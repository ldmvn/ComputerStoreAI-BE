import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { createProduct, getProductBySlug } from '../src/services/productCatalog.service.js';

const marker = `spec-sources-${randomUUID().slice(0, 8)}`;
let category;
let product;
const attributes = [];

try {
  category = await prisma.category.create({ data: { name: marker, slug: marker, skuPrefix: `S${Date.now().toString().slice(-6)}` } });
  attributes.push(await prisma.attribute.create({ data: { name: 'Socket CPU', slug: `${marker}-socket`, type: 'TEXT', sortOrder: 20 } }));
  attributes.push(await prisma.attribute.create({ data: { name: 'RAM tối đa', slug: `${marker}-max-ram`, type: 'NUMBER', unit: 'GB', sortOrder: 10 } }));
  await prisma.categoryAttribute.createMany({
    data: attributes.map(attribute => ({ categoryId: category.id, attributeId: attribute.id, sortOrder: attribute.sortOrder })),
  });

  product = await createProduct({
    name: marker,
    slug: `${marker}-product`,
    categoryId: category.id,
    category: category.name,
    brandId: null,
    brand: null,
    shortDescription: null,
    description: null,
    price: 1,
    originalPrice: null,
    costPrice: null,
    stockQuantity: 1,
    lowStockThreshold: 5,
    isActive: true,
    productAttributes: [
      { attributeId: attributes[0].id, attributeValueIds: [], valueText: 'AM5' },
      { attributeId: attributes[1].id, attributeValueIds: [], valueText: '64' },
    ],
    customSpecifications: [
      { name: 'LAN', value: '2.5 GbE', sortOrder: 10 },
      { name: 'BIOS', value: 'UEFI', sortOrder: 0 },
    ],
    highlightSpecs: [],
  }, []);

  const detail = await getProductBySlug(product.slug);
  assert.deepEqual(detail.productAttributes.map(attribute => attribute.name), ['RAM tối đa', 'Socket CPU'], 'Standard attributes follow configured Admin order');
  assert.deepEqual(detail.productAttributes[0], {
    id: attributes[1].id,
    name: 'RAM tối đa',
    slug: `${marker}-max-ram`,
    type: 'NUMBER',
    unit: 'GB',
    sortOrder: 10,
    valueIds: [],
    values: ['64'],
  }, 'Standard attribute source includes the configured numeric unit');
  assert.deepEqual(detail.customSpecifications.map(spec => [spec.name, spec.value, spec.sortOrder]), [
    ['BIOS', 'UEFI', 0],
    ['LAN', '2.5 GbE', 10],
  ], 'Free-form specifications remain a separate, ordered source');
  console.log('PASS specification sources: separate payloads, Admin order and numeric units');
} finally {
  if (product) await prisma.product.deleteMany({ where: { id: product.id } });
  if (attributes.length) {
    await prisma.categoryAttribute.deleteMany({ where: { attributeId: { in: attributes.map(attribute => attribute.id) } } });
    await prisma.attribute.deleteMany({ where: { id: { in: attributes.map(attribute => attribute.id) } } });
  }
  if (category) await prisma.category.deleteMany({ where: { id: category.id } });
  await prisma.$disconnect();
}
