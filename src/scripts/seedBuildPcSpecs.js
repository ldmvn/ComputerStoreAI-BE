// Import product specs from buildPcSpecs.json.
// --dry-run : print diff table, no DB writes
// --update  : apply changes to DB
// No flags  : print usage and exit

import '../config/env.js';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'buildPcSpecs.json');

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const UPDATE  = args.includes('--update');

if (!DRY_RUN && !UPDATE) {
  console.log('Cách dùng:');
  console.log('  node src/scripts/seedBuildPcSpecs.js --dry-run   # xem trước, không ghi DB');
  console.log('  node src/scripts/seedBuildPcSpecs.js --update    # ghi thật');
  process.exit(0);
}

const SEED_PREFIX = 'SEED-';
const prisma = new PrismaClient();
const data = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
const { attributeFixes, products } = data;

const stats = {
  fixApplied: 0, fixNoChange: 0, fixSkipped: 0,
  specsApplied: 0, specsNoChange: 0, specsSkipped: 0,
  warnings: [],
};
const dryTable = [];

// ── Load DB state ─────────────────────────────────────────────────────────────

const allAttrs = await prisma.attribute.findMany({ select: { id: true, slug: true, type: true } });
const attrBySlug = {};
const attrById = {};
for (const a of allAttrs) { attrBySlug[a.slug] = a; attrById[a.id] = a; }

const allAttrVals = await prisma.attributeValue.findMany({ select: { id: true, attributeId: true, value: true } });
const avMap = {};
for (const av of allAttrVals) {
  if (!avMap[av.attributeId]) avMap[av.attributeId] = new Map();
  avMap[av.attributeId].set(av.value, av.id);
}

const allBrands = await prisma.brand.findMany({ select: { id: true, slug: true } });
const brandSlugToId = {};
const brandIdToSlug = {};
for (const b of allBrands) { brandSlugToId[b.slug] = b.id; brandIdToSlug[b.id] = b.slug; }

const allCats = await prisma.category.findMany({ select: { id: true, slug: true } });
const catSlugById = {};
for (const c of allCats) catSlugById[c.id] = c.slug;

// ── Helpers ───────────────────────────────────────────────────────────────────

const KNOWN_BRAND_NAMES = { 'ek': 'EK Water Blocks', 'bykski': 'Bykski', 'e-win': 'E-Win' };
function brandNameFromSlug(s) {
  return KNOWN_BRAND_NAMES[s] || s.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

async function ensureAttrVal(attrId, value) {
  if (!avMap[attrId]) avMap[attrId] = new Map();
  if (avMap[attrId].has(String(value))) return avMap[attrId].get(String(value));
  const strVal = String(value);
  if (DRY_RUN) {
    avMap[attrId].set(strVal, -1);
    console.log(`[DRY-RUN]  AttributeValue  ${attrById[attrId]?.slug}="${strVal}"  → would CREATE`);
    return -1;
  }
  const av = await prisma.attributeValue.create({ data: { attributeId: attrId, value: strVal } });
  avMap[attrId].set(strVal, av.id);
  console.log(`[CREATE]   AttributeValue  ${attrById[attrId]?.slug}="${strVal}"  (id=${av.id})`);
  return av.id;
}

async function ensureBrand(slug) {
  if (brandSlugToId[slug]) return brandSlugToId[slug];
  if (DRY_RUN) {
    brandSlugToId[slug] = -1;
    brandIdToSlug[-1] = slug;
    console.log(`[DRY-RUN]  Brand  "${slug}"  → would CREATE`);
    return -1;
  }
  const b = await prisma.brand.create({ data: { slug, name: brandNameFromSlug(slug), isActive: true } });
  brandSlugToId[slug] = b.id;
  brandIdToSlug[b.id] = slug;
  console.log(`[CREATE]   Brand  "${slug}"  (id=${b.id})`);
  return b.id;
}

// Map attribute slug → highlight spec content string (for patching after PAV update)
function hsContent(slug, val) {
  switch (slug) {
    case 'chipset':       return `Chipset: ${val}`;
    case 'so-khe-m-2':   return `Khe M.2: ${val} khe`;
    case 'so-khe-ram':   return `Số khe RAM: ${val} khe`;
    case 'ram-toi-da':   return `RAM tối đa: ${val} GB`;
    case 'pcie-cho-vga': return `PCIe VGA: Gen ${val}`;
    default: return null;
  }
}

// Build auto-derived highlight lines from a product's attribute map
function buildAutoHighlightLines(catSlug, am) {
  const lines = [];
  const v  = (slug) => am[slug];
  const vn = (slug) => (am[slug] != null ? am[slug] : null);
  const arr = (slug) => (Array.isArray(am[slug]) ? am[slug] : am[slug] != null ? [am[slug]] : []);

  if (catSlug === 'cpu') {
    if (v('socket-cpu'))  lines.push(`Socket: ${v('socket-cpu')}`);
    if (v('cpu-series'))  lines.push(`Dòng CPU: ${v('cpu-series')}`);
    if (vn('tdp') != null) lines.push(`TDP: ${vn('tdp')} W`);
  }
  if (catSlug === 'main') {
    if (v('chipset'))              lines.push(`Chipset: ${v('chipset')}`);
    if (v('socket-cpu'))           lines.push(`Socket CPU: ${v('socket-cpu')}`);
    if (v('loai-ram'))             lines.push(`Loại RAM: ${v('loai-ram')}`);
    if (v('kich-thuoc-mainboard')) lines.push(`Kích thước: ${v('kich-thuoc-mainboard')}`);
    if (vn('so-khe-ram') != null)  lines.push(`Số khe RAM: ${vn('so-khe-ram')} khe`);
    if (vn('ram-toi-da') != null)  lines.push(`RAM tối đa: ${vn('ram-toi-da')} GB`);
    if (vn('so-khe-m-2') != null)  lines.push(`Khe M.2: ${vn('so-khe-m-2')} khe`);
    if (v('pcie-cho-vga'))         lines.push(`PCIe VGA: Gen ${v('pcie-cho-vga')}`);
  }
  if (catSlug === 'ram') {
    if (v('loai-ram'))       lines.push(`Loại RAM: ${v('loai-ram')}`);
    if (v('ram'))            lines.push(`Dung lượng: ${v('ram')}`);
    if (v('toc-do-bus-ram')) lines.push(`Tốc độ bus: ${v('toc-do-bus-ram')}`);
  }
  if (catSlug === 'vga' || catSlug === 'vga-like-new') {
    if (vn('tdp') != null)        lines.push(`Công suất (TDP): ${vn('tdp')} W`);
    if (vn('vga-length') != null) lines.push(`Chiều dài: ${vn('vga-length')} mm`);
  }
  if (catSlug === 'nguon') {
    if (vn('psu-wattage') != null) lines.push(`Công suất: ${vn('psu-wattage')} W`);
  }
  if (catSlug === 'vo-case') {
    const s = arr('kich-thuoc-mainboard');
    if (s.length) lines.push(`Hỗ trợ mainboard: ${s.join(', ')}`);
    if (vn('case-max-vga-length') != null)    lines.push(`GPU tối đa: ${vn('case-max-vga-length')} mm`);
    if (vn('case-max-cooler-height') != null) lines.push(`Tản nhiệt tối đa: ${vn('case-max-cooler-height')} mm`);
    const r = arr('radiator-size');
    if (r.length) lines.push(`Radiator hỗ trợ: ${r.join(', ')} mm`);
  }
  if (catSlug === 'tan-nhiet' || catSlug === 'aio') {
    if (vn('cooler-height') != null) lines.push(`Chiều cao tản: ${vn('cooler-height')} mm`);
    const s = arr('socket-cpu');
    if (s.length) lines.push(`Socket hỗ trợ: ${s.join(', ')}`);
  }
  return lines;
}

// ── Phase 1: Attribute Fixes ──────────────────────────────────────────────────

async function applyAttributeFix(fix) {
  if (!fix.sku.startsWith(SEED_PREFIX)) {
    stats.warnings.push(`${fix.sku}: bỏ qua vì không phải SEED-`); return;
  }
  const dbProduct = await prisma.product.findUnique({
    where: { sku: fix.sku },
    include: { attributeValues: { include: { attribute: true, attributeValue: true } } },
  });
  if (!dbProduct) {
    stats.warnings.push(`${fix.sku}: không tìm thấy trong DB`); return;
  }

  const changes = [];

  // Name
  if (fix.name && dbProduct.name !== fix.name) {
    changes.push({
      field: 'name', from: dbProduct.name, to: fix.name,
      apply: async () => prisma.product.update({ where: { id: dbProduct.id }, data: { name: fix.name } }),
    });
  }

  // Brand
  if (fix.brand) {
    const currentBrandSlug = brandIdToSlug[dbProduct.brandId] ?? String(dbProduct.brandId);
    if (currentBrandSlug !== fix.brand) {
      await ensureBrand(fix.brand); // ensure exists (or placeholder in dry-run)
      changes.push({
        field: 'brand', from: currentBrandSlug, to: fix.brand,
        apply: async () => prisma.product.update({
          where: { id: dbProduct.id }, data: { brandId: brandSlugToId[fix.brand] },
        }),
      });
    }
  }

  // Attribute set
  for (const [slug, newValue] of Object.entries(fix.set || {})) {
    const attr = attrBySlug[slug];
    if (!attr) { stats.warnings.push(`${fix.sku}: attr "${slug}" not found`); continue; }

    if (attr.type === 'NUMBER') {
      const newNum = Number(newValue);
      const ep = dbProduct.attributeValues.find(p => p.attributeId === attr.id);
      if (!ep) {
        changes.push({
          field: `${slug} (PAV new)`, from: '(none)', to: String(newValue),
          apply: async () => prisma.productAttributeValue.create({
            data: { productId: dbProduct.id, attributeId: attr.id, valueText: String(newValue), valueNumber: newNum },
          }),
        });
      } else {
        const oldNum = Number(ep.valueNumber);
        if (oldNum !== newNum) {
          changes.push({
            field: `${slug} (PAV)`, from: String(oldNum), to: String(newNum),
            apply: async () => prisma.productAttributeValue.update({
              where: { id: ep.id }, data: { valueText: String(newValue), valueNumber: newNum },
            }),
          });
          const oldHs = hsContent(slug, oldNum);
          const newHs = hsContent(slug, newNum);
          if (oldHs && newHs && oldHs !== newHs) {
            const hsRow = await prisma.productHighlightSpec.findFirst({
              where: { productId: dbProduct.id, content: oldHs },
            });
            if (hsRow) {
              changes.push({
                field: `highlight_spec (${slug})`, from: oldHs, to: newHs,
                apply: async () => prisma.productHighlightSpec.update({
                  where: { id: hsRow.id }, data: { content: newHs },
                }),
              });
            }
          }
        }
      }

    } else if (attr.type === 'SELECT') {
      const newStr = String(newValue);
      await ensureAttrVal(attr.id, newStr);
      const ep = dbProduct.attributeValues.find(p => p.attributeId === attr.id);
      const oldStr = ep?.attributeValue?.value ?? null;
      if (oldStr !== newStr) {
        if (ep) {
          changes.push({
            field: `${slug} (PAV)`, from: oldStr ?? '(none)', to: newStr,
            apply: async () => prisma.productAttributeValue.update({
              where: { id: ep.id }, data: { attributeValueId: avMap[attr.id].get(newStr) },
            }),
          });
        } else {
          changes.push({
            field: `${slug} (PAV new)`, from: '(none)', to: newStr,
            apply: async () => prisma.productAttributeValue.create({
              data: { productId: dbProduct.id, attributeId: attr.id, attributeValueId: avMap[attr.id].get(newStr) },
            }),
          });
        }
        if (oldStr) {
          const oldHs = hsContent(slug, oldStr);
          const newHs = hsContent(slug, newStr);
          if (oldHs && newHs && oldHs !== newHs) {
            const hsRow = await prisma.productHighlightSpec.findFirst({
              where: { productId: dbProduct.id, content: oldHs },
            });
            if (hsRow) {
              changes.push({
                field: `highlight_spec (${slug})`, from: oldHs, to: newHs,
                apply: async () => prisma.productHighlightSpec.update({
                  where: { id: hsRow.id }, data: { content: newHs },
                }),
              });
            }
          }
        }
      }

    } else if (attr.type === 'MULTI_SELECT') {
      const newVals = Array.isArray(newValue) ? newValue : [newValue];
      for (const v of newVals) await ensureAttrVal(attr.id, v);
      const existingPavs = dbProduct.attributeValues.filter(p => p.attributeId === attr.id);
      const oldVals = existingPavs.map(p => p.attributeValue?.value).filter(Boolean);
      const toAdd    = newVals.filter(v => !oldVals.includes(v));
      const toRemove = oldVals.filter(v => !newVals.includes(String(v)));
      for (const v of toRemove) {
        const pav = existingPavs.find(p => p.attributeValue?.value === v);
        if (pav) changes.push({
          field: `${slug} (remove)`, from: v, to: '(removed)',
          apply: async () => prisma.productAttributeValue.delete({ where: { id: pav.id } }),
        });
      }
      for (const v of toAdd) {
        const avId = avMap[attr.id].get(String(v));
        changes.push({
          field: `${slug} (add)`, from: '(none)', to: String(v),
          apply: async () => prisma.productAttributeValue.create({
            data: { productId: dbProduct.id, attributeId: attr.id, attributeValueId: avId },
          }),
        });
      }
    }
  }

  if (changes.length === 0) { stats.fixNoChange++; return; }

  if (DRY_RUN) {
    for (const c of changes) dryTable.push({ sku: fix.sku, field: c.field, from: c.from, to: c.to });
    stats.fixApplied++;
    return;
  }

  for (const c of changes) await c.apply();
  console.log(`[FIX]      ${fix.sku}  ${changes.length} change(s)`);
  stats.fixApplied++;
}

// ── Phase 2: Product Specs ────────────────────────────────────────────────────

async function applySpecs(sku, specRows) {
  if (!sku.startsWith(SEED_PREFIX)) {
    stats.warnings.push(`${sku}: không phải SEED-, bỏ qua`); return;
  }
  const dbProduct = await prisma.product.findUnique({
    where: { sku },
    include: { attributeValues: { include: { attribute: true, attributeValue: true } } },
  });
  if (!dbProduct) {
    stats.warnings.push(`${sku}: không tìm thấy trong DB`); return;
  }

  const catSlug = catSlugById[dbProduct.categoryId] ?? '';

  // Build attrsMap from current DB state
  const am = {};
  for (const pav of dbProduct.attributeValues) {
    const a = attrById[pav.attributeId];
    if (!a) continue;
    if (a.type === 'MULTI_SELECT') {
      if (!am[a.slug]) am[a.slug] = [];
      if (pav.attributeValue?.value) am[a.slug].push(pav.attributeValue.value);
    } else if (a.type === 'NUMBER') {
      am[a.slug] = Number(pav.valueNumber);
    } else if (a.type === 'SELECT') {
      am[a.slug] = pav.attributeValue?.value ?? null;
    } else {
      am[a.slug] = pav.valueText;
    }
  }

  // ── ProductSpecification ──────────────────────────────────────────────────
  const existingSpecs = await prisma.productSpecification.findMany({
    where: { productId: dbProduct.id }, orderBy: { sortOrder: 'asc' },
  });
  const baoBanh = existingSpecs.find(s => s.name === 'Bảo hành');
  const existingNonBH = existingSpecs.filter(s => s.name !== 'Bảo hành');

  const specsChanged = existingNonBH.length !== specRows.length ||
    specRows.some(([name, value], i) =>
      existingNonBH[i]?.name !== name || existingNonBH[i]?.value !== value
    );

  // ── ProductHighlightSpec ──────────────────────────────────────────────────
  const existingHs = await prisma.productHighlightSpec.findMany({
    where: { productId: dbProduct.id }, orderBy: { sortOrder: 'asc' },
  });

  const autoLines = buildAutoHighlightLines(catSlug, am);
  const suppLines = specRows.slice(0, 8).map(([name, value]) => `${name}: ${value}`);
  const hsLines = [...autoLines];
  for (const line of suppLines) {
    if (hsLines.length >= 12) break;
    if (!hsLines.includes(line)) hsLines.push(line);
  }
  const desiredHs = hsLines.map((content, i) => ({ content, sortOrder: i + 1 }));

  const hsChanged = existingHs.length !== desiredHs.length ||
    desiredHs.some((h, i) => existingHs[i]?.content !== h.content);

  if (!specsChanged && !hsChanged) { stats.specsNoChange++; return; }

  if (DRY_RUN) {
    if (specsChanged) dryTable.push({
      sku, field: 'ProductSpecification',
      from: `${existingNonBH.length} dòng`,
      to:   `${specRows.length} dòng`,
    });
    if (hsChanged) dryTable.push({
      sku, field: 'ProductHighlightSpec',
      from: `${existingHs.length} dòng`,
      to:   `${desiredHs.length} dòng`,
    });
    stats.specsApplied++;
    return;
  }

  // Apply ProductSpecification
  if (specsChanged) {
    await prisma.productSpecification.deleteMany({
      where: { productId: dbProduct.id, NOT: { name: 'Bảo hành' } },
    });
    for (let i = 0; i < specRows.length; i++) {
      const [name, value] = specRows[i];
      await prisma.productSpecification.create({
        data: { productId: dbProduct.id, name, value, sortOrder: i + 1 },
      });
    }
    // Ensure Bảo hành stays at 9999
    if (baoBanh) {
      await prisma.productSpecification.updateMany({
        where: { productId: dbProduct.id, name: 'Bảo hành' },
        data: { sortOrder: 9999 },
      });
    }
  }

  // Apply ProductHighlightSpec
  if (hsChanged) {
    await prisma.productHighlightSpec.deleteMany({ where: { productId: dbProduct.id } });
    for (const h of desiredHs) {
      await prisma.productHighlightSpec.create({
        data: { productId: dbProduct.id, content: h.content, sortOrder: h.sortOrder },
      });
    }
  }

  console.log(`[SPECS]    ${sku}  spec:${specsChanged ? `${existingNonBH.length}→${specRows.length}` : 'OK'}  hs:${hsChanged ? `${existingHs.length}→${desiredHs.length}` : 'OK'}`);
  stats.specsApplied++;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('=== Phase 1: Attribute Fixes ===');
for (const fix of attributeFixes) {
  if (fix.c === 'can_tra') { stats.fixSkipped++; continue; }
  await applyAttributeFix(fix);
}

console.log('\n=== Phase 2: Product Specs ===');
for (const [sku, prod] of Object.entries(products)) {
  if (prod.c === 'can_tra') { stats.specsSkipped++; continue; }
  await applySpecs(sku, prod.specs || []);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n=== Tổng kết ===');
console.log('Attribute fixes:');
console.log(`  Áp dụng  : ${stats.fixApplied}   Không đổi: ${stats.fixNoChange}   Bỏ qua (can_tra): ${stats.fixSkipped}`);
console.log('Product specs:');
console.log(`  Áp dụng  : ${stats.specsApplied}   Không đổi: ${stats.specsNoChange}   Bỏ qua (can_tra): ${stats.specsSkipped}`);

if (stats.warnings.length) {
  console.log(`\nCảnh báo (${stats.warnings.length}):`);
  for (const w of stats.warnings) console.log(`  ⚠ ${w}`);
}

if (DRY_RUN && dryTable.length > 0) {
  console.log('\n=== Dry-run diff table ===');
  const skuW   = Math.max(4, ...dryTable.map(r => r.sku.length));
  const fieldW = Math.max(6, ...dryTable.map(r => r.field.length));
  const header = `${'SKU'.padEnd(skuW)}  ${'Trường'.padEnd(fieldW)}  Giá trị cũ → mới`;
  console.log(header);
  console.log('-'.repeat(header.length + 10));
  for (const r of dryTable) {
    const trunc = s => s.length > 70 ? s.slice(0, 67) + '...' : s;
    console.log(`${r.sku.padEnd(skuW)}  ${r.field.padEnd(fieldW)}  ${trunc(r.from)}  →  ${trunc(r.to)}`);
  }
}

if (DRY_RUN) console.log('\n[DRY-RUN] Không có thay đổi nào được ghi vào DB.');

await prisma.$disconnect();
