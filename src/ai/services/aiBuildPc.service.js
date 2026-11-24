import { aiConfig } from '../config/ai.config.js';
import { providerUnavailableError } from '../providers/aiProvider.interface.js';
import { queryRag, isRagReady } from '../rag/rag.service.js';
import { productSearchToolDefinition, searchProducts } from '../tools/productSearch.tool.js';
import { compatibilityToolDefinition, checkBuildCompatibility } from '../tools/compatibility.tool.js';
import { validateBuildConfig } from '../../services/buildPc.service.js';

let activeProvider = null;

export function setBuildPcProvider(provider) {
  activeProvider = provider;
}

const TOOLS = {
  search_products: { definition: productSearchToolDefinition, run: (args) => searchProducts(args) },
  check_build_compatibility: { definition: compatibilityToolDefinition, run: (args) => checkBuildCompatibility(args) },
};

const VALID_PURPOSES = new Set([
  'gaming', 'van-phong', 'hoc-tap', 'lap-trinh', 'do-hoa', 'dung-video',
  'ai-ml', 'livestream', 'may-tram', 'chung-khoan', 'khac',
]);

const PURPOSE_LABELS = {
  gaming: 'Gaming', 'van-phong': 'Văn phòng', 'hoc-tap': 'Học tập',
  'lap-trinh': 'Lập trình', 'do-hoa': 'Đồ họa', 'dung-video': 'Dựng video',
  'ai-ml': 'AI/Machine Learning', livestream: 'Livestream',
  'may-tram': 'Máy trạm', 'chung-khoan': 'Chứng khoán', khac: 'Khác',
};

const money = (n) => `${Math.round(n).toLocaleString('vi-VN')} VNĐ`;

// Một cấu hình chỉ hợp lệ khi đủ linh kiện bắt buộc; bản thiếu (ví dụ chỉ có RAM, nguồn, case) không phải
// một bộ máy dùng được nên không được hiện ra như "vừa ngân sách".
// Bộ PC tối thiểu có 7 linh kiện: CPU, mainboard, RAM, SSD, nguồn, vỏ case và một tản nhiệt CPU
// (khí, nước AIO hoặc custom). Tản nhiệt luôn tính là bắt buộc, kể cả khi CPU có kèm tản box.
const REQUIRED_SLOTS = ['cpu', 'mainboard', 'ram', 'ssd', 'psu', 'case'];
const COOLER_SLOTS = ['cooler-air', 'cooler-aio', 'cooler-custom'];
export const isFullBuild = (tier) => {
  const slots = new Set((tier?.items || []).filter(it => it.slot && (it.productId || it.id)).map(it => it.slot));
  return REQUIRED_SLOTS.every(slot => slots.has(slot)) && COOLER_SLOTS.some(slot => slots.has(slot));
};

// Đọc ngân sách từ câu mô tả tự do. Chấp nhận cả cách gõ tắt/sai dấu: "50 triệu", "50tr", "50 trieu", "50 chiệu", "50 củ", "1,5 tỷ".
export function extractBudgetFromText(prompt) {
  const text = prompt.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const match = text.match(/(\d+(?:[.,]\d+)*)\s*(trieu|trjeu|triu|treu|chieu|chiu|tr|cu|ty)(?![a-z])/);
  if (!match) return 0;
  const raw = match[1];
  const value = /^\d+[.,]\d{1,2}$/.test(raw) ? parseFloat(raw.replace(',', '.')) : parseFloat(raw.replace(/[.,]/g, ''));
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * (match[2] === 'ty' ? 1_000_000_000 : 1_000_000));
}

// Khi khách bấm "Dựng lại với X triệu", câu mô tả cũ vẫn ghi số tiền cũ ("Build PC 8 triệu..."). Thay số đó bằng ngân sách
// mới để AI không thấy hai con số mâu thuẫn và dựng theo số cũ.
function replaceBudgetInPrompt(prompt, budget) {
  const millions = budget / 1_000_000;
  const label = `${Number.isInteger(millions) ? millions : String(Math.round(millions * 10) / 10).replace('.', ',')} triệu`;
  return prompt.replace(/(\d+(?:[.,]\d+)*)\s*(tri[ệe]u|trjeu|triu|treu|chi[ệe]u|chiu|tr|c[ủu])(?![\p{L}])/iu, label);
}

export function validateBuildPcRequest(input = {}) {
  let prompt = typeof input.prompt === 'string' ? input.prompt.trim().slice(0, 1000) : '';

  if (prompt) {
    let budget = extractBudgetFromText(prompt);
    if (!budget) {
      const rawMatch = prompt.match(/(\d{7,9})/);
      if (rawMatch) budget = parseInt(rawMatch[1], 10);
    }
    // Ngân sách chọn riêng (nút "Dựng lại với X triệu") ưu tiên hơn số trích từ câu mô tả.
    const override = Number(input.budget);
    if (Number.isFinite(override) && override > 0) {
      budget = Math.min(override, 500_000_000);
      prompt = replaceBudgetInPrompt(prompt, budget);
    }
    // Không chặn ngân sách thấp ở đây: mức tối thiểu thật phụ thuộc linh kiện đang có trong kho, nên để bước dựng
    // cấu hình tính ra và báo "cần tối thiểu X" (budgetShortfall) thay vì dùng một con số cố định dễ sai lệch.
    if (!budget) budget = 20_000_000;
    if (budget > 500_000_000) budget = 500_000_000;
    return { prompt, budget, purpose: 'khac', purposeLabel: 'Khác', mode: 'freetext' };
  }

  const budget = Number(input.budget);
  if (!Number.isFinite(budget) || budget <= 0) {
    const error = new Error('Vui lòng nhập ngân sách hợp lệ.');
    error.statusCode = 400;
    throw error;
  }
  if (budget > 500_000_000) {
    const error = new Error('Ngân sách tối đa là 500.000.000 VNĐ.');
    error.statusCode = 400;
    throw error;
  }
  const purpose = String(input.purpose ?? '').trim().toLowerCase();
  if (!VALID_PURPOSES.has(purpose)) {
    const error = new Error(`Mục đích sử dụng không hợp lệ. Chọn: ${[...VALID_PURPOSES].join(', ')}.`);
    error.statusCode = 400;
    throw error;
  }
  return {
    budget,
    purpose,
    purposeLabel: PURPOSE_LABELS[purpose] || purpose,
    games: sanitize(input.games, 300),
    resolution: sanitize(input.resolution, 200),
    cpuPreference: sanitize(input.cpuPreference, 50),
    gpuPreference: sanitize(input.gpuPreference, 50),
    priority: sanitize(input.priority, 100),
    extras: sanitize(input.extras, 500),
    freeText: sanitize(input.freeText, 500),
    mode: 'structured',
  };
}

function sanitize(val, max) {
  return typeof val === 'string' ? val.trim().slice(0, max) : '';
}

function buildSystemPrompt(ragContext) {
  const base = `Bạn là chuyên gia tư vấn Build PC của DUCMANH PC. Nhiệm vụ: tạo 3 CẤU HÌNH PC (3 bản: Tiết kiệm, Tối ưu, Hiệu năng cao) theo ngân sách và nhu cầu.

QUY TẮC BẮT BUỘC:
1. Chỉ dùng sản phẩm tìm được qua search_products. Không bịa sản phẩm, giá, SKU hoặc thông số.
2. Hệ thống tự kiểm tra tương thích sau khi bạn trả kết quả, nên KHÔNG gọi check_build_compatibility. Tự chú ý socket, chuẩn RAM, form factor, công suất nguồn khi chọn.
3. Giá và tồn kho chỉ lấy từ kết quả search_products (stockStatus="IN_STOCK" mới còn hàng).
4. Không đề xuất sản phẩm hết hàng (OUT_OF_STOCK).
5. GIÁ CỦA 3 BẢN PHẢI KHÁC NHAU RÕ THEO NGÂN SÁCH khách nêu (gọi là N):
   - Tiết kiệm: dưới N một chút (khoảng 85-98% N), KHÔNG được vượt N.
   - Tối ưu: sát N (khoảng 95-105% N), tận dụng gần hết ngân sách chứ không để dư nhiều.
   - Hiệu năng cao: ĐƯỢC PHÉP vượt N để nâng cấp hiệu năng, tối đa ${Math.round(aiConfig.buildPcPerfOver * 100)}% trên N; ghi rõ trong description số tiền vượt (tính bằng triệu đồng, KHÔNG ghi theo phần trăm) và vì sao đáng nâng cấp.
   Tuyệt đối không để cả 3 bản đều rẻ hơn N nhiều.
   Khi N dưới 15 triệu: ưu tiên CPU có đồ họa tích hợp hoặc card đồ họa rẻ nhất đủ dùng, mainboard/RAM/SSD/nguồn/case/tản ở mức giá thấp nhất vẫn tương thích; chỉ chia thêm tiền cho CPU và VGA khi nhu cầu là game. Bản Tiết kiệm chọn linh kiện rẻ nhất đủ dùng, đừng cố dùng hết ngân sách.
6. Nếu không tìm đủ linh kiện, giải thích và đề xuất phương án gần nhất.
7. Slot bắt buộc, MỖI BẢN tối thiểu 7 linh kiện: CPU, Mainboard, RAM, SSD (ít nhất 1), PSU, Case và TẢN NHIỆT CPU
   (cooler-air, hoặc cooler-aio/cooler-custom cho bản cao cấp). Luôn thêm tản nhiệt CPU, kể cả khi CPU có kèm tản box;
   bản nào thiếu tản nhiệt bị coi là chưa đủ bộ và sẽ bị loại.
8. Slot tùy chọn theo nhu cầu: VGA, HDD, Monitor, case-fan...

BẢNG CATEGORY SLUG (dùng cho search_products):
cpu → "cpu", mainboard → "main", ram → "ram", ssd → "ssd-m2" (hoặc "ssd-25"), hdd → "hdd",
vga → "vga", psu → "nguon", case → "vo-case", monitor → "man-hinh",
keyboard-mouse-combo → "ban-phim-chuot", keyboard → "ban-phim", mouse → "chuot",
headphone → "tai-nghe", speaker → "loa", chair → "ghe-gaming",
case-fan → "quat-case", cooler-air → "tan-nhiet-cpu-air", cooler-aio → "tan-nhiet-cpu-aio".

QUY TRÌNH:
1. Phân tích yêu cầu → xác định mục đích, game, độ phân giải, FPS, ngân sách, sở thích.
2. QUAN TRỌNG: Danh sách sản phẩm đã được tìm sẵn ở cuối prompt. CHỌN TRỰC TIẾP từ đó bằng productId. Chỉ gọi search_products nếu cần tìm thêm danh mục phụ (tản nhiệt, màn hình...) hoặc tìm model cụ thể user yêu cầu.
3. Từ kết quả tìm kiếm, chọn linh kiện cho 3 bản:
   - Tiết kiệm: dưới ngân sách một chút, đáp ứng đủ nhu cầu
   - Tối ưu: sát ngân sách, cân bằng giá/hiệu năng tốt nhất (BẢN AI KHUYÊN DÙNG)
   - Hiệu năng cao: hiệu năng tốt nhất, được phép vượt ngân sách (xem quy tắc 5)
4. Tự đối chiếu tương thích khi chọn (chú ý chiều cao tản nhiệt khí so với Case, chiều dài VGA, socket, form factor mainboard); lỗi nào còn sót hệ thống sẽ báo lại để bạn sửa.
5. Ước tính FPS cho các game được yêu cầu (dựa trên benchmark đã biết).
6. Trả kết quả JSON.

QUAN TRỌNG - KHI TRẢ KẾT QUẢ, PHẢI trả về duy nhất JSON block:
\`\`\`json
{
  "parsedRequirements": {
    "purpose": "Chơi game",
    "games": ["Valorant", "Liên Minh"],
    "monitor": "2K 144Hz",
    "fps": "144",
    "budget": 25000000,
    "preferences": ["Intel"]
  },
  "tiers": [
    {
      "name": "Tiết kiệm",
      "description": "Mô tả ngắn hiệu năng bản này",
      "items": [
        { "slot": "cpu", "productId": 123, "quantity": 1, "reason": "Lý do chọn (tối đa 10 từ)" }
      ],
      "fpsEstimates": [
        { "game": "Valorant", "resolution": "2K · High", "fpsRange": "200-250", "estimated": true }
      ]
    },
    {
      "name": "Tối ưu",
      "description": "Mô tả...",
      "items": [...],
      "fpsEstimates": [...]
    },
    {
      "name": "Hiệu năng cao",
      "description": "Mô tả...",
      "items": [...],
      "fpsEstimates": [...]
    }
  ],
  "selectedTier": 1,
  "summary": "Nhận xét tổng quan"
}
\`\`\`

3 bản khác nhau chủ yếu ở CPU, VGA, tản nhiệt. Các linh kiện chung (RAM, SSD, Case, PSU) có thể giống hoặc khác.
Mỗi bản mô tả rõ sự khác biệt so với bản trước. selectedTier = index bản AI khuyên dùng (thường = 1 = Tối ưu).
Nếu ngân sách quá thấp (<10 triệu), chỉ cần 1-2 bản cũng được.
fpsEstimates chỉ cần cho game/phần mềm được yêu cầu. Nếu không yêu cầu game cụ thể, bỏ qua.

Slot hợp lệ: cpu, mainboard, ram, ssd, hdd, vga, psu, case, monitor, keyboard-mouse-combo, keyboard, mouse, headphone, speaker, chair, case-fan, cooler-air, cooler-aio, cooler-custom.
Mỗi slot tối đa 1 lần. quantity thường = 1. Hệ thống chỉ hỗ trợ TỐI ĐA 1 card đồ họa (slot vga, quantity = 1): nếu khách đòi 2 card trở lên thì chọn 1 card mạnh nhất và nói rõ giới hạn này trong description. RAM tối đa 4 thanh.
${aiConfig.buildPcThinkingOff ? 'Khi dùng công cụ, bạn có thể nói một câu ngắn trước; nếu không công cụ nào đáp ứng được thì nói rõ thay vì đoán. Không chèn thẻ XML nội bộ vào câu trả lời.\n' : ''}KHÔNG ghi tên, SKU, giá hay tổng tiền trong JSON: hệ thống tự lấy từ productId. Chỉ trả JSON block, không viết thêm giải thích ngoài JSON. "description" và "summary" tối đa 2 câu ngắn.`;

  if (ragContext) {
    return `${base}\n\nTài liệu tham khảo (chỉ dùng để hiểu thông số, KHÔNG lấy giá từ đây):\n${ragContext}`;
  }
  return base;
}

function buildUserPrompt(input) {
  if (input.mode === 'freetext') {
    return `${input.prompt}\n\nNgân sách ước tính: ${input.budget.toLocaleString('vi-VN')} VNĐ\n\nPhân tích yêu cầu, tìm linh kiện, tạo 3 bản cấu hình, trả JSON.`;
  }
  const parts = [`Ngân sách: ${input.budget.toLocaleString('vi-VN')} VNĐ`, `Mục đích: ${input.purposeLabel}`];
  if (input.games) parts.push(`Game/phần mềm: ${input.games}`);
  if (input.resolution) parts.push(`Độ phân giải/hiệu năng: ${input.resolution}`);
  if (input.cpuPreference) parts.push(`Ưu tiên CPU: ${input.cpuPreference}`);
  if (input.gpuPreference) parts.push(`Ưu tiên GPU: ${input.gpuPreference}`);
  if (input.priority) parts.push(`Ưu tiên: ${input.priority}`);
  if (input.extras) parts.push(`Yêu cầu thêm: ${input.extras}`);
  if (input.freeText) parts.push(`Ghi chú: ${input.freeText}`);
  return parts.join('\n') + '\n\nPhân tích yêu cầu, tìm linh kiện, tạo 3 bản cấu hình PC, trả JSON.';
}

function extractJsonFromResponse(text) {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1].trim()); } catch { /* fall through */ }
  }
  const braceMatch = text.match(/\{[\s\S]*"tiers"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch { /* fall through */ }
  }
  const legacyMatch = text.match(/\{[\s\S]*"items"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
  if (legacyMatch) {
    try {
      const legacy = JSON.parse(legacyMatch[0]);
      if (legacy.items && !legacy.tiers) {
        return {
          parsedRequirements: {},
          tiers: [{ name: 'Tối ưu', description: legacy.summary || '', items: legacy.items, totalPrice: legacy.totalPrice || 0, fpsEstimates: [] }],
          selectedTier: 0,
          summary: legacy.summary || '',
        };
      }
      return legacy;
    } catch { /* fall through */ }
  }
  return null;
}

const MAX_ROUNDS = 5;

const CORE_CATEGORIES = [
  { slug: 'cpu', label: 'CPU' },
  { slug: 'main', label: 'Mainboard' },
  { slug: 'ram', label: 'RAM' },
  { slug: 'ssd-m2', label: 'SSD' },
  { slug: 'vga', label: 'VGA' },
  { slug: 'nguon', label: 'PSU' },
  { slug: 'vo-case', label: 'Case' },
  // Tản nhiệt CPU bắt buộc: tìm sẵn để mô hình chọn trực tiếp; giá một tản không thể lớn như CPU/VGA nên giới hạn thấp hơn.
  { slug: 'tan-nhiet-cpu-air', label: 'Tản nhiệt CPU (khí)', share: 0.1 },
];

// Dưới ngưỡng này, danh sách "mới nhất" thường không chứa hàng giá thấp, nên bổ sung thêm vài sản phẩm rẻ nhất mỗi nhóm.
const LOW_BUDGET = 15_000_000;

// Phân khúc giá hợp lý cho từng linh kiện theo nhu cầu, tính theo tỉ lệ ngân sách [thấp, cao]. Giá là chỉ báo hiệu năng
// thô nhưng đủ dùng: game dồn tiền cho VGA, đồ họa/AI cần cả CPU lẫn VGA mạnh, văn phòng không cần card rời đắt.
const PURPOSE_GROUP = {
  gaming: 'gaming', livestream: 'gaming',
  'do-hoa': 'creator', 'dung-video': 'creator', 'ai-ml': 'creator', 'may-tram': 'creator',
  'lap-trinh': 'dev',
  'van-phong': 'office', 'hoc-tap': 'office', 'chung-khoan': 'office',
};
const SLOT_WINDOWS = {
  gaming:  { vga: [0.18, 0.45], cpu: [0.07, 0.25], main: [0, 0.22], ram: [0, 0.18], 'ssd-m2': [0, 0.15], nguon: [0, 0.15], 'vo-case': [0, 0.12] },
  creator: { vga: [0.12, 0.45], cpu: [0.10, 0.30], main: [0, 0.25], ram: [0, 0.25], 'ssd-m2': [0, 0.20], nguon: [0, 0.15], 'vo-case': [0, 0.12] },
  dev:     { vga: [0, 0.20],    cpu: [0.10, 0.30], main: [0, 0.22], ram: [0, 0.22], 'ssd-m2': [0, 0.18], nguon: [0, 0.12], 'vo-case': [0, 0.10] },
  office:  { vga: [0, 0.15],    cpu: [0.05, 0.25], main: [0, 0.20], ram: [0, 0.15], 'ssd-m2': [0, 0.15], nguon: [0, 0.12], 'vo-case': [0, 0.10] },
};

// Câu mô tả tự do không có trường "mục đích", nên đoán từ từ khóa để vẫn lọc đúng phân khúc.
export function inferPurposeGroup(input) {
  if (PURPOSE_GROUP[input.purpose]) return PURPOSE_GROUP[input.purpose];
  const text = `${input.prompt || ''} ${input.freeText || ''} ${input.games || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  if (/(game|choi|fps|valorant|lol|cs2|csgo|pubg|gta|cyberpunk|stream)/.test(text)) return 'gaming';
  if (/(do hoa|render|blender|premiere|photoshop|dung phim|dung video|edit video|ai |llm|machine learning|3d)/.test(text)) return 'creator';
  if (/(lap trinh|code|dev )/.test(text)) return 'dev';
  if (/(van phong|word|excel|hoc|ke toan|chung khoan|cho nguoi gia)/.test(text)) return 'office';
  return null;
}

async function prefetchCatalog(budget, tools, group = null) {
  const perSlot = Math.round(budget * 0.4);
  const low = budget < LOW_BUDGET;
  const ceil = 1 + aiConfig.buildPcPerfOver; // bản Hiệu năng cao được vượt ngân sách
  const windows = group ? SLOT_WINDOWS[group] : null;
  const searches = CORE_CATEGORIES.map(async cat => {
    const maxPrice = cat.share ? Math.round(budget * cat.share) : perSlot;
    try {
      let items = [];
      let total = 0;
      const win = windows?.[cat.slug];
      if (win && !low) {
        // Lọc theo phân khúc phù hợp; thiếu hàng trong dải này thì rơi về cách tìm thường bên dưới.
        // Chia khoảng giá thành 3 dải rồi lấy mỗi dải vài sản phẩm, để AI thấy đủ các tầng (rẻ, vừa, đắt) thay vì chỉ 10 món mới nhất.
        const lo = Math.round(budget * win[0]);
        const hi = Math.round(budget * win[1] * ceil);
        const step = Math.ceil((hi - lo) / 3);
        const bands = await Promise.all([0, 1, 2].map(i =>
          tools.search_products.run({ category: cat.slug, minPrice: lo + step * i + (i ? 1 : 0), maxPrice: Math.min(hi, lo + step * (i + 1)), limit: 5 }).catch(() => ({ items: [], total: 0 }))
        ));
        const seen = new Set();
        for (const b of bands) for (const p of b.items) if (!seen.has(p.id)) { seen.add(p.id); items.push(p); }
        total = bands.reduce((s, b) => s + b.total, 0);
      }
      if (items.length < 4) {
        const r = await tools.search_products.run({ category: cat.slug, maxPrice, limit: 10 });
        const seen = new Set(items.map(p => p.id));
        items = [...items, ...r.items.filter(p => !seen.has(p.id))];
        total = Math.max(total, r.total);
      }
      const r = { items, total };
      if (low) {
        const cheap = await tools.search_products.run({ category: cat.slug, maxPrice, limit: 5, sort: 'priceAsc' }).catch(() => null);
        const seen = new Set(items.map(p => p.id));
        items = [...items, ...(cheap?.items || []).filter(p => !seen.has(p.id))];
      }
      return { slug: cat.slug, label: cat.label, items, total: r.total };
    } catch {
      return { slug: cat.slug, label: cat.label, items: [], total: 0 };
    }
  });
  return Promise.all(searches);
}

function formatPrefetchedCatalog(catalog) {
  const sections = catalog
    .filter(c => c.items.length)
    .map(c => {
      const lines = c.items.map(p =>
        `  id=${p.id} | ${p.name} | ${p.price.toLocaleString('vi-VN')}đ | ${p.stockStatus}`
      ).join('\n');
      return `[${c.label}] (${c.total} sản phẩm)\n${lines}`;
    });
  return sections.join('\n\n');
}

export function createBuildPcService({ provider, tools = TOOLS, retrieve = queryRag, ragReady = isRagReady, maxRepairRounds = 3 } = {}) {
  const getProvider = provider || (() => activeProvider);

  return async function generateBuildConfig(rawInput) {
    if (!aiConfig.enabled) throw providerUnavailableError();
    const prov = getProvider();
    if (!prov) {
      const err = new Error('Tính năng AI Build PC chưa khả dụng.');
      err.statusCode = 501;
      err.code = 'AI_PROVIDER_UNAVAILABLE';
      throw err;
    }

    const input = validateBuildPcRequest(rawInput);
    const started = performance.now();
    const deadline = started + aiConfig.buildPcTimeoutMs;
    // Ngân sách khách nêu là mức tham chiếu; chấp nhận vượt nhẹ (mặc định 5%) trước khi coi là "vượt ngân sách".
    const budgetLimit = Math.round(input.budget * (1 + aiConfig.buildPcBudgetTolerance));
    // Bản "Hiệu năng cao" được phép đắt hơn ngân sách để khách thấy lựa chọn nâng cấp; hai bản còn lại phải sát/trong ngân sách.
    const perfLimit = Math.round(input.budget * (1 + aiConfig.buildPcPerfOver));
    const limitFor = (tier) => (/hi[ệe]u\s*n[ăa]ng/i.test(tier?.name || '') ? perfLimit : budgetLimit);
    const metrics = { geminiCalls: 0, embeddingCalls: 0, toolCalls: 0, searchCalls: 0, compatCalls: 0, prefetchMs: 0, promptTokens: 0, completionTokens: 0 };

    const prefetchStart = performance.now();
    const [catalog, ragResult] = await Promise.all([
      prefetchCatalog(input.budget, tools, inferPurposeGroup(input)),
      ragReady()
        ? retrieve({ query: `Build PC ${input.purposeLabel || ''} ngân sách ${input.budget}`, topK: 3, complexity: 'simple' }).catch(() => null)
        : null,
    ]);
    metrics.prefetchMs = Math.round(performance.now() - prefetchStart);
    metrics.searchCalls += CORE_CATEGORIES.length;
    metrics.toolCalls += CORE_CATEGORIES.length;

    const ragContext = ragResult?.contextText || '';
    if (ragResult?.diagnostics) metrics.embeddingCalls = ragResult.diagnostics.embeddingCalls || 0;

    const catalogText = formatPrefetchedCatalog(catalog);
    const executed = new Map();
    for (const cat of catalog) {
      const key = JSON.stringify(['search_products', { category: cat.slug, maxPrice: Math.round(input.budget * 0.4), limit: 10 }]);
      executed.set(key, { items: cat.items, total: cat.total });
    }

    console.log(`[AI BuildPC] Prefetch done in ${metrics.prefetchMs}ms — ${catalog.reduce((s, c) => s + c.items.length, 0)} products across ${CORE_CATEGORIES.length} categories`);

    const messages = [
      { role: 'system', content: buildSystemPrompt(ragContext) },
      { role: 'user', content: buildUserPrompt(input) + `\n\n--- SẢN PHẨM HIỆN CÓ (đã tìm sẵn, chọn từ đây, chỉ gọi search_products nếu cần tìm thêm) ---\n${catalogText}` },
    ];
    const toolDefs = Object.values(tools).map(t => t.definition);

    function checkTimeout() {
      if (performance.now() > deadline) {
        console.error(`[AI BuildPC] Vượt giới hạn tổng ${aiConfig.buildPcTimeoutMs}ms sau ${Math.round(performance.now() - started)}ms, ${metrics.geminiCalls} lần gọi AI`);
        const err = new Error('Build PC vượt thời gian cho phép. Vui lòng thử lại.');
        err.statusCode = 504;
        throw err;
      }
    }

    // Suy nghĩ đôi khi "chạy quá đà" tới hết max_tokens mà không ra chữ nào (mất 35-40 giây vô ích). Một khi đã gặp,
    // các lần gọi sau trong lượt này tắt suy nghĩ để chắc chắn ra kết quả.
    let thinkingRunaway = false;

    async function complete(withTools = true) {
      checkTimeout();
      metrics.geminiCalls++;
      console.log(`[AI BuildPC] AI call #${metrics.geminiCalls} (tools=${withTools}, msgs=${messages.length})`);
      try {
        const result = await prov.complete({
          messages,
          ...(withTools ? { tools: toolDefs } : {}),
          maxTokens: 8192,
          ...(aiConfig.buildPcEffort ? { effort: aiConfig.buildPcEffort } : {}),
          ...(!withTools || thinkingRunaway || aiConfig.buildPcThinkingOff ? { disableThinking: true } : {}),
        });
        if (result.stopReason === 'max_tokens') thinkingRunaway = true;
        metrics.promptTokens += result.usage?.promptTokens || 0;
        metrics.completionTokens += result.usage?.completionTokens || 0;
        console.log(`[AI BuildPC] AI call #${metrics.geminiCalls} returned: toolCalls=${result.toolCalls?.length || 0}, text=${(result.content || '').length} chars, out=${result.usage?.completionTokens ?? '?'}tok, blocks=${Array.isArray(result._rawModelContent) ? result._rawModelContent.map(b => b.type).join('+') || 'rỗng' : '?'}, stop=${result.stopReason ?? result.finishReason}, tổng ${Math.round(performance.now() - started)}ms`);
        return result;
      } catch (err) {
        console.error(`[AI BuildPC] AI call #${metrics.geminiCalls} error:`, err.message, `statusCode=${err.statusCode}`, `sau ${Math.round(performance.now() - started)}ms`);
        throw err;
      }
    }

    let completion = await complete();

    async function runToolRounds() {
      for (let round = 0; round < MAX_ROUNDS && completion.toolCalls?.length; round++) {
        checkTimeout();
        const calls = completion.toolCalls.slice(0, 5);
        const roundResults = await Promise.all(calls.map(async (call) => {
          const tool = tools[call.name];
          if (!tool) return { id: call.id, name: call.name, result: { error: 'Tool không hợp lệ.' } };
          const key = JSON.stringify([call.name, call.arguments]);
          let result;
          try {
            if (executed.has(key)) result = executed.get(key);
            else { result = await tool.run(call.arguments ?? {}); executed.set(key, result); }
            metrics.toolCalls++;
            if (call.name === 'search_products') metrics.searchCalls++;
            if (call.name === 'check_build_compatibility') metrics.compatCalls++;
          } catch (e) {
            result = { error: e.message };
          }
          return { id: call.id, name: call.name, result };
        }));

        const assistantMsg = { role: 'assistant', content: completion.content || '', toolCalls: calls };
        if (completion._rawModelContent) assistantMsg._rawModelContent = completion._rawModelContent;
        const toolMsgs = roundResults.map(tc => ({
          role: 'tool', name: tc.name, toolCallId: tc.id,
          content: JSON.stringify(compactResult(tc.name, tc.result)),
        }));
        messages.push(assistantMsg, ...toolMsgs);
        console.log(`[AI BuildPC] Tool round ${round + 1}: ${roundResults.map(r => `${r.name}→${r.result?.items?.length ?? 'ok'}`).join(', ')}`);
        completion = await complete(round < MAX_ROUNDS - 1);
      }
    }
    await runToolRounds();

    let responseText = completion.content || '';
    let parsed = extractJsonFromResponse(responseText);

    if (!parsed?.tiers?.length && metrics.toolCalls > 0) {
      console.log('[AI BuildPC] No JSON tiers in response, retrying without tools...');
      if (responseText.trim()) {
        messages.push({ role: 'assistant', content: responseText });
      }
      // Gộp luôn trường hợp ngân sách quá thấp vào lần thử lại này: nếu chỉ nhắc "trả JSON", model thường lặp lại
      // lời giải thích bằng văn bản rồi phải tốn thêm một lượt "cấu hình rẻ nhất" (mỗi lượt 10-20 giây).
      messages.push({ role: 'user', content: `Hãy trả về kết quả 3 cấu hình PC dưới dạng JSON block theo format đã yêu cầu (với parsedRequirements, tiers, selectedTier). Không gọi thêm tool, chọn sản phẩm từ danh sách đã có. Nếu lắp được bộ đủ linh kiện trong ngân sách ${money(input.budget)} thì PHẢI trả đủ 3 bản (Tiết kiệm, Tối ưu, Hiệu năng cao) đều nằm trong ngân sách, dù hiệu năng với nhu cầu chỉ ở mức tối thiểu; nếu hiệu năng còn hạn chế thì nói rõ ở summary, KHÔNG được vì thế mà chỉ trả 1 bản. CHỈ KHI không thể lắp nổi bộ đủ linh kiện bắt buộc trong ngân sách thì mới trả JSON với ĐÚNG 1 bản trong "tiers" là cấu hình RẺ NHẤT lắp hoàn chỉnh (đủ CPU, Mainboard, RAM, SSD, PSU, Case, tản nhiệt CPU và VGA/iGPU đủ dùng), dù tổng vượt ngân sách, đúng tương thích, và nói rõ trong summary rằng ngân sách chưa đủ. Tuyệt đối không để "tiers" rỗng và không viết giải thích ngoài JSON block.` });
      const retry = await complete(false);
      responseText = retry.content || '';
      parsed = extractJsonFromResponse(responseText);
    }

    if (!parsed?.tiers?.length && completion.toolCalls?.length) {
      const assistantMsg = { role: 'assistant', content: completion.content || '', toolCalls: completion.toolCalls };
      if (completion._rawModelContent) assistantMsg._rawModelContent = completion._rawModelContent;
      const calls = completion.toolCalls.slice(0, 5);
      const toolResults = await Promise.all(calls.map(async (call) => {
        const tool = tools[call.name];
        const key = JSON.stringify([call.name, call.arguments]);
        let result;
        try {
          result = (tool && executed.has(key)) ? executed.get(key)
            : tool ? await tool.run(call.arguments ?? {}) : { error: 'Tool không hợp lệ.' };
        } catch (e) { result = { error: e.message }; }
        return { id: call.id, name: call.name, result };
      }));
      messages.push(assistantMsg, ...toolResults.map(tc => ({
        role: 'tool', name: tc.name, toolCallId: tc.id,
        content: JSON.stringify(compactResult(tc.name, tc.result)),
      })));
      messages.push({ role: 'user', content: 'Hãy trả về kết quả 3 cấu hình PC dưới dạng JSON block theo format đã yêu cầu (với parsedRequirements, tiers, selectedTier). Không gọi thêm tool.' });
      const final = await complete(false);
      responseText = final.content || '';
      parsed = extractJsonFromResponse(responseText);
    }

    // Ngân sách quá thấp: AI hay trả "tiers" rỗng. Vẫn cần 1 cấu hình rẻ nhất khả thi để báo khách mức
    // ngân sách tối thiểu, nên hỏi lại đúng một lần với yêu cầu bỏ qua giới hạn ngân sách.
    // "Có cấu hình" nghĩa là ít nhất một bản ĐỦ linh kiện bắt buộc (AI đôi khi trả bản rỗng hoặc thiếu).
    const hasBuild = (p) => Array.isArray(p?.tiers) && p.tiers.some(isFullBuild);
    if (!hasBuild(parsed)) {
      console.log('[AI BuildPC] Empty tiers, asking for the cheapest feasible build...');
      messages.push({ role: 'assistant', content: responseText || '(không có cấu hình)' });
      messages.push({ role: 'user', content: `Không có cấu hình nào nằm trong ngân sách ${money(input.budget)}. Hãy trả JSON block (cùng format) với ĐÚNG 1 bản trong "tiers" là cấu hình RẺ NHẤT có thể lắp hoàn chỉnh (đủ CPU, Mainboard, RAM, SSD, PSU, Case, tản nhiệt CPU và VGA/iGPU đủ dùng cho nhu cầu), dù tổng vượt ngân sách. Chọn sản phẩm thật từ search_products, đúng tương thích. Tuyệt đối không để "tiers" rỗng; nói rõ trong summary rằng ngân sách chưa đủ.` });
      completion = await complete();
      await runToolRounds();
      responseText = completion.content || '';
      parsed = extractJsonFromResponse(responseText);
    }

    if (!hasBuild(parsed)) {
      console.error('[AI BuildPC] Failed to parse tiers from Gemini response.');
      console.error('[AI BuildPC] Metrics:', JSON.stringify(metrics));
      console.error('[AI BuildPC] Response (first 800 chars):', responseText.slice(0, 800));
      return {
        success: false,
        error: 'AI không thể tạo cấu hình phù hợp với yêu cầu. Vui lòng thử với ngân sách hoặc yêu cầu khác.',
        rawResponse: responseText,
        metrics: { ...metrics, latencyMs: performance.now() - started },
      };
    }

    // Mọi bản đều phải qua Compatibility Engine; bản lỗi được trả lại cho AI sửa (tối đa 2 lượt).
    const tierCheck = async (tier) => {
      const cfg = (tier.items || []).filter(it => (it.productId || it.id) && it.slot)
        .map(it => ({ slot: it.slot, productId: it.productId || it.id, quantity: it.quantity || 1 }));
      try {
        const v = await validateBuildConfig(cfg);
        return { errors: (v?.data?.issues || []).filter(i => i.level === 'error'), total: Number.isFinite(v?.data?.total) ? v.data.total : null };
      } catch (e) {
        // Cấu hình sai khuôn (trùng slot, quantity quá giới hạn...) không được coi là "không có lỗi": trả lại cho AI sửa.
        return { errors: [{ message: `Cấu hình không hợp lệ: ${e.message}` }], total: null };
      }
    };
    // Sửa lỗi tương thích tối đa 3 lượt. Bản vượt ngân sách được yêu cầu chọn lại ở lượt đầu, và thêm
    // một lượt nữa CHỈ khi bản gần đạt nhất vượt không quá 30%: vượt nhiều thường là ngân sách quá thấp
    // so với giá linh kiện, gọi thêm AI (mỗi lượt 10-20 giây) cũng không đạt.
    const NEAR_BUDGET_RATIO = 0.3;
    // Nhớ bản hợp lệ (không lỗi tương thích) rẻ nhất gặp được qua mọi lượt: AI đôi khi chọn lại còn tệ hơn.
    let bestTier = null;
    // Đã có cấu hình hợp lệ từ AI: nếu hết thời gian trong lúc sửa thì giữ bản hiện có (kèm cảnh báo tương thích
    // ở bước kiểm tra cuối) thay vì báo lỗi và bỏ mất kết quả. Một lượt sửa cần tối thiểu ~35 giây.
    const REPAIR_MIN_REMAINING_MS = 35_000;
    for (let attempt = 0; attempt < maxRepairRounds; attempt++) {
      const bad = [];
      const checks = await Promise.all(parsed.tiers.map(tier => tierCheck(tier)));
      parsed.tiers.forEach((t, i) => {
        const c = checks[i];
        if (isFullBuild(t) && c.total !== null && c.errors.length === 0 && (!bestTier || c.total < bestTier.total)) {
          bestTier = { total: c.total, tier: JSON.parse(JSON.stringify(t)) };
        }
      });
      const overRatios = checks.filter((c, i) => c.total !== null && c.total > limitFor(parsed.tiers[i])).map(c => (c.total - input.budget) / input.budget);
      // Vượt quá NEAR_BUDGET_RATIO ngay từ lượt đầu nghĩa là ngân sách không đủ: không bắt AI "hạ cho vừa" (vô ích, tốn 3-4 lần gọi).
      // Đã có bản nằm trong ngân sách thì bản vượt chỉ bị ẩn khi hiển thị, không cần tốn lượt AI để hạ giá nó.
      const anyFits = checks.some((c, i) => isFullBuild(parsed.tiers[i]) && c.total !== null && c.total <= limitFor(parsed.tiers[i]));
      const askBudget = overRatios.length > 0 && !anyFits && attempt <= 1 && Math.min(...overRatios) <= NEAR_BUDGET_RATIO;
      for (let i = 0; i < parsed.tiers.length; i++) {
        const problems = checks[i].errors.map(e => e.message || e.code || JSON.stringify(e));
        if (askBudget && checks[i].total !== null && checks[i].total > limitFor(parsed.tiers[i])) {
          problems.push(`Tổng ${money(checks[i].total)} VƯỢT ngân sách ${money(input.budget)}, cần giảm ít nhất ${money(checks[i].total - input.budget)}. Phải thay linh kiện rẻ hơn (ưu tiên hạ linh kiện đắt nhất như VGA/CPU/main) để tổng KHÔNG vượt ngân sách.`);
        }
        if (problems.length) bad.push({ index: i, name: parsed.tiers[i].name, errors: problems });
      }
      if (!bad.length) break;
      // Chỉ bỏ qua lần gọi AI để sửa; bước kiểm tra ở trên vẫn luôn chạy (không gọi AI, rất nhanh).
      if (deadline - performance.now() < REPAIR_MIN_REMAINING_MS) {
        console.log(`[AI BuildPC] Còn ${Math.round(deadline - performance.now())}ms, bỏ qua lượt sửa (${bad.length} bản còn vấn đề), dùng bản hiện có`);
        break;
      }
      messages.push({ role: 'assistant', content: responseText });
      messages.push({ role: 'user', content: `Hệ thống kiểm tra phát hiện vấn đề ở các bản sau:\n${JSON.stringify(bad)}\nHãy khắc phục: với lỗi tương thích thì thay linh kiện gây lỗi (ví dụ tản nhiệt quá cao so với Case thì đổi tản thấp hơn hoặc đổi Case khác; chỉ dùng search_products khi cần tìm linh kiện thay thế, không cần gọi check_build_compatibility vì hệ thống tự kiểm tra lại); với bản vượt ngân sách thì chọn linh kiện rẻ hơn (hạ VGA/CPU/main, bỏ linh kiện tùy chọn, KHÔNG được bỏ tản nhiệt CPU) sao cho tổng ≤ ngân sách. Nếu thật sự không thể lắp đủ linh kiện bắt buộc trong ngân sách, giữ cấu hình rẻ nhất có thể và nói rõ điều đó trong summary. Rồi trả lại đầy đủ JSON block 3 bản theo format cũ.` });
      try {
        completion = await complete();
        await runToolRounds();
      } catch (err) {
        if (err?.statusCode !== 504) throw err;
        console.log('[AI BuildPC] Hết thời gian trong lượt sửa, dùng bản hiện có');
        break;
      }
      const fixedText = completion.content || '';
      const fixed = extractJsonFromResponse(fixedText);
      if (!fixed?.tiers?.length) break;
      responseText = fixedText;
      parsed = fixed;
    }

    if (bestTier) {
      const finalChecks = await Promise.all(parsed.tiers.map(tier => tierCheck(tier)));
      const minFinal = Math.min(...finalChecks.map((c, i) => (isFullBuild(parsed.tiers[i]) && c.total !== null && c.errors.length === 0 ? c.total : Infinity)));
      if (minFinal > budgetLimit && bestTier.total < minFinal) parsed.tiers.push(bestTier.tier);
    }

    const tiersToValidate = parsed.tiers.filter(isFullBuild);
    for (const tier of tiersToValidate) {
      for (const it of tier.items) { if (!it.productId && it.id) it.productId = it.id; }
    }

    const validations = await Promise.all(tiersToValidate.map(async (tier) => {
      const configItems = tier.items
        .filter(it => it.productId && it.slot)
        .map(it => ({ slot: it.slot, productId: it.productId, quantity: it.quantity || 1 }));
      try { return { data: (await validateBuildConfig(configItems))?.data, error: null }; }
      catch (e) { return { data: null, error: e.message }; }
    }));

    // Bản không qua được bước kiểm tra cấu trúc (ví dụ 2 card đồ họa) sẽ có giá 0đ và không có linh kiện: bỏ hẳn thay vì hiện ra.
    const validatedTiers = tiersToValidate
      .map((tier, idx) => ({ tier, idx, validation: validations[idx] }))
      .filter(({ validation, tier }) => {
        if (validation.error) { console.error(`[AI BuildPC] Bỏ bản "${tier.name}": ${validation.error}`); return false; }
        return true;
      })
      .map(({ tier, idx, validation }) => {
      const items = tier.items
        .filter(it => it.productId && it.slot)
        .map(aiItem => {
          const validated = validation.data?.items?.find(v => v.slot === aiItem.slot);
          return {
            slot: aiItem.slot,
            productId: aiItem.productId,
            name: validated?.name || aiItem.name || '',
            sku: validated?.sku || aiItem.sku || '',
            price: validated?.price ?? aiItem.price ?? 0,
            quantity: aiItem.quantity || 1,
            lineTotal: validated?.lineTotal ?? ((aiItem.price ?? 0) * (aiItem.quantity || 1)),
            stockQuantity: validated?.stockQuantity ?? null,
            primaryImage: validated?.primaryImage ?? null,
            reason: aiItem.reason || '',
            slug: validated?.slug || '',
          };
        });
      const totalPrice = validation.data?.total ?? items.reduce((s, it) => s + it.lineTotal, 0);
      return {
        name: tier.name || `Bản ${idx + 1}`,
        description: tier.description || '',
        items,
        totalPrice,
        budgetDiff: totalPrice - input.budget,
        overBudget: totalPrice > limitFor(tier),
        fpsEstimates: Array.isArray(tier.fpsEstimates) ? tier.fpsEstimates : [],
        compatibilityStatus: validation.data?.issues?.some(i => i.level === 'error') ? 'fail'
          : validation.data?.issues?.length ? 'warning' : 'pass',
        compatibilityIssues: validation.data?.issues || [],
        compatibilityChecks: validation.data?.checks || [],
        compatibilityMissing: validation.data?.missing || [],
        canAddToCart: validation.data?.canAddToCart ?? false,
        isComplete: validation.data?.isComplete ?? false,
        validationError: validation.error,
      };
    });

    if (!validatedTiers.length) {
      return {
        success: false,
        error: 'AI không thể tạo cấu hình phù hợp với yêu cầu. Vui lòng thử lại.',
        rawResponse: responseText,
        metrics: { ...metrics, latencyMs: performance.now() - started },
      };
    }

    // Có bản nằm trong ngân sách thì chỉ hiện các bản đó. Cả ba đều vượt thì chỉ giữ bản rẻ nhất kèm
    // cảnh báo, không bày ra nhiều cấu hình đều ngoài tầm ngân sách của khách.
    const requestedTier = validatedTiers[Math.min(parsed.selectedTier ?? 0, validatedTiers.length - 1)];
    const fitting = validatedTiers.filter(t => !t.overBudget);
    const hidden = validatedTiers.filter(t => t.overBudget);
    const cheapestTier = validatedTiers.reduce((best, t) => (t.totalPrice < best.totalPrice ? t : best), validatedTiers[0]);
    const finalTiers = fitting.length ? fitting : [cheapestTier];
    let budgetNotice = '';
    if (!fitting.length) {
      budgetNotice = `Ngân sách ${money(input.budget)} chưa đủ cho nhu cầu này với linh kiện hiện có tại cửa hàng. Cấu hình rẻ nhất là ${money(cheapestTier.totalPrice)} (cao hơn ${money(cheapestTier.totalPrice - input.budget)}). Bạn có thể tăng ngân sách hoặc tham khảo cấu hình rẻ nhất bên dưới.`;
    } else if (hidden.length) {
      budgetNotice = `Đã ẩn bản ${hidden.map(t => t.name).join(', ')} vì vượt ngân sách ${money(input.budget)}. Bạn có thể tăng ngân sách để xem thêm lựa chọn.`;
    }
    const selectedIndex = fitting.length ? Math.max(0, finalTiers.indexOf(requestedTier)) : 0;
    const budgetShortfall = fitting.length ? null : {
      minimumBudget: cheapestTier.totalPrice,
      // Dư thêm 10%: AI không phải lúc nào cũng tìm ra cấu hình rẻ nhất, nên mức đề xuất sát đáy dễ dựng lại vẫn trượt.
      suggestedBudget: Math.min(Math.ceil((cheapestTier.totalPrice * 1.1) / 1_000_000) * 1_000_000, 500_000_000),
      shortfall: cheapestTier.totalPrice - input.budget,
    };

    return {
      success: true,
      parsedRequirements: parsed.parsedRequirements || {},
      tiers: finalTiers,
      budgetNotice,
      budgetShortfall,
      selectedTier: selectedIndex,
      budget: input.budget,
      purpose: input.purpose || parsed.parsedRequirements?.purpose || '',
      purposeLabel: input.purposeLabel || parsed.parsedRequirements?.purpose || '',
      summary: parsed.summary || '',
      metrics: { ...metrics, latencyMs: performance.now() - started },
    };
  };
}

function compactResult(name, result) {
  if (name === 'search_products' && result.items) {
    return {
      items: result.items.map(p => ({
        id: p.id, sku: p.sku, slug: p.slug, name: p.name, brand: p.brand, category: p.category,
        price: p.price, ...(p.originalPrice ? { originalPrice: p.originalPrice } : {}),
        stockStatus: p.stockStatus,
      })),
      total: result.total,
    };
  }
  return result;
}

export const generateBuildConfig = createBuildPcService();
