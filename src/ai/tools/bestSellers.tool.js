// AI tool: top-selling products, aggregated from real (non-cancelled) order items.

import { prisma } from '../../config/prisma.js';

export const bestSellersToolDefinition = {
  name: 'get_best_sellers',
  description: 'Lấy danh sách sản phẩm bán chạy nhất của DUCMANH PC dựa trên số lượng đã bán thực tế (không tính đơn đã hủy). Dùng khi khách hỏi "bán chạy nhất", "được mua nhiều nhất", "hot nhất".',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Slug danh mục để lọc (ví dụ "ram", "vga"). Bỏ trống để lấy toàn shop.' },
      days: { type: 'number', description: 'Chỉ tính đơn trong N ngày gần nhất. Bỏ trống để tính toàn thời gian.' },
      limit: { type: 'number', description: 'Số sản phẩm tối đa, mặc định 5, tối đa 10.' },
    },
  },
};

export async function getBestSellers(args = {}) {
  const limit = Math.min(Math.max(Number.parseInt(args.limit, 10) || 5, 1), 10);
  const days = Number.parseInt(args.days, 10);

  const grouped = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: {
      order: {
        status: { not: 'CANCELLED' },
        ...(days > 0 ? { createdAt: { gte: new Date(Date.now() - days * 86_400_000) } } : {}),
      },
      product: {
        isActive: true,
        isDeleted: false,
        ...(args.category ? { OR: [{ category: args.category }, { categoryRecord: { slug: args.category } }] } : {}),
      },
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  });

  if (!grouped.length) {
    return { items: [], summary: 'Chưa có dữ liệu bán hàng phù hợp.' };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map(g => g.productId) } },
    select: { id: true, name: true, price: true, originalPrice: true, stockQuantity: true, category: true, brand: true },
  });
  const byId = new Map(products.map(p => [p.id, p]));

  const items = grouped.map(g => {
    const p = byId.get(g.productId);
    return {
      id: p.id, name: p.name, brand: p.brand, category: p.category,
      price: p.price, originalPrice: p.originalPrice,
      stockStatus: p.stockQuantity > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
      soldQuantity: g._sum.quantity,
    };
  });

  return { items, summary: `Top ${items.length} sản phẩm bán chạy nhất theo số lượng đã bán.` };
}
