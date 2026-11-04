// Real MySQL integration test for payment-status SYNC fixes: a signature-
// verified NON-success Return (VNPAY cancel / MoMo cancel) must record the
// attempt as terminal so the UI stops showing "đang xác minh", while the
// Payment is left open for retry and NEVER flipped to PAID from a Return URL.
// (The success path is settled only via the authenticated provider QUERY API —
// verified separately against the real sandbox; it cannot be deterministically
// integration-tested without a real paid transaction, by design: we never
// simulate a success to claim it works.)
//
// Returns are signed with the SAME real secrets the handlers verify, so the
// round-trip is valid whatever the configured values are. Cleans up in finally.
// Run: node tests/paymentReconcile.integration.mjs
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import { handleVnpayReturn, handleMomoReturn, reconcilePaymentByOrder } from '../src/payments/services/payment.service.js';
import { signParams } from '../src/payments/services/vnpayUtil.service.js';
import { signIpn } from '../src/payments/services/momoUtil.service.js';

const VNP_SECRET = process.env.VNPAY_HASH_SECRET || 'TESTSECRET';
const VNP_TMN = process.env.VNPAY_TMN_CODE || 'TESTTMN';
const MOMO_AK = process.env.MOMO_ACCESS_KEY || 'F8BBA842ECF85';
const MOMO_SK = process.env.MOMO_SECRET_KEY || 'K951B6PE1waDMi640xX08PD3vg6EkVlz';
const marker = `recon-test-${randomUUID().slice(0, 8)}`;
const orderIds = [];
let userId;
let failures = 0;

async function check(label, fn) {
  try { await fn(); console.log(`  ok  — ${label}`); }
  catch (e) { failures++; console.error(`  FAIL — ${label}\n        ${e.stack || e.message}`); }
}

async function makeGatewayOrder(method, { amount = 150000, paymentStatus = 'PROCESSING' } = {}) {
  const order = await prisma.order.create({
    data: { userId, status: 'PENDING', paymentMethod: method, shippingName: marker, shippingPhone: '0900000000', shippingAddress: marker, subtotal: amount, discountAmount: 0 },
  });
  orderIds.push(order.id);
  const payment = await prisma.payment.create({ data: { orderId: order.id, method, status: paymentStatus, amount } });
  const merchantReference = method === 'VNPAY' ? `${order.id}${Date.now()}` : `DMPC${order.id}T${Date.now()}`;
  const attempt = await prisma.paymentAttempt.create({ data: { paymentId: payment.id, method, merchantReference, amount, status: 'PENDING' } });
  return { order, payment, attempt, merchantReference, amount };
}

function vnpReturn({ merchantReference, amount, responseCode, transactionStatus }) {
  const q = {
    vnp_Amount: String(amount * 100), vnp_BankCode: 'NCB', vnp_CardType: 'ATM',
    vnp_OrderInfo: `Thanh toan don hang`, vnp_PayDate: '20261025100000',
    vnp_ResponseCode: responseCode, vnp_TmnCode: VNP_TMN, vnp_TransactionNo: '0',
    vnp_TransactionStatus: transactionStatus, vnp_TxnRef: merchantReference,
  };
  q.vnp_SecureHash = signParams(q, VNP_SECRET);
  return q;
}

function momoReturn({ merchantReference, amount, resultCode }) {
  const body = {
    partnerCode: 'MOMO', orderId: merchantReference, requestId: `${merchantReference}-r`, amount,
    orderInfo: 'pay', orderType: 'momo_wallet', transId: 0, resultCode,
    message: 'Cancelled', payType: '', responseTime: Date.now(), extraData: '',
  };
  body.signature = signIpn(body, MOMO_AK, MOMO_SK);
  return body;
}

async function run() {
  const user = await prisma.user.create({ data: { email: `${marker}@test.local`, passwordHash: 'x', fullName: marker, role: 'USER' } });
  userId = user.id;

  await check('VNPAY cancel Return (code 24) marks attempt CANCELLED, Payment left for retry, never PAID', async () => {
    const { order, merchantReference, amount } = await makeGatewayOrder('VNPAY');
    const result = await handleVnpayReturn(vnpReturn({ merchantReference, amount, responseCode: '24', transactionStatus: '02' }));
    assert.equal(result.valid, true, 'return signature valid');
    assert.notEqual(result.paymentStatus, 'PAID');
    assert.equal(result.attemptStatus, 'CANCELLED');
    const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference } });
    assert.equal(attempt.status, 'CANCELLED', 'attempt CANCELLED');
    const p = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.notEqual(p.status, 'PAID');
    assert.notEqual(p.status, 'CANCELLED'); // Payment stays open so customer can retry
  });

  await check('VNPAY failure Return (code 99) marks attempt FAILED', async () => {
    const { merchantReference, amount } = await makeGatewayOrder('VNPAY');
    const result = await handleVnpayReturn(vnpReturn({ merchantReference, amount, responseCode: '99', transactionStatus: '02' }));
    assert.equal(result.attemptStatus, 'FAILED');
    const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference } });
    assert.equal(attempt.status, 'FAILED');
  });

  await check('VNPAY Return with a forged signature changes nothing', async () => {
    const { order, merchantReference, amount } = await makeGatewayOrder('VNPAY');
    const q = vnpReturn({ merchantReference, amount, responseCode: '24', transactionStatus: '02' });
    q.vnp_SecureHash = 'deadbeef';
    const result = await handleVnpayReturn(q);
    assert.equal(result.valid, false);
    assert.equal(result.attemptStatus, null);
    const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference } });
    assert.equal(attempt.status, 'PENDING', 'untouched on invalid signature');
  });

  await check('MoMo cancel Return (1006) marks attempt CANCELLED, Payment left for retry', async () => {
    const { order, merchantReference, amount } = await makeGatewayOrder('MOMO');
    const result = await handleMomoReturn(momoReturn({ merchantReference, amount, resultCode: 1006 }));
    assert.equal(result.valid, true);
    assert.notEqual(result.paymentStatus, 'PAID');
    assert.equal(result.attemptStatus, 'CANCELLED');
    const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference } });
    assert.equal(attempt.status, 'CANCELLED');
    const p = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.notEqual(p.status, 'PAID');
  });

  await check('MoMo Return with forged signature changes nothing', async () => {
    const { merchantReference, amount } = await makeGatewayOrder('MOMO');
    const body = momoReturn({ merchantReference, amount, resultCode: 1006 });
    body.signature = 'f'.repeat(64);
    const result = await handleMomoReturn(body);
    assert.equal(result.valid, false);
    const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference } });
    assert.equal(attempt.status, 'PENDING');
  });

  await check('reconcilePaymentByOrder is a no-op for COD', async () => {
    const order = await prisma.order.create({ data: { userId, status: 'PENDING', paymentMethod: 'COD', shippingName: marker, shippingPhone: '0900000000', shippingAddress: marker, subtotal: 100000, discountAmount: 0 } });
    orderIds.push(order.id);
    await prisma.payment.create({ data: { orderId: order.id, method: 'COD', status: 'PENDING', amount: 100000 } });
    const r = await reconcilePaymentByOrder(order.id, userId);
    assert.equal(r.reconciled, false);
    assert.equal(r.reason, 'not_a_gateway_payment');
  });

  await check('reconcilePaymentByOrder rejects another user\'s order (404)', async () => {
    const { order } = await makeGatewayOrder('VNPAY');
    await assert.rejects(() => reconcilePaymentByOrder(order.id, userId + 999999), /không tồn tại/i);
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

console.log(`\nPayment reconcile integration: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
