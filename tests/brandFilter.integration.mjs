import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import { normalizeLegacyBrandSlugs } from '../src/services/brand.service.js';
import { slugifyBrand } from '../src/validators/brand.validator.js';
const base = process.env.BRAND_FILTER_TEST_API || `http://localhost:${process.env.PORT || 5000}/api`;
const marker = randomUUID().slice(0, 8);
const name = `Filter Brand ${marker}`;
const oldSlug = `legacy-${createHash('md5').update(name.toLowerCase()).digest('hex')}`;
let brand, product;
async function list(query) {
  const response = await fetch(`${base}/products?${new URLSearchParams(query)}`);
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
try {
  brand = await prisma.brand.create({ data: { name, slug: oldSlug } });
  product = await prisma.product.create({ data: { name, slug: `filter-product-${marker}`, sku: `FILTER-${marker}`, price: 100, brandId: brand.id } });
  let result = await list({ brand: oldSlug });
  assert.equal(result.filters.brand.name, name); assert.equal(result.products[0].id, product.id);
  result = await list({ brandId: String(brand.id) });
  assert.equal(result.filters.brand.id, brand.id); assert.equal(result.products[0].id, product.id);
  result = await list({ brand: oldSlug, minPrice: '1000' });
  assert.equal(result.products.length, 0); assert.equal(result.filters.brand.name, name, 'Brand metadata is independent of matching products');
  const plan = await normalizeLegacyBrandSlugs(); assert.ok(plan.some(change => change.id === brand.id && change.after === slugifyBrand(name)));
  assert.equal((await prisma.brand.findUnique({ where: { id: brand.id } })).slug, oldSlug, 'Dry run leaves data unchanged');
  await normalizeLegacyBrandSlugs(true);
  const normalized = await prisma.brand.findUnique({ where: { id: brand.id } });
  assert.equal(normalized.slug, slugifyBrand(name)); assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).brandId, brand.id);
  for (const query of [{ brand: normalized.slug }, { brand: oldSlug }, { brandId: String(brand.id) }]) {
    result = await list(query); assert.equal(result.filters.brand.name, name); assert.equal(result.products[0].id, product.id);
  }
  result = await list({ brand: `missing-${marker}` }); assert.equal(result.filters.brand, null); assert.equal(result.products.length, 0);
  const invalid = await fetch(`${base}/products?brandId=not-an-id`); assert.equal(invalid.status, 400);
  assert.equal(slugifyBrand('Acer'), 'acer'); assert.equal(slugifyBrand('ASUS'), 'asus'); assert.equal(slugifyBrand('MSI'), 'msi');
  console.log('PASS Brand filters: slug/ID/legacy bookmarks, resolved name with zero products, generic missing brand, canonical normalization and unchanged product relation');
} finally {
  if (product) await prisma.product.deleteMany({ where: { id: product.id } });
  if (brand) await prisma.brand.deleteMany({ where: { id: brand.id } });
  await prisma.$disconnect();
}
