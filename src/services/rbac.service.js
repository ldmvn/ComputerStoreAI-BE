import { prisma } from '../config/prisma.js';

// In-memory TTL cache for admin permission sets.
// TTL is short enough that role changes propagate within one window.
const PERM_CACHE_TTL = (parseInt(process.env.RBAC_CACHE_TTL_MS) || 60) * 1000;
const permCache = new Map(); // userId → { perms: Set, expiresAt: number }

export function invalidatePermissionCache(userId) {
  if (userId) permCache.delete(userId);
  else permCache.clear();
}

async function fetchUserPermissions(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      isActive: true,
      adminRoleId: true,
      adminRole: {
        select: {
          isActive: true,
          isSystem: true,
          permissions: { select: { permission: { select: { module: true, action: true } } } },
        },
      },
    },
  });
  if (!user || !user.isActive) return new Set();
  if (user.role === 'ADMIN' && !user.adminRoleId) return new Set(['*']);
  if (!user.adminRole?.isActive) return new Set();
  if (user.adminRole.isSystem) return new Set(['*']);
  return new Set(user.adminRole.permissions.map(({ permission: p }) => `${p.module}:${p.action}`));
}

export async function getUserPermissions(userId) {
  const now = Date.now();
  const cached = permCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.perms;
  const perms = await fetchUserPermissions(userId);
  permCache.set(userId, { perms, expiresAt: now + PERM_CACHE_TTL });
  return perms;
}

// CRUD helpers for roles and permissions

export async function listRoles() {
  return prisma.role.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { adminUsers: true } },
    },
  });
}

export async function createRole({ name, slug, description, sortOrder = 0 }) {
  return prisma.role.create({
    data: { name, slug, description, sortOrder, updatedAt: new Date() },
    include: { permissions: { include: { permission: true } }, _count: { select: { adminUsers: true } } },
  });
}

export async function updateRole(id, { name, slug, description, sortOrder, isActive }) {
  const role = await prisma.role.findUniqueOrThrow({ where: { id } });
  if (role.isSystem && isActive === false) throw Object.assign(new Error('Không thể vô hiệu hóa vai trò hệ thống.'), { status: 400 });
  return prisma.role.update({
    where: { id },
    data: { name, slug, description, sortOrder, isActive, updatedAt: new Date() },
    include: { permissions: { include: { permission: true } }, _count: { select: { adminUsers: true } } },
  });
}

export async function deleteRole(id) {
  const role = await prisma.role.findUniqueOrThrow({ where: { id } });
  if (role.isSystem) throw Object.assign(new Error('Không thể xóa vai trò hệ thống.'), { status: 400 });
  const inUse = await prisma.user.count({ where: { adminRoleId: id } });
  if (inUse > 0) throw Object.assign(new Error(`Vai trò đang được sử dụng bởi ${inUse} tài khoản. Gán vai trò khác trước khi xóa.`), { status: 409 });
  await prisma.role.delete({ where: { id } });
}

export async function setRolePermissions(roleId, permissionIds) {
  const role = await prisma.role.findUniqueOrThrow({ where: { id: roleId } });
  if (role.isSystem) throw Object.assign(new Error('Không thể thay đổi quyền của vai trò hệ thống.'), { status: 400 });
  const valid = await prisma.permission.findMany({ where: { id: { in: permissionIds } }, select: { id: true } });
  const validIds = new Set(valid.map(p => p.id));
  const invalid = permissionIds.filter(id => !validIds.has(id));
  if (invalid.length) throw Object.assign(new Error(`Permission ID không hợp lệ: ${invalid.join(', ')}`), { status: 422 });
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({ data: permissionIds.map(permissionId => ({ roleId, permissionId })), skipDuplicates: true }),
  ]);
  // Invalidate cache for all users with this role so new permissions take effect immediately.
  invalidatePermissionCache();
  return prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: true } }, _count: { select: { adminUsers: true } } },
  });
}

export async function listPermissions() {
  return prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
}
