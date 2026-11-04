// Parses each SEED- product's name to auto-fill the newly created shop
// attributes (storage capacity/interface, monitor specs, connectivity,
// speaker config, fan size, VGA VRAM...) so existing catalog products
// aren't left with empty attribute gaps after seedShopAttributes.js.
// Idempotent: skips any (product, attribute) pair that already has a value.
//
//   node src/scripts/fillShopProductAttrs.js --dry-run
//   node src/scripts/fillShopProductAttrs.js --apply

import '../config/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;
const SEED_PREFIX = 'SEED-';

const attrs = await prisma.attribute.findMany({ select: { id: true, slug: true, type: true } });
const attrBySlug = Object.fromEntries(attrs.map(a => [a.slug, a]));
const attrValues = await prisma.attributeValue.findMany({ select: { id: true, attributeId: true, value: true } });
const avMap = {}; // attrId -> Map(value -> id)
for (const av of attrValues) {
  (avMap[av.attributeId] ??= new Map()).set(av.value, av.id);
}

function findClosestValue(attrId, candidate) {
  const map = avMap[attrId];
  if (!map) return null;
  if (map.has(candidate)) return map.get(candidate);
  // case-insensitive / loose match
  const needle = candidate.toLowerCase().replace(/\s+/g, '');
  for (const [v, id] of map) {
    if (v.toLowerCase().replace(/\s+/g, '') === needle) return id;
  }
  return null;
}

// ── Per-category parsers ────────────────────────────────────────────────────
// Each returns { slug: stringValue | number } for attrs it can confidently derive.

function parseStorage(name, catSlug) {
  const out = {};
  const capMatch = name.match(/(\d+(?:\.\d+)?(?:TB|GB))(?!\s*Cache)/i);
  if (capMatch) out['dung-luong-luu-tru'] = capMatch[1].toUpperCase();

  if (/PCIe\s*5\.0/i.test(name)) out['chuan-giao-tiep-luu-tru'] = 'PCIe 5.0 NVMe';
  else if (/PCIe\s*4\.0/i.test(name)) out['chuan-giao-tiep-luu-tru'] = 'PCIe 4.0 NVMe';
  else if (/PCIe\s*3\.0/i.test(name)) out['chuan-giao-tiep-luu-tru'] = 'PCIe 3.0 NVMe';
  else if (/SATA/i.test(name)) out['chuan-giao-tiep-luu-tru'] = 'SATA III';
  else if (catSlug === 'ssd-m2') out['chuan-giao-tiep-luu-tru'] = 'PCIe 4.0 NVMe';

  const rpmMatch = name.match(/(\d{4})\s*RPM/i);
  if (rpmMatch) out['toc-do-vong-quay-hdd'] = `${rpmMatch[1]} RPM`;

  return out;
}

function parseVga(name) {
  const out = {};
  const m = name.match(/(\d+)\s*GB\s+GDDR/i);
  if (m) out['vram-dung-luong'] = `${m[1]}GB`;
  return out;
}

function parseMonitor(name) {
  const out = {};
  const sizeMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:"|”|inch)/i);
  if (sizeMatch) out['kich-thuoc-man-hinh'] = `${sizeMatch[1]}"`;

  if (/4K|UHD/i.test(name)) out['do-phan-giai'] = '4K UHD (3840x2160)';
  else if (/ultrawide/i.test(name)) out['do-phan-giai'] = 'Ultrawide QHD (3440x1440)';
  else if (/QHD/i.test(name)) out['do-phan-giai'] = '2K (2560x1440)';
  else if (/FHD|Full\s*HD/i.test(name)) out['do-phan-giai'] = 'Full HD (1920x1080)';
  else if (/\bHD\b/i.test(name)) out['do-phan-giai'] = 'HD (1366x768)';

  const hzMatch = name.match(/\b(\d{2,3})\s*Hz\b/i);
  if (hzMatch) out['tan-so-quet'] = `${hzMatch[1]}Hz`;

  if (/\bIPS\b/i.test(name)) out['tam-nen'] = 'IPS';
  else if (/\bVA\b/i.test(name)) out['tam-nen'] = 'VA';
  else if (/\bTN\b/i.test(name)) out['tam-nen'] = 'TN';
  else if (/OLED/i.test(name)) out['tam-nen'] = 'OLED';

  return out;
}

function parseConnectivity(name) {
  const out = {};
  if (/không\s*dây|wireless/i.test(name)) out['ket-noi'] = 'Không dây';
  else out['ket-noi'] = 'Có dây';
  return out;
}

function parseHeadphone(name) {
  const out = { ...parseConnectivity(name) };
  if (/true\s*wireless|earbuds/i.test(name)) out['loai-tai-nghe'] = 'Earbuds True Wireless';
  else if (/on-ear|áp\s*tai/i.test(name)) out['loai-tai-nghe'] = 'On-ear (áp tai)';
  else if (/in-ear|nhét\s*tai/i.test(name)) out['loai-tai-nghe'] = 'In-ear (nhét tai)';
  else out['loai-tai-nghe'] = 'Over-ear (trùm tai)';
  return out;
}

function parseSpeaker(name) {
  const out = { ...parseConnectivity(name) };
  const m = name.match(/\b(2\.0|2\.1|4\.1|5\.1)\b/);
  if (m) out['cau-hinh-loa'] = m[1];
  else if (/soundbar|loa\s*thanh/i.test(name)) out['cau-hinh-loa'] = 'Loa thanh (Soundbar)';
  return out;
}

function parseFan(name) {
  const out = {};
  const m = name.match(/(\d{2,3})\s*mm/i);
  if (m) out['kich-thuoc-quat-case'] = `${m[1]}mm`;
  return out;
}

const PARSERS = {
  'hdd': parseStorage,
  'ssd-m2': parseStorage,
  'ssd-25': parseStorage,
  'vga': parseVga,
  'vga-like-new': parseVga,
  'man-hinh': parseMonitor,
  'ban-phim': parseConnectivity,
  'chuot': parseConnectivity,
  'ban-phim-chuot': parseConnectivity,
  'tai-nghe': parseHeadphone,
  'loa': parseSpeaker,
  'quat-case': parseFan,
};

// ── Run ──────────────────────────────────────────────────────────────────────

const categories = await prisma.category.findMany({ select: { id: true, slug: true } });
const catById = Object.fromEntries(categories.map(c => [c.id, c.slug]));

const products = await prisma.product.findMany({
  where: { sku: { startsWith: SEED_PREFIX } },
  select: { id: true, sku: true, name: true, categoryId: true, attributeValues: { select: { attributeId: true } } },
});

const stats = { filled: 0, skippedHasValue: 0, skippedNoMatch: 0, warnings: [] };

for (const p of products) {
  const catSlug = catById[p.categoryId];
  const parser = PARSERS[catSlug];
  if (!parser) continue;

  const derived = parser(p.name, catSlug);
  const have = new Set(p.attributeValues.map(av => av.attributeId));

  for (const [slug, value] of Object.entries(derived)) {
    const attr = attrBySlug[slug];
    if (!attr) { stats.warnings.push(`${p.sku}: attribute "${slug}" không tồn tại`); continue; }
    if (have.has(attr.id)) { stats.skippedHasValue++; continue; }

    if (attr.type === 'NUMBER') {
      const num = Number(String(value).replace(/[^\d.]/g, ''));
      if (Number.isNaN(num)) { stats.skippedNoMatch++; continue; }
      console.log(`${DRY ? '[DRY]' : '[FILL]'} ${p.sku}  ${slug} = ${num}`);
      stats.filled++;
      if (APPLY) {
        await prisma.productAttributeValue.create({
          data: { productId: p.id, attributeId: attr.id, valueText: String(value), valueNumber: num },
        });
      }
    } else {
      const avId = findClosestValue(attr.id, String(value));
      if (!avId) { stats.warnings.push(`${p.sku}: không tìm thấy AttributeValue "${value}" cho ${slug}`); stats.skippedNoMatch++; continue; }
      console.log(`${DRY ? '[DRY]' : '[FILL]'} ${p.sku}  ${slug} = "${value}"`);
      stats.filled++;
      if (APPLY) {
        await prisma.productAttributeValue.create({
          data: { productId: p.id, attributeId: attr.id, attributeValueId: avId },
        });
      }
    }
  }
}

console.log('\n=== Tổng kết ===');
console.log(`Điền mới: ${stats.filled}   Đã có sẵn (bỏ qua): ${stats.skippedHasValue}   Không nhận diện được: ${stats.skippedNoMatch}`);
if (stats.warnings.length) {
  console.log(`\nCảnh báo (${stats.warnings.length}):`);
  for (const w of stats.warnings) console.log(`  ⚠ ${w}`);
}
if (DRY) console.log('\n[DRY-RUN] Không có thay đổi nào được ghi vào DB. Chạy lại với --apply để ghi thật.');

await prisma.$disconnect();
