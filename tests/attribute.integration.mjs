import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { categoryAttributes, createAttribute, createValue, deleteAttribute, deleteValue, saveCategories } from '../src/services/attribute.service.js';
import { createProduct, getProduct, listProducts } from '../src/services/productCatalog.service.js';
import { attributeOptions, getAdminMenu, publicMenus, saveItem } from '../src/services/megaMenu.service.js';

const marker = `attr-${randomUUID().slice(0, 8)}`;
let category;
let attribute;
let value;
let product;
let secondProduct;

try {
  category = await prisma.category.create({ data: { name: marker, slug: marker, skuPrefix: `A${Date.now().toString().slice(-6)}` } });
  attribute = await createAttribute({ name: 'RAM test', slug: marker, type: 'SELECT', sortOrder: 10, isActive: true });
  await saveCategories(attribute.id, [category.id]);
  value = await createValue(attribute.id, { value: '16GB', sortOrder: 0, isActive: true });
  assert.equal((await categoryAttributes(category.id))[0].id, attribute.id);

  product = await createProduct({ name: marker, slug: `${marker}-product`, categoryId: category.id, category: category.name, brandId: null, brand: null, shortDescription: null, description: null, price: 1, originalPrice: null, costPrice: null, stockQuantity: 1, lowStockThreshold: 5, isActive: true, customSpecifications: [], productAttributes: [{ attributeId: attribute.id, attributeValueIds: [value.id], valueText: null }], highlightSpecs: [] }, []);
  const detail = await getProduct(product.id);
  assert.deepEqual(detail.customSpecifications, []);
  assert.deepEqual(detail.productAttributes[0].valueIds, [value.id]);
  // Aggregate display shape used by Product Detail (attribute row -> merged table)
  const mergedRows = [
    ...detail.productAttributes.map(a => ({ name: a.name, value: a.values.join(', ') })),
    ...detail.customSpecifications.map(s => ({ name: s.name, value: s.value })),
  ];
  assert.deepEqual(mergedRows, [{ name: 'RAM test', value: '16GB' }]);

  const filtered = await listProducts({ page: 1, limit: 20, attribute: marker, attributeValue: String(value.id), search: '', category: '', brand: '', status: '', stock: '', orderBy: [{ updatedAt: 'desc' }] });
  assert.ok(filtered.items.some(item => item.id === product.id));
  assert.ok((await attributeOptions()).some(item => item.id === attribute.id && item.values.some(option => option.id === value.id)));
  const menu = await prisma.megaMenu.create({ data: { categoryId: category.id, groups: { create: { title: 'Theo RAM', items: { create: [] } } } }, include: { groups: true } });
  await saveItem(menu.groups[0].id, null, { label: 'RAM 16GB', type: 'ATTRIBUTE_FILTER', attributeId: attribute.id, attributeValueId: value.id, attributeName: null, attributeValue: null, categoryId: null, brandId: null, minPrice: null, maxPrice: null, customUrl: null, sortOrder: 0, isActive: true });
  const unusedValue = await createValue(attribute.id, { value: '32GB', sortOrder: 10, isActive: true });
  await saveItem(menu.groups[0].id, null, { label: 'RAM 32GB', type: 'ATTRIBUTE_FILTER', attributeId: attribute.id, attributeValueId: unusedValue.id, attributeName: null, attributeValue: null, categoryId: null, brandId: null, minPrice: null, maxPrice: null, customUrl: null, sortOrder: 10, isActive: true });
  const unusedAdminItem = (await getAdminMenu(category.id)).menu.groups[0].items.find(item => item.attributeValueId === unusedValue.id);
  assert.equal(unusedAdminItem.invalid, false);
  assert.equal(unusedAdminItem.productCount, 0);
  assert.equal((await publicMenus(category.slug))[0].groups[0].items.some(item => item.label === 'RAM 32GB'), false);
  const publicItem = (await publicMenus(category.slug))[0].groups[0].items[0];
  assert.match(publicItem.href, new RegExp(`attribute=${marker}&attributeValue=${value.id}`));
  secondProduct = await prisma.product.create({ data: { name: `${marker} second`, slug: `${marker}-second`, sku: `${marker}-SECOND`.toUpperCase(), price: 1, categoryId: category.id, attributeValues: { create: { attributeId: attribute.id, attributeValueId: unusedValue.id } } } });
  assert.equal((await publicMenus(category.slug))[0].groups[0].items.some(item => item.label === 'RAM 32GB'), true);
  await assert.rejects(deleteValue(value.id), error => error.statusCode === 409);
  await assert.rejects(deleteAttribute(attribute.id), error => error.statusCode === 409);
  console.log('PASS attributes: category load, normalized product detail/filter, Mega Menu options and safe delete');
} finally {
  if (secondProduct) await prisma.product.deleteMany({ where: { id: secondProduct.id } });
  if (product) await prisma.product.deleteMany({ where: { id: product.id } });
  if (attribute) { await prisma.categoryAttribute.deleteMany({ where: { attributeId: attribute.id } }); await prisma.attributeValue.deleteMany({ where: { attributeId: attribute.id } }); await prisma.attribute.deleteMany({ where: { id: attribute.id } }); }
  if (category) await prisma.category.deleteMany({ where: { id: category.id } });
  await prisma.$disconnect();
}
