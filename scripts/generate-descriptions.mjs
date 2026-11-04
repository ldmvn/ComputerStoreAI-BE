/**
 * Tự động sinh mô tả sản phẩm bằng Google Gemini AI cho tất cả sản phẩm thiếu mô tả.
 *
 * Cách dùng:
 *   node scripts/generate-descriptions.mjs           # xử lý tất cả
 *   node scripts/generate-descriptions.mjs --limit 10  # thử 10 sản phẩm
 *   node scripts/generate-descriptions.mjs --dry-run   # chỉ in danh sách, không gọi API
 *   node scripts/generate-descriptions.mjs --id 123    # xử lý 1 sản phẩm cụ thể
 *
 * Yêu cầu: OPENAI_API_KEY trong file .env
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OPENAI_MODEL = 'deepseek/deepseek-chat';
const OPENAI_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// --- CLI args ---
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limitVal = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null;
const idIdx = args.indexOf('--id');
const singleId = idIdx !== -1 ? parseInt(args[idIdx + 1], 10) : null;

// Khoảng dừng giữa các lần gọi API (ms) — tránh rate limit
const DELAY_MS = 1200;

const SYSTEM_PROMPT = `Bạn là chuyên gia tư vấn sản phẩm công nghệ tại cửa hàng DUCMANH PC — chuyên về linh kiện máy tính, gaming gear và thiết bị ngoại vi.

Nhiệm vụ: Viết mô tả chi tiết sản phẩm bằng tiếng Việt chuyên nghiệp, hấp dẫn, có giá trị tư vấn mua hàng thực sự.

Quy tắc bắt buộc:
1. KHÔNG viết mục "Thông số kỹ thuật" hay bất kỳ bảng/danh sách liệt kê thông số thuần túy — website đã có bảng Thông số riêng.
2. Thay vào đó, viết phân tích chuyên sâu về thiết kế, hiệu năng, công nghệ, trải nghiệm sử dụng, tính tương thích và lưu ý thực tế.
3. Tiêu đề H2 linh hoạt theo từng sản phẩm — không áp dụng mẫu cứng.
4. Chỉ đề cập đến thông số kỹ thuật khi cần giải thích bối cảnh hoặc so sánh (ví dụ: "115W TDP thấp hơn thế hệ trước 30%"). Không liệt kê thông số thuần túy.
5. Chỉ dùng thông tin đã được xác minh trong dữ liệu sản phẩm. Không bịa đặt.
6. Viết 3–5 phần H2. Mỗi phần 1–3 đoạn văn. Kết thúc bằng mục "Phù hợp với ai?" ngắn gọn.
7. Định dạng HTML: dùng <h2>, <p>, <strong>, <em>. KHÔNG dùng <ul>/<li> để liệt kê thông số.
8. Chỉ trả về HTML thuần — không có markdown, không có giải thích, không có code fence.`;

function buildUserPrompt(product) {
  const lines = [
    `Sản phẩm: ${product.name}`,
    `SKU: ${product.sku}`,
    product.brand ? `Thương hiệu: ${product.brand}` : null,
    product.category ? `Danh mục: ${product.category}` : null,
    product.shortDescription ? `Mô tả ngắn: ${product.shortDescription}` : null,
  ].filter(Boolean);

  // Attributes (từ attributeValues đã serialize)
  const attrs = product.attributeValues || [];
  if (attrs.length > 0) {
    lines.push('\nThuộc tính sản phẩm:');
    for (const row of attrs) {
      const name = row.attribute?.name || '?';
      const values = [];
      if (row.attributeValue?.value) values.push(row.attributeValue.value);
      if (row.valueText) values.push(row.valueText);
      if (values.length) lines.push(`  ${name}: ${values.join(', ')}`);
    }
  }

  // Custom specs
  const specs = product.specifications || [];
  if (specs.length > 0) {
    lines.push('\nThông số tùy chỉnh:');
    for (const s of specs) lines.push(`  ${s.name}: ${s.value}`);
  }

  // Highlight specs
  const highlights = product.highlightSpecs || [];
  if (highlights.length > 0) {
    lines.push('\nĐiểm nổi bật:');
    for (const h of highlights) lines.push(`  - ${h.content}`);
  }

  lines.push('\nViết mô tả HTML theo quy tắc đã cho.');
  return lines.join('\n');
}

async function generateDescription(product) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let res;
  try {
    res = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://ducmanh.store',
        'X-Title': 'DUCMANH PC',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(product) },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status} ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Không nhận được text từ OpenAI API');

  return text.trim().replace(/^```html\n?/, '').replace(/\n?```$/, '').trim();
}

async function getProducts() {
  const where = {
    isActive: true,
    isDeleted: false,
    ...(singleId
      ? { id: singleId }
      : {
          OR: [
            { description: null },
            { description: '' },
          ],
        }),
  };

  const products = await prisma.product.findMany({
    where,
    include: {
      attributeValues: { include: { attribute: true, attributeValue: true }, orderBy: { id: 'asc' } },
      specifications: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      highlightSpecs: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      brandRecord: true,
      categoryRecord: true,
    },
    orderBy: [{ categoryId: 'asc' }, { id: 'asc' }],
    ...(limitVal ? { take: limitVal } : {}),
  });

  return products.map(p => ({
    ...p,
    brand: p.brandRecord?.name || null,
    category: p.categoryRecord?.name || null,
  }));
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('❌ Thiếu OPENROUTER_API_KEY trong file .env');
    process.exit(1);
  }

  console.log('🔍 Tìm sản phẩm cần viết mô tả...');
  const products = await getProducts();

  if (products.length === 0) {
    console.log('✅ Không có sản phẩm nào cần viết mô tả.');
    return;
  }

  console.log(`\nTìm thấy ${products.length} sản phẩm${isDryRun ? ' (dry-run — không gọi API)' : ''}:\n`);

  // Group theo category để hiển thị
  const byCategory = {};
  for (const p of products) {
    const cat = p.category || 'Không có danh mục';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(p);
  }
  for (const [cat, items] of Object.entries(byCategory)) {
    console.log(`  ${cat} (${items.length}):`);
    for (const p of items) console.log(`    #${p.id} ${p.name} [${p.sku}]`);
  }

  if (isDryRun) {
    console.log('\nDry-run: không gọi API. Dùng bỏ --dry-run để xử lý thật.');
    return;
  }

  console.log(`\nBắt đầu sinh mô tả (model: ${OPENAI_MODEL}, delay: ${DELAY_MS}ms)...\n`);

  let saved = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const prefix = `[${i + 1}/${products.length}] #${p.id}`;

    // Bỏ qua nếu đã có mô tả đủ dài (chỉ áp dụng khi chạy theo --id)
    if (singleId && p.description && p.description.trim().length > 500) {
      console.log(`⏭  ${prefix} — Đã có mô tả (${p.description.length} ký tự), bỏ qua.`);
      skipped++;
      continue;
    }

    process.stdout.write(`⏳ ${prefix} ${p.name}...`);

    try {
      const html = await generateDescription(p);
      await prisma.product.update({ where: { id: p.id }, data: { description: html } });
      console.log(` ✅ (${html.length} ký tự)`);
      saved++;
    } catch (err) {
      console.log(` ❌ ${err.message}`);
      failed++;
      errors.push({ id: p.id, name: p.name, error: err.message });
    }

    if (i < products.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Kết quả: ✅ ${saved} thành công  ⏭  ${skipped} bỏ qua  ❌ ${failed} lỗi`);

  if (errors.length > 0) {
    console.log('\nSản phẩm lỗi:');
    for (const e of errors) console.log(`  #${e.id} ${e.name}: ${e.error}`);
  }
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
