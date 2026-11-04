import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGroup, parseItem, safeMenuUrl, menuInt } from '../../src/validators/megaMenu.validator.js';
import { parseProductListQuery } from '../../src/validators/product.validator.js';
test('reject invalid groups, IDs, booleans, unsafe URLs and inverted prices', () => {
  for (const n of ['', null, false, -1, '1.2', '1e2', 2147483648]) assert.throws(() => menuInt(n));
  assert.throws(() => parseGroup({ title: 'Laptop', columnSpan: 5 }));
  assert.throws(() => parseGroup({ title: 'Laptop', isActive: 'false' }));
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '//evil.test', '/\\evil.test', '/\nevil.test', 'https://a.test/a b']) assert.equal(safeMenuUrl(url), false);
  for (const url of ['/customer/products?brand=acer', 'https://example.com']) assert.equal(safeMenuUrl(url), true);
  assert.throws(() => parseItem({ label: 'Price', type: 'PRICE_FILTER', minPrice: 15, maxPrice: 10 }));
  assert.throws(() => parseItem({ label: 'Price', type: 'PRICE_FILTER' }));
  assert.throws(() => parseItem({ label: 'Bad', type: 'OTHER' }));
  assert.throws(() => parseProductListQuery({ attribute: 'RAM' }));
  assert.throws(() => parseProductListQuery({ minPrice: '-1' }));
  assert.throws(() => parseProductListQuery({ minPrice: '15', maxPrice: '10' }));
});
test('each type clears stale fields and preserves zero price bounds', () => {
  const item = parseItem({ label: 'Acer', type: 'BRAND', brandId: '3', categoryId: 9, minPrice: 100, customUrl: '/old', attributeName: 'RAM' });
  assert.equal(item.brandId, 3); assert.equal(item.categoryId, null); assert.equal(item.minPrice, null); assert.equal(item.customUrl, null); assert.equal(item.attributeName, null);
  const price = parseItem({ label: 'Dưới 15 triệu', type: 'PRICE_FILTER', minPrice: 0, maxPrice: 15000000 });
  assert.equal(price.minPrice, 0); assert.equal(price.maxPrice, 15000000);
  const query = parseProductListQuery({ minPrice: '0', maxPrice: '15000000', attribute: 'RAM', attributeValue: '16GB' });
  assert.equal(query.minPrice, 0); assert.equal(query.attributeValue, '16GB');
});
