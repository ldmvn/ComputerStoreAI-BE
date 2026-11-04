import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryError, parseCategoryListQuery, parseCategoryOrder, parseCategoryPayload, parseCategoryStatus, slugifyCategory } from '../../src/validators/category.validator.js';
import { parseProductPayload } from '../../src/validators/product.validator.js';

test('category slug generation normalizes Vietnamese names', () => {
  assert.equal(slugifyCategory('Ổ cứng Đổi mới'), 'o-cung-doi-moi');
  assert.equal(parseCategoryPayload({ name: ' Laptop Gaming ' }).slug, 'laptop-gaming');
});

test('category payload validates slug, hierarchy id, order, and icon key', () => {
  assert.deepEqual(parseCategoryPayload({ name: 'Laptop', slug: 'laptop', parentId: '2', sortOrder: '4', icon: 'Laptop', isActive: 'false' }), {
    name: 'Laptop', slug: 'laptop', icon: 'Laptop', parentId: 2, sortOrder: 4, description: null, isActive: false,
  });
  assert.throws(() => parseCategoryPayload({ name: 'Laptop', slug: 'invalid slug' }), /Đường dẫn/);
  assert.throws(() => parseCategoryPayload({ name: 'Laptop', parentId: '0' }), /Danh mục cha/);
  assert.throws(() => parseCategoryPayload({ name: 'Laptop', sortOrder: '-1' }), /Thứ tự/);
});

test('category filters and status/order inputs are constrained', () => {
  assert.deepEqual(parseCategoryListQuery({ search: 'laptop', status: 'active', type: 'child', sort: 'name' }), { search: 'laptop', status: 'active', type: 'child', sort: 'name' });
  assert.equal(parseCategoryStatus('false'), false);
  assert.equal(parseCategoryOrder('3'), 3);
  assert.throws(() => parseCategoryStatus('yes'), /Trạng thái/);
  assert.throws(() => parseCategoryOrder('1.5'), /Thứ tự/);
});

test('Product CRUD accepts nullable Category relation IDs and rejects invalid IDs', () => {
  const product = parseProductPayload({ name: 'PC', slug: 'pc', sku: 'PC-01', price: '100', categoryId: '7', category: 'Laptop' });
  assert.equal(product.categoryId, 7);
  assert.equal(product.category, 'Laptop');
  assert.equal(parseProductPayload({ name: 'PC', slug: 'pc', sku: 'PC-01', price: '100', categoryId: '' }).categoryId, null);
  assert.throws(() => parseProductPayload({ name: 'PC', slug: 'pc', sku: 'PC-01', price: '100', categoryId: '0' }), /ID danh mục/);
});

test('category validator exposes consistent status errors', () => {
  assert.throws(() => parseCategoryPayload({ name: '' }), error => error instanceof Error && error.statusCode === 400);
  assert.equal(categoryError('conflict', 409).statusCode, 409);
});