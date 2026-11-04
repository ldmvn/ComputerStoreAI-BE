import { prisma } from '../config/prisma.js';

// Lists ALL accounts (customers + admins). Role is carried per-row:
// role === 'ADMIN' → shown with adminRole (or "Admin (Toàn quyền)" if adminRoleId is null)
// role === 'USER'  → shown as "Khách hàng"

function accountSelect() {
  return {
    id: true, fullName: true, email: true, phone: true,
    isActive: true, createdAt: true,
    role: true, adminRoleId: true,
    adminRole: { select: { id: true, name: true, slug: true, isSystem: true, isActive: true } },
  };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getCustomerStats() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const where = { role: { not: 'ADMIN' } };
  const [total, newCount, withOrders] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.count({ where: { ...where, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.user.count({ where: { ...where, orders: { some: {} } } }),
  ]);

  return { total, newCount, withOrders, withoutOrders: total - withOrders };
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listCustomers({ page = 1, limit = 20, search, filter = 'all', sortBy = 'newest' } = {}) {
  let where = {};

  if (search?.trim()) {
    where = {
      ...where,
      OR: [
        { fullName: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ],
    };
  }

  if (filter === 'no_orders') {
    where = { ...where, orders: { none: {} } };
  } else if (filter === 'has_orders') {
    where = { ...where, orders: { some: {} } };
  } else if (filter === 'returning') {
    const rows = await prisma.order.groupBy({
      by: ['userId'],
      _count: { id: true },
      having: { id: { _count: { gte: 2 } } },
    });
    const ids = rows.map(r => r.userId);
    if (ids.length === 0) return { customers: [], total: 0, page, limit };
    where = { ...where, id: { in: ids } };
  } else if (filter === 'admins') {
    where = { ...where, role: 'ADMIN' };
  } else if (filter === 'customers') {
    where = { ...where, role: { not: 'ADMIN' } };
  }

  // sortBy = 'spent' requires a post-sort pass
  if (sortBy === 'spent') {
    return listSortedBySpent(where, page, limit);
  }

  const orderBy =
    sortBy === 'oldest'  ? { createdAt: 'asc' } :
    sortBy === 'orders'  ? { orders: { _count: 'desc' } } :
    { createdAt: 'desc' };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { ...accountSelect(), _count: { select: { orders: true } } },
      orderBy,
      skip: (page - 1) * limit, take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return enrichWithSpent(users, total, page, limit);
}

async function listSortedBySpent(where, page, limit) {
  const allUsers = await prisma.user.findMany({
    where,
    select: { ...accountSelect(), _count: { select: { orders: true } } },
  });

  const total = allUsers.length;
  if (total === 0) return { customers: [], total: 0, page, limit };

  const userIds = allUsers.map(u => u.id);
  const [spendAgg, lastOrderRows] = await Promise.all([
    prisma.order.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, status: 'DELIVERED' },
      _sum: { subtotal: true },
    }),
    getLastOrderRows(userIds),
  ]);

  const spendMap = Object.fromEntries(spendAgg.map(s => [s.userId, s._sum.subtotal ?? 0]));
  const lastMap = Object.fromEntries(lastOrderRows.map(o => [o.userId, o.createdAt]));

  const sorted = allUsers
    .map(u => ({ ...u, orderCount: u._count.orders, totalSpent: spendMap[u.id] ?? 0, lastOrderAt: lastMap[u.id] ?? null }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice((page - 1) * limit, page * limit)
    .map(({ _count, ...rest }) => rest);

  return { customers: sorted, total, page, limit };
}

async function enrichWithSpent(users, total, page, limit) {
  if (users.length === 0) return { customers: [], total, page, limit };

  const userIds = users.map(u => u.id);
  const [spendAgg, lastOrderRows] = await Promise.all([
    prisma.order.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, status: 'DELIVERED' },
      _sum: { subtotal: true },
    }),
    getLastOrderRows(userIds),
  ]);

  const spendMap = Object.fromEntries(spendAgg.map(s => [s.userId, s._sum.subtotal ?? 0]));
  const lastMap = Object.fromEntries(lastOrderRows.map(o => [o.userId, o.createdAt]));

  return {
    customers: users.map(u => ({
      id: u.id, fullName: u.fullName, email: u.email, phone: u.phone,
      isActive: u.isActive, createdAt: u.createdAt,
      role: u.role, adminRoleId: u.adminRoleId, adminRole: u.adminRole,
      orderCount: u._count.orders,
      totalSpent: spendMap[u.id] ?? 0,
      lastOrderAt: lastMap[u.id] ?? null,
    })),
    total, page, limit,
  };
}

async function getLastOrderRows(userIds) {
  if (userIds.length === 0) return [];
  return prisma.order.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    distinct: ['userId'],
  });
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createCustomer({ fullName, email, phone, password }) {
  const bcrypt = (await import('bcryptjs')).default;
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] } });
  if (existing) {
    const field = existing.email === email ? 'Email' : 'Số điện thoại';
    const error = new Error(`${field} đã được sử dụng.`);
    error.status = 409;
    throw error;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: { fullName, email, phone: phone || null, passwordHash, role: 'USER', isActive: true },
    select: accountSelect(),
  });
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateCustomer(id, { fullName, email, phone, isActive, password }) {
  const bcrypt = (await import('bcryptjs')).default;
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) { const e = new Error('Tài khoản không tồn tại.'); e.status = 404; throw e; }

  if (email && email !== existing.email) {
    const dup = await prisma.user.findUnique({ where: { email } });
    if (dup) { const e = new Error('Email đã được sử dụng.'); e.status = 409; throw e; }
  }
  if (phone && phone !== existing.phone) {
    const dup = await prisma.user.findUnique({ where: { phone } });
    if (dup) { const e = new Error('Số điện thoại đã được sử dụng.'); e.status = 409; throw e; }
  }

  const data = {};
  if (fullName !== undefined) data.fullName = fullName;
  if (email !== undefined) data.email = email;
  if (phone !== undefined) data.phone = phone || null;
  if (isActive !== undefined) data.isActive = isActive;
  if (password) data.passwordHash = await bcrypt.hash(password, 10);

  const updated = await prisma.user.update({ where: { id }, data, select: accountSelect() });
  const { invalidatePermissionCache } = await import('./rbac.service.js');
  invalidatePermissionCache(id);
  return updated;
}

// ── Role ──────────────────────────────────────────────────────────────────────

export async function updateAccountRole(id, { role, adminRoleId }, requesterId) {
  if (id === requesterId) {
    const e = new Error('Không thể thay đổi vai trò của chính mình.'); e.status = 400; throw e;
  }
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) { const e = new Error('Tài khoản không tồn tại.'); e.status = 404; throw e; }

  if (role === 'ADMIN' && adminRoleId) {
    const r = await prisma.role.findUnique({ where: { id: adminRoleId } });
    if (!r || !r.isActive) { const e = new Error('Vai trò không hợp lệ hoặc đã bị vô hiệu hóa.'); e.status = 422; throw e; }
  }

  if (existing.role === 'ADMIN' && role !== 'ADMIN') {
    const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
    if (activeAdmins <= 1) { const e = new Error('Không thể hạ quyền quản trị viên cuối cùng đang hoạt động.'); e.status = 400; throw e; }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      role: role === 'ADMIN' ? 'ADMIN' : 'USER',
      adminRoleId: role === 'ADMIN' ? (adminRoleId || null) : null,
    },
    select: accountSelect(),
  });
  const { invalidatePermissionCache } = await import('./rbac.service.js');
  invalidatePermissionCache(id);
  return updated;
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteCustomer(id, requesterId) {
  if (id === requesterId) {
    const e = new Error('Không thể xóa tài khoản của chính mình.'); e.status = 400; throw e;
  }
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) { const e = new Error('Tài khoản không tồn tại.'); e.status = 404; throw e; }
  if (existing.role === 'ADMIN') {
    const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
    if (activeAdmins <= 1) { const e = new Error('Không thể xóa quản trị viên cuối cùng đang hoạt động.'); e.status = 400; throw e; }
  }
  await prisma.user.delete({ where: { id } });
}

// ── Activity logs ─────────────────────────────────────────────────────────────

export async function getCustomerActivity(userId, { page = 1, limit = 30 } = {}) {
  const { listLogs } = await import('./activityLog.service.js');
  return listLogs({ userId, page, limit });
}

// ── Detail ────────────────────────────────────────────────────────────────────

export async function getCustomer(id) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      ...accountSelect(),
      orders: {
        select: {
          id: true, status: true, paymentMethod: true, subtotal: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
    },
  });
  if (!user) return null;

  const [spendAgg, deliveredCount] = await Promise.all([
    prisma.order.aggregate({
      where: { userId: id, status: 'DELIVERED' },
      _sum: { subtotal: true },
    }),
    prisma.order.count({ where: { userId: id, status: 'DELIVERED' } }),
  ]);

  const lastOrder = user.orders[0] ?? null;

  return {
    ...user,
    totalOrders: user.orders.length,
    deliveredOrders: deliveredCount,
    totalSpent: spendAgg._sum.subtotal ?? 0,
    lastOrderAt: lastOrder?.createdAt ?? null,
  };
}
