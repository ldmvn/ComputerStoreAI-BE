import { prisma } from '../config/prisma.js';

// ── Date range helpers ──────────────────────────────────────────────────────

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// range: 'today' | '7d' | '30d' | 'month' | '12m' | 'custom'
export function resolveRange({ range = '7d', from, to } = {}) {
  const now = new Date();
  if (range === 'custom' && from && to) {
    return { start: startOfDay(new Date(from)), end: endOfDay(new Date(to)), bucket: 'day' };
  }
  if (range === 'today') {
    return { start: startOfDay(now), end: endOfDay(now), bucket: 'day' };
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

// ── Profit & loss ────────────────────────────────────────────────────────────

// Percent change vs the previous period; null when the previous value is 0 (no baseline).
// Uses |previous| so a loss turning into a profit reads as an increase.
function changePercent(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

// Same rules as getProfitLoss, totals only: DELIVERED orders created in [start, end], revenue =
// Order.subtotal, cost/profit only from lines with costPrice > 0.
async function periodProfitTotals(start, end) {
  const [revenueRows, lineRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT COALESCE(SUM(o.subtotal), 0) AS revenue
      FROM \`Order\` o
      WHERE o.status = 'DELIVERED' AND o.createdAt BETWEEN ${start} AND ${end}
    `,
    prisma.$queryRaw`
      SELECT COALESCE(SUM(oi.price * oi.quantity), 0) AS costedRevenue,
             COALESCE(SUM(oi.costPrice * oi.quantity), 0) AS cost
      FROM OrderItem oi
      JOIN \`Order\` o ON o.id = oi.orderId
      WHERE o.status = 'DELIVERED' AND o.createdAt BETWEEN ${start} AND ${end} AND oi.costPrice > 0
    `,
  ]);
  const revenue = Number(revenueRows[0]?.revenue ?? 0);
  const costedRevenue = Number(lineRows[0]?.costedRevenue ?? 0);
  const cost = Number(lineRows[0]?.cost ?? 0);
  const profit = costedRevenue - cost;
  return { revenue, cost, profit, marginPercent: costedRevenue > 0 ? Math.round((profit / costedRevenue) * 1000) / 10 : 0 };
}

// Point-in-time snapshot of active stock (independent of the selected date range).
async function inventorySnapshot() {
  const rows = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(CASE WHEN costPrice > 0 THEN costPrice * stockQuantity END), 0) AS costValue,
      COALESCE(SUM(CASE WHEN costPrice > 0 THEN price * stockQuantity END), 0) AS retailValue,
      COALESCE(SUM(CASE WHEN costPrice > 0 THEN 1 ELSE 0 END), 0) AS productsCounted,
      COALESCE(SUM(CASE WHEN costPrice IS NULL OR costPrice <= 0 THEN 1 ELSE 0 END), 0) AS productsMissingCost
    FROM Product
    WHERE isActive = 1 AND isDeleted = 0
  `;
  const r = rows[0] ?? {};
  return {
    costValue: Number(r.costValue ?? 0),
    retailValue: Number(r.retailValue ?? 0),
    productsCounted: Number(r.productsCounted ?? 0),
    productsMissingCost: Number(r.productsMissingCost ?? 0),
  };
}

// Revenue matches the dashboard KPI cards: DELIVERED orders, createdAt in range, Order.subtotal
// (before voucher discount). Lines without a cost (NULL/0) are excluded from cost AND profit,
// never treated as cost 0. Day buckets use the server's local date so no order is dropped.
export async function getProfitLoss({ start, end, bucket }) {
  const prev = previousPeriod(start, end);
  const [orderRows, productRows, missingRows, missingSampleRows, inventory, previousTotals] = await Promise.all([
    prisma.$queryRaw`
      SELECT o.id AS id, o.createdAt AS createdAt, o.subtotal AS subtotal,
        COALESCE(SUM(CASE WHEN oi.costPrice > 0 THEN oi.price * oi.quantity END), 0) AS costedRevenue,
        COALESCE(SUM(CASE WHEN oi.costPrice > 0 THEN oi.costPrice * oi.quantity END), 0) AS cost
      FROM \`Order\` o
      LEFT JOIN OrderItem oi ON oi.orderId = o.id
      WHERE o.status = 'DELIVERED' AND o.createdAt BETWEEN ${start} AND ${end}
      GROUP BY o.id, o.createdAt, o.subtotal
    `,
    prisma.$queryRaw`
      SELECT oi.productId AS productId, MAX(oi.name) AS name, MAX(oi.slug) AS slug, MAX(oi.primaryImage) AS primaryImage,
        SUM(oi.quantity) AS quantitySold,
        SUM(oi.price * oi.quantity) AS revenue,
        SUM(oi.costPrice * oi.quantity) AS cost
      FROM OrderItem oi
      JOIN \`Order\` o ON o.id = oi.orderId
      WHERE o.status = 'DELIVERED' AND o.createdAt BETWEEN ${start} AND ${end} AND oi.costPrice > 0
      GROUP BY oi.productId
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS missingLines, COUNT(DISTINCT oi.productId) AS products
      FROM OrderItem oi
      JOIN \`Order\` o ON o.id = oi.orderId
      WHERE o.status = 'DELIVERED' AND o.createdAt BETWEEN ${start} AND ${end}
        AND (oi.costPrice IS NULL OR oi.costPrice <= 0)
    `,
    prisma.$queryRaw`
      SELECT MAX(oi.name) AS name
      FROM OrderItem oi
      JOIN \`Order\` o ON o.id = oi.orderId
      WHERE o.status = 'DELIVERED' AND o.createdAt BETWEEN ${start} AND ${end}
        AND (oi.costPrice IS NULL OR oi.costPrice <= 0)
      GROUP BY oi.productId
      ORDER BY SUM(oi.price * oi.quantity) DESC
      LIMIT 5
    `,
    inventorySnapshot(),
    periodProfitTotals(prev.start, prev.end),
  ]);

  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => bucket === 'month'
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const buckets = new Map();
  if (bucket === 'month') {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      buckets.set(key(cursor), { date: key(cursor), revenue: 0, cost: 0, profit: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    const cursor = new Date(start);
    while (cursor <= end) {
      buckets.set(key(cursor), { date: key(cursor), revenue: 0, cost: 0, profit: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  let revenue = 0, cost = 0, costedRevenue = 0;
  for (const o of orderRows) {
    const orderRevenue = Number(o.subtotal);
    const orderCosted = Number(o.costedRevenue);
    const orderCost = Number(o.cost);
    revenue += orderRevenue; cost += orderCost; costedRevenue += orderCosted;
    const row = buckets.get(key(new Date(o.createdAt)));
    if (row) { row.revenue += orderRevenue; row.cost += orderCost; row.profit += orderCosted - orderCost; }
  }
  const profit = costedRevenue - cost;

  const products = productRows.map(r => {
    const rev = Number(r.revenue), c = Number(r.cost);
    return {
      productId: r.productId, name: r.name, slug: r.slug, primaryImage: r.primaryImage ?? null,
      quantitySold: Number(r.quantitySold), revenue: rev, cost: c, profit: rev - c,
      marginPercent: rev > 0 ? Math.round(((rev - c) / rev) * 1000) / 10 : 0,
    };
  });

  return {
    revenue,
    cost,
    profit,
    marginPercent: costedRevenue > 0 ? Math.round((profit / costedRevenue) * 1000) / 10 : 0,
    timeline: Array.from(buckets.values()),
    topProfit: products.filter(p => p.profit > 0).sort((a, b) => b.profit - a.profit).slice(0, 5),
    topLoss: products.filter(p => p.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 5),
    missingCostItems: Number(missingRows[0]?.missingLines ?? 0),
    missingCostProducts: Number(missingRows[0]?.products ?? 0),
    missingCostSamples: missingSampleRows.map(r => r.name).filter(Boolean),
    inventory,
    previous: {
      ...previousTotals,
      changePercent: {
        revenue: changePercent(revenue, previousTotals.revenue),
        profit: changePercent(profit, previousTotals.profit),
      },
    },
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
