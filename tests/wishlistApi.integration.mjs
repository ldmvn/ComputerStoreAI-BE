import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';

const marker = `wshapi-${randomUUID().slice(0, 8)}`;
const identifier = `${marker}@x.com`;
const password = 'Test@12345';

let user;
let product;
try {
  user = await prisma.user.create({ data: { fullName: marker, email: identifier, phone: `09${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, passwordHash: await bcrypt.hash(password, 4), role: 'USER' } });
  product = await prisma.product.create({ data: { name: marker, slug: marker, sku: marker.toUpperCase(), price: 100, stockQuantity: 5, lowStockThreshold: 1, isActive: true } });

  const loginRes = await fetch('http://localhost:5000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  const login = await loginRes.json();
  assert.equal(loginRes.status, 200, JSON.stringify(login));
  const token = login.token;

  const auth = { Authorization: `Bearer ${token}` };

  let r = await fetch('http://localhost:5000/api/wishlist', { headers: auth });
  assert.equal(r.status, 200);
  let body = await r.json();
  assert.deepEqual(body.items, []);

  r = await fetch(`http://localhost:5000/api/wishlist/${product.id}`, { method: 'POST', headers: auth });
  const err1 = await r.json();
  assert.equal(r.status, 201, JSON.stringify(err1));
  body = err1;
  assert.equal(body.item.productId, product.id);

  // duplicate -> still 201
  r = await fetch(`http://localhost:5000/api/wishlist/${product.id}`, { method: 'POST', headers: auth });
  assert.equal(r.status, 201);
  body = await r.json();
  assert.equal(body.item.productId, product.id);

  r = await fetch('http://localhost:5000/api/wishlist', { headers: auth });
  body = await r.json();
  assert.equal(body.items.length, 1);

  r = await fetch(`http://localhost:5000/api/wishlist/check/${product.id}`, { headers: auth });
  body = await r.json();
  assert.equal(body.favorited, true);

  r = await fetch(`http://localhost:5000/api/wishlist/${product.id}`, { method: 'DELETE', headers: auth });
  assert.equal(r.status, 200);
  body = await r.json();
  assert.equal(body.removed, true);

  r = await fetch(`http://localhost:5000/api/wishlist/check/${product.id}`, { headers: auth });
  body = await r.json();
  assert.equal(body.favorited, false);

  // unauthenticated
  r = await fetch('http://localhost:5000/api/wishlist');
  assert.equal(r.status, 401);

  // invalid id
  r = await fetch(`http://localhost:5000/api/wishlist/abc`, { method: 'POST', headers: auth });
  assert.equal(r.status, 400);

  // non-existent product
  r = await fetch(`http://localhost:5000/api/wishlist/99999999`, { method: 'POST', headers: auth });
  assert.equal(r.status, 404);

  console.log('PASS wishlist API: list, add (idempotent), remove, check, auth required, validation');
} finally {
  if (user) await prisma.user.deleteMany({ where: { id: user.id } });
  if (product) await prisma.product.deleteMany({ where: { id: product.id } });
  await prisma.$disconnect();
}