// Seed ~110 sample Build PC products for the DUCMANH PC store.
// Idempotent: skips any product whose SKU already exists.
// Run: node src/scripts/seedBuildPcProducts.js [--dry-run] [--update] [--cleanup] [--force]
//
// --dry-run : print what would be created/skipped/updated, no DB writes
// --update  : update existing SEED-* products to match JSON (combined with --dry-run: show diff table only)
// --cleanup : DELETE every product whose SKU starts with "SEED-" (then exit)
// --force   : allow running in production

import '../config/env.js';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'buildPcProducts.json');

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CLEANUP  = args.includes('--cleanup');
const FORCE    = args.includes('--force');
const UPDATE   = args.includes('--update');
const SEED_PREFIX = 'SEED-';

if (process.env.NODE_ENV === 'production' && !FORCE) {
  console.error('ERROR: Từ chối chạy trong production. Thêm --force nếu thực sự cần.');
  process.exit(1);
}

const prisma = new PrismaClient();
const stats  = { created: 0, skipped: 0, updated: 0, cleaned: 0, errors: 0 };

function logOp(action, sku, extra = '') {
  const tag = `[${action}]`.padEnd(10);
  console.log(`${tag} ${sku}${extra ? '  ' + extra : ''}`);
  if      (action === 'CREATE') stats.created++;
  else if (action === 'SKIP')   stats.skipped++;
  else if (action === 'UPDATE') stats.updated++;
  else if (action === 'CLEAN')  stats.cleaned++;
  else if (action === 'ERROR')  stats.errors++;
}

// ── Load JSON ────────────────────────────────────────────────────────────────

const data = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
const { newAttributeValues, brands: brandDefs, products } = data;

// ── CLEANUP MODE ─────────────────────────────────────────────────────────────

if (CLEANUP) {
  console.log('=== CLEANUP MODE ===');
  const seedProducts = await prisma.product.findMany({
    where: { sku: { startsWith: 'SEED-' } },
    select: { id: true, sku: true },
  });
  console.log(`Tìm thấy ${seedProducts.length} sản phẩm SEED-* trong DB.`);
  if (!DRY_RUN) {
    for (const p of seedProducts) {
      await prisma.productSpecification.deleteMany({ where: { productId: p.id } });
      await prisma.productAttributeValue.deleteMany({ where: { productId: p.id } });
      await prisma.product.delete({ where: { id: p.id } });
      logOp('CLEAN', p.sku);
    }
    console.log(`\nĐã xóa ${stats.cleaned} sản phẩm.`);
  } else {
    for (const p of seedProducts) console.log(`  [DRY-RUN] Sẽ xóa: ${p.sku}`);
    console.log('[DRY-RUN] Không ghi vào DB.');
  }
  await prisma.$disconnect();
  process.exit(0);
}

// ── PHASE 1: Upsert brands ────────────────────────────────────────────────────

console.log('=== Phase 1: Upsert brands ===');
const brandSlugToId = {};

const existingBrands = await prisma.brand.findMany({ select: { id: true, slug: true, name: true } });
for (const b of existingBrands) brandSlugToId[b.slug] = b.id;

for (const def of brandDefs) {
  if (brandSlugToId[def.slug]) {
    console.log(`[SKIP]     brand  ${def.slug}  (id=${brandSlugToId[def.slug]})`);
    continue;
  }
  if (DRY_RUN) {
    console.log(`[DRY-RUN]  brand  ${def.slug}  → would CREATE`);
    brandSlugToId[def.slug] = -1;
    continue;
  }
  const b = await prisma.brand.create({ data: { name: def.name, slug: def.slug, isActive: true } });
  brandSlugToId[def.slug] = b.id;
  console.log(`[CREATE]   brand  ${def.slug}  (id=${b.id})`);
}

// ── PHASE 2: New AttributeValues ──────────────────────────────────────────────

console.log('\n=== Phase 2: New AttributeValues ===');

const allAttrs = await prisma.attribute.findMany({
  select: { id: true, slug: true, type: true },
});
const attrBySlug = {};
for (const a of allAttrs) attrBySlug[a.slug] = a;

const allAttrVals = await prisma.attributeValue.findMany({
  select: { id: true, attributeId: true, value: true },
});
const avMap = {};
for (const av of allAttrVals) {
  if (!avMap[av.attributeId]) avMap[av.attributeId] = new Map();
  avMap[av.attributeId].set(av.value, av.id);
}

for (const [attrSlug, values] of Object.entries(newAttributeValues)) {
  const attr = attrBySlug[attrSlug];
  if (!attr) {
    console.error(`ERROR: attribute slug "${attrSlug}" not found in DB. Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (!avMap[attr.id]) avMap[attr.id] = new Map();
  for (const val of values) {
    if (avMap[attr.id].has(val)) {
      console.log(`[SKIP]     AttributeValue  ${attrSlug}="${val}"  (id=${avMap[attr.id].get(val)})`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`[DRY-RUN]  AttributeValue  ${attrSlug}="${val}"  → would CREATE`);
      avMap[attr.id].set(val, -1);
      continue;
    }
    const av = await prisma.attributeValue.create({ data: { attributeId: attr.id, value: val } });
    avMap[attr.id].set(val, av.id);
    console.log(`[CREATE]   AttributeValue  ${attrSlug}="${val}"  (id=${av.id})`);
  }
}

// ── PHASE 3: Load category map ────────────────────────────────────────────────

const allCats = await prisma.category.findMany({ select: { id: true, slug: true } });
const catBySlug = {};
for (const c of allCats) catBySlug[c.slug] = c.id;

// ── PHASE 4: Validate all products before writing ─────────────────────────────

console.log('\n=== Phase 3: Validate ===');
const validationErrors = [];

for (const p of products) {
  const catId = catBySlug[p.categorySlug];
  if (!catId) { validationErrors.push(`${p.sku}: categorySlug "${p.categorySlug}" not found`); continue; }
  if (!brandSlugToId[p.brandSlug]) { validationErrors.push(`${p.sku}: brandSlug "${p.brandSlug}" not found`); continue; }
  if (!p.name || !p.sku) { validationErrors.push(`${p.sku}: missing name or sku`); continue; }
  if (typeof p.price !== 'number' || p.price < 0) { validationErrors.push(`${p.sku}: invalid price`); continue; }

  for (const [slug, value] of Object.entries(p.attributes || {})) {
    const attr = attrBySlug[slug];
    if (!attr) { validationErrors.push(`${p.sku}: attribute slug "${slug}" not found`); continue; }
    const values = Array.isArray(value) ? value : [value];
    if (attr.type === 'SELECT' || attr.type === 'MULTI_SELECT') {
      for (const v of values) {
        if (!avMap[attr.id] || !avMap[attr.id].has(v)) {
          validationErrors.push(`${p.sku}: AttributeValue "${slug}"="${v}" not found`);
        }
      }
    } else if (attr.type === 'NUMBER') {
      for (const v of values) {
        if (!Number.isFinite(Number(v))) {
          validationErrors.push(`${p.sku}: attribute "${slug}" value "${v}" is not a finite number`);
        }
      }
    }
  }
}

if (validationErrors.length > 0) {
  console.error(`\nValidation FAILED với ${validationErrors.length} lỗi:`);
  for (const e of validationErrors) console.error(`  - ${e}`);
  await prisma.$disconnect();
  process.exit(1);
}
console.log('Validation OK: 0 lỗi.');

// ── UPDATE HELPERS ────────────────────────────────────────────────────────────

// Map attribute slug → highlight spec content string for a given value
function hsContent(attrSlug, val) {
  switch (attrSlug) {
    case 'chipset':       return `Chipset: ${val}`;
    case 'so-khe-m-2':   return `Khe M.2: ${val} khe`;
    case 'so-khe-ram':   return `Số khe RAM: ${val} khe`;
    case 'ram-toi-da':   return `RAM tối đa: ${val} GB`;
    case 'pcie-cho-vga': return `PCIe VGA: Gen ${val}`;
    default: return null;
  }
}

function parseBaseClock(name) {
  const m = name.match(/([\d.]+)GHz\s+Up\s+to/i);
  return m ? m[1] : null;
}

function parseBoostClock(name) {
  const m = name.match(/Up\s+to\s+([\d.]+)GHz/i);
  return m ? m[1] : null;
}

// Dry-run diff table rows
const dryTable = [];

async function updateSeedProduct(p) {
  const dbProduct = await prisma.product.findUnique({
    where: { sku: p.sku },
    include: {
      attributeValues: {
        include: { attribute: true, attributeValue: true },
      },
    },
  });
  if (!dbProduct) {
    logOp('ERROR', p.sku, 'not found despite being in existingSkus');
    return;
  }

  const dbHs = await prisma.productHighlightSpec.findMany({
    where: { productId: dbProduct.id },
    select: { id: true, content: true },
  });

  const changes = []; // { field, oldVal, newVal, apply: async fn }

  // ── Name change ──────────────────────────────────────────────────────────
  if (dbProduct.name !== p.name) {
    changes.push({
      field: 'name',
      oldVal: dbProduct.name,
      newVal: p.name,
      apply: async () => prisma.product.update({ where: { id: dbProduct.id }, data: { name: p.name } }),
    });

    // CPU: update "Xung nhịp: X.X GHz (tối đa Y.Y GHz)" highlight spec
    const oldBase = parseBaseClock(dbProduct.name);
    const newBase = parseBaseClock(p.name);
    const boost   = parseBoostClock(p.name);
    if (oldBase && newBase && oldBase !== newBase && boost) {
      const oldHs = `Xung nhịp: ${oldBase} GHz (tối đa ${boost} GHz)`;
      const newHs = `Xung nhịp: ${newBase} GHz (tối đa ${boost} GHz)`;
      const hsRow = dbHs.find(h => h.content === oldHs);
      if (hsRow) {
        changes.push({
          field: 'highlight_spec (xung nhịp)',
          oldVal: oldHs,
          newVal: newHs,
          apply: async () => prisma.productHighlightSpec.update({ where: { id: hsRow.id }, data: { content: newHs } }),
        });
      }
    }
  }

  // ── PAV changes ──────────────────────────────────────────────────────────
  for (const [slug, newValue] of Object.entries(p.attributes || {})) {
    const attr = attrBySlug[slug];
    if (!attr) continue;

    if (attr.type === 'NUMBER') {
      const newNum = Number(newValue);
      const existingPav = dbProduct.attributeValues.find(pav => pav.attributeId === attr.id);

      if (!existingPav) {
        changes.push({
          field: `${slug} (PAV new)`,
          oldVal: '(none)',
          newVal: String(newValue),
          apply: async () => prisma.productAttributeValue.create({
            data: { productId: dbProduct.id, attributeId: attr.id, valueText: String(newValue), valueNumber: newNum },
          }),
        });
      } else {
        const oldNum = Number(existingPav.valueNumber); // Prisma returns Decimal; convert for comparison
        if (oldNum !== newNum) {
          const oldHs = hsContent(slug, oldNum);
          const newHs = hsContent(slug, newNum);
          changes.push({
            field: `${slug} (PAV)`,
            oldVal: String(oldNum),
            newVal: String(newNum),
            apply: async () => prisma.productAttributeValue.update({
              where: { id: existingPav.id },
              data: { valueText: String(newValue), valueNumber: newNum },
            }),
          });
          if (oldHs && newHs && oldHs !== newHs) {
            const hsRow = dbHs.find(h => h.content === oldHs);
            if (hsRow) {
              changes.push({
                field: `highlight_spec (${slug})`,
                oldVal: oldHs,
                newVal: newHs,
                apply: async () => prisma.productHighlightSpec.update({ where: { id: hsRow.id }, data: { content: newHs } }),
              });
            }
          }
        }
      }

    } else if (attr.type === 'SELECT') {
      const newStrVal = String(newValue);

      // Auto-create missing AttributeValue (already handled in Phase 2 via newAttributeValues,
      // but guard here in case avMap placeholder is -1 from dry-run)
      if (!avMap[attr.id]) avMap[attr.id] = new Map();
      if (!avMap[attr.id].has(newStrVal)) {
        if (DRY_RUN) {
          console.log(`[DRY-RUN]  AttributeValue  ${slug}="${newStrVal}"  → would CREATE (update path)`);
          avMap[attr.id].set(newStrVal, -1);
        } else {
          const av = await prisma.attributeValue.create({ data: { attributeId: attr.id, value: newStrVal } });
          avMap[attr.id].set(newStrVal, av.id);
          console.log(`[CREATE]   AttributeValue  ${slug}="${newStrVal}"  (id=${av.id})  [update path]`);
        }
      }

      const existingPav = dbProduct.attributeValues.find(pav => pav.attributeId === attr.id);
      const oldStrVal   = existingPav?.attributeValue?.value ?? null;

      if (oldStrVal !== newStrVal) {
        const newAvId = avMap[attr.id].get(newStrVal);
        const oldHs   = oldStrVal ? hsContent(slug, oldStrVal) : null;
        const newHs   = hsContent(slug, newStrVal);

        if (existingPav) {
          changes.push({
            field: `${slug} (PAV)`,
            oldVal: oldStrVal ?? '(none)',
            newVal: newStrVal,
            apply: async () => prisma.productAttributeValue.update({
              where: { id: existingPav.id },
              data: { attributeValueId: newAvId },
            }),
          });
        } else {
          changes.push({
            field: `${slug} (PAV new)`,
            oldVal: '(none)',
            newVal: newStrVal,
            apply: async () => prisma.productAttributeValue.create({
              data: { productId: dbProduct.id, attributeId: attr.id, attributeValueId: newAvId },
            }),
          });
        }

        if (oldHs && newHs && oldHs !== newHs) {
          const hsRow = dbHs.find(h => h.content === oldHs);
          if (hsRow) {
            changes.push({
              field: `highlight_spec (${slug})`,
              oldVal: oldHs,
              newVal: newHs,
              apply: async () => prisma.productHighlightSpec.update({ where: { id: hsRow.id }, data: { content: newHs } }),
            });
          }
        }
      }

    } else if (attr.type === 'MULTI_SELECT') {
      const newVals = Array.isArray(newValue) ? newValue : [newValue];

      for (const v of newVals) {
        if (!avMap[attr.id]) avMap[attr.id] = new Map();
        if (!avMap[attr.id].has(v)) {
          if (DRY_RUN) {
            avMap[attr.id].set(v, -1);
          } else {
            const av = await prisma.attributeValue.create({ data: { attributeId: attr.id, value: v } });
            avMap[attr.id].set(v, av.id);
          }
        }
      }

      const existingPavs = dbProduct.attributeValues.filter(pav => pav.attributeId === attr.id);
      const oldVals = existingPavs.map(pav => pav.attributeValue?.value).filter(Boolean);
      const toAdd    = newVals.filter(v => !oldVals.includes(v));
      const toRemove = oldVals.filter(v => !newVals.includes(v));

      for (const v of toRemove) {
        const pav = existingPavs.find(ep => ep.attributeValue?.value === v);
        if (pav) {
          changes.push({
            field: `${slug} (MULTI_SELECT remove)`,
            oldVal: v,
            newVal: '(removed)',
            apply: async () => prisma.productAttributeValue.delete({ where: { id: pav.id } }),
          });
        }
      }
      for (const v of toAdd) {
        const avId = avMap[attr.id].get(v);
        changes.push({
          field: `${slug} (MULTI_SELECT add)`,
          oldVal: '(none)',
          newVal: v,
          apply: async () => prisma.productAttributeValue.create({
            data: { productId: dbProduct.id, attributeId: attr.id, attributeValueId: avId },
          }),
        });
      }
    }
  }

  if (changes.length === 0) {
    logOp('SKIP', p.sku, '(no changes)');
    return;
  }

  if (DRY_RUN) {
    for (const c of changes) dryTable.push({ sku: p.sku, field: c.field, from: c.oldVal, to: c.newVal });
    console.log(`[DRY-RUN]  ${p.sku}  → ${changes.length} change(s) pending`);
    stats.updated++;
    return;
  }

  for (const c of changes) await c.apply();
  logOp('UPDATE', p.sku, `${changes.length} change(s) applied`);
}

// ── PHASE 5: Seed products ────────────────────────────────────────────────────

console.log('\n=== Phase 4: Seed products ===');

const existingSkus = new Set(
  (await prisma.product.findMany({ select: { sku: true } })).map(p => p.sku)
);

for (const p of products) {
  if (existingSkus.has(p.sku)) {
    if (UPDATE && p.sku.startsWith(SEED_PREFIX)) {
      await updateSeedProduct(p);
    } else {
      logOp('SKIP', p.sku);
    }
    continue;
  }
  if (DRY_RUN) {
    logOp('CREATE', p.sku, `[DRY-RUN] would create "${p.name.substring(0, 60)}..."`);
    continue;
  }

  const catId   = catBySlug[p.categorySlug];
  const brandId = brandSlugToId[p.brandSlug];

  try {
    const pavRows = [];
    for (const [slug, value] of Object.entries(p.attributes || {})) {
      const attr   = attrBySlug[slug];
      const values = Array.isArray(value) ? value : [value];

      if (attr.type === 'SELECT' || attr.type === 'MULTI_SELECT') {
        for (const v of values) {
          pavRows.push({ attributeId: attr.id, attributeValueId: avMap[attr.id].get(v) });
        }
      } else if (attr.type === 'NUMBER') {
        for (const v of values) {
          const num = Number(v);
          pavRows.push({ attributeId: attr.id, valueText: String(v), valueNumber: num });
        }
      } else if (attr.type === 'TEXT' || attr.type === 'BOOLEAN') {
        for (const v of values) {
          pavRows.push({ attributeId: attr.id, valueText: String(v) });
        }
      }
    }

    const product = await prisma.product.create({
      data: {
        sku:           p.sku,
        name:          p.name,
        slug:          p.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        price:         p.price,
        stockQuantity: p.stockQuantity ?? 0,
        isActive:      true,
        isDeleted:     false,
        categoryId:    catId,
        brandId:       brandId,
        description:   null,
        attributeValues: { create: pavRows },
      },
    });

    if (p.warrantyMonths) {
      await prisma.productSpecification.create({
        data: { productId: product.id, name: 'Bảo hành', value: `${p.warrantyMonths} tháng`, sortOrder: 0 },
      });
    }

    logOp('CREATE', p.sku, `"${p.name.substring(0, 60)}"`);
  } catch (err) {
    logOp('ERROR', p.sku, err.message);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n=== Tổng kết ===');
console.log(`  Created : ${stats.created}`);
console.log(`  Skipped : ${stats.skipped}`);
if (UPDATE) console.log(`  Updated : ${stats.updated}`);
if (stats.errors > 0) console.log(`  Errors  : ${stats.errors}`);

if (DRY_RUN && dryTable.length > 0) {
  console.log('\n=== Dry-run diff table ===');
  const skuW   = Math.max(4, ...dryTable.map(r => r.sku.length));
  const fieldW = Math.max(6, ...dryTable.map(r => r.field.length));
  const header = `${'SKU'.padEnd(skuW)}  ${'Trường'.padEnd(fieldW)}  Giá trị cũ → mới`;
  console.log(header);
  console.log('-'.repeat(header.length + 10));
  for (const r of dryTable) {
    console.log(`${r.sku.padEnd(skuW)}  ${r.field.padEnd(fieldW)}  ${r.from}  →  ${r.to}`);
  }
}

if (DRY_RUN) console.log('\n[DRY-RUN] Không có thay đổi nào được ghi vào DB.');

await prisma.$disconnect();
