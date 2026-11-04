// Apply verified SEED-only corrections from buildPcSpecFixes.json.
// --dry-run: validate and print changes only; --update: write validated changes.

import '../config/env.js';
import { Prisma, PrismaClient } from '@prisma/client';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(here, 'data', 'buildPcSpecFixes.json');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const update = args.includes('--update');

if (dryRun === update) {
  console.log('Cách dùng:');
  console.log('  npm run fix:build-pc-specs -- --dry-run');
  console.log('  npm run fix:build-pc-specs -- --update');
  process.exit(0);
}

const prisma = new PrismaClient();
const allowedConfidence = new Set(['hang', 'hai-nguon']);
const allowedSpecificationCreates = new Set([
  'SEED-MON-005\u0000Độ phủ màu',
  'SEED-CHAIR-003\u0000Chất liệu',
]);
const document = JSON.parse(readFileSync(dataFile, 'utf8'));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sorted = (values) => [...values].sort((a, b) => String(a).localeCompare(String(b)));
const printable = (value) => Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
const isSourceUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};
const normalizeOption = (value, unit) => {
  let normalized = String(value).normalize('NFKC').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, '');
  const normalizedUnit = unit
    ? String(unit).normalize('NFKC').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, '')
    : '';
  if (normalizedUnit && normalized.endsWith(normalizedUnit)) {
    normalized = normalized.slice(0, -normalizedUnit.length);
  }
  return normalized;
};

const attributeValueReport = {
  existing: [],
  normalizable: [],
  missingOptions: [],
  missingEvidence: [],
};
const validationErrors = [];
const fixes = [];

for (const fix of document.fixes ?? []) {
  if (!fix?.sku?.startsWith('SEED-')) {
    validationErrors.push({ sku: fix?.sku ?? null, field: fix?.field ?? null, reason: 'SKU ngoài phạm vi SEED-' });
    continue;
  }
  if (!fix.field || !Object.hasOwn(fix, 'old') || !Object.hasOwn(fix, 'new')) {
    validationErrors.push({ sku: fix.sku, field: fix.field ?? null, reason: 'Mục sửa thiếu field, old hoặc new' });
    continue;
  }
  if (!allowedConfidence.has(fix.confidence) || !isSourceUrl(fix.source)) {
    attributeValueReport.missingEvidence.push({
      sku: fix.sku,
      field: fix.field,
      expected: fix.new,
      confidence: fix.confidence ?? null,
      source: fix.source ?? null,
      reason: !allowedConfidence.has(fix.confidence)
        ? 'Mức độ xác minh chưa được phép'
        : 'Thiếu URL nguồn hợp lệ',
    });
    continue;
  }
  fixes.push(fix);
}

const skus = [...new Set(fixes.map((fix) => fix.sku))];
const products = await prisma.product.findMany({
  where: { sku: { in: skus } },
  include: {
    attributeValues: {
      include: { attribute: true, attributeValue: true },
      orderBy: { id: 'asc' },
    },
    specifications: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  },
});
const productBySku = new Map(products.map((product) => [product.sku, product]));

for (const sku of skus) {
  if (!productBySku.has(sku)) {
    validationErrors.push({ sku, field: null, reason: 'SKU không tồn tại trong DB' });
  }
}

const attributes = await prisma.attribute.findMany({
  where: { slug: { in: [...new Set(fixes.map((fix) => fix.field))] } },
  include: { values: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
});
const attributeBySlug = new Map(attributes.map((attribute) => [attribute.slug, attribute]));
const operations = [];
const noChanges = [];

for (const fix of fixes) {
  const product = productBySku.get(fix.sku);
  if (!product) continue;

  if (fix.field === 'name') {
    if (product.name === fix.new) {
      noChanges.push(fix);
    } else if (product.name === fix.old) {
      operations.push({ kind: 'name', fix, productId: product.id });
    } else {
      validationErrors.push({ sku: fix.sku, field: fix.field, reason: `Giá trị hiện tại không khớp old/new: ${product.name}` });
    }
    continue;
  }

  if (fix.field.startsWith('spec:')) {
    const name = fix.field.slice(5);
    const rows = product.specifications.filter((spec) => spec.name === name);
    const createKey = `${fix.sku}\u0000${name}`;
    if (rows.length === 0 && fix.createIfMissing === true && allowedSpecificationCreates.has(createKey)) {
      if (!Number.isInteger(fix.sortOrder) || fix.sortOrder < 0) {
        validationErrors.push({ sku: fix.sku, field: fix.field, reason: 'Thiếu sortOrder hợp lệ cho specification cần tạo' });
      } else {
        operations.push({
          kind: 'spec-create',
          fix,
          productId: product.id,
          name,
          value: fix.new,
          sortOrder: fix.sortOrder,
        });
      }
    } else if (rows.length !== 1) {
      validationErrors.push({ sku: fix.sku, field: fix.field, reason: `Cần đúng 1 dòng DB, hiện có ${rows.length}` });
    } else if (rows[0].value === fix.new) {
      noChanges.push(fix);
    } else if (rows[0].value === fix.old) {
      operations.push({ kind: 'spec', fix, specificationId: rows[0].id });
    } else {
      validationErrors.push({ sku: fix.sku, field: fix.field, reason: `Giá trị hiện tại không khớp old/new: ${rows[0].value}` });
    }
    continue;
  }

  const attribute = attributeBySlug.get(fix.field);
  if (!attribute) {
    validationErrors.push({ sku: fix.sku, field: fix.field, reason: 'Thuộc tính không tồn tại' });
    continue;
  }
  const rows = product.attributeValues.filter((row) => row.attributeId === attribute.id);

  if (attribute.type === 'NUMBER') {
    const activeRows = rows.filter((row) => row.valueNumber !== null);
    if (activeRows.length !== 1) {
      validationErrors.push({ sku: fix.sku, field: fix.field, reason: `Cần đúng 1 giá trị số, hiện có ${activeRows.length}` });
    } else {
      const current = Number(activeRows[0].valueNumber);
      if (current === Number(fix.new)) {
        noChanges.push(fix);
      } else if (current === Number(fix.old)) {
        operations.push({ kind: 'number', fix, pavId: activeRows[0].id });
      } else {
        validationErrors.push({ sku: fix.sku, field: fix.field, reason: `Giá trị hiện tại không khớp old/new: ${current}` });
      }
    }
    continue;
  }

  if (attribute.type !== 'SELECT' && attribute.type !== 'MULTI_SELECT') {
    validationErrors.push({ sku: fix.sku, field: fix.field, reason: `Kiểu thuộc tính ${attribute.type} chưa được script hỗ trợ` });
    continue;
  }

  const expectedOld = Array.isArray(fix.old) ? fix.old.map(String) : [String(fix.old)];
  const expectedNew = Array.isArray(fix.new) ? fix.new.map(String) : [String(fix.new)];
  const valueByExact = new Map(attribute.values.map((value) => [value.value, value]));
  let hasUnresolvedOption = false;

  for (const expected of expectedNew) {
    const exact = valueByExact.get(expected);
    if (exact) {
      attributeValueReport.existing.push({
        sku: fix.sku,
        field: fix.field,
        expected,
        stored: exact.value,
        attributeValueId: exact.id,
        isActive: exact.isActive,
      });
      if (!exact.isActive) {
        hasUnresolvedOption = true;
        validationErrors.push({ sku: fix.sku, field: fix.field, reason: `AttributeValue tồn tại nhưng đang bị vô hiệu hóa: ${expected}` });
      }
      continue;
    }

    const normalizedExpected = normalizeOption(expected, attribute.unit);
    const candidates = attribute.values.filter((value) => normalizeOption(value.value, attribute.unit) === normalizedExpected);
    hasUnresolvedOption = true;
    if (candidates.length === 1) {
      attributeValueReport.normalizable.push({
        sku: fix.sku,
        field: fix.field,
        expected,
        stored: candidates[0].value,
        attributeValueId: candidates[0].id,
        reason: 'Khác định dạng nhưng cùng giá trị sau chuẩn hóa; cần sửa file dự kiến, script không tự đổi',
      });
    } else {
      attributeValueReport.missingOptions.push({
        sku: fix.sku,
        field: fix.field,
        expected,
        available: attribute.values.map((value) => value.value),
        reason: candidates.length > 1 ? 'Có nhiều giá trị gần tương đương, không thể tự chọn' : 'Không có AttributeValue tương ứng',
      });
    }
  }

  if (hasUnresolvedOption) continue;

  const activeRows = rows.filter((row) => row.attributeValueId !== null);
  const current = activeRows.map((row) => row.attributeValue?.value);
  if (same(sorted(current), sorted(expectedNew))) {
    noChanges.push(fix);
    continue;
  }
  if (!same(sorted(current), sorted(expectedOld))) {
    validationErrors.push({ sku: fix.sku, field: fix.field, reason: `Giá trị hiện tại không khớp old/new: ${printable(current)}` });
    continue;
  }

  const oldSet = new Set(expectedOld);
  const newSet = new Set(expectedNew);
  const removedRows = activeRows.filter((row) => oldSet.has(row.attributeValue.value) && !newSet.has(row.attributeValue.value));
  const addedValues = expectedNew.filter((value) => !oldSet.has(value));
  const replaceCount = Math.min(removedRows.length, addedValues.length);

  for (let index = 0; index < replaceCount; index += 1) {
    operations.push({
      kind: 'enum-replace',
      fix,
      pavId: removedRows[index].id,
      attributeValueId: valueByExact.get(addedValues[index]).id,
    });
  }
  for (const value of addedValues.slice(replaceCount)) {
    operations.push({
      kind: 'enum-add',
      fix,
      productId: product.id,
      attributeId: attribute.id,
      attributeValueId: valueByExact.get(value).id,
    });
  }
  for (const row of removedRows.slice(replaceCount)) {
    operations.push({ kind: 'enum-deactivate', fix, pavId: row.id });
  }
}

const changedFixes = [...new Map(operations.map((operation) => [
  `${operation.fix.sku}\u0000${operation.fix.field}`,
  operation.fix,
])).values()];
const operationPlan = operations.map((operation) => ({
  action: operation.kind === 'spec-create' || operation.kind === 'enum-add' ? 'INSERT' : 'UPDATE',
  kind: operation.kind,
  sku: operation.fix.sku,
  field: operation.fix.field,
  target: operation.kind === 'name'
    ? { productId: operation.productId }
    : operation.kind === 'spec'
      ? { specificationId: operation.specificationId }
      : operation.kind === 'spec-create'
        ? { productId: operation.productId, name: operation.name, sortOrder: operation.sortOrder }
        : operation.kind === 'number' || operation.kind === 'enum-replace' || operation.kind === 'enum-deactivate'
          ? { productAttributeValueId: operation.pavId }
          : { productId: operation.productId, attributeId: operation.attributeId },
  old: operation.fix.old,
  new: operation.fix.new,
  attributeValueId: operation.attributeValueId ?? null,
}));
const hasValidationFailures = validationErrors.length > 0
  || attributeValueReport.normalizable.length > 0
  || attributeValueReport.missingOptions.length > 0
  || attributeValueReport.missingEvidence.length > 0;

console.log('=== Các thay đổi hợp lệ dự kiến ===');
for (const fix of changedFixes) {
  console.log(`${fix.sku} | ${fix.field} | ${printable(fix.old)} -> ${printable(fix.new)} | ${fix.source}`);
}

console.log('=== Kế hoạch thao tác DB ===');
console.log(JSON.stringify(operationPlan, null, 2));

console.log('=== Báo cáo kiểm tra AttributeValue ===');
console.log(JSON.stringify(attributeValueReport, null, 2));

if (validationErrors.length > 0) {
  console.log('=== Lỗi kiểm tra dữ liệu ===');
  console.log(JSON.stringify(validationErrors, null, 2));
}

let executedInserts = 0;
let executedUpdates = 0;
let backupFile = null;

if (update && !hasValidationFailures && operations.length > 0) {
  const backupDir = path.join(here, '..', '..', '.tmp');
  backupFile = path.join(backupDir, 'prompt5-preupdate-backup-2026-10-14.json');
  mkdirSync(backupDir, { recursive: true });
  if (existsSync(backupFile)) {
    throw new Error(`File backup đã tồn tại, không ghi đè: ${backupFile}`);
  }
  writeFileSync(backupFile, JSON.stringify({
    createdAt: new Date().toISOString(),
    dataFile,
    operations: operations.map((operation) => ({
      kind: operation.kind,
      sku: operation.fix.sku,
      field: operation.fix.field,
      old: operation.fix.old,
      new: operation.fix.new,
    })),
    products,
    restoreNote: 'Khôi phục UPDATE theo id từ snapshot; xóa đúng các spec-create sau khi xác nhận id và không có phụ thuộc.',
  }, null, 2), { encoding: 'utf8', flag: 'wx' });

  await prisma.$transaction(async (tx) => {
    for (const operation of operations) {
      if (operation.kind === 'name') {
        await tx.product.update({ where: { id: operation.productId }, data: { name: operation.fix.new } });
        executedUpdates += 1;
      } else if (operation.kind === 'spec') {
        await tx.productSpecification.update({ where: { id: operation.specificationId }, data: { value: operation.fix.new } });
        executedUpdates += 1;
      } else if (operation.kind === 'spec-create') {
        const existing = await tx.productSpecification.findFirst({
          where: { productId: operation.productId, name: operation.name },
          select: { id: true, value: true },
        });
        if (existing) {
          if (existing.value !== operation.value) {
            throw new Error(`${operation.fix.sku} ${operation.fix.field}: specification xuất hiện với giá trị khác trong lúc cập nhật`);
          }
        } else {
          await tx.productSpecification.create({
            data: {
              productId: operation.productId,
              name: operation.name,
              value: operation.value,
              sortOrder: operation.sortOrder,
            },
          });
          executedInserts += 1;
        }
      } else if (operation.kind === 'number') {
        await tx.productAttributeValue.update({
          where: { id: operation.pavId },
          data: { valueNumber: operation.fix.new, valueText: String(operation.fix.new) },
        });
        executedUpdates += 1;
      } else if (operation.kind === 'enum-replace') {
        await tx.productAttributeValue.update({
          where: { id: operation.pavId },
          data: { attributeValueId: operation.attributeValueId, valueText: null, valueNumber: null },
        });
        executedUpdates += 1;
      } else if (operation.kind === 'enum-add') {
        await tx.productAttributeValue.create({
          data: {
            productId: operation.productId,
            attributeId: operation.attributeId,
            attributeValueId: operation.attributeValueId,
          },
        });
        executedInserts += 1;
      } else if (operation.kind === 'enum-deactivate') {
        await tx.productAttributeValue.update({
          where: { id: operation.pavId },
          data: { attributeValueId: null, valueText: null, valueNumber: null },
        });
        executedUpdates += 1;
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

console.log(JSON.stringify({
  mode: dryRun ? 'dry-run' : 'update',
  verifiedFixes: fixes.length,
  changedFixes: changedFixes.length,
  databaseOperations: operations.length,
  noChangeFixes: noChanges.length,
  existingAttributeValues: attributeValueReport.existing.length,
  normalizableAttributeValues: attributeValueReport.normalizable.length,
  missingAttributeValues: attributeValueReport.missingOptions.length,
  missingEvidence: attributeValueReport.missingEvidence.length,
  validationErrors: validationErrors.length,
  status: hasValidationFailures ? 'failed' : 'ok',
  plannedInserts: operations.filter((operation) => operation.kind === 'spec-create' || operation.kind === 'enum-add').length,
  plannedUpdates: operations.filter((operation) => operation.kind !== 'spec-create' && operation.kind !== 'enum-add').length,
  executedInserts,
  executedUpdates,
  backupFile,
  writesPerformed: executedInserts + executedUpdates,
  deletes: 0,
}, null, 2));

await prisma.$disconnect();

if (hasValidationFailures) {
  process.exitCode = 1;
}
