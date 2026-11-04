import bcrypt from 'bcryptjs';
import { createUser, findSafeUserById, findUserByEmail, findUserByIdentifier, findUserByPhone, findUserById, updateUserById } from '../repositories/user.repository.js';
import { createAccessToken } from './token.service.js';

export class AuthConflictError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'AuthConflictError';
    this.statusCode = 409;
    this.field = field;
  }
}

export async function registerUser({ fullName, email, phone, password }) {
  if (await findUserByEmail(email)) throw new AuthConflictError('email', 'Email này đã được sử dụng.');
  if (await findUserByPhone(phone)) throw new AuthConflictError('phone', 'Số điện thoại này đã được sử dụng.');

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    return await createUser({ fullName, email, phone, passwordHash, role: 'USER' });
  } catch (error) {
    if (error?.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target || '');
      if (target.includes('email')) throw new AuthConflictError('email', 'Email này đã được sử dụng.');
      if (target.includes('phone')) throw new AuthConflictError('phone', 'Số điện thoại này đã được sử dụng.');
    }
    throw error;
  }
}

export class AuthCredentialsError extends Error {
  constructor() {
    super('Email/số điện thoại hoặc mật khẩu không chính xác.');
    this.name = 'AuthCredentialsError';
    this.statusCode = 401;
  }
}

export class AuthAccountDisabledError extends Error {
  constructor() {
    super('Tài khoản hiện đang bị khóa.');
    this.name = 'AuthAccountDisabledError';
    this.statusCode = 403;
  }
}

export async function loginUser({ identifier, password }) {
  const user = await findUserByIdentifier(identifier);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new AuthCredentialsError();
  if (!user.isActive) throw new AuthAccountDisabledError();

  const safeUser = await findSafeUserById(user.id);
  return { token: createAccessToken(user), user: safeUser };
}

const ALLOWED_GENDERS = new Set(['male', 'female', 'other', '']);

export async function updateUserProfile(userId, { fullName, phone, gender }) {
  if (phone !== undefined && phone !== null && phone !== '') {
    const existing = await findUserByPhone(phone);
    if (existing && existing.id !== userId) throw new AuthConflictError('phone', 'Số điện thoại này đã được sử dụng.');
  }
  const data = {};
  if (fullName !== undefined) data.fullName = fullName.trim();
  if (phone !== undefined) data.phone = phone ? phone.trim() : null;
  if (gender !== undefined) {
    const g = typeof gender === 'string' ? gender.trim() : '';
    if (!ALLOWED_GENDERS.has(g)) throw new AuthConflictError('gender', 'Giới tính không hợp lệ.');
    data.gender = g || null;
  }
  return updateUserById(userId, data);
}

export async function getCurrentUser(userId) {
  const user = await findSafeUserById(userId);
  if (!user || !user.isActive) throw new AuthCredentialsError();
  return user;
}

export class AuthWrongPasswordError extends Error {
  constructor() {
    super('Mật khẩu hiện tại không đúng.');
    this.name = 'AuthWrongPasswordError';
    this.statusCode = 400;
    this.field = 'currentPassword';
  }
}

export class AuthNoPasswordError extends Error {
  constructor() {
    super('Tài khoản đăng nhập qua Google không có mật khẩu. Vui lòng dùng tính năng quên mật khẩu.');
    this.name = 'AuthNoPasswordError';
    this.statusCode = 400;
  }
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await findUserById(userId);
  if (!user) throw new AuthCredentialsError();
  if (!user.passwordHash) throw new AuthNoPasswordError();
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new AuthWrongPasswordError();
  const newHash = await bcrypt.hash(newPassword, 12);
  await updateUserById(userId, { passwordHash: newHash });
}
