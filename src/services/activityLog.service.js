import { prisma } from '../config/prisma.js';

// Sensitive field names to strip from before/after snapshots
const SENSITIVE_FIELDS = ['passwordHash', 'password', 'token', 'accessToken', 'refreshToken', 'otp', 'apiKey', 'secret'];

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = { ...obj };
  for (const field of SENSITIVE_FIELDS) delete clean[field];
  return clean;
}

export async function logActivity({
  req,
  userId,
  action,
  module,
  targetId,
  targetLabel,
  description,
  success = true,
  before,
  after,
}) {
  try {
    const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip || null;
    const ua = req?.headers?.['user-agent']?.slice(0, 500) || null;
    // Resolve user identity (prefer passed userId, fall back to req.user)
    const uid = userId ?? req?.user?.userId ?? null;
    let userEmail = null;
    let userName = null;
    if (uid) {
      const u = await prisma.user.findUnique({ where: { id: uid }, select: { email: true, fullName: true } }).catch(() => null);
      userEmail = u?.email ?? null;
      userName = u?.fullName ?? null;
    }
    await prisma.activityLog.create({
      data: {
        userId: uid,
        userEmail,
        userName,
        action,
        module,
        targetId: targetId != null ? String(targetId) : null,
        targetLabel: targetLabel ?? null,
        description: description ?? null,
        success,
        ipAddress: ip,
        userAgent: ua,
        before: before ? sanitize(before) : undefined,
        after: after ? sanitize(after) : undefined,
      },
    });
  } catch {
    // Non-fatal — log silently to console, never throw
    console.warn('[ActivityLog] Failed to write activity log entry');
  }
}

export async function listLogs({ page = 1, limit = 30, module, action, userId, success, from, to, search }) {
  const where = {};
  if (module) where.module = module;
  if (action) where.action = action;
  if (userId) where.userId = Number(userId);
  if (success != null) where.success = success === 'true' || success === true;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  if (search) {
    where.OR = [
      { userEmail: { contains: search } },
      { userName: { contains: search } },
      { description: { contains: search } },
      { targetLabel: { contains: search } },
    ];
  }
  const [total, logs] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, userId: true, userEmail: true, userName: true,
        action: true, module: true, targetId: true, targetLabel: true,
        description: true, success: true, ipAddress: true, createdAt: true,
      },
    }),
  ]);
  return { logs, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getLogDetail(id) {
  return prisma.activityLog.findUniqueOrThrow({ where: { id } });
}
