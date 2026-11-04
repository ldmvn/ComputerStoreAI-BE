// Normalize only directly verified SEED product identity/spec data.
// Dry-run is the default. Pass --update to execute the validated plan.

import '../config/env.js';
import { Prisma, PrismaClient } from '@prisma/client';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const reportFile = path.join(here, 'data', 'seedProductNormalization.json');
const productSeedFile = path.join(here, 'data', 'buildPcProducts.json');
const args = process.argv.slice(2);
const allowedArgs = new Set(['--dry-run', '--update']);
const unknownArgs = args.filter((arg) => !allowedArgs.has(arg));
const update = args.includes('--update');

if (unknownArgs.length > 0 || (update && args.includes('--dry-run'))) {
  console.error('Cách dùng: npm run fix:seed-product-normalization [-- --dry-run|--update]');
  process.exit(1);
}

const mode = update ? 'update' : 'dry-run';
const prisma = new PrismaClient();
const report = JSON.parse(readFileSync(reportFile, 'utf8'));
const productSeed = JSON.parse(readFileSync(productSeedFile, 'utf8'));
const classifications = new Set(['VERIFIED', 'SAFE_TO_FIX', 'NEEDS_REVIEW']);
const officialHosts = new Set([
  'www.asus.com',
  'www.bykski.us',
  'www.corsair.com',
  'www.deepcool.com',
  'global.deepcool.com',
  'uk.deepcool.com',
  'www.ekwb.com',
  'www.ewinracing.com',
  'www.fractal-design.com',
  'www.msi.com',
  'steelseries.com',
]);
const validationErrors = [];
const operations = [];
const noChanges = [];

const sameSet = (left, right) => (
  JSON.stringify([...left].map(String).sort()) === JSON.stringify([...right].map(String).sort())
);

const productReports = report.products ?? [];
const reportBySku = new Map();
for (const item of productReports) {
  if (!report.scope.includes(item.sku)) {
    validationErrors.push(`${item.sku}: nằm ngoài scope`);
  }
  if (reportBySku.has(item.sku)) {
    validationErrors.push(`${item.sku}: bị lặp trong báo cáo`);
  }
  if (!classifications.has(item.classification)) {
    validationErrors.push(`${item.sku}: classification không hợp lệ`);
  }
  try {
    const host = new URL(item.source).hostname.toLowerCase();
    if (!officialHosts.has(host)) validationErrors.push(`${item.sku}: nguồn không thuộc allowlist hãng: ${host}`);
  } catch {
    validationErrors.push(`${item.sku}: URL nguồn không hợp lệ`);
  }
  reportBySku.set(item.sku, item);
}

for (const sku of report.scope) {
  if (!reportBySku.has(sku)) validationErrors.push(`${sku}: thiếu phân loại`);
}
if (new Set(report.scope).size !== report.scope.length) {
  validationErrors.push('Scope có SKU bị lặp');
}

for (const fix of report.safeFixes ?? []) {
  if (reportBySku.get(fix.sku)?.classification !== 'SAFE_TO_FIX') {
    validationErrors.push(`${fix.sku} | ${fix.field}: fix không thuộc SAFE_TO_FIX`);
  }
  try {
    const host = new URL(fix.source).hostname.toLowerCase();
    if (!officialHosts.has(host)) validationErrors.push(`${fix.sku} | ${fix.field}: nguồn fix không thuộc allowlist hãng`);
  } catch {
    validationErrors.push(`${fix.sku} | ${fix.field}: URL nguồn fix không hợp lệ`);
  }
}

const seedProductBySku = new Map((productSeed.products ?? []).map((item) => [item.sku, item]));
const seedBrandBySlug = new Map((productSeed.brands ?? []).map((item) => [item.slug, item]));
const canonicalChecks = [
  ['SEED-CASE-006', 'seed:radiator-size', seedProductBySku.get('SEED-CASE-006')?.attributes?.['radiator-size'],
    ['120', '140']],
  ['SEED-CHAIR-003', 'seed:brandSlug', seedProductBySku.get('SEED-CHAIR-003')?.brandSlug, 'e-win'],
  ['SEED-CHAIR-003', 'seed:brand-definition', seedBrandBySlug.get('e-win')?.name, 'E-Win'],
];
for (const [sku, field, actual, expected] of canonicalChecks) {
  const matches = Array.isArray(expected) ? sameSet(actual ?? [], expected) : actual === expected;
  if (!matches) validationErrors.push(`${sku} | ${field}: file seed chưa đồng bộ (${JSON.stringify(actual)})`);
}

const products = await prisma.product.findMany({
  where: { sku: { in: report.scope } },
  include: {
    brandRecord: { select: { name: true, slug: true } },
    specifications: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
    attributeValues: {
      include: { attribute: true, attributeValue: true },
      orderBy: { id: 'asc' },
    },
  },
  orderBy: { sku: 'asc' },
});
const productBySku = new Map(products.map((product) => [product.sku, product]));
for (const sku of report.scope) {
  if (!productBySku.has(sku)) validationErrors.push(`${sku}: không tồn tại trong DB`);
}

for (const fix of report.safeFixes ?? []) {
  const product = productBySku.get(fix.sku);
  if (!product) continue;

  if (fix.field === 'name') {
    if (product.name === fix.new) {
      noChanges.push(fix);
    } else if (product.name === fix.old) {
      operations.push({ kind: 'product-name', productId: product.id, fix });
    } else {
      validationErrors.push(`${fix.sku} | name: DB không khớp old/new (${product.name})`);
    }
    continue;
  }

  if (fix.field.startsWith('spec:')) {
    const specName = fix.field.slice(5);
    const rows = product.specifications.filter((row) => row.name === specName);
    if (rows.length !== 1) {
      validationErrors.push(`${fix.sku} | ${fix.field}: cần đúng 1 dòng, hiện có ${rows.length}`);
    } else if (rows[0].value === fix.new) {
      noChanges.push(fix);
    } else if (rows[0].value === fix.old) {
      operations.push({ kind: 'spec-value', specificationId: rows[0].id, fix });
    } else {
      validationErrors.push(`${fix.sku} | ${fix.field}: DB không khớp old/new (${rows[0].value})`);
    }
    continue;
  }

  const rows = product.attributeValues.filter((row) => row.attribute.slug === fix.field && row.attributeValueId !== null);
  const currentValues = rows.map((row) => row.attributeValue.value);
  if (sameSet(currentValues, fix.new)) {
    noChanges.push(fix);
    continue;
  }
  if (!sameSet(currentValues, fix.old)) {
    validationErrors.push(`${fix.sku} | ${fix.field}: DB không khớp old/new (${currentValues.join(', ')})`);
    continue;
  }
  const attribute = rows[0]?.attribute;
  if (!attribute || attribute.type !== 'MULTI_SELECT') {
    validationErrors.push(`${fix.sku} | ${fix.field}: không phải MULTI_SELECT`);
    continue;
  }
  const options = await prisma.attributeValue.findMany({
    where: { attributeId: attribute.id, value: { in: fix.new.map(String) }, isActive: true },
  });
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  const missingOptions = fix.new.filter((value) => !optionByValue.has(String(value)));
  if (missingOptions.length > 0) {
    validationErrors.push(`${fix.sku} | ${fix.field}: thiếu AttributeValue ${missingOptions.join(', ')}`);
    continue;
  }
  const oldOnlyRows = rows.filter((row) => !fix.new.map(String).includes(row.attributeValue.value));
  const newOnlyValues = fix.new.map(String).filter((value) => !currentValues.includes(value));
  if (oldOnlyRows.length !== newOnlyValues.length) {
    validationErrors.push(`${fix.sku} | ${fix.field}: không thể ánh xạ thay thế 1-1`);
    continue;
  }
  oldOnlyRows.forEach((row, index) => {
    operations.push({
      kind: 'enum-replace',
      productAttributeValueId: row.id,
      attributeValueId: optionByValue.get(newOnlyValues[index]).id,
      fix,
    });
  });
}

const classificationCounts = productReports.reduce((counts, item) => {
  counts[item.classification] += 1;
  return counts;
}, { VERIFIED: 0, SAFE_TO_FIX: 0, NEEDS_REVIEW: 0 });
const operationPlan = operations.map((operation) => ({
  action: 'UPDATE',
  kind: operation.kind,
  sku: operation.fix.sku,
  field: operation.fix.field,
  old: operation.fix.old,
  new: operation.fix.new,
  source: operation.fix.source,
}));

console.log('=== Phân loại 14 sản phẩm ===');
for (const item of productReports) {
  console.log(`${item.sku} | ${item.classification} | ${item.evidence}`);
}
console.log('=== Kế hoạch thay đổi ===');
console.log(JSON.stringify(operationPlan, null, 2));
if (validationErrors.length > 0) {
  console.log('=== Lỗi kiểm tra ===');
  console.log(JSON.stringify(validationErrors, null, 2));
}

let executedUpdates = 0;
let backupFile = null;
if (update && validationErrors.length === 0 && operations.length > 0) {
  const backupDir = path.join(here, '..', '..', '.tmp');
  backupFile = path.join(backupDir, 'seed-normalization-preupdate-2026-10-14.json');
  mkdirSync(backupDir, { recursive: true });
  if (existsSync(backupFile)) {
    throw new Error(`Không ghi đè file backup đã tồn tại: ${backupFile}`);
  }
  writeFileSync(backupFile, JSON.stringify({
    createdAt: new Date().toISOString(),
    reportFile,
    operationPlan,
    products,
    restoreNote: 'Khôi phục đúng các UPDATE theo ID và giá trị old trong operationPlan.',
  }, null, 2), { encoding: 'utf8', flag: 'wx' });

  await prisma.$transaction(async (tx) => {
    for (const operation of operations) {
      if (operation.kind === 'product-name') {
        await tx.product.update({
          where: { id: operation.productId },
          data: { name: operation.fix.new },
        });
      } else if (operation.kind === 'spec-value') {
        await tx.productSpecification.update({
          where: { id: operation.specificationId },
          data: { value: operation.fix.new },
        });
      } else if (operation.kind === 'enum-replace') {
        await tx.productAttributeValue.update({
          where: { id: operation.productAttributeValueId },
          data: { attributeValueId: operation.attributeValueId, valueText: null, valueNumber: null },
        });
      }
      executedUpdates += 1;
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

const result = {
  mode,
  classifications: classificationCounts,
  scopeProducts: report.scope.length,
  safeFixFields: report.safeFixes.length,
  plannedUpdates: operations.length,
  plannedInserts: 0,
  validationErrors: validationErrors.length,
  noChangeFixes: noChanges.length,
  executedUpdates,
  executedInserts: 0,
  deletes: 0,
  writesPerformed: executedUpdates,
  backupFile,
  status: validationErrors.length === 0 ? 'ok' : 'failed',
};
console.log('=== Kết quả ===');
console.log(JSON.stringify(result, null, 2));

await prisma.$disconnect();
if (validationErrors.length > 0) process.exitCode = 1;
