import { isChatConfigured } from '../config/ai.config.js';
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

export function validateBuildPcRequest(input = {}) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim().slice(0, 1000) : '';

  if (prompt) {
    const budgetMatch = prompt.match(/(\d[\d.,]*)\s*(triệu|tr|trieu)/i);
    let budget = 0;
    if (budgetMatch) {
      budget = parseFloat(budgetMatch[1].replace(/[.,]/g, '')) * 1_000_000;
      if (budgetMatch[1].includes('.') || budgetMatch[1].includes(',')) {
        const num = parseFloat(budgetMatch[1].replace(',', '.'));
        if (num < 1000) budget = num * 1_000_000;
      }
    }
    if (!budget) {
      const rawMatch = prompt.match(/(\d{7,9})/);
      if (rawMatch) budget = parseInt(rawMatch[1], 10);
    }
    if (budget < 3_000_000) budget = 20_000_000;
    if (budget > 500_000_000) budget = 500_000_000;
    return { prompt, budget, purpose: 'khac', purposeLabel: 'Khác', mode: 'freetext' };
  }

  const budget = Number(input.budget);
  if (!Number.isFinite(budget) || budget < 3_000_000) {
    const error = new Error('Ngân sách tối thiểu là 3.000.000 VNĐ.');
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
2. Dùng check_build_compatibility kiểm tra tương thích cho bản Tối ưu.
3. Giá và tồn kho chỉ lấy từ kết quả search_products (stockStatus="IN_STOCK" mới còn hàng).
4. Không đề xuất sản phẩm hết hàng (OUT_OF_STOCK).
5. TẤT CẢ 3 bản PHẢI nằm trong ngân sách (không vượt).
6. Nếu không tìm đủ linh kiện, giải thích và đề xuất phương án gần nhất.
7. Slot bắt buộc: CPU, Mainboard, RAM, SSD (ít nhất 1), PSU, Case.
8. Slot tùy chọn theo nhu cầu: VGA, HDD, Monitor, Cooler...

BẢNG CATEGORY SLUG (dùng cho search_products):
cpu → "cpu", mainboard → "main", ram → "ram", ssd → "ssd-m2" (hoặc "ssd-25"), hdd → "hdd",
vga → "vga", psu → "nguon", case → "vo-case", monitor → "man-hinh",
keyboard-mouse-combo → "ban-phim-chuot", keyboard → "ban-phim", mouse → "chuot",
headphone → "tai-nghe", speaker → "loa", chair → "ghe-gaming",
case-fan → "quat-case", cooler-air → "tan-nhiet-cpu-air", cooler-aio → "tan-nhiet-cpu-aio".

QUY TRÌNH:
1. Phân tích yêu cầu → xác định mục đích, game, độ phân giải, FPS, ngân sách, sở thích.
2. Tìm linh kiện bằng search_products — mỗi danh mục tìm một lần với limit 8-10 để có nhiều lựa chọn giá.
3. Từ kết quả tìm kiếm, chọn linh kiện cho 3 bản:
   - Tiết kiệm: rẻ nhất có thể, đáp ứng nhu cầu cơ bản
   - Tối ưu: cân bằng giá/hiệu năng tốt nhất (BẢN AI KHUYÊN DÙNG)
   - Hiệu năng cao: hiệu năng tốt nhất trong ngân sách
4. Dùng check_build_compatibility kiểm tra CẢ 3 bản; bản nào có lỗi (error) phải đổi linh kiện cho đến khi hết lỗi (chú ý chiều cao tản nhiệt khí so với Case, chiều dài VGA, socket, form factor mainboard).
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
        { "slot": "cpu", "productId": 123, "name": "Tên SP", "sku": "SKU", "price": 3000000, "quantity": 1, "reason": "Lý do chọn ngắn gọn" }
      ],
      "totalPrice": 18000000,
      "fpsEstimates": [
        { "game": "Valorant", "resolution": "2K · High", "fpsRange": "200-250", "estimated": true }
      ]
    },
    {
      "name": "Tối ưu",
      "description": "Mô tả...",
      "items": [...],
      "totalPrice": 22000000,
      "fpsEstimates": [...]
    },
    {
      "name": "Hiệu năng cao",
      "description": "Mô tả...",
      "items": [...],
      "totalPrice": 24000000,
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
Mỗi slot tối đa 1 lần. quantity thường = 1.`;

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

export function createBuildPcService({ provider, tools = TOOLS, retrieve = queryRag, ragReady = isRagReady } = {}) {
  const getProvider = provider || (() => activeProvider);

  return async function generateBuildConfig(rawInput) {
    if (!isChatConfigured()) throw providerUnavailableError();
    const prov = getProvider();
    if (!prov) throw providerUnavailableError();

    const input = validateBuildPcRequest(rawInput);
    const started = performance.now();
    const metrics = { geminiCalls: 0, embeddingCalls: 0, toolCalls: 0, searchCalls: 0, compatCalls: 0 };

    let ragContext = '';
    if (ragReady()) {
      try {
        const rag = await retrieve({ query: `Build PC ${input.purposeLabel || ''} ngân sách ${input.budget}`, topK: 3, complexity: 'simple' });
        ragContext = rag.contextText || '';
        metrics.embeddingCalls = rag.diagnostics?.embeddingCalls || 0;
      } catch { /* RAG failure is non-fatal */ }
    }

    const messages = [
      { role: 'system', content: buildSystemPrompt(ragContext) },
      { role: 'user', content: buildUserPrompt(input) },
    ];
    const toolDefs = Object.values(tools).map(t => t.definition);

    async function complete(withTools = true) {
      metrics.geminiCalls++;
      console.log(`[AI BuildPC] Calling Gemini #${metrics.geminiCalls} (tools=${withTools}, msgs=${messages.length})`);
      try {
        const result = await prov.complete({
          messages,
          ...(withTools ? { tools: toolDefs } : {}),
          maxTokens: 8192,
        });
        console.log(`[AI BuildPC] Gemini #${metrics.geminiCalls} returned: toolCalls=${result.toolCalls?.length || 0}, text=${(result.content || '').length} chars`);
        return result;
      } catch (err) {
        console.error(`[AI BuildPC] Gemini #${metrics.geminiCalls} error:`, err.message, `statusCode=${err.statusCode}`);
        throw err;
      }
    }

    let completion = await complete();
    console.log('[AI BuildPC] Initial completion:', completion.toolCalls?.length ? `${completion.toolCalls.length} tool calls` : `text ${(completion.content || '').length} chars`);
    const executed = new Map();
    const MAX_ROUNDS = 10;

    async function runToolRounds() {
    for (let round = 0; round < MAX_ROUNDS && completion.toolCalls?.length; round++) {
      const roundResults = [];
      for (const call of completion.toolCalls.slice(0, 5)) {
        const tool = tools[call.name];
        let result;
        const key = JSON.stringify([call.name, call.arguments]);
        if (!tool) { roundResults.push({ name: call.name, result: { error: 'Tool không hợp lệ.' } }); continue; }
        try {
          if (executed.has(key)) result = executed.get(key);
          else { result = await tool.run(call.arguments ?? {}); executed.set(key, result); }
          metrics.toolCalls++;
          if (call.name === 'search_products') metrics.searchCalls++;
          if (call.name === 'check_build_compatibility') metrics.compatCalls++;
        } catch (e) {
          result = { error: e.message };
        }
        roundResults.push({ name: call.name, result });
      }

      const assistantMsg = { role: 'assistant', content: completion.content || '', toolCalls: completion.toolCalls.slice(0, 5) };
      if (completion._rawModelContent) assistantMsg._rawModelContent = completion._rawModelContent;
      const toolMsgs = roundResults.map(tc => ({
        role: 'tool', name: tc.name,
        content: JSON.stringify(compactResult(tc.name, tc.result)),
      }));
      messages.push(assistantMsg, ...toolMsgs);
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
      messages.push({ role: 'user', content: 'Hãy trả về kết quả 3 cấu hình PC dưới dạng JSON block theo format đã yêu cầu (với parsedRequirements, tiers, selectedTier). Không gọi thêm tool.' });
      const retry = await complete(false);
      responseText = retry.content || '';
      parsed = extractJsonFromResponse(responseText);
    }

    if (!parsed?.tiers?.length && completion.toolCalls?.length) {
      const assistantMsg = { role: 'assistant', content: completion.content || '', toolCalls: completion.toolCalls };
      if (completion._rawModelContent) assistantMsg._rawModelContent = completion._rawModelContent;
      const toolResults = [];
      for (const call of completion.toolCalls.slice(0, 5)) {
        const tool = tools[call.name];
        const key = JSON.stringify([call.name, call.arguments]);
        let result;
        try {
          result = (tool && executed.has(key)) ? executed.get(key)
            : tool ? await tool.run(call.arguments ?? {}) : { error: 'Tool không hợp lệ.' };
        } catch (e) { result = { error: e.message }; }
        toolResults.push({ name: call.name, result });
      }
      messages.push(assistantMsg, ...toolResults.map(tc => ({
        role: 'tool', name: tc.name,
        content: JSON.stringify(compactResult(tc.name, tc.result)),
      })));
      messages.push({ role: 'user', content: 'Hãy trả về kết quả 3 cấu hình PC dưới dạng JSON block theo format đã yêu cầu (với parsedRequirements, tiers, selectedTier). Không gọi thêm tool.' });
      const final = await complete(false);
      responseText = final.content || '';
      parsed = extractJsonFromResponse(responseText);
    }

    if (!parsed?.tiers?.length) {
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
    const tierErrors = async (tier) => {
      const cfg = (tier.items || []).filter(it => (it.productId || it.id) && it.slot)
        .map(it => ({ slot: it.slot, productId: it.productId || it.id, quantity: it.quantity || 1 }));
      try {
        const v = await validateBuildConfig(cfg);
        return (v?.data?.issues || []).filter(i => i.level === 'error');
      } catch { return []; }
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const bad = [];
      for (let i = 0; i < parsed.tiers.length; i++) {
        const errs = await tierErrors(parsed.tiers[i]);
        if (errs.length) bad.push({ index: i, name: parsed.tiers[i].name, errors: errs.map(e => e.message || e.code || JSON.stringify(e)) });
      }
      if (!bad.length) break;
      messages.push({ role: 'assistant', content: responseText });
      messages.push({ role: 'user', content: `Compatibility Engine báo lỗi tương thích ở các bản sau:\n${JSON.stringify(bad)}\nHãy thay linh kiện gây lỗi (ví dụ tản nhiệt quá cao so với Case thì đổi tản thấp hơn hoặc đổi Case khác; dùng search_products và check_build_compatibility cho TỪNG bản), vẫn trong ngân sách, rồi trả lại đầy đủ JSON block 3 bản theo format cũ.` });
      completion = await complete();
      await runToolRounds();
      const fixedText = completion.content || '';
      const fixed = extractJsonFromResponse(fixedText);
      if (!fixed?.tiers?.length) break;
      responseText = fixedText;
      parsed = fixed;
    }

    const validatedTiers = [];
    for (const tier of parsed.tiers) {
      if (!tier.items?.length) continue;

      for (const it of tier.items) {
        if (!it.productId && it.id) it.productId = it.id;
      }

      const configItems = tier.items
        .filter(it => it.productId && it.slot)
        .map(it => ({ slot: it.slot, productId: it.productId, quantity: it.quantity || 1 }));

      let validation = null;
      let validationError = null;
      try {
        validation = await validateBuildConfig(configItems);
      } catch (e) {
        validationError = e.message;
      }

      const items = tier.items
        .filter(it => it.productId && it.slot)
        .map(aiItem => {
          const validated = validation?.data?.items?.find(v => v.slot === aiItem.slot);
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

      const totalPrice = validation?.data?.total ?? items.reduce((s, it) => s + it.lineTotal, 0);

      validatedTiers.push({
        name: tier.name || `Bản ${validatedTiers.length + 1}`,
        description: tier.description || '',
        items,
        totalPrice,
        budgetDiff: totalPrice - input.budget,
        fpsEstimates: Array.isArray(tier.fpsEstimates) ? tier.fpsEstimates : [],
        compatibilityStatus: validation?.data?.issues?.some(i => i.level === 'error') ? 'fail'
          : validation?.data?.issues?.length ? 'warning' : 'pass',
        compatibilityIssues: validation?.data?.issues || [],
        compatibilityMissing: validation?.data?.missing || [],
        canAddToCart: validation?.data?.canAddToCart ?? false,
        isComplete: validation?.data?.isComplete ?? false,
        validationError,
      });
    }

    if (!validatedTiers.length) {
      return {
        success: false,
        error: 'AI không thể tạo cấu hình phù hợp với yêu cầu. Vui lòng thử lại.',
        rawResponse: responseText,
        metrics: { ...metrics, latencyMs: performance.now() - started },
      };
    }

    return {
      success: true,
      parsedRequirements: parsed.parsedRequirements || {},
      tiers: validatedTiers,
      selectedTier: Math.min(parsed.selectedTier ?? 0, validatedTiers.length - 1),
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
