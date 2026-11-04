import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
const base = process.env.PRODUCT_DETAIL_TEST_API || `http://localhost:${process.env.PORT || 5000}/api`;
const marker = `detail-${randomUUID().slice(0, 8)}`;
let category, brand, product, section;
const detail = async slug => { const response = await fetch(`${base}/products/${slug}`); return { status: response.status, data: await response.json() }; };
const view = async (slug, viewId) => { const response = await fetch(`${base}/products/${slug}/views`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewId }) }); return { status: response.status, data: await response.json() }; };
try {
  category = await prisma.category.create({ data: { name: `${marker} Category`, slug: `legacy-${marker}-category` } });
  brand = await prisma.brand.create({ data: { name: `${marker} Brand`, slug: `legacy-${marker}-brand` } });
  product = await prisma.product.create({ data: {
    name: `${marker} Product`, slug: `${marker}-product`, sku: marker.toUpperCase(), category: 'outdated category name', categoryId: category.id, brand: 'outdated brand name', brandId: brand.id,
    price: 16000000, originalPrice: 20000000, costPrice: 12000000, stockQuantity: 2, shortDescription: 'Short database description', description: 'Detailed database description',
    images: { create: [{ imageUrl: '/media/products/second.webp', altText: 'Second photo', sortOrder: 0 }, { imageUrl: '/media/products/primary.webp', altText: 'Primary photo', sortOrder: 5, isPrimary: true }] },
    specifications: { create: [{ name: 'RAM', value: '32GB', sortOrder: 2 }, { name: 'CPU', value: 'Ryzen 7', sortOrder: 1 }] },
  } });
  section = await prisma.productSection.create({ data: { name: marker, slug: marker, items: { create: { productId: product.id } } } });
  let result = await detail(product.slug); assert.equal(result.status, 200);
  const record = result.data.product;
  for (const key of ['id', 'name', 'slug', 'sku', 'price', 'originalPrice', 'stockQuantity', 'shortDescription', 'description', 'categoryInfo', 'brandInfo', 'images', 'customSpecifications', 'isActive', 'stockStatus', 'ratingAverage', 'reviewCount', 'commentCount', 'viewCount']) assert.ok(key in record, key);
  assert.equal(record.categoryInfo.name, category.name); assert.equal(record.category, category.name); assert.equal(record.brandInfo.name, brand.name); assert.equal(record.brand, brand.name);
  assert.equal(record.images[0].altText, 'Primary photo'); assert.deepEqual(record.customSpecifications.map(spec => spec.name), ['CPU', 'RAM']);
  assert.equal(record.price, product.price); assert.equal(record.originalPrice, product.originalPrice); assert.equal(record.stockStatus, 'LOW_STOCK'); assert.ok(!('costPrice' in record), 'Public API does not expose procurement costs');
  assert.equal(record.ratingAverage, null); assert.equal(record.reviewCount, 0); assert.equal(record.commentCount, 0); assert.equal(record.viewCount, 0);
  assert.equal((await detail(product.slug)).data.product.viewCount, 0, 'Reading API does not record page views');
  await prisma.productReview.createMany({ data: [
    ...[3, 4, 5].map(rating => ({ productId: product.id, rating, content: 'Integration test review', isPublished: true })),
    { productId: product.id, rating: 1, content: 'Unpublished review' },
    { productId: product.id, rating: 9, content: 'Invalid legacy rating', isPublished: true },
  ] });
  await prisma.productComment.createMany({ data: [
    ...[1, 2].map(index => ({ productId: product.id, content: `Published comment ${index}`, isPublished: true })),
    { productId: product.id, content: 'Pending comment' },
  ] });
  result = await detail(product.slug);
  assert.equal(result.data.product.reviewCount, 3); assert.equal(result.data.product.ratingAverage, 4); assert.equal(result.data.product.commentCount, 2);
  const viewId = randomUUID();
  const sameViewResults = await Promise.all(Array.from({ length: 6 }, () => view(product.slug, viewId)));
  for (const response of sameViewResults) { assert.equal(response.status, 200); assert.equal(response.data.viewCount, 1); }
  assert.equal((await view(product.slug, viewId.toUpperCase())).data.viewCount, 1, 'View IDs are normalized and deduplicated');
  await Promise.all(Array.from({ length: 3 }, () => view(product.slug, randomUUID())));
  assert.equal(await prisma.productView.count({ where: { productId: product.id } }), 4);
  assert.equal((await detail(product.slug)).data.product.viewCount, 4, 'View count persists across API requests');
  assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).updatedAt.getTime(), product.updatedAt.getTime(), 'Views do not alter product modification time');
  assert.equal((await view(product.slug, 'invalid-id')).status, 400);
  assert.equal((await detail(product.slug)).data.product.viewCount, 4);
  const home = await fetch(`${base}/product-sections/home`).then(r => r.json()); assert.equal(home.sections.find(s => s.id === section.id).products[0].slug, product.slug);
  await prisma.product.update({ where: { id: product.id }, data: { stockQuantity: 0 } }); result = await detail(product.slug); assert.equal(result.data.product.stockStatus, 'OUT_OF_STOCK');
  await prisma.product.update({ where: { id: product.id }, data: { isActive: false } }); assert.equal((await detail(product.slug)).status, 404);
  assert.equal((await view(product.slug, randomUUID())).status, 404);
  await prisma.product.update({ where: { id: product.id }, data: { isActive: true, isDeleted: true } }); assert.equal((await detail(product.slug)).status, 404);
  assert.equal((await view(product.slug, randomUUID())).status, 404);
  assert.equal((await detail(`${marker}-missing`)).status, 404);
  assert.equal((await view(`${marker}-missing`, randomUUID())).status, 404);
  assert.equal(await prisma.productView.count({ where: { productId: product.id } }), 4, 'Hidden/deleted/missing products do not record views');
  console.log('PASS Product detail API: real published review/comment aggregates, persisted views, concurrent/idempotent view events, validation, unchanged modification time, complete response, image/spec order, stock, hidden/deleted/missing products and no public costPrice');
} finally {
  if (section) await prisma.productSection.deleteMany({ where: { id: section.id } });
  if (product) await prisma.product.deleteMany({ where: { id: product.id } });
  if (category) await prisma.category.deleteMany({ where: { id: category.id } });
  if (brand) await prisma.brand.deleteMany({ where: { id: brand.id } });
  await prisma.$disconnect();
}
