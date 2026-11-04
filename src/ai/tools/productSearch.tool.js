// AI tool: search the real product catalog. This is a thin, real adapter
// over the existing Product Services — it reuses parseProductListQuery() and
// listProducts() exactly as the public /api/products route does, so a
// future LLM tool call can never see different data (or different filtering
// rules) than a human browsing the Storefront. Structured data like price,
// stock and SKU always comes from here, never from RAG (see docs/ai-architecture.md §10).

import { parseProductListQuery } from '../../validators/product.validator.js';
import { listProducts } from '../../services/productCatalog.service.js';

// Tool-calling schema in the shape most chat-completion APIs (OpenAI,
// Gemini) expect for function/tool definitions. Not registered with any
// provider yet — this is the contract a future aiChat.service hands to
// AIProvider.complete({ tools }) once one exists.
export const productSearchToolDefinition = {
  name: 'search_products',
  description: 'Tìm sản phẩm máy tính/laptop/linh kiện đang bán tại DUCMANH PC theo tên, danh mục, thương hiệu hoặc khoảng giá.',
  parameters: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Từ khóa tìm theo tên/SKU sản phẩm.' },
      category: { type: 'string', description: 'Slug danh mục, ví dụ "cpu", "laptop-gaming".' },
      brand: { type: 'string', description: 'Tên hoặc slug thương hiệu.' },
      minPrice: { type: 'number', description: 'Giá tối thiểu (VNĐ).' },
      maxPrice: { type: 'number', description: 'Giá tối đa (VNĐ), dùng để lọc theo ngân sách.' },
      limit: { type: 'number', description: 'Số sản phẩm tối đa trả về, mặc định 5, tối đa 10.' },
    },
  },
};

/**
 * @param {{ search?: string, category?: string, brand?: string, minPrice?: number, maxPrice?: number, limit?: number }} args
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function searchProducts(args = {}) {
  const query = parseProductListQuery({
    search: args.search,
    category: args.category,
    brand: args.brand,
    minPrice: args.minPrice,
    maxPrice: args.maxPrice,
    status: 'active', // AI never surfaces inactive/hidden products
    limit: Math.min(Math.max(Number.parseInt(args.limit, 10) || 5, 1), 10),
    sort: 'newest',
  });
  const result = await listProducts(query);
  const items = result.items.map(p => ({
    id: p.id, name: p.name, slug: p.slug, sku: p.sku,
    brand: p.brand, category: p.category,
    price: p.price, originalPrice: p.originalPrice,
    stockStatus: p.stockStatus, primaryImage: p.primaryImage,
  }));
  const inStock = items.filter(p => p.stockStatus === 'IN_STOCK').length;
  const outOfStock = items.filter(p => p.stockStatus === 'OUT_OF_STOCK').length;
  return {
    items,
    total: result.meta.total,
    summary: items.length === 0
      ? 'Không tìm thấy sản phẩm nào phù hợp với tiêu chí tìm kiếm.'
      : `Tìm thấy ${result.meta.total} sản phẩm (${inStock} còn hàng, ${outOfStock} hết hàng).`,
  };
}
