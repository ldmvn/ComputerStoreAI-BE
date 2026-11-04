import { prisma } from '../config/prisma.js';

function dateRange(from, to) {
  const where = {};
  if (from) where.gte = new Date(from);
  if (to) {
    const d = new Date(to);
    d.setHours(23, 59, 59, 999);
    where.lte = d;
  }
  return Object.keys(where).length ? where : undefined;
}

export async function getRevenueSummary({ from, to } = {}) {
  const createdAt = dateRange(from, to);
  const baseWhere = { status: 'DELIVERED', ...(createdAt ? { createdAt } : {}) };

  const [revenue, orderCount, allStatuses] = await Promise.all([
    prisma.order.aggregate({ where: baseWhere, _sum: { subtotal: true } }),
    prisma.order.count({ where: baseWhere }),
    prisma.order.groupBy({
      by: ['status'],
      where: createdAt ? { createdAt } : {},
      _count: true,
      _sum: { subtotal: true },
    }),
  ]);

  const statusMap = Object.fromEntries(allStatuses.map(s => [s.status, { count: s._count, sum: s._sum.subtotal ?? 0 }]));
  return {
    revenue: revenue._sum.subtotal ?? 0,
    deliveredOrders: orderCount,
    statusBreakdown: statusMap,
  };
}

export async function getTopProducts({ from, to, limit = 10 } = {}) {
  const createdAt = dateRange(from, to);
  const where = { order: { status: 'DELIVERED', ...(createdAt ? { createdAt } : {}) } };

  const items = await prisma.orderItem.groupBy({
    by: ['productId', 'name', 'slug', 'primaryImage'],
    where,
    _sum: { quantity: true, price: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  });

  return items.map(i => ({
    productId: i.productId,
    name: i.name,
    slug: i.slug,
    primaryImage: i.primaryImage,
    totalQuantity: i._sum.quantity ?? 0,
    totalRevenue: (i._sum.quantity ?? 0) * (i._sum.price ?? 0),
  }));
}

export async function getDailyRevenue({ from, to } = {}) {
  const createdAt = dateRange(from, to);
  const orders = await prisma.order.findMany({
    where: { status: 'DELIVERED', ...(createdAt ? { createdAt } : {}) },
    select: { createdAt: true, subtotal: true },
    orderBy: { createdAt: 'asc' },
  });

  const byDay = {};
  for (const o of orders) {
    const day = o.createdAt.toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { date: day, revenue: 0, count: 0 };
    byDay[day].revenue += o.subtotal;
    byDay[day].count += 1;
  }
  return Object.values(byDay);
}

export async function getNewCustomers({ from, to } = {}) {
  const createdAt = dateRange(from, to);
  const where = { role: 'CUSTOMER', ...(createdAt ? { createdAt } : {}) };
  return prisma.user.count({ where });
}
