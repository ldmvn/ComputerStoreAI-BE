import { prisma } from '../config/prisma.js';

// ── Date range helpers ──────────────────────────────────────────────────────

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// range: '7d' | '30d' | 'month' | '12m' | 'custom'
export function resolveRange({ range = '7d', from, to } = {}) {
  const now = new Date();
  if (range === 'custom' && from && to) {
    return { start: startOfDay(new Date(from)), end: endOfDay(new Date(to)), bucket: 'day' };
  }
  if (range === '30d') {
    const start = startOfDay(now); start.setDate(start.getDate() - 29);
    return { start, end: endOfDay(now), bucket: 'day' };
  }
  if (range === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start, end: endOfDay(now), bucket: 'day' };
  }
  if (range === '12m') {
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    return { start, end: endOfDay(now), bucket: 'month' };
  }
  // default '7d'
  const start = startOfDay(now); start.setDate(start.getDate() - 6);
  return { start, end: endOfDay(now), bucket: 'day' };
}

// Equal-length period immediately preceding `start`
function previousPeriod(start, end) {
  const lengthMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - lengthMs);
  return { start: prevStart, end: prevEnd };
}

function pctChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

const NON_ADMIN = { not: 'ADMIN' };

// ── KPI summary ──────────────────────────────────────────────────────────────

export async function getKpiSummary() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const yesterdayStart = startOfDay(new Date(now.getTime() - 86400000));
  const yesterdayEnd = endOfDay(new Date(now.getTime() - 86400000));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthSameDay = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

  const [
    todayRevenueAgg, yesterdayRevenueAgg,
    monthRevenueAgg, lastMonthToDateAgg,
    totalRevenueAgg,
    todayOrders, yesterdayOrders,
    newCustomersToday, newCustomersYesterday,
    lowStockRow,
  ] = await Promise.all([
    prisma.order.aggregate({ where: { status: 'DELIVERED', createdAt: { gte: todayStart, lte: todayEnd } }, _sum: { subtotal: true } }),
    prisma.order.aggregate({ where: { status: 'DELIVERED', createdAt: { gte: yesterdayStart, lte: yesterdayEnd } }, _sum: { subtotal: true } }),
    prisma.order.aggregate({ where: { status: 'DELIVERED', createdAt: { gte: monthStart, lte: todayEnd } }, _sum: { subtotal: true } }),
    prisma.order.aggregate({ where: { status: 'DELIVERED', createdAt: { gte: lastMonthStart, lte: endOfDay(lastMonthSameDay) } }, _sum: { subtotal: true } }),
    prisma.order.aggregate({ where: { status: 'DELIVERED' }, _sum: { subtotal: true } }),
    prisma.order.count({ where: { createdAt: { gte: todayStart, lte: todayEnd } } }),
    prisma.order.count({ where: { createdAt: { gte: yesterdayStart, lte: yesterdayEnd } } }),
    prisma.user.count({ where: { role: NON_ADMIN, createdAt: { gte: todayStart, lte: todayEnd } } }),
    prisma.user.count({ where: { role: NON_ADMIN, createdAt: { gte: yesterdayStart, lte: yesterdayEnd } } }),
    // Prisma's fluent API can't compare two columns (stockQuantity <= lowStockThreshold) portably, so use raw SQL.
    prisma.$queryRaw`
      SELECT COUNT(*) as cnt FROM Product
      WHERE isActive = 1 AND isDeleted = 0 AND stockQuantity <= lowStockThreshold
    `,
  ]);

  const lowStock = Number(lowStockRow[0]?.cnt ?? 0);

  const todayRevenue = todayRevenueAgg._sum.subtotal ?? 0;
  const yesterdayRevenue = yesterdayRevenueAgg._sum.subtotal ?? 0;
  const monthRevenue = monthRevenueAgg._sum.subtotal ?? 0;
  const lastMonthToDate = lastMonthToDateAgg._sum.subtotal ?? 0;

  return {
    todayRevenue: { value: todayRevenue, changePct: pctChange(todayRevenue, yesterdayRevenue) },
    monthRevenue: { value: monthRevenue, changePct: pctChange(monthRevenue, lastMonthToDate) },
    totalRevenue: { value: totalRevenueAgg._sum.subtotal ?? 0 },
    todayOrders: { value: todayOrders, changePct: pctChange(todayOrders, yesterdayOrders) },
    newCustomersToday: { value: newCustomersToday, changePct: pctChange(newCustomersToday, newCustomersYesterday) },
    lowStockProducts: { value: lowStock },
  };
}

// ── Order status breakdown ──────────────────────────────────────────────────

export async function getOrderStatusBreakdown({ start, end }) {
  const rows = await prisma.order.groupBy({
    by: ['status'],
    where: { createdAt: { gte: start, lte: end } },
    _count: true,
  });
  const byStatus = Object.fromEntries(rows.map(r => [r.status, r._count]));
  const statuses = ['PENDING', 'CONFIRMED', 'SHIPPING', 'DELIVERED', 'CANCELLED'];
  const total = rows.reduce((s, r) => s + r._count, 0);
  return {
    total,
    items: statuses.map(status => ({ status, count: byStatus[status] ?? 0 })),
  };
}

// ── Revenue over time ────────────────────────────────────────────────────────

export async function getRevenueTimeline({ start, end, bucket }) {
  const orders = await prisma.order.findMany({
    where: { status: 'DELIVERED', createdAt: { gte: start, lte: end } },
    select: { createdAt: true, subtotal: true },
  });

  const key = (d) => bucket === 'month'
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    : d.toISOString().slice(0, 10);

  const buckets = new Map();
  // pre-fill buckets so empty days/months still show on the chart
  if (bucket === 'month') {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      buckets.set(key(cursor), { label: key(cursor), revenue: 0, orders: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    const cursor = new Date(start);
    while (cursor <= end) {
      buckets.set(key(cursor), { label: key(cursor), revenue: 0, orders: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  for (const o of orders) {
    const k = key(o.createdAt);
    const row = buckets.get(k);
    if (row) { row.revenue += o.subtotal; row.orders += 1; }
  }

  return Array.from(buckets.values());
}

// ── Revenue by category ──────────────────────────────────────────────────────

export async function getCategoryRevenue({ start, end }, limit = 8) {
  const rows = await prisma.$queryRaw`
    SELECT c.name as name, c.slug as slug, SUM(oi.price * oi.quantity) as revenue
    FROM OrderItem oi
    JOIN \`Order\` o ON o.id = oi.orderId
    JOIN Product p ON p.id = oi.productId
    JOIN Category c ON c.id = p.categoryId
    WHERE o.status = 'DELIVERED' AND o.createdAt BETWEEN ${start} AND ${end}
    GROUP BY c.id, c.name, c.slug
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;
  return rows.map(r => ({ name: r.name, slug: r.slug, revenue: Number(r.revenue) }));
}

// ── Recent orders ────────────────────────────────────────────────────────────

export async function getRecentOrders(limit = 8) {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, status: true, subtotal: true, createdAt: true,
      user: { select: { fullName: true } },
    },
  });
  return orders.map(o => ({
    id: o.id, status: o.status, total: o.subtotal, createdAt: o.createdAt,
    customerName: o.user?.fullName ?? 'Khách vãng lai',
  }));
}

// ── Top products ─────────────────────────────────────────────────────────────

export async function getTopProducts({ start, end }, limit = 5) {
  const items = await prisma.orderItem.groupBy({
    by: ['productId', 'name', 'slug', 'primaryImage'],
    where: { order: { status: 'DELIVERED', createdAt: { gte: start, lte: end } } },
    _sum: { quantity: true, price: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  });
  return items.map(i => ({
    productId: i.productId, name: i.name, slug: i.slug, primaryImage: i.primaryImage,
    quantitySold: i._sum.quantity ?? 0,
    revenue: (i._sum.quantity ?? 0) * (i._sum.price ?? 0),
  }));
}

// ── Low stock products ───────────────────────────────────────────────────────

export async function getLowStockProducts(limit = 5) {
  const products = await prisma.product.findMany({
    where: { isActive: true, isDeleted: false, stockQuantity: { gt: 0 } },
    select: { id: true, name: true, slug: true, stockQuantity: true, lowStockThreshold: true, images: { where: { isPrimary: true }, take: 1, select: { imageUrl: true } } },
    orderBy: { stockQuantity: 'asc' },
    take: limit * 3, // over-fetch, filter in JS since Prisma can't compare two columns
  });
  return products
    .filter(p => p.stockQuantity <= p.lowStockThreshold)
    .slice(0, limit)
    .map(p => ({ id: p.id, name: p.name, slug: p.slug, stockQuantity: p.stockQuantity, lowStockThreshold: p.lowStockThreshold, image: p.images[0]?.imageUrl ?? null }));
}

// ── Customer stats ───────────────────────────────────────────────────────────

export async function getCustomerStats({ start, end }) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, newToday, newThisMonth, newInRange, withOrders] = await Promise.all([
    prisma.user.count({ where: { role: NON_ADMIN } }),
    prisma.user.count({ where: { role: NON_ADMIN, createdAt: { gte: todayStart } } }),
    prisma.user.count({ where: { role: NON_ADMIN, createdAt: { gte: monthStart } } }),
    prisma.user.count({ where: { role: NON_ADMIN, createdAt: { gte: start, lte: end } } }),
    prisma.user.count({ where: { role: NON_ADMIN, orders: { some: {} } } }),
  ]);

  return { total, newToday, newThisMonth, newInRange, withOrders };
}

export async function getTopCustomers({ start, end }, limit = 5) {
  const rows = await prisma.order.groupBy({
    by: ['userId'],
    where: { status: 'DELIVERED', createdAt: { gte: start, lte: end } },
    _sum: { subtotal: true },
    _count: true,
    orderBy: { _sum: { subtotal: 'desc' } },
    take: limit,
  });
  if (rows.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: rows.map(r => r.userId) } }, select: { id: true, fullName: true } });
  const nameMap = Object.fromEntries(users.map(u => [u.id, u.fullName]));
  return rows.map(r => ({ userId: r.userId, fullName: nameMap[r.userId] ?? '—', orderCount: r._count, totalSpent: r._sum.subtotal ?? 0 }));
}

// ── Support ticket stats ─────────────────────────────────────────────────────

export async function getSupportStats(limit = 5) {
  const rows = await prisma.supportTicket.groupBy({ by: ['status'], _count: true });
  const byStatus = Object.fromEntries(rows.map(r => [r.status, r._count]));
  const waiting = (byStatus.NEW ?? 0) + (byStatus.WAITING_ADMIN ?? 0);
  const inProgress = (byStatus.IN_PROGRESS ?? 0) + (byStatus.WAITING_CUSTOMER ?? 0);
  const done = (byStatus.RESOLVED ?? 0) + (byStatus.CLOSED ?? 0);

  const recent = await prisma.supportTicket.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, code: true, category: true, status: true, createdAt: true },
  });

  return { waiting, inProgress, done, recent };
}

// ── Payment method breakdown ──────────────────────────────────────────────────

export async function getPaymentStats({ start, end }) {
  const rows = await prisma.order.groupBy({
    by: ['paymentMethod'],
    where: { createdAt: { gte: start, lte: end } },
    _count: true,
    _sum: { subtotal: true },
  });
  const cancelled = await prisma.order.count({ where: { status: 'CANCELLED', createdAt: { gte: start, lte: end } } });
  const total = rows.reduce((s, r) => s + r._count, 0);
  return {
    total,
    cancelled,
    methods: rows.map(r => ({ method: r.paymentMethod, count: r._count, revenue: r._sum.subtotal ?? 0, pct: total ? Math.round((r._count / total) * 1000) / 10 : 0 })),
  };
}

// ── Combined dashboard payload ────────────────────────────────────────────────

export async function getDashboard({ range = '7d', from, to } = {}) {
  const { start, end, bucket } = resolveRange({ range, from, to });

  const [
    kpi, orderStatus, revenueTimeline, categoryRevenue,
    recentOrders, topProducts, lowStockProducts,
    customerStats, topCustomers, supportStats, paymentStats,
  ] = await Promise.all([
    getKpiSummary(),
    getOrderStatusBreakdown({ start, end }),
    getRevenueTimeline({ start, end, bucket }),
    getCategoryRevenue({ start, end }),
    getRecentOrders(8),
    getTopProducts({ start, end }),
    getLowStockProducts(5),
    getCustomerStats({ start, end }),
    getTopCustomers({ start, end }),
    getSupportStats(5),
    getPaymentStats({ start, end }),
  ]);

  return {
    range: { range, start, end, bucket },
    kpi, orderStatus, revenueTimeline, categoryRevenue,
    recentOrders, topProducts, lowStockProducts,
    customerStats, topCustomers, supportStats, paymentStats,
  };
}
