import test from 'node:test';
import assert from 'node:assert/strict';
import { brandError, brandId, parseBrandPayload, parseBrandStatus, slugifyBrand } from '../../src/validators/brand.validator.js';
import { parseProductListQuery, parseProductPayload } from '../../src/validators/product.validator.js';

test('brand slug generation and payload validation normalize values', () => {
  assert.equal(slugifyBrand('Thương hiệu Đổi mới'), 'thuong-hieu-doi-moi');
  assert.deepEqual(parseBrandPayload({ name: ' ASUS ', websiteUrl: 'https://asus.com', sortOrder: '3', isActive: 'false' }), {
    name: 'ASUS', slug: 'asus', logoUrl: null, websiteUrl: 'https://asus.com', description: null, sortOrder: 3, isActive: false,
  });
  assert.throws(() => parseBrandPayload({ name: 'Brand', slug: 'bad slug' }), /Đường dẫn/);
  assert.throws(() => parseBrandPayload({ name: 'Brand', websiteUrl: 'javascript:alert(1)' }), /Website/);
  assert.throws(() => parseBrandPayload({ name: 'Brand', sortOrder: '-1' }), /Thứ tự/);
});

test('brand IDs/status and product brand filter are validated and parsed', () => {
  assert.equal(brandId('4'), 4);
  assert.equal(parseBrandStatus('false'), false);
  assert.throws(() => brandId('0'), /ID thương hiệu/);
  assert.throws(() => parseBrandStatus('yes'), /Trạng thái/);
  assert.equal(parseProductPayload({ name: 'PC', slug: 'pc', sku: 'PC-01', price: '1', brandId: '4' }).brandId, 4);
  assert.equal(parseProductListQuery({ brand: 'asus' }).brand, 'asus');
  assert.equal(brandError('conflict', 409).statusCode, 409);
});