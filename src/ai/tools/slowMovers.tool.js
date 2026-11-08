// AI tool: slow-moving stock — in-stock products with the fewest units sold in a period.

import { prisma } from '../../config/prisma.js';

export const slowMoversToolDefinition = {
  name: 'get_slow_movers',
  description: 'Lấy danh sách sản phẩm bán chậm / ế / tồn kho nhiều: còn hàng nhưng bán được ít (hoặc chưa bán được cái nào) trong khoảng thời gian gần đây. Dùng khi hỏi "ế", "tồn kho", "bán chậm", "hàng tồn".',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Slug danh mục để lọc (ví dụ "ram", "vga"). Bỏ trống để lấy toàn shop.' },
      days: { type: 'number', description: 'Tính số lượng bán trong N ngày gần nhất, mặc định 90.' },
      limit: { type: 'number', description: 'Số sản phẩm tối đa, mặc định 5, tối đa 10.' },
    },
  },
};

export async function getSlowMovers(args = {}) {
  const limit = Math.min(Math.max(Number.parseInt(args.limit, 10) || 5, 1), 10);
  const days = Number.parseInt(args.days, 10) > 0 ? Number.parseInt(args.days, 10) : 90;
  const since = new Date(Date.now() - days * 86_400_000);

  const [products, sold] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        stockQuantity: { gt: 0 },
        ...(args.category ? { OR: [{ category: args.category }, { categoryRecord: { slug: args.category } }] } : {}),
      },
      select: { id: true, name: true, price: true, originalPrice: true, stockQuantity: true, category: true, brand: true },
    }),
    prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: { status: { not: 'CANCELLED' }, createdAt: { gte: since } } },
      _sum: { quantity: true },
    }),
  ]);

  const soldById = new Map(sold.map(s => [s.productId, s._sum.quantity || 0]));
  const items = products
    .map(p => ({ ...p, soldQuantity: soldById.get(p.id) || 0 }))
    .sort((a, b) => a.soldQuantity - b.soldQuantity || b.stockQuantity - a.stockQuantity)
    .slice(0, limit)
    .map(p => ({
      id: p.id, name: p.name, brand: p.brand, category: p.category,
      price: p.price, originalPrice: p.originalPrice,
      stockStatus: 'IN_STOCK', stockQuantity: p.stockQuantity,
      soldQuantity: p.soldQuantity,
    }));

  return {
    items,
    periodDays: days,
    summary: items.length
      ? `Top ${items.length} sản phẩm còn hàng bán chậm nhất trong ${days} ngày gần đây (soldQuantity = số lượng bán trong kỳ).`
      : 'Không có sản phẩm còn hàng phù hợp.',
  };
}
