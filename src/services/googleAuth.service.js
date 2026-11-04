import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { findSafeUserById } from '../repositories/user.repository.js';
import { AuthAccountDisabledError } from './auth.service.js';
import { createAccessToken } from './token.service.js';

export class GoogleAuthError extends Error {
  constructor(code, statusCode = 400) {
    super('Không thể đăng nhập bằng Google. Vui lòng thử lại.');
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const hashGoogleCode = value => createHash('sha256').update(value).digest('hex');
export const googleChallenge = value => createHash('sha256').update(value).digest('base64url');

export async function resolveGoogleUser(profile) {
  if (typeof profile?.sub !== 'string' || !profile.sub || profile.sub.length > 191) throw new GoogleAuthError('invalid_token');
  if (typeof profile.email !== 'string' || !/^\S+@\S+\.\S+$/.test(profile.email) || profile.email.length > 191) throw new GoogleAuthError('missing_email');
  if (profile.email_verified !== true) throw new GoogleAuthError('unverified_email');
  const email = profile.email.trim().toLowerCase();
  const avatarUrl = typeof profile.picture === 'string' && /^https:\/\//.test(profile.picture) && profile.picture.length <= 1000 ? profile.picture : null;
  let user = await prisma.user.findUnique({ where: { googleId: profile.sub } });
  if (!user) user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    if (!user.isActive) throw new AuthAccountDisabledError();
    if (user.googleId && user.googleId !== profile.sub) throw new GoogleAuthError('account_conflict');
    // Link only a verified Google email; preserve password, role and local profile.
    try {
      const linked = await prisma.user.updateMany({
        where: { id: user.id, googleId: user.googleId },
        data: { googleId: profile.sub, ...(!user.avatarUrl && avatarUrl ? { avatarUrl } : {}) },
      });
      if (linked.count !== 1) throw new GoogleAuthError('account_conflict');
      return await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    } catch (error) {
      if (['P2002', 'P2025'].includes(error?.code)) throw new GoogleAuthError('account_conflict');
      throw error;
    }
  }
  try {
    return await prisma.user.create({ data: {
      email, googleId: profile.sub, avatarUrl, phone: null,
      fullName: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim().slice(0, 191) : email.split('@')[0],
      // An unknown random password preserves the existing password login/reset schema.
      passwordHash: await bcrypt.hash(randomBytes(48).toString('base64url'), 12), role: 'USER',
    } });
  } catch (error) {
    // Concurrent callbacks or registration must not create duplicate users.
    if (error?.code === 'P2002') return resolveGoogleUser(profile);
    throw error;
  }
}

export async function issueGoogleExchange(userId, challenge) {
  await prisma.googleLoginExchange.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const code = randomBytes(32).toString('base64url');
  await prisma.googleLoginExchange.create({ data: { codeHash: hashGoogleCode(code), userId, challenge, expiresAt: new Date(Date.now() + 60000) } });
  return code;
}

export async function exchangeGoogleLogin(code, verifier) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code) || typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw new GoogleAuthError('invalid_exchange');
  const codeHash = hashGoogleCode(code);
  const challenge = googleChallenge(verifier);
  const ticket = await prisma.googleLoginExchange.findUnique({ where: { codeHash } });
  if (!ticket || ticket.challenge !== challenge || ticket.expiresAt <= new Date()) throw new GoogleAuthError('invalid_exchange');
  // Atomic consumption ensures only one concurrent exchange can receive a JWT.
  const consumed = await prisma.googleLoginExchange.deleteMany({ where: { codeHash, challenge, expiresAt: { gt: new Date() } } });
  if (consumed.count !== 1) throw new GoogleAuthError('invalid_exchange');
  const user = await findSafeUserById(ticket.userId);
  if (!user || !user.isActive) throw new AuthAccountDisabledError();
  return { user, token: createAccessToken(user) };
}
