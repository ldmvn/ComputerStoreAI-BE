import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import { createAccessToken } from '../src/services/token.service.js';

const base = process.env.CATEGORY_TEST_API || `http://localhost:${process.env.PORT || 5000}/api`;
const marker = `category-test-${randomUUID().slice(0, 8)}`;
const ids = [];
let productId;
let adminId;
let token;

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = auth && token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}

async function createCategory(name, slug, parentId = null) {
  const result = await request('/admin/categories', { method: 'POST', body: { name, slug, parentId, icon: 'Laptop', sortOrder: 0, isActive: true } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  ids.push(result.data.category.id);
  return result.data.category;
}

try {
  const admin = await prisma.user.create({ data: {
    fullName: marker,
    email: `${marker}@example.com`,
    phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`,
    passwordHash: 'category-integration-test',
    role: 'ADMIN',
    isActive: true,
  } });
  adminId = admin.id;
  token = createAccessToken(admin);

  assert.equal((await request('/admin/categories', { auth: false })).status, 401);
  const root = await createCategory(`${marker} Laptop`, `${marker}-laptop`);
  const child = await createCategory(`${marker} Gaming`, `${marker}-gaming`, root.id);
  const sibling = await createCategory(`${marker} Accessories`, `${marker}-accessories`);
  assert.equal(child.parentId, root.id);
  assert.equal((await request(`/admin/categories/${root.id}`, { method: 'PUT', body: { name: root.name, slug: root.slug, parentId: child.id, sortOrder: 0, isActive: true } })).status, 400, 'Reject hierarchy cycles');
  assert.equal((await request('/admin/categories', { method: 'POST', body: { name: `${marker} Duplicate`, slug: root.slug } })).status, 409, 'Reject duplicate slugs');

  const empty = await createCategory(`${marker} Empty`, `${marker}-empty`);
  assert.equal((await request(`/admin/categories/${empty.id}`, { method: 'DELETE' })).status, 200, 'Allow deleting an empty category');
  ids.splice(ids.indexOf(empty.id), 1);

  const productBody = new FormData();
  for (const [key, value] of Object.entries({ name: `${marker} Product`, slug: `${marker}-product`, sku: `${marker.toUpperCase()}-01`, categoryId: child.id, category: child.name, price: '1999000', stockQuantity: '1' })) productBody.set(key, value);
  const productResponse = await fetch(`${base}/admin/products`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: productBody });
  const productResult = await productResponse.json();
  assert.equal(productResponse.status, 201, JSON.stringify(productResult));
  productId = productResult.product.id;
  assert.equal(productResult.product.categoryId, child.id);
  assert.equal(productResult.product.category, child.name);

  const listed = await request('/admin/categories');
  const childRow = listed.data.categories.find(category => category.id === child.id);
  assert.equal(childRow.productCount, 1);
  assert.equal((await request(`/products?category=${child.slug}`)).data.products[0].id, productId, 'Product filters resolve category slugs');
  assert.equal((await request(`/admin/categories/${child.id}`, { method: 'DELETE' })).status, 409, 'Block deleting a category with products');
  assert.equal((await request(`/admin/categories/${root.id}`, { method: 'DELETE' })).status, 409, 'Block deleting a parent with children');

  const publicMenu = () => request('/categories/menu', { auth: false });
  await request(`/admin/categories/${root.id}/order`, { method: 'PATCH', body: { sortOrder: 21 } });
  await request(`/admin/categories/${sibling.id}/order`, { method: 'PATCH', body: { sortOrder: 20 } });
  let menu = (await publicMenu()).data.categories;
  const publicRoot = menu.find(category => category.id === root.id);
  assert.ok(publicRoot?.children.some(category => category.id === child.id));
  assert.ok(menu.findIndex(category => category.id === sibling.id) < menu.findIndex(category => category.id === root.id), 'Public menu honors persisted sort order');
  await request(`/admin/categories/${child.id}/order`, { method: 'PATCH', body: { sortOrder: 7 } });
  assert.equal((await request(`/admin/categories/${child.id}`)).data.category.sortOrder, 7);
  await request(`/admin/categories/${child.id}/status`, { method: 'PATCH', body: { isActive: false } });
  const dashboard = await request('/admin/categories');
  assert.equal(dashboard.data.categories.find(category => category.id === child.id).isActive, false);
  menu = (await publicMenu()).data.categories;
  assert.ok(!menu.find(category => category.id === root.id).children.some(category => category.id === child.id));

  await request(`/admin/products/${productId}`, { method: 'DELETE' });
  assert.equal((await request(`/admin/categories/${child.id}`, { method: 'DELETE' })).status, 200);
  ids.splice(ids.indexOf(child.id), 1);
  assert.equal((await request(`/admin/categories/${root.id}`, { method: 'DELETE' })).status, 200);
  ids.splice(ids.indexOf(root.id), 1);
  assert.equal((await request(`/admin/categories/${sibling.id}`, { method: 'DELETE' })).status, 200);
  ids.splice(ids.indexOf(sibling.id), 1);
  await prisma.product.delete({ where: { id: productId } });
  productId = undefined;
  console.log('PASS category API: admin protection, CRUD, hierarchy/cycle validation, product relation/count/filter, active menu/order, and safe deletion');
} finally {
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  if (ids.length) {
    await prisma.category.updateMany({ where: { parentId: { in: ids } }, data: { parentId: null } });
    await prisma.category.deleteMany({ where: { id: { in: ids } } });
  }
  if (adminId) await prisma.user.delete({ where: { id: adminId } });
  await prisma.$disconnect();
}