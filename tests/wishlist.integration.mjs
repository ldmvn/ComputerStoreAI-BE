import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { addWishlistItem, listWishlist, isFavorited, removeWishlistItem } from '../src/services/wishlist.service.js';

const marker = `wsh-${randomUUID().slice(0, 8)}`;
let user;
let product;
let inactiveProduct;
try {
  user = await prisma.user.create({ data: { fullName: marker, email: `${marker}@x.com`, phone: `09${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, passwordHash: await bcrypt.hash('Passw0rd!', 4), role: 'USER' } });
  product = await prisma.product.create({ data: { name: marker, slug: marker, sku: marker.toUpperCase(), price: 100, stockQuantity: 5, lowStockThreshold: 1, isActive: true } });
  inactiveProduct = await prisma.product.create({ data: { name: `${marker}-off`, slug: `${marker}-off`, sku: `${marker.toUpperCase()}-OFF`, price: 100, stockQuantity: 5, lowStockThreshold: 1, isActive: false } });

  await addWishlistItem(user.id, product.id);
  await addWishlistItem(user.id, product.id); // duplicate -> idempotent
  assert.equal(await prisma.wishlistItem.count({ where: { wishlistId: user.id, productId: product.id } }), 1, 'duplicate add must be idempotent');
  assert.equal(await isFavorited(user.id, product.id), true);

  await addWishlistItem(user.id, inactiveProduct.id);
  let list = await listWishlist(user.id);
  assert.equal(list.length, 2, 'inactive product still listed but flagged');

  // Soft-delete product should not crash and should be filtered from list
  await prisma.product.update({ where: { id: product.id }, data: { isDeleted: true, deletedAt: new Date() } });
  list = await listWishlist(user.id);
  assert.equal(list.length, 1, 'soft-deleted product must be filtered out');
  assert.equal(list[0].productId, inactiveProduct.id);

  // Adding a non-existent product should throw
  await assert.rejects(addWishlistItem(user.id, 99999999), error => error.statusCode === 404);

  await removeWishlistItem(user.id, inactiveProduct.id);
  assert.equal(await isFavorited(user.id, inactiveProduct.id), false);
  await removeWishlistItem(user.id, inactiveProduct.id); // no-op
  assert.equal(await isFavorited(user.id, inactiveProduct.id), false);

  // Re-add and re-remove to confirm round-trip
  await prisma.product.update({ where: { id: product.id }, data: { isDeleted: false, deletedAt: null } });
  await addWishlistItem(user.id, product.id);
  await removeWishlistItem(user.id, product.id);
  assert.equal(await isFavorited(user.id, product.id), false);
  console.log('PASS wishlist: unique (user,product), soft-deleted product filtered, idempotent add/remove');
} finally {
  if (user) await prisma.user.deleteMany({ where: { id: user.id } });
  if (product) await prisma.product.deleteMany({ where: { id: product.id } });
  if (inactiveProduct) await prisma.product.deleteMany({ where: { id: inactiveProduct.id } });
  await prisma.$disconnect();
}