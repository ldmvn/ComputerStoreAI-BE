import { prisma } from '../../config/prisma.js';
import { pageLinePrompt } from '../config/pageContext.js';

const MAX_SPECS = 12;
const WARRANTY = /b[aả]o h[aà]nh/i;

// Live DB read (never the RAG index, which can be stale). Returns null for a missing,
// inactive or deleted product so a bad client hint is simply ignored.
export async function loadCurrentProduct(id) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  try {
    const p = await prisma.product.findFirst({
      where: { id, isActive: true, isDeleted: false },
      select: {
        id: true, name: true, sku: true, brand: true, category: true,
        price: true, originalPrice: true, stockQuantity: true, shortDescription: true,
        categoryRecord: { select: { slug: true, parent: { select: { slug: true } } } },
        specifications: { orderBy: { sortOrder: 'asc' }, take: 60, select: { name: true, value: true } },
      },
    });
    if (!p) return null;
    const warranty = p.specifications.filter(s => WARRANTY.test(s.name));
    const others = p.specifications.filter(s => !WARRANTY.test(s.name)).slice(0, MAX_SPECS);
    return {
      id: p.id, name: p.name, sku: p.sku, brand: p.brand, category: p.category,
      categorySlug: p.categoryRecord?.parent?.slug ?? p.categoryRecord?.slug ?? null,
      price: p.price, ...(p.originalPrice && p.originalPrice > p.price ? { originalPrice: p.originalPrice } : {}),
      stockStatus: p.stockQuantity > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
      stockQuantity: p.stockQuantity,
      ...(p.shortDescription ? { shortDescription: p.shortDescription.slice(0, 200) } : {}),
      specifications: [...warranty, ...others].map(s => ({ name: s.name, value: s.value.slice(0, 120) })),
    };
  } catch (e) {
    console.error('[AI Chat] loadCurrentProduct failed (ignored):', e.message);
    return null;
  }
}

export function currentProductPrompt(product, previous = null, page = null) {
  const switched = previous && previous.id !== product.id
    ? `Khách vừa chuyển từ trang "${previous.name}" sang trang này; "sản phẩm này" ở các lượt trước nói về sản phẩm cũ, điều đó là bình thường, không cần giải thích hay đính chính. `
    : '';
  return `\n\nNGỮ CẢNH TRANG: Khách đang xem trang sản phẩm "${product.name}" (productId ${product.id}, sku ${product.sku}). ` +
    switched +
    'Nếu họ dùng "sản phẩm này", "cái này", "con này", "nó" hoặc hỏi mà không nêu tên sản phẩm thì hiểu là sản phẩm này; ngữ cảnh trang này ưu tiên hơn các lượt chat trước. ' +
    'Nếu họ nêu rõ tên một sản phẩm KHÁC thì ưu tiên sản phẩm được nêu tên (so sánh thì xử lý cả hai, dùng search_products cho sản phẩm còn lại, kể cả "cái rẻ hơn": gọi search_products với category=categorySlug của sản phẩm này và maxPrice thấp hơn giá hiện tại; "cái đắt hơn" thì dùng minPrice). Không xin lỗi hay nhắc lại việc khách đổi sang sản phẩm khác, chỉ trả lời theo sản phẩm hiện tại. ' +
    'Câu hỏi chung (chính sách, đơn hàng, build PC) không bị ép về sản phẩm này. Nếu khách hỏi "tôi đang ở trang nào", "đây là trang gì" thì trả lời ngắn gọn: bạn đang xem trang sản phẩm "' + product.name + '".\n' +
    'Dữ liệu sau lấy trực tiếp từ cơ sở dữ liệu ngay lúc này, được dùng để trả lời giá/tồn kho/bảo hành/thông số của sản phẩm này mà không cần gọi search_products (JSON): ' +
    JSON.stringify(product) + (page ? pageLinePrompt(page) : '');
}

const UNKNOWN_PAGE_REPLY = 'Mình chưa nhận biết được trang bạn đang mở. Bạn muốn hỏi về sản phẩm hay chức năng nào để mình hỗ trợ?';
const NO_RECALL = 'Không nhắc lại sản phẩm khách đã xem hoặc đã hỏi trước đó như "trang vừa rời", trừ khi khách hỏi rõ về sản phẩm đó. Không thêm lời đính chính hay ghi chú nào về các câu trả lời trước (giá/tồn kho đã nêu trước đó dựa trên dữ liệu trang sản phẩm là hợp lệ).';

// No product page open. `leftName`: product viewed on the previous turn, if any. `page`: known page config or null.
export function noProductPagePrompt(leftName = null, page = null) {
  let base;
  if (page) {
    base = '\n\nNGỮ CẢNH TRANG: Khách hiện không mở trang chi tiết sản phẩm nào.' + pageLinePrompt(page) + ' ' + NO_RECALL;
  } else {
    base = '\n\nNGỮ CẢNH TRANG: Khách hiện không mở trang chi tiết sản phẩm nào và bạn không biết họ đang ở trang nào. ' +
      'Nếu khách hỏi về trang hoặc màn hình hiện tại ("tôi đang ở trang nào", "đây là trang gì", "trang này làm được gì"...), chỉ trả lời đúng một câu ngắn: "' + UNKNOWN_PAGE_REPLY + '" ' + NO_RECALL;
  }
  if (!leftName) return base;
  return base + ' Khách dùng "sản phẩm này", "cái này", "con này", "nó" mà không nêu tên sản phẩm trong tin nhắn hiện tại thì KHÔNG mặc định là sản phẩm cũ, KHÔNG trả lời giá/tồn kho/thông số và KHÔNG gọi tool; hãy hỏi lại họ muốn hỏi sản phẩm nào, có thể gợi ý "Có phải sản phẩm bạn vừa xem là ' + leftName + ' không?".';
}
