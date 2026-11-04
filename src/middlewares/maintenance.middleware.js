import * as svc from '../services/storeSetting.service.js';
import { verifyAccessToken } from '../services/token.service.js';
import { getUserPermissions } from '../services/rbac.service.js';

let cached = { on: false, message: '', ts: 0 };
const TTL = 10_000;

async function readFlag() {
  const now = Date.now();
  if (now - cached.ts < TTL) return cached;
  const [mode, msg] = await Promise.all([
    svc.getSetting('system.maintenance_mode'),
    svc.getSetting('system.maintenance_message'),
  ]);
  cached = { on: mode === 'true', message: msg || 'Website đang bảo trì, vui lòng quay lại sau.', ts: now };
  return cached;
}

const BYPASS_PREFIXES = [
  '/api/health',
  '/api/auth',
  '/api/admin/',
  '/api/content/',
  '/media/',
];

function isBypassed(path) {
  return BYPASS_PREFIXES.some(p => path.startsWith(p));
}

function extractToken(req) {
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && token) return token;
  return null;
}

export async function maintenanceGuard(req, res, next) {
  try {
    const flag = await readFlag();
    if (!flag.on) return next();

    if (isBypassed(req.path)) return next();

    const token = extractToken(req);
    if (token) {
      try {
        const payload = verifyAccessToken(token);
        const perms = await getUserPermissions(payload.userId);
        if (perms.has('*') || perms.has('settings:manage')) return next();
      } catch { /* invalid token → treat as guest */ }
    }

    return res.status(503).json({
      success: false,
      maintenance: true,
      message: flag.message,
    });
  } catch {
    return next();
  }
}
