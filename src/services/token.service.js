import jwt from 'jsonwebtoken';

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured.');
  return process.env.JWT_SECRET;
};

export function createAccessToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '2h' },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, getJwtSecret());
}
