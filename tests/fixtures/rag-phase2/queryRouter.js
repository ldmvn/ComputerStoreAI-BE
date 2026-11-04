/**
 * Lightweight query router — classifies user messages to determine which
 * retrieval strategy to use: RAG, Function Calling, both, or neither.
 * No LLM call — uses keyword/pattern matching for zero latency and zero cost.
 */

const GREETING_PATTERNS = /^(xin\s+)?ch[àa]o|^hi\b|^hello\b|^hey\b|^alo\b|^c[óo]\s+(ai|gì)|^bạn\s+(là|tên)|^cảm\s+ơn|^thanks?\b|^bye\b|^tạm\s+biệt/i;

const PRICE_STOCK_PATTERNS = /gi[áa]\s+(bao\s+nhiêu|nào|rẻ|đắt|sale|khuyến|giảm)|bao\s+nhi[êe]u\s+ti[ềe]n|còn\s+hàng|h[ếe]t\s+hàng|tồn\s+kho|mua\s+ngay|đặt\s+hàng|so\s+sánh\s+giá|budget|ngân\s+sách/i;

const ORDER_PATTERNS = /đơn\s+hàng|order|tracking|theo\s+dõi\s+đơn|tình\s+trạng\s+đơn|mã\s+đơn/i;

const POLICY_PATTERNS = /bảo\s+hành|đổi\s+trả|ho[àa]n\s+ti[ềe]n|v[ậa]n\s+chuy[ểe]n|giao\s+hàng|thanh\s+to[áa]n|chính\s+s[áa]ch|quy\s+định|hướng\s+dẫn\s+mua/i;

const PRODUCT_SEARCH_PATTERNS = /tìm|search|tư\s+vấn|gợi\s+ý|đề\s+xuất|recommend|sản\s+phẩm\s+nào|loại\s+nào|dòng\s+nào|mẫu\s+nào|con\s+nào/i;

const KNOWLEDGE_PATTERNS = /là\s+gì|khác\s+(gì|nhau)|so\s+với|nên\s+chọn|ưu\s+điểm|nhược\s+điểm|đánh\s+giá|review|giải\s+thích|thông\s+số|spec|công\s+nghệ|tương\s+thích|compatible|socket|chipset|bus|tần\s+số|xung\s+nhịp|hiệu\s+năng|benchmark|fps|render|overclock|tdp|watt|công\s+suất/i;

const BUILD_PC_PATTERNS = /build\s+pc|ráp\s+máy|lắp\s+máy|cấu\s+hình|combo|bộ\s+máy|pc\s+gaming|pc\s+văn\s+phòng|pc\s+đồ\s+họa|pc\s+render/i;

const COMPONENT_KEYWORDS = /cpu|gpu|vga|ram|ssd|hdd|mainboard|main|bo\s+mạch|nguồn|psu|case|vỏ|tản\s+nhiệt|cooler|fan|quạt|màn\s+hình|monitor|bàn\s+phím|keyboard|chuột|mouse|tai\s+nghe|headset|loa|speaker/i;

/**
 * @typedef {'none' | 'rag_only' | 'fc_only' | 'rag_and_fc'} RouteType
 * @param {string} message
 * @returns {{ route: RouteType, reason: string }}
 */
export function classifyQuery(message) {
  const msg = message.trim();
  if (!msg || msg.length < 2) return { route: 'none', reason: 'empty' };

  if (GREETING_PATTERNS.test(msg) && msg.length < 50) {
    return { route: 'none', reason: 'greeting' };
  }

  if (ORDER_PATTERNS.test(msg)) {
    return { route: 'fc_only', reason: 'order_lookup' };
  }

  if (POLICY_PATTERNS.test(msg)) {
    return { route: 'rag_only', reason: 'policy_question' };
  }

  const wantsPrice = PRICE_STOCK_PATTERNS.test(msg);
  const wantsKnowledge = KNOWLEDGE_PATTERNS.test(msg);
  const wantsBuild = BUILD_PC_PATTERNS.test(msg);
  const wantsSearch = PRODUCT_SEARCH_PATTERNS.test(msg);
  const hasComponent = COMPONENT_KEYWORDS.test(msg);

  if (wantsBuild) {
    return { route: 'rag_and_fc', reason: 'build_pc' };
  }

  if (wantsKnowledge && wantsPrice) {
    return { route: 'rag_and_fc', reason: 'knowledge_and_price' };
  }

  if (wantsKnowledge && hasComponent) {
    return { route: 'rag_and_fc', reason: 'tech_advice' };
  }

  if (wantsKnowledge) {
    return { route: 'rag_only', reason: 'knowledge_question' };
  }

  if (wantsPrice || wantsSearch) {
    return { route: 'fc_only', reason: 'product_search_or_price' };
  }

  if (hasComponent) {
    return { route: 'rag_and_fc', reason: 'component_question' };
  }

  // Default: use RAG for anything non-trivial (provides background knowledge)
  if (msg.length > 15) {
    return { route: 'rag_only', reason: 'general_question' };
  }

  return { route: 'none', reason: 'short_message' };
}
