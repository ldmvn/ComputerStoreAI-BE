import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import { createAccessToken } from '../src/services/token.service.js';
const base = process.env.MEGA_MENU_TEST_API || `http://localhost:${process.env.PORT || 5000}/api`;
const marker = `mega-${randomUUID().slice(0, 8)}`;
const ids = { categories: [], brands: [], products: [], users: [], attributes: [] };
let token;
const request = async (path, method = 'GET', body, auth = true) => {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json(), headers: response.headers };
};
const ok = async (path, method, body, status = 200) => { const result = await request(path, method, body); assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; };
try {
  const admin = await prisma.user.create({ data: { fullName: marker, email: `${marker}@example.com`, passwordHash: 'integration-only', role: 'ADMIN' } }); ids.users.push(admin.id); token = createAccessToken(admin);
  const user = await prisma.user.create({ data: { fullName: marker, email: `${marker}-user@example.com`, passwordHash: 'integration-only', role: 'USER' } }); ids.users.push(user.id);
  assert.equal((await request('/admin/mega-menu/options', 'GET', undefined, false)).status, 401);
  const adminToken = token; token = createAccessToken(user); assert.equal((await request('/admin/mega-menu/options')).status, 403); token = adminToken;
  const root = await prisma.category.create({ data: { name: `${marker} Laptop`, slug: `${marker}-laptop`, icon: 'Laptop' } }); ids.categories.push(root.id);
  const child = await prisma.category.create({ data: { name: `${marker} Gaming`, slug: `${marker}-gaming`, parentId: root.id } }); ids.categories.push(child.id);
  const brands = [];
  for (const name of ['Acer', 'ASUS']) {
    let brand = await prisma.brand.findFirst({ where: { name, isActive: true } });
    if (!brand) { brand = await prisma.brand.create({ data: { name: `${marker} ${name}`, slug: `${marker}-${name.toLowerCase()}` } }); ids.brands.push(brand.id); }
    brands.push(brand);
  }
  const brandCount = await prisma.brand.count(); const categoryCount = await prisma.category.count();
  // ATTRIBUTE_FILTER menu items reference normalized Attribute/AttributeValue records, so the
  // products are tagged through ProductAttributeValue rather than free-text specifications.
  const ramAttribute = await prisma.attribute.create({
    data: { name: `${marker} RAM`, slug: `${marker}-ram`, type: 'SELECT', values: { create: [{ value: '16GB', sortOrder: 0 }, { value: '8GB', sortOrder: 1 }] }, categories: { create: { categoryId: child.id } } },
    include: { values: { orderBy: { sortOrder: 'asc' } } },
  });
  ids.attributes.push(ramAttribute.id);
  const [ram16, ram8] = ramAttribute.values;
  for (const [index, price] of [14000000, 15000000, 16000000].entries()) {
    const product = await prisma.product.create({ data: {
      name: `${marker} Product ${index}`, slug: `${marker}-product-${index}`, sku: `${marker}-${index}`, categoryId: child.id, brandId: brands[index === 2 ? 1 : 0].id, price, stockQuantity: 1,
      specifications: { create: { name: 'RAM', value: index === 2 ? '8GB' : '16GB' } },
      attributeValues: { create: { attributeId: ramAttribute.id, attributeValueId: index === 2 ? ram8.id : ram16.id } },
    } }); ids.products.push(product.id);
  }
  const path = `/admin/mega-menu/categories/${root.id}`;
  assert.equal((await ok(path)).menu, null);
  await ok(path, 'PUT', { isActive: true, brandIds: brands.map(b => b.id) });
  assert.equal((await request(`/admin/mega-menu/categories/${child.id}`, 'PUT', { isActive: true })).status, 400);
  const group = (await ok(`${path}/groups`, 'POST', { title: 'Laptop Theo Hãng', sortOrder: 10, columnSpan: 2 }, 201)).group;
  const priceGroup = (await ok(`${path}/groups`, 'POST', { title: 'Laptop Theo Khoảng Giá', sortOrder: 20 }, 201)).group;
  const itemPath = `/admin/mega-menu/groups/${group.id}/items`;
  const acer = (await ok(itemPath, 'POST', { label: 'Acer', type: 'BRAND', brandId: brands[0].id, sortOrder: 20 }, 201)).item;
  const asus = (await ok(itemPath, 'POST', { label: 'ASUS', type: 'BRAND', brandId: brands[1].id, sortOrder: 10 }, 201)).item;
  assert.equal((await request(itemPath, 'POST', { label: 'Acer duplicate', type: 'BRAND', brandId: brands[0].id })).status, 409);
  const price = (await ok(`/admin/mega-menu/groups/${priceGroup.id}/items`, 'POST', { label: 'Dưới 15 triệu', type: 'PRICE_FILTER', minPrice: 0, maxPrice: 15000000 }, 201)).item;
  const attr = (await ok(itemPath, 'POST', { label: 'RAM 16GB', type: 'ATTRIBUTE_FILTER', attributeId: ramAttribute.id, attributeValueId: ram16.id, sortOrder: 30 }, 201)).item;
  await ok(itemPath, 'POST', { label: 'Gaming', type: 'CATEGORY', categoryId: child.id, sortOrder: 40 }, 201);
  await ok(itemPath, 'POST', { label: 'Build PC', type: 'CUSTOM_URL', customUrl: '/customer/build-pc', sortOrder: 50 }, 201);
  assert.equal((await request(itemPath, 'POST', { label: 'Bad', type: 'ATTRIBUTE_FILTER', attributeId: ramAttribute.id, attributeValueId: 2147483647 })).status, 400, 'Unknown attribute value is rejected');
  assert.equal((await request(itemPath, 'POST', { label: 'Bad', type: 'ATTRIBUTE_FILTER', attributeId: ramAttribute.id })).status, 400, 'Attribute value is required');
  const read = async () => (await request(`/mega-menu/${root.slug}`, 'GET', undefined, false)).data.menus[0];
  let menu = await read(); assert.equal(menu.groups[0].title, group.title); assert.equal(menu.groups[0].items[0].label, 'ASUS'); assert.equal(menu.brands.length, 2);
  assert.match((await request('/mega-menu', 'GET', undefined, false)).headers.get('cache-control'), /max-age=30/);
  for (const [item, expected] of [[menu.groups[0].items.find(i => i.id === acer.id), 2], [menu.groups[1].items[0], 2], [menu.groups[0].items.find(i => i.id === attr.id), 2]]) {
    const params = new URL(item.href, 'http://local').search;
    const products = (await ok(`/products${params}`)).products; assert.equal(products.length, expected); assert.ok(products.every(p => ids.products.includes(p.id)));
  }
  assert.equal((await ok(`/products?category=${root.slug}&minPrice=15000000&maxPrice=15000000`)).products.length, 1, 'Price bounds are inclusive');
  await ok(`/admin/mega-menu/groups/${priceGroup.id}`, 'PUT', { title: priceGroup.title, sortOrder: 0, isActive: false }); assert.equal((await read()).groups.length, 1);
  await ok(`/admin/mega-menu/groups/${priceGroup.id}`, 'PUT', { title: priceGroup.title, sortOrder: 0, isActive: true }); assert.equal((await read()).groups[0].id, priceGroup.id);
  await ok(`${itemPath}/${acer.id}`, 'PUT', { ...acer, sortOrder: 0, isActive: false }); assert.ok(!(await read()).groups.flatMap(g => g.items).some(i => i.id === acer.id));
  await ok(`${itemPath}/${acer.id}`, 'PUT', { ...acer, sortOrder: 0, isActive: true });
  await prisma.category.update({ where: { id: child.id }, data: { isActive: false } }); assert.ok(!(await read()).groups.flatMap(g => g.items).some(i => i.type === 'CATEGORY'));
  await prisma.category.update({ where: { id: child.id }, data: { isActive: true } });
  const disposable = await prisma.brand.create({ data: { name: marker, slug: marker } }); ids.brands.push(disposable.id);
  const orphan = (await ok(itemPath, 'POST', { label: 'Removed brand', type: 'BRAND', brandId: disposable.id }, 201)).item;
  await ok(`/admin/brands/${disposable.id}/status`, 'PATCH', { isActive: false });
  assert.ok(!(await read()).groups.flatMap(g => g.items).some(i => i.id === orphan.id));
  await ok(`/admin/brands/${disposable.id}`, 'DELETE'); ids.brands.splice(ids.brands.indexOf(disposable.id), 1);
  assert.ok(!(await read()).groups.flatMap(g => g.items).some(i => i.id === orphan.id));
  assert.equal((await ok(path)).menu.groups.flatMap(g => g.items).find(i => i.id === orphan.id).invalid, true);
  const tempAttribute = await prisma.attribute.create({ data: { name: `${marker} Temp`, slug: `${marker}-temp`, type: 'SELECT', values: { create: { value: 'Only value' } } }, include: { values: true } });
  ids.attributes.push(tempAttribute.id);
  const tempValue = tempAttribute.values[0];
  const tagged = await prisma.productAttributeValue.create({ data: { productId: ids.products[0], attributeId: tempAttribute.id, attributeValueId: tempValue.id } });
  const stale = (await ok(itemPath, 'POST', { label: 'Temporary attribute', type: 'ATTRIBUTE_FILTER', attributeId: tempAttribute.id, attributeValueId: tempValue.id }, 201)).item;
  // No product carries the value any more: the link still resolves but has nothing to show.
  await prisma.productAttributeValue.delete({ where: { id: tagged.id } });
  assert.ok(!(await read()).groups.flatMap(g => g.items).some(i => i.id === stale.id), 'Attribute values with no products are hidden');
  // Deleting the value itself nulls the FK, so the item is reported as a broken reference.
  await prisma.attributeValue.delete({ where: { id: tempValue.id } });
  assert.equal((await ok(path)).menu.groups.flatMap(g => g.items).find(i => i.id === stale.id).invalid, true);
  await prisma.category.update({ where: { id: root.id }, data: { isActive: false } });
  assert.equal((await request(`/mega-menu/${root.slug}`, 'GET', undefined, false)).status, 404);
  await prisma.category.update({ where: { id: root.id }, data: { isActive: true } });
  await ok(path, 'PUT', { isActive: false, brandIds: [] }); assert.equal((await read()).groups.length, 0); assert.equal((await read()).brands.length, 0);
  await ok(path, 'PUT', { isActive: true });
  await ok(`/admin/mega-menu/items/${asus.id}`, 'DELETE');
  await ok(`/admin/mega-menu/groups/${priceGroup.id}`, 'DELETE'); assert.equal(await prisma.megaMenuItem.count({ where: { id: price.id } }), 0);
  assert.equal(await prisma.brand.count(), brandCount); assert.equal(await prisma.category.count(), categoryCount); assert.equal(await prisma.product.count({ where: { id: { in: ids.products } } }), 3);
  console.log('PASS Mega Menu API: auth, five types, existing references, duplicate rejection, descendant/brand/price/attribute filters, inclusive prices, status/order, featured brands, safe deletion and unchanged product counts');
} finally {
  await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  // Products cascade their ProductAttributeValue rows, so the values are now unreferenced.
  await prisma.attributeValue.deleteMany({ where: { attributeId: { in: ids.attributes } } });
  await prisma.categoryAttribute.deleteMany({ where: { attributeId: { in: ids.attributes } } });
  await prisma.attribute.deleteMany({ where: { id: { in: ids.attributes } } });
  for (const id of ids.categories.reverse()) await prisma.category.deleteMany({ where: { id } });
  await prisma.brand.deleteMany({ where: { id: { in: ids.brands } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  await prisma.$disconnect();
}
