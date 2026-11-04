import nodemailer from 'nodemailer';
import { OTP_TTL_SECONDS } from '../config/passwordReset.js';

let transport;
let verification;
let verifiedAt = 0;
const VERIFY_CACHE_MS = 5 * 60 * 1000;

function smtpError(message, code = 'SMTP_CONFIG_MISSING') {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code;
  return error;
}

function smtpConfiguration() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const isGmail = host?.toLowerCase() === 'smtp.gmail.com';
  // Google displays App Passwords in groups of four; remove spaces for authentication.
  const pass = isGmail ? process.env.SMTP_PASS?.replace(/\s/g, '') : process.env.SMTP_PASS;
  const missing = ['SMTP_HOST', 'SMTP_FROM'].filter(key => !process.env[key]?.trim());
  if (isGmail || user) {
    if (!user) missing.push('SMTP_USER');
    if (!pass) missing.push('SMTP_PASS');
  }
  if (missing.length) throw smtpError('Thiếu cấu hình SMTP: ' + missing.join(', ') + '. Vui lòng điền trong backend/.env.');
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw smtpError('SMTP_PORT không hợp lệ trong backend/.env.', 'SMTP_CONFIG_INVALID');
  if (isGmail && (port !== 587 || process.env.SMTP_SECURE === 'true')) {
    throw smtpError('Gmail SMTP cần SMTP_PORT=587 và SMTP_SECURE=false trong backend/.env.', 'SMTP_CONFIG_INVALID');
  }
  return {
    host, port, secure: isGmail ? false : process.env.SMTP_SECURE === 'true',
    ...(user ? { auth: { user, pass } } : {}),
    ...(isGmail ? { requireTLS: true } : {}),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false,
  };
}

export function getResetMailTransport() {
  // Validate even after caching, so a missing env is never silently accepted.
  const config = smtpConfiguration();
  transport ||= nodemailer.createTransport(config);
  return transport;
}

function safeDetail(error) {
  let message = String(error?.message || 'Unknown SMTP error');
  for (const secret of [process.env.SMTP_PASS, process.env.SMTP_PASS?.replace(/\s/g, '')]) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  return {
    code: error?.code || 'SMTP_ERROR',
    ...(error?.responseCode ? { responseCode: error.responseCode } : {}),
    ...(error?.command ? { command: error.command } : {}),
    message,
  };
}

export function logResetMailFailure(context, error) {
  verifiedAt = 0;
  console.error('[SMTP] ' + context + ' failed:', safeDetail(error));
}

export async function verifyResetMailConnection() {
  if (verification) return verification;
  verification = (async () => {
    try {
      await getResetMailTransport().verify();
      verifiedAt = Date.now();
      console.info('[SMTP] ready — transporter.verify() succeeded.');
      return true;
    } catch (error) {
      logResetMailFailure('verification', error);
      throw error;
    }
  })();
  try { return await verification; }
  finally { verification = undefined; }
}

export async function ensureResetMailReady() {
  getResetMailTransport();
  if (verifiedAt && Date.now() - verifiedAt < VERIFY_CACHE_MS) return;
  try { await verifyResetMailConnection(); }
  catch (error) {
    if (error.statusCode === 503) throw error;
    const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'SMTP_ERROR';
    if (code === 'EAUTH') throw smtpError('SMTP chưa xác thực được Gmail (EAUTH). Kiểm tra SMTP_USER và SMTP_PASS trong backend/.env.', code);
    throw smtpError('Chưa kết nối được máy chủ SMTP (' + code + '). Kiểm tra mạng và cấu hình SMTP trong backend/.env.', code);
  }
}

export async function sendResetOtp(email, otp) {
  const minutes = OTP_TTL_SECONDS / 60;
  const info = await getResetMailTransport().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'DUCMANHPC — Mã xác nhận đổi mật khẩu',
    text: 'DUCMANHPC\n\nMã xác nhận của bạn là: ' + otp + '\nOTP có hiệu lực ' + minutes + ' phút. Không chia sẻ mã này với bất kỳ ai.\nNếu bạn không yêu cầu đổi mật khẩu, hãy bỏ qua email này.',
    html: '<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:480px;padding:24px">' +
      '<h2>DUCMANHPC</h2><p>Mã xác nhận đổi mật khẩu của bạn:</p>' +
      '<p style="font-size:32px;font-weight:bold;letter-spacing:8px">' + otp + '</p>' +
      '<p>OTP có hiệu lực <strong>' + minutes + ' phút</strong>.</p>' +
      '<p>Không chia sẻ mã này với bất kỳ ai.</p>' +
      '<p>Nếu bạn không yêu cầu đổi mật khẩu, hãy bỏ qua email này.</p></div>',
  });
  if (!info.accepted?.length) throw smtpError('SMTP không chấp nhận người nhận.', 'SMTP_RECIPIENT_REJECTED');
  console.info('[SMTP] OTP message accepted by mail server.');
  return info;
}

export async function sendTestMail(to) {
  await ensureResetMailReady();
  const info = await getResetMailTransport().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Email thử nghiệm — DUCMANH PC',
    text: 'Đây là email thử nghiệm từ hệ thống DUCMANH PC.\n\nNếu bạn nhận được email này, cấu hình SMTP đang hoạt động tốt.',
    html: '<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:480px;padding:24px 32px;border:1px solid #e2e8f0;border-radius:12px">' +
      '<h2 style="color:#C4480A;margin-bottom:8px">DUCMANH PC</h2>' +
      '<p style="margin:0 0 12px">Đây là email thử nghiệm từ hệ thống DUCMANH PC.</p>' +
      '<p style="margin:0 0 12px">Nếu bạn nhận được email này, cấu hình SMTP đang hoạt động tốt.</p>' +
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>' +
      '<p style="font-size:12px;color:#94a3b8;margin:0">Email này được gửi từ trang quản trị DUCMANH PC. Vui lòng không trả lời.</p></div>',
  });
  if (!info.accepted?.length) throw smtpError('SMTP không chấp nhận người nhận.', 'SMTP_RECIPIENT_REJECTED');
  console.info('[SMTP] Test email accepted by mail server.');
  return info;
}
