// Backfill valueNumber for ProductAttributeValue rows of NUMBER attributes where valueNumber IS NULL.
// Idempotent and safe to run multiple times.
// Run: node src/scripts/backfillValueNumber.js [--dry-run]

import '../config/env.js';
import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
const prisma   = new PrismaClient();

const rows = await prisma.productAttributeValue.findMany({
  where: {
    valueNumber: null,
    valueText:   { not: null },
    attribute:   { type: 'NUMBER' },
  },
  select: { id: true, productId: true, attributeId: true, valueText: true, attribute: { select: { slug: true } } },
  orderBy: { id: 'asc' },
});

console.log(`Tìm thấy ${rows.length} dòng NUMBER có valueNumber IS NULL.`);

const toUpdate  = [];
const skipped   = [];

for (const r of rows) {
  const trimmed = (r.valueText ?? '').trim();
  const n = Number(trimmed);
  if (trimmed !== '' && Number.isFinite(n)) {
    toUpdate.push({ id: r.id, productId: r.productId, attrSlug: r.attribute.slug, valueText: r.valueText, valueNumber: n });
  } else {
    skipped.push({ id: r.id, productId: r.productId, attrSlug: r.attribute.slug, valueText: r.valueText });
  }
}

if (skipped.length) {
  console.log(`\nBỎ QUA (không parse được thành số):`);
  for (const r of skipped)
    console.log(`  id=${r.id}  product=${r.productId}  attr=${r.attrSlug}  valueText=${JSON.stringify(r.valueText)}`);
}

console.log(`\nSẽ cập nhật: ${toUpdate.length}  Bỏ qua: ${skipped.length}`);

if (DRY_RUN) {
  console.log('\n[DRY-RUN] Không ghi vào DB.');
  for (const r of toUpdate)
    console.log(`  id=${r.id}  product=${r.productId}  attr=${r.attrSlug}  valueText=${r.valueText}  → valueNumber=${r.valueNumber}`);
} else {
  let updated = 0;
  for (const r of toUpdate) {
    await prisma.productAttributeValue.update({ where: { id: r.id }, data: { valueNumber: r.valueNumber } });
    updated++;
  }
  console.log(`[LIVE] Đã cập nhật ${updated} dòng.`);
}

await prisma.$disconnect();
