import { searchProducts } from '../tools/productSearch.tool.js';
import { lookupMyOrders } from '../tools/orderLookup.tool.js';

function formatPrice(n) {
  return Number(n).toLocaleString('vi-VN') + 'đ';
}

function stockLabel(status) {
  if (status === 'IN_STOCK') return 'Còn hàng';
  if (status === 'PRE_ORDER') return 'Đặt trước';
  return 'Hết hàng';
}

const ALIASES = [
  [/\br3\b/gi, 'Ryzen 3'], [/\br5\b/gi, 'Ryzen 5'], [/\br7\b/gi, 'Ryzen 7'], [/\br9\b/gi, 'Ryzen 9'],
  [/\bi3\b/gi, 'Core i3'], [/\bi5\b/gi, 'Core i5'], [/\bi7\b/gi, 'Core i7'], [/\bi9\b/gi, 'Core i9'],
  [/\bvga\b/gi, 'card đồ họa'], [/\bpsu\b/gi, 'nguồn'], [/\bbo mach\b/gi, 'mainboard'],
  [/\bram\b/gi, 'RAM'], [/\bssd\b/gi, 'SSD'], [/\bhdd\b/gi, 'HDD'],
];

function expandAliases(text) {
  let result = text;
  for (const [pattern, replacement] of ALIASES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

const NOISE_WORDS = /(?:^|\s)(shop|cửa hàng|cua hang|chọn hộ|chon ho|tìm hộ|tim ho|gợi ý|goi y|tư vấn|tu van|cho tớ|cho toi|hộ tớ|ho to|giúp tớ|giup to|loại nào|loai nao|con nào|con nao|cái nào|cai nao|rẻ nhất|re nhat|đắt nhất|dat nhat|tốt nhất|tot nhat|mạnh nhất|manh nhat|nào rẻ|nao re|giá|gia|bao nhiêu|bao nhieu|còn hàng|con hang|hết hàng|het hang|tồn kho|ton kho|mua|đặt hàng|dat hang|thanh|miếng|mieng|tấm|cây|của tớ|cua to|cho mình|cho minh|ơi|à|nhé|nhe|ạ|đi|di|xem|trong mấy|trong may|tớ|toi|mình|minh|không|khong|con|cái|cai|bus|loại|loai|tầm|tam|khoảng|khoang|dưới|duoi|trên|tren)(?=\s|$)/gi;

function cleanSearchTerm(text) {
  let cleaned = text;
  for (let i = 0; i < 2; i++) cleaned = cleaned.replace(NOISE_WORDS, ' ');
  return cleaned.replace(/\s+/g, ' ').trim();
}

function extractCategory(cleaned) {
  const map = {
    ram: 'ram', ssd: 'ssd-m2', hdd: 'hdd', vga: 'vga', cpu: 'cpu',
    'card đồ họa': 'vga', nguồn: 'nguon', psu: 'nguon', mainboard: 'main',
    laptop: 'laptop', 'màn hình': 'man-hinh', monitor: 'man-hinh',
    'tai nghe': 'tai-nghe', headset: 'tai-nghe', chuột: 'chuot', mouse: 'chuot',
    'bàn phím': 'ban-phim', keyboard: 'ban-phim',
  };
  const lower = cleaned.toLowerCase();
  for (const [kw, slug] of Object.entries(map)) {
    if (lower.includes(kw)) return slug;
  }
  return null;
}

async function handlePriceLookup(message) {
  const cleaned = cleanSearchTerm(message);
  if (!cleaned) return null;

  const category = extractCategory(expandAliases(cleaned));
  const expanded = expandAliases(cleaned);

  const searches = [
    { search: cleaned, limit: 8 },
    expanded !== cleaned ? { search: expanded, limit: 8 } : null,
    category ? { search: cleaned.replace(/\b(ram|ssd|hdd|vga|cpu|gpu|psu)\b/gi, '').trim(), category, limit: 8 } : null,
    category ? { category, limit: 10 } : null,
  ].filter(Boolean);

  let data;
  for (const params of searches) {
    data = await searchProducts(params);
    if (data.items.length) break;
  }

  let specFiltered = false;
  let totalBeforeFilter = data?.total || 0;
  if (data?.items.length) {
    const words = cleaned.toLowerCase().split(/\s+/);
    const specFilters = words.filter(w => /^\d+[a-z]*$/i.test(w) || /^ddr[345]$/i.test(w));
    if (specFilters.length) {
      const filtered = data.items.filter(p => {
        const name = p.name.toLowerCase();
        return specFilters.every(spec => name.includes(spec));
      });
      if (filtered.length) {
        data.items = filtered;
        specFiltered = true;
      }
    }
    data.items.sort((a, b) => a.price - b.price);
  }

  if (!data?.items.length) return null;

  const lines = data.items.map((p, i) => {
    const discount = p.originalPrice && p.originalPrice > p.price
      ? ` ~~${formatPrice(p.originalPrice)}~~` : '';
    return `${i + 1}. **${p.name}**\n   - Giá: **${formatPrice(p.price)}**${discount}\n   - ${stockLabel(p.stockStatus)}`;
  });

  let reply = lines.join('\n');
  if (specFiltered && data.items.length < totalBeforeFilter) {
    reply += `\n\n_Tìm thấy ${data.items.length} sản phẩm đúng yêu cầu (trong tổng ${totalBeforeFilter} sản phẩm cùng loại)._`;
  } else if (data.total > data.items.length) {
    reply += `\n\n_Hiển thị ${data.items.length}/${data.total} sản phẩm. Bạn có thể nêu rõ hơn để mình lọc chính xác hơn._`;
  }
  reply += '\n\nBạn muốn xem chi tiết hoặc so sánh sản phẩm nào không?';

  return { reply, toolCalls: [{ name: 'search_products', result: data }] };
}

async function handleOrderLookup(args, userId) {
  if (!Number.isInteger(userId) || userId <= 0) {
    return { reply: 'Vui lòng đăng nhập để tra cứu đơn hàng.', toolCalls: [] };
  }

  const data = await lookupMyOrders(args, userId);
  if (data.order) {
    const o = data.order;
    return {
      reply: `**Đơn hàng #${o.id}**\n- Trạng thái: **${o.status}**\n- Tổng tiền: **${formatPrice(o.totalAmount)}**\n- Ngày đặt: ${new Date(o.createdAt).toLocaleDateString('vi-VN')}`,
      toolCalls: [{ name: 'lookup_my_orders', result: data }],
    };
  }
  if (data.orders) {
    if (!data.orders.length) {
      return { reply: 'Bạn chưa có đơn hàng nào.', toolCalls: [{ name: 'lookup_my_orders', result: data }] };
    }
    const lines = data.orders.slice(0, 5).map(o =>
      `- **#${o.id}** — ${o.status} — ${formatPrice(o.totalAmount)} — ${new Date(o.createdAt).toLocaleDateString('vi-VN')}`
    );
    let reply = `**Đơn hàng gần đây:**\n${lines.join('\n')}`;
    if (data.orders.length > 5) reply += `\n\n_...và ${data.orders.length - 5} đơn hàng khác._`;
    return { reply, toolCalls: [{ name: 'lookup_my_orders', result: data }] };
  }
  if (data.message) return { reply: data.message, toolCalls: [{ name: 'lookup_my_orders', result: data }] };
  return null;
}

export async function tryLocalResponse(intent, message, ctx = {}) {
  try {
    if (intent.isLocalPrice) {
      return await handlePriceLookup(message);
    }
    if (intent.isLocalOrder) {
      return await handleOrderLookup({}, ctx.userId);
    }
  } catch {
    return null;
  }
  return null;
}
