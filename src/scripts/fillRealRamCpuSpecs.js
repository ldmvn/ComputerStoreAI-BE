// fillRealRamCpuSpecs.js
// Usage: node src/scripts/fillRealRamCpuSpecs.js [--dry-run | --update]
// Fills missing compatibility attributes for real (non-SEED-) RAM and CPU products.
// Rules: never overwrite existing values; never touch SEED- products; no schema changes.

import '../config/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const isDry = process.argv.includes('--dry-run') || !process.argv.includes('--update');
const mode = isDry ? 'DRY-RUN' : 'UPDATE';
console.log(`=== fillRealRamCpuSpecs [${mode}] ===\n`);

// ── Attribute IDs ──────────────────────────────────────────────────────────────
// Verified from DB query 2026-10-14
const ATTR = {
  loaiRam:     { id: 29, type: 'SELECT' },       // attributeValueId = 48 (DDR4)
  ramModules:  { id: 55, type: 'NUMBER' },
  socketCpu:   { id: 32, type: 'MULTI_SELECT' }, // attributeValueId = 69 (LGA 1700)
  tdp:         { id: 51, type: 'NUMBER' },
};

const AV = {
  DDR4:    48,   // loai-ram = DDR4
  LGA1700: 69,   // socket-cpu = LGA 1700
};

// ── Per-product spec table ─────────────────────────────────────────────────────
// [sku, attributeId, type, {attributeValueId} | {valueNumber, valueText}]
const SPECS = [
  // MEM0001: loai-ram + ram-modules
  ['MEM0001', ATTR.loaiRam.id,    'SELECT', { attributeValueId: AV.DDR4 }],
  ['MEM0001', ATTR.ramModules.id, 'NUMBER', { valueNumber: 1, valueText: '1' }],

  // RAM0002-RAM0025: ram-modules only
  // qty=2: RAM0010, RAM0015, RAM0016
  // qty=1: all others
  ...['RAM0002','RAM0003','RAM0004','RAM0005','RAM0006','RAM0007','RAM0008',
      'RAM0009','RAM0011','RAM0012','RAM0013','RAM0014','RAM0017','RAM0018',
      'RAM0019','RAM0020','RAM0021','RAM0022','RAM0023','RAM0024','RAM0025']
    .map(sku => [sku, ATTR.ramModules.id, 'NUMBER', { valueNumber: 1, valueText: '1' }]),

  ['RAM0010', ATTR.ramModules.id, 'NUMBER', { valueNumber: 2, valueText: '2' }],
  ['RAM0015', ATTR.ramModules.id, 'NUMBER', { valueNumber: 2, valueText: '2' }],
  ['RAM0016', ATTR.ramModules.id, 'NUMBER', { valueNumber: 2, valueText: '2' }],

  // MCV0001: socket-cpu + tdp
  ['MCV0001', ATTR.socketCpu.id, 'MULTI_SELECT', { attributeValueId: AV.LGA1700 }],
  ['MCV0001', ATTR.tdp.id,       'NUMBER',        { valueNumber: 60, valueText: '60' }],
];

// ── Resolve SKU → productId ────────────────────────────────────────────────────
const skus = [...new Set(SPECS.map(s => s[0]))];
const products = await prisma.product.findMany({
  where: {
    sku: { in: skus },
    isActive: true,
    NOT: { sku: { startsWith: 'SEED-' } },
  },
  select: { id: true, sku: true },
});
const idBySku = Object.fromEntries(products.map(p => [p.sku, p.id]));
const missing = skus.filter(s => !idBySku[s]);
if (missing.length > 0) console.log('⚠ SKUs not found (inactive or missing):', missing.join(', '));

// ── Fetch existing ProductAttributeValues for affected products ────────────────
const productIds = Object.values(idBySku);
const existing = await prisma.productAttributeValue.findMany({
  where: { productId: { in: productIds } },
  select: { id: true, productId: true, attributeId: true, attributeValueId: true, valueNumber: true, valueText: true },
});
// Key: productId-attributeId → existing rows
const existMap = new Map();
for (const row of existing) {
  const key = `${row.productId}-${row.attributeId}`;
  if (!existMap.has(key)) existMap.set(key, []);
  existMap.get(key).push(row);
}

// ── Process each spec ─────────────────────────────────────────────────────────
let inserted = 0, skipped = 0, conflicts = 0;
const toCreate = [];

for (const [sku, attrId, type, val] of SPECS) {
  const productId = idBySku[sku];
  if (!productId) { skipped++; continue; }

  const key = `${productId}-${attrId}`;
  const rows = existMap.get(key) ?? [];

  if (rows.length > 0) {
    // Already has a value — check for conflict
    const existing0 = rows[0];
    if (type === 'NUMBER') {
      if (Number(existing0.valueNumber) === val.valueNumber) {
        console.log(`  SKIP  [${sku}] attr=${attrId} → already has valueNumber=${val.valueNumber}`);
        skipped++;
      } else {
        console.log(`  CONFLICT [${sku}] attr=${attrId} → DB=${Number(existing0.valueNumber)} vs proposed=${val.valueNumber}`);
        conflicts++;
      }
    } else {
      if (existing0.attributeValueId === val.attributeValueId) {
        console.log(`  SKIP  [${sku}] attr=${attrId} → already has attributeValueId=${val.attributeValueId}`);
        skipped++;
      } else {
        console.log(`  CONFLICT [${sku}] attr=${attrId} → DB attributeValueId=${existing0.attributeValueId} vs proposed=${val.attributeValueId}`);
        conflicts++;
      }
    }
    continue;
  }

  // No existing row → queue for insert
  const record = { productId, attributeId: attrId };
  if (type === 'NUMBER') {
    record.valueNumber = val.valueNumber;
    record.valueText   = val.valueText;
  } else {
    record.attributeValueId = val.attributeValueId;
  }
  toCreate.push({ sku, attrId, record });
  console.log(`  INSERT [${sku}] attr=${attrId} type=${type} → ${JSON.stringify(val)}`);
  inserted++;
}

console.log(`\n--- Kết quả [${mode}]: insert=${inserted} skip=${skipped} conflict=${conflicts} ---`);

if (!isDry && toCreate.length > 0) {
  await prisma.productAttributeValue.createMany({
    data: toCreate.map(t => t.record),
    skipDuplicates: true,
  });
  console.log(`✓ Đã ghi ${toCreate.length} dòng vào DB.`);
} else if (isDry) {
  console.log('(dry-run — không ghi DB)');
} else {
  console.log('(không có gì để ghi)');
}

// ── Verify: no duplicate rows per product-attribute ───────────────────────────
if (!isDry) {
  const afterRows = await prisma.productAttributeValue.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, attributeId: true },
  });
  const seen = new Map();
  let dupCount = 0;
  for (const r of afterRows) {
    const k = `${r.productId}-${r.attributeId}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (seen.get(k) === 2) dupCount++;
  }
  if (dupCount > 0) {
    console.error('⛔ Phát hiện dòng trùng:', [...seen.entries()].filter(([,v]) => v > 1));
  } else {
    console.log('✓ Không có dòng trùng.');
  }
}

await prisma.$disconnect();
