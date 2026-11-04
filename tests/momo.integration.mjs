// Real MySQL/InnoDB integration test for the MoMo IPN flow — exercises
// handleMomoIpn() end to end (signature verify → match → confirmPaymentAttempt)
// against the real Payment/PaymentAttempt/Order tables with genuine HMAC
// signatures (signed with the SAME MOMO_ACCESS_KEY/MOMO_SECRET_KEY the handler
// verifies, so the round-trip is valid whatever the configured values are — the
// REAL sandbox credentials are validated separately by the create-call check).
// No real MoMo network call is made here. Cleans up in `finally`.
//
// Run: node tests/momo.integration.mjs
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import { handleMomoIpn } from '../src/payments/services/payment.service.js';
import { signIpn } from '../src/payments/services/momoUtil.service.js';

const ACCESS_KEY = process.env.MOMO_ACCESS_KEY || 'F8BBA842ECF85';
const SECRET = process.env.MOMO_SECRET_KEY || 'K951B6PE1waDMi640xX08PD3vg6EkVlz';
const marker = `momo-test-${randomUUID().slice(0, 8)}`;
const orderIds = [];
let userId;
let failures = 0;

async function check(label, fn) {
  try { await fn(); console.log(`  ok  — ${label}`); }
  catch (e) { failures++; console.error(`  FAIL — ${label}\n        ${e.stack || e.message}`); }
}

function ipn({ orderId, amount, resultCode = 0, transId = Date.now(), tamper = false, secret = SECRET }) {
  const body = {
    partnerCode: 'MOMO', orderId, requestId: `${orderId}-req`, amount, orderInfo: 'pay',
    orderType: 'momo_wallet', transId, resultCode, message: resultCode === 0 ? 'Successful.' : 'Failed.',
    payType: 'qr', responseTime: Date.now(), extraData: '',
  };
  body.signature = signIpn(body, ACCESS_KEY, secret);
  if (tamper) body.amount = amount + 1; // change a signed field after signing
  return body;
}

async function makeMomoOrder({ amount = 2500000, status = 'PENDING', paymentStatus = 'PROCESSING' } = {}) {
  const order = await prisma.order.create({
    data: {
      userId, status, paymentMethod: 'MOMO',
      shippingName: marker, shippingPhone: '0900000000', shippingAddress: marker,
      subtotal: amount, discountAmount: 0,
    },
  });
  orderIds.push(order.id);
  const payment = await prisma.payment.create({ data: { orderId: order.id, method: 'MOMO', status: paymentStatus, amount } });
  const momoOrderId = `DMPC${order.id}T${Date.now()}`;
  const attempt = await prisma.paymentAttempt.create({
    data: { paymentId: payment.id, method: 'MOMO', merchantReference: momoOrderId, amount, status: 'PENDING' },
  });
  return { order, payment, attempt, momoOrderId };
}

async function run() {
  const user = await prisma.user.create({ data: { email: `${marker}@test.local`, passwordHash: 'x', fullName: marker, role: 'USER' } });
  userId = user.id;

  await check('valid success IPN marks Payment PAID (order NOT auto-approved — like VNPAY)', async () => {
    const { order, momoOrderId } = await makeMomoOrder({ amount: 2500000 });
    const r = await handleMomoIpn(ipn({ orderId: momoOrderId, amount: 2500000, resultCode: 0 }));
    assert.equal(r.httpStatus, 204);
    assert.equal(r.outcome, 'paid');
    const p = await prisma.payment.findUnique({ where: { orderId: order.id } });
    const o = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(p.status, 'PAID', 'payment PAID');
    assert.equal(o.status, 'PENDING', 'order stays PENDING (admin approves, same as VNPAY)');
  });

  await check('duplicate success IPN is idempotent', async () => {
    const { order, momoOrderId } = await makeMomoOrder({ amount: 1000000 });
    const body = ipn({ orderId: momoOrderId, amount: 1000000, resultCode: 0, transId: 55551111 });
    await handleMomoIpn(body);
    const r2 = await handleMomoIpn(body);
    assert.equal(r2.httpStatus, 204);
    assert.equal(r2.outcome, 'duplicate_same_attempt');
    const paid = await prisma.paymentAttempt.findMany({ where: { payment: { orderId: order.id }, status: 'PAID' } });
    assert.equal(paid.length, 1, 'exactly one PAID attempt');
  });

  await check('forged signature changes nothing (204 invalid)', async () => {
    const { order, momoOrderId } = await makeMomoOrder({ amount: 500000 });
    const r = await handleMomoIpn(ipn({ orderId: momoOrderId, amount: 500000, resultCode: 0, secret: 'attacker-secret' }));
    assert.equal(r.httpStatus, 204);
    assert.equal(r.invalid, true);
    const p = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.notEqual(p.status, 'PAID');
  });

  await check('tampered amount (valid-looking) fails signature verification', async () => {
    const { order, momoOrderId } = await makeMomoOrder({ amount: 777000 });
    const r = await handleMomoIpn(ipn({ orderId: momoOrderId, amount: 777000, resultCode: 0, tamper: true }));
    assert.equal(r.invalid, true);
    const p = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.notEqual(p.status, 'PAID');
  });

  await check('amount mismatch (correctly signed) is not confirmed', async () => {
    const { order, momoOrderId } = await makeMomoOrder({ amount: 2500000 });
    // Correctly signed for a DIFFERENT amount than the attempt expects.
    const r = await handleMomoIpn(ipn({ orderId: momoOrderId, amount: 2000000, resultCode: 0 }));
    assert.equal(r.httpStatus, 204);
    assert.equal(r.reason, 'amount_mismatch');
    const p = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.notEqual(p.status, 'PAID');
  });

  await check('user-cancel IPN (1006) records CANCELLED on attempt, Payment left for retry', async () => {
    const { order, momoOrderId } = await makeMomoOrder({ amount: 1200000 });
    const r = await handleMomoIpn(ipn({ orderId: momoOrderId, amount: 1200000, resultCode: 1006 }));
    assert.equal(r.httpStatus, 204);
    assert.equal(r.outcome, 'CANCELLED');
    const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference: momoOrderId } });
    assert.equal(attempt.status, 'CANCELLED', 'attempt CANCELLED');
    const p = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.notEqual(p.status, 'PAID');
    assert.notEqual(p.status, 'CANCELLED'); // Payment stays open so customer can retry
  });

  await check('generic failure IPN (1001) records FAILED on attempt', async () => {
    const { momoOrderId } = await makeMomoOrder({ amount: 300000 });
    const r = await handleMomoIpn(ipn({ orderId: momoOrderId, amount: 300000, resultCode: 1001 }));
    assert.equal(r.outcome, 'FAILED');
    const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference: momoOrderId } });
    assert.equal(attempt.status, 'FAILED');
  });

  await check('unknown order IPN is acked 204 without side effects', async () => {
    const r = await handleMomoIpn(ipn({ orderId: 'DMPC999999999T0', amount: 123000, resultCode: 0 }));
    assert.equal(r.httpStatus, 204);
    assert.equal(r.reason, 'unknown_order');
  });

  await check('success IPN after user-cancel on a still-open order still confirms (late success)', async () => {
    const { order, momoOrderId } = await makeMomoOrder({ amount: 900000 });
    await handleMomoIpn(ipn({ orderId: momoOrderId, amount: 900000, resultCode: 1006 })); // cancel first
    const r = await handleMomoIpn(ipn({ orderId: momoOrderId, amount: 900000, resultCode: 0, transId: 42 })); // then success
    assert.equal(r.httpStatus, 204);
    assert.equal(r.outcome, 'late_confirmation_after_terminal');
    const p = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.equal(p.status, 'PAID', 'order still open → late success is applied');
  });
}

async function cleanup() {
  for (const orderId of orderIds) {
    await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.orderStatusHistory.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => {});
  }
  if (userId) await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}

try { await run(); }
catch (e) { failures++; console.error('FATAL', e.stack || e.message); }
finally { await cleanup(); await prisma.$disconnect(); }

console.log(`\nMoMo IPN integration: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
