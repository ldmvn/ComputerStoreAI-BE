import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { ensureResetMailReady, logResetMailFailure, sendResetOtp } from './passwordResetMail.service.js';
import { OTP_TTL_SECONDS } from '../config/passwordReset.js';

export { OTP_TTL_SECONDS };
export const RESEND_SECONDS = 60;
export const MAX_ATTEMPTS = 5;
export const RESET_TOKEN_TTL_SECONDS = 600;
const genericMessage = 'Nếu email tồn tại trong hệ thống, mã xác nhận đã được gửi.';
const normalizeEmail = email => email.trim().toLowerCase();

function fail(message, statusCode = 400, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

export function resetHash(value) {
  const secret = process.env.PASSWORD_RESET_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('Password reset secret is not configured.');
  return createHmac('sha256', secret).update(value).digest('hex');
}

function otpMatches(record, otp) {
  if (!record.otpHash || !/^[a-f0-9]{64}$/.test(record.otpHash)) return false;
  return timingSafeEqual(
    Buffer.from(record.otpHash, 'hex'),
    Buffer.from(resetHash(record.challengeId + ':' + otp), 'hex'),
  );
}

// Serializable prevents verification/reset races; retry upsert unique-key races too.
async function transaction(work, retryUnique = false) {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: 'Serializable' }); }
    catch (error) {
      const retryable = error.code === 'P2034' || (retryUnique && error.code === 'P2002');
      if (!retryable || attempt >= 4) throw error;
    }
  }
}

export async function cleanupExpiredPasswordResets(now = new Date()) {
  // Expire OTP material even without user interaction; keep a verified reset session.
  await prisma.passwordReset.updateMany({
    where: { expiresAt: { lte: now }, otpHash: { not: null } },
    data: { otpHash: null },
  });
  // Keep hourly counters until their window ends; never delete a live reset token.
  return prisma.passwordReset.deleteMany({
    where: {
      expiresAt: { lte: now }, windowStart: { lte: new Date(now.getTime() - 3600000) },
      OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { lte: now } }],
    },
  });
}

export async function requestPasswordReset(inputEmail) {
  const email = normalizeEmail(inputEmail);
  await ensureResetMailReady();
  await cleanupExpiredPasswordResets();
  const { record, otp } = await transaction(async tx => {
    const now = new Date();
    const previous = await tx.passwordReset.findUnique({ where: { email } });
    const sameWindow = previous && now - previous.windowStart < 3600000;
    if (sameWindow && previous.requestCount >= 5) throw fail('Bạn đã yêu cầu quá nhiều mã. Vui lòng thử lại sau 1 giờ.', 429);
    // Every accepted request replaces the previous OTP, including a reopened form.
    // The UI still waits 60s for its resend button; hourly/IP guards prevent abuse.
    let otp;
    do { otp = String(randomInt(0, 1000000)).padStart(6, '0'); }
    while (previous && otpMatches(previous, otp));
    const challengeId = randomBytes(32).toString('hex');
    const data = {
      challengeId, otpHash: resetHash(challengeId + ':' + otp), tokenHash: null,
      expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000), tokenExpiresAt: null,
      attempts: 0, verifiedAt: null, usedAt: null, sentAt: now,
      windowStart: sameWindow ? previous.windowStart : now,
      requestCount: sameWindow ? previous.requestCount + 1 : 1,
    };
    const record = await tx.passwordReset.upsert({ where: { email }, create: { email, ...data }, update: data });
    return { record, otp };
  }, true);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.isActive) {
    try { await sendResetOtp(email, otp); }
    catch (error) {
      await prisma.passwordReset.updateMany({
        where: { email, challengeId: record.challengeId },
        data: { otpHash: null, tokenHash: null, usedAt: new Date() },
      });
      logResetMailFailure('OTP delivery', error);
      throw fail('Không thể gửi mã xác nhận lúc này. Vui lòng thử lại.', 503);
    }
  }
  // Start the final five-minute window when SMTP has accepted the message, so
  // SMTP latency does not shorten the user's countdown or contradict the email.
  const sentAt = new Date();
  const expiresAt = new Date(sentAt.getTime() + OTP_TTL_SECONDS * 1000);
  const finalized = await prisma.passwordReset.updateMany({
    where: { email, challengeId: record.challengeId, verifiedAt: null, usedAt: null },
    data: { sentAt, expiresAt },
  });
  if (!finalized.count) throw fail('Yêu cầu này đã được thay thế. Vui lòng sử dụng mã của yêu cầu mới nhất.', 409);
  return {
    message: genericMessage, challengeId: record.challengeId, expiresIn: OTP_TTL_SECONDS,
    expiresAt: expiresAt.toISOString(), serverTime: new Date().toISOString(), resendAfter: RESEND_SECONDS,
  };
}

export async function verifyPasswordResetOtp({ email: inputEmail, otp: inputOtp }) {
  const email = normalizeEmail(inputEmail);
  const otp = inputOtp.trim();
  const resetToken = randomBytes(32).toString('hex');
  const outcome = await transaction(async tx => {
    // One row per normalized email: always read the latest OTP. A stale client
    // challengeId must not reject a correct latest code; HMAC uses the stored id.
    const record = await tx.passwordReset.findUnique({ where: { email } });
    if (!record || record.usedAt || record.verifiedAt) return 'unavailable';
    const now = new Date();
    if (record.expiresAt <= now) return 'expired';
    if (record.attempts >= MAX_ATTEMPTS) return 'locked';
    if (!record.otpHash) return 'unavailable';
    if (!otpMatches(record, otp)) {
      const attempts = record.attempts + 1;
      await tx.passwordReset.update({ where: { email }, data: { attempts } });
      return attempts >= MAX_ATTEMPTS ? 'locked' : 'invalid';
    }
    const user = await tx.user.findUnique({ where: { email } });
    if (!user?.isActive) return 'unavailable';
    await tx.passwordReset.update({ where: { email }, data: {
      verifiedAt: now, tokenHash: resetHash(resetToken),
      tokenExpiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_SECONDS * 1000),
    } });
    return 'accepted';
  });
  const errors = {
    unavailable: 'Mã xác nhận không hợp lệ hoặc đã được sử dụng. Vui lòng yêu cầu mã mới.',
    expired: 'Mã xác nhận đã hết hạn sau 5 phút. Vui lòng yêu cầu mã mới.',
    locked: 'Bạn đã nhập sai mã 5 lần. Vui lòng yêu cầu mã mới.',
    invalid: 'Mã xác nhận không đúng. Vui lòng kiểm tra mã mới nhất trong email.',
  };
  if (outcome !== 'accepted') throw fail(errors[outcome], 400, 'OTP_' + outcome.toUpperCase());
  return { resetToken, expiresIn: RESET_TOKEN_TTL_SECONDS };
}

export async function resetPassword({ email: inputEmail, resetToken, password }) {
  const email = normalizeEmail(inputEmail);
  const passwordHash = await bcrypt.hash(password, 12);
  const accepted = await transaction(async tx => {
    const record = await tx.passwordReset.findUnique({ where: { email } });
    if (!record?.verifiedAt || record.usedAt || !record.tokenHash || !record.tokenExpiresAt ||
        record.tokenExpiresAt <= new Date() || record.tokenHash !== resetHash(resetToken.trim())) return false;
    const updated = await tx.user.updateMany({ where: { email, isActive: true }, data: { passwordHash } });
    if (!updated.count) return false;
    await tx.passwordReset.update({ where: { email }, data: {
      usedAt: new Date(), otpHash: null, tokenHash: null, tokenExpiresAt: null,
    } });
    return true;
  });
  if (!accepted) throw fail('Phiên đổi mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.');
  return { message: 'Đổi mật khẩu thành công' };
}
