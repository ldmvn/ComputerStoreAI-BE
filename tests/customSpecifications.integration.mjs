import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { createProduct, getProduct, updateProduct } from '../src/services/productCatalog.service.js';

const marker = `custs-${randomUUID().slice(0, 8)}`;
let category;
let product;
try {
  category = await prisma.category.create({ data: { name: marker, slug: marker, skuPrefix: `C${Date.now().toString().slice(-6)}` } });
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
    customSpecifications: [
      { name: 'Kich thuoc', value: '15.6 inch', sortOrder: 0 },
      { name: 'Can nang', value: '1.8 kg', sortOrder: 1 },
    ],
    productAttributes: [],
    highlightSpecs: [],
  }, []);
  let detail = await getProduct(product.id);
  assert.deepEqual(detail.customSpecifications.map(s => [s.name, s.value, s.sortOrder]), [['Kich thuoc', '15.6 inch', 0], ['Can nang', '1.8 kg', 1]]);
  assert.deepEqual(detail.productAttributes, []);

  await updateProduct(product.id, {
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
    customSpecifications: [
      { name: 'Can nang', value: '1.9 kg', sortOrder: 0 },
      { name: 'Kich thuoc', value: '15.6 inch', sortOrder: 1 },
      { name: 'Bao hanh', value: '24 thang', sortOrder: 2 },
    ],
    productAttributes: [],
    highlightSpecs: [],
  }, []);
  detail = await getProduct(product.id);
  assert.deepEqual(detail.customSpecifications.map(s => [s.name, s.value, s.sortOrder]), [['Can nang', '1.9 kg', 0], ['Kich thuoc', '15.6 inch', 1], ['Bao hanh', '24 thang', 2]]);

  await updateProduct(product.id, {
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
    customSpecifications: [{ name: 'Can nang', value: '1.9 kg', sortOrder: 0 }],
    productAttributes: [],
    highlightSpecs: [],
  }, []);
  detail = await getProduct(product.id);
  assert.deepEqual(detail.customSpecifications.map(s => s.name), ['Can nang']);
  console.log('PASS custom specifications round-trip + edit + reorder + delete');
} finally {
  if (product) await prisma.product.deleteMany({ where: { id: product.id } });
  if (category) await prisma.category.deleteMany({ where: { id: category.id } });
  await prisma.$disconnect();
}