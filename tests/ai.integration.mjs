// Controlled integration test for the AI Foundation — exercises the real
// HTTP routes and the real tool adapters against the live dev database
// (read-only: no product/order/compatibility data is created or mutated).
import 'dotenv/config';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma.js';
import { searchProducts } from '../src/ai/tools/productSearch.tool.js';
import { checkBuildCompatibility } from '../src/ai/tools/compatibility.tool.js';
import { lookupMyOrders } from '../src/ai/tools/orderLookup.tool.js';

const base = process.env.AI_TEST_API || `http://localhost:${process.env.PORT || 5000}/api`;

async function request(path, { method = 'GET', body } = {}) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  const response = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok  — ${label}`); }
  catch (e) { failures++; console.error(`  FAIL — ${label}\n        ${e.message}`); }
}

try {
  console.log('\n[GET /api/ai/status]');
  {
    const res = await request('/ai/status');
    check('status returns 200', () => assert.equal(res.status, 200));
    check('status reports everything disabled by default', () => {
      assert.deepEqual(res.data.data, { enabled: false, chatAvailable: false, ragAvailable: false, buildPcAvailable: false });
    });
    check('status never leaks provider/model/vector-store fields', () => {
      const keys = Object.keys(res.data.data);
      assert.ok(!keys.includes('provider'));
      assert.ok(!keys.includes('model'));
      assert.ok(!keys.includes('vectorStoreProvider'));
    });
  }

  console.log('\n[POST /api/ai/chat — never a fake 200]');
  {
    const notConfigured = await request('/ai/chat', { method: 'POST', body: { message: 'Tư vấn PC chơi game 15 triệu' } });
    check('chat returns 501, not a fabricated 200 answer', () => assert.equal(notConfigured.status, 501));
    check('chat response never contains a "reply" field when unavailable', () => assert.ok(!notConfigured.data.data?.reply));
    check("chat error code identifies the provider as the reason", () => assert.equal(notConfigured.data.code, 'AI_PROVIDER_UNAVAILABLE'));

    const emptyMsg = await request('/ai/chat', { method: 'POST', body: { message: '' } });
    check('empty message is rejected (400) before ever reaching the provider', () => assert.equal(emptyMsg.status, 400));

    const tooLong = await request('/ai/chat', { method: 'POST', body: { message: 'a'.repeat(2001) } });
    check('oversized message is rejected (400)', () => assert.equal(tooLong.status, 400));

    const badContext = await request('/ai/chat', { method: 'POST', body: { message: 'hi', context: 'not-real' } });
    check('invalid context is rejected (400)', () => assert.equal(badContext.status, 400));

    const noBody = await request('/ai/chat', { method: 'POST' });
    check('missing body is rejected (400), not a 500', () => assert.equal(noBody.status, 400));
  }

  console.log('\n[AI tools — real adapters over existing services, read-only]');
  {
    const anyProduct = await prisma.product.findFirst({ where: { isDeleted: false, isActive: true }, select: { id: true, name: true, price: true } });
    check('at least one active product exists to search against', () => assert.ok(anyProduct, 'seed/catalog data expected in dev DB'));

    if (anyProduct) {
      const result = await searchProducts({ search: anyProduct.name.slice(0, 6), limit: 5 });
      check('searchProducts finds the real product by partial name', () => assert.ok(result.items.some(p => p.id === anyProduct.id)));
      check('searchProducts never returns more than the requested limit', () => assert.ok(result.items.length <= 5));

      const byBudget = await searchProducts({ maxPrice: anyProduct.price, limit: 20 });
      check('searchProducts maxPrice filter only returns products at/under that price', () => {
        assert.ok(byBudget.items.every(p => p.price <= anyProduct.price));
      });
    }

    const inactiveLeaks = await searchProducts({ search: '', limit: 1 });
    check('searchProducts call succeeds without throwing on an empty search term', () => assert.ok(Array.isArray(inactiveLeaks.items)));
  }

  console.log('\n[Compatibility tool — defers to the real engine, never invents a verdict]');
  {
    await assert.rejects(() => checkBuildCompatibility({ items: [] }), /mảng không rỗng/);
    const fakeProductResult = await checkBuildCompatibility({ items: [{ slot: 'cpu', productId: 999999999, quantity: 1 }] }).catch(e => e);
    check('a non-existent slot/productId is rejected by the real engine, not silently accepted', () => {
      assert.ok(fakeProductResult instanceof Error || fakeProductResult?.issues?.length > 0 || fakeProductResult?.compatible === false, JSON.stringify(fakeProductResult));
    });
  }

  console.log('\n[Order lookup tool — strictly scoped to the authenticated caller]');
  {
    await assert.rejects(() => lookupMyOrders({}, null), /đăng nhập/);
    await assert.rejects(() => lookupMyOrders({}, 0), /đăng nhập/);
    await assert.rejects(() => lookupMyOrders({}, -1), /đăng nhập/);

    const anyUserWithId = await prisma.user.findFirst({ select: { id: true } });
    if (anyUserWithId) {
      const result = await lookupMyOrders({}, anyUserWithId.id);
      check('lookupMyOrders with a real userId returns only that scope (no cross-user data)', () => {
        assert.ok(Array.isArray(result.orders));
        assert.ok(result.orders.every(o => o.userId === undefined || o.userId === anyUserWithId.id));
      });
    }
  }

  console.log('\n[Regression — existing sales/catalog APIs are unaffected by mounting /api/ai]');
  {
    const products = await request('/products?limit=1');
    check('public product list API still responds 200', () => assert.equal(products.status, 200));
    const storeInfo = await request('/content/store-info');
    check('public store-info API still responds 200', () => assert.equal(storeInfo.status, 200));
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
} finally {
  await prisma.$disconnect();
  if (failures > 0) process.exitCode = 1;
}
