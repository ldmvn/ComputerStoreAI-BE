import { verifyAccessToken } from '../services/token.service.js';

function extractToken(req) {
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && token) return token;
  return null;
}

// Optional auth — attaches req.user if a valid token is present (cookie or Bearer), but never rejects.
export function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (token) {
    try { req.user = verifyAccessToken(token); } catch { /* ignore */ }
  }
  return next();
}

export function authenticateToken(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để tiếp tục.' });
  }
  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
  }
}
