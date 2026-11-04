// Real MySQL/InnoDB integration test for the SePay VietQR auto-confirmation
// flow — exercises handleSepayWebhook() end to end (signature verify → match →
// confirmPaymentAttempt → auto-approve) against the real Payment/PaymentAttempt/
// Order tables, with a genuine HMAC signature. No real bank/SePay network call
// is involved — the webhook body + signature are crafted here exactly as SePay
// would send them. Runs in a throwaway data slice and cleans up in `finally`.
//
// Run: node tests/sepay.integration.mjs   (needs DATABASE_URL + migrations)
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import { getBankConfig } from '../src/payments/services/payment.service.js';

// Fix the webhook secret for deterministic signing regardless of .env.
process.env.SEPAY_WEBHOOK_SECRET = 'whsec_integration_test_secret';
const { handleSepayWebhook } = await import('../src/payments/services/sepayWebhook.service.js');

const marker = `sepay-test-${randomUUID().slice(0, 8)}`;
const orderIds = [];
let userId;
let failures = 0;

async function check(label, fn) {
  try { await fn(); console.log(`  ok  — ${label}`); }
  catch (e) { failures++; console.error(`  FAIL — ${label}\n        ${e.stack || e.message}`); }
}

function signedWebhook({ sepayId, orderId, amount, accountNumber, transferType = 'in', secretOverride, tsOverride }) {
  const body = {
    id: sepayId, gateway: 'MBBank', transactionDate: '2026-10-25 10:00:00',
    accountNumber, subAccount: '', code: `DH${orderId}`,
    content: `DUCMANHPC DH${orderId}`, transferType,
    description: `${marker} chuyen tien`, transferAmount: amount,
    accumulated: 0, referenceCode: `FT${sepayId}`,
  };
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  const ts = tsOverride ?? Math.floor(Date.now() / 1000);
  const message = Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), rawBody]);
  const sig = 'sha256=' + createHmac('sha256', secretOverride ?? process.env.SEPAY_WEBHOOK_SECRET).update(message).digest('hex');
  return { rawBody, body, signatureHeader: sig, timestampHeader: String(ts) };
}

async function makeBankTransferOrder({ amount = 7290000, status = 'PENDING' } = {}) {
  const order = await prisma.order.create({
    data: {
      userId, status, paymentMethod: 'BANK_TRANSFER',
      shippingName: marker, shippingPhone: '0900000000', shippingAddress: marker,
      subtotal: amount, discountAmount: 0,
    },
  });
  orderIds.push(order.id);
  const bank = await getBankConfig();
  const payment = await prisma.payment.create({ data: { orderId: order.id, method: 'BANK_TRANSFER', status: 'PENDING', amount } });
  const attempt = await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id, method: 'BANK_TRANSFER',
      merchantReference: `BT-${order.id}-${randomUUID().slice(0, 8)}`,
      amount, status: 'PENDING',
      bankBin: bank.bin, bankName: 'MB Bank', bankAccountNumber: bank.accountNumber,
      bankAccountName: bank.accountName, transferContent: `DUCMANHPC DH${order.id}`,
    },
  });
  return { order, payment, attempt, bank };
}

const uid = () => Math.floor(Math.random() * 1e9) + Date.now() % 1e6;

async function run() {
  const user = await prisma.user.create({
    data: { email: `${marker}@test.local`, passwordHash: 'x', fullName: marker, role: 'USER' },
  });
  userId = user.id;

  // ── 1. Happy path: valid transfer → Payment PAID + Order auto-approved ──────
  await check('valid transfer confirms Payment PAID and auto-approves PENDING order', async () => {
    const { order, bank } = await makeBankTransferOrder({ amount: 7290000 });
    const wh = signedWebhook({ sepayId: String(uid()), orderId: order.id, amount: 7290000, accountNumber: bank.accountNumber });
    const r = await handleSepayWebhook({ ...wh });
    assert.equal(r.httpStatus, 200, 'acks 200');
    assert.equal(r.ack.success, true);
    assert.equal(r.telegram.type, 'confirmed');
    assert.equal(r.telegram.payload.orderApproved, true);
    const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
    const freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(payment.status, 'PAID', 'payment PAID');
    assert.equal(freshOrder.status, 'CONFIRMED', 'order auto-approved');
    assert.ok(freshOrder.confirmedAt, 'confirmedAt set');
  });

  // ── 2. Idempotent redelivery: same SePay id twice → single PAID, no alert ───
  await check('duplicate redelivery (same SePay id) is an idempotent no-op', async () => {
    const { order, bank } = await makeBankTransferOrder({ amount: 1000000 });
    const sepayId = String(uid());
    const wh = signedWebhook({ sepayId, orderId: order.id, amount: 1000000, accountNumber: bank.accountNumber });
    const first = await handleSepayWebhook({ ...wh });
    assert.equal(first.telegram.type, 'confirmed');
    // Re-sign with a fresh timestamp (same id/body) — a real redelivery.
    const wh2 = signedWebhook({ sepayId, orderId: order.id, amount: 1000000, accountNumber: bank.accountNumber });
    const second = await handleSepayWebhook({ ...wh2 });
    assert.equal(second.httpStatus, 200);
    assert.equal(second.ack.success, true);
    assert.ok(!second.telegram, 'no reconciliation alert on benign redelivery');
    const attempts = await prisma.paymentAttempt.findMany({ where: { payment: { orderId: order.id }, status: 'PAID' } });
    assert.equal(attempts.length, 1, 'exactly one PAID attempt');
  });

  // ── 3. Forged signature is rejected (401), nothing is confirmed ─────────────
  await check('forged signature is rejected and confirms nothing', async () => {
    const { order, bank } = await makeBankTransferOrder({ amount: 500000 });
    const wh = signedWebhook({ sepayId: String(uid()), orderId: order.id, amount: 500000, accountNumber: bank.accountNumber, secretOverride: 'attacker-secret' });
    const r = await handleSepayWebhook({ ...wh });
    assert.equal(r.httpStatus, 401, 'rejected 401');
    assert.ok(!r.telegram);
    const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.equal(payment.status, 'PENDING', 'payment untouched');
  });

  // ── 4. Replay (stale timestamp) is rejected ─────────────────────────────────
  await check('replayed (stale timestamp) webhook is rejected', async () => {
    const { order, bank } = await makeBankTransferOrder({ amount: 500000 });
    const stale = Math.floor(Date.now() / 1000) - 600;
    const wh = signedWebhook({ sepayId: String(uid()), orderId: order.id, amount: 500000, accountNumber: bank.accountNumber, tsOverride: stale });
    const r = await handleSepayWebhook({ ...wh });
    assert.equal(r.httpStatus, 401);
    const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.equal(payment.status, 'PENDING');
  });

  // ── 5. Amount mismatch → NOT paid, flagged for manual reconciliation ────────
  await check('amount mismatch is not confirmed and is flagged for reconciliation', async () => {
    const { order, bank } = await makeBankTransferOrder({ amount: 7290000 });
    const wh = signedWebhook({ sepayId: String(uid()), orderId: order.id, amount: 7000000, accountNumber: bank.accountNumber }); // underpaid
    const r = await handleSepayWebhook({ ...wh });
    assert.equal(r.httpStatus, 200);
    assert.equal(r.ack.success, false);
    assert.equal(r.telegram.type, 'reconcile');
    assert.match(r.telegram.payload.reason, /Sai số tiền/);
    const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
    const freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(payment.status, 'PENDING', 'payment NOT paid');
    assert.equal(freshOrder.status, 'PENDING', 'order NOT approved');
  });

  // ── 6. Second distinct transfer onto an already-paid order → refund alert ───
  await check('a second distinct transfer onto a paid order is flagged (double pay)', async () => {
    const { order, bank } = await makeBankTransferOrder({ amount: 2000000 });
    const firstPay = signedWebhook({ sepayId: String(uid()), orderId: order.id, amount: 2000000, accountNumber: bank.accountNumber });
    await handleSepayWebhook({ ...firstPay });
    const secondPay = signedWebhook({ sepayId: String(uid()), orderId: order.id, amount: 2000000, accountNumber: bank.accountNumber }); // different id
    const r = await handleSepayWebhook({ ...secondPay });
    assert.equal(r.httpStatus, 200);
    assert.equal(r.telegram.type, 'reconcile', 'double payment flagged');
    assert.match(r.telegram.payload.reason, /trùng|dư tiền|đã thanh toán/i);
  });

  // ── 7. Unknown order code → reconciliation ──────────────────────────────────
  await check('transfer for a non-existent order is flagged for reconciliation', async () => {
    const wh = signedWebhook({ sepayId: String(uid()), orderId: 999999999, amount: 123000, accountNumber: (await getBankConfig()).accountNumber });
    const r = await handleSepayWebhook({ ...wh });
    assert.equal(r.httpStatus, 200);
    assert.equal(r.telegram.type, 'reconcile');
  });

  // ── 8. Cancelled order that receives money → NOT revived, flagged ───────────
  await check('money arriving for a cancelled order is not revived and is flagged', async () => {
    const { order, bank } = await makeBankTransferOrder({ amount: 800000, status: 'PENDING' });
    // Move attempt+payment+order to a cancelled state first.
    await prisma.paymentAttempt.updateMany({ where: { payment: { orderId: order.id } }, data: { status: 'CANCELLED' } });
    await prisma.payment.update({ where: { orderId: order.id }, data: { status: 'CANCELLED' } });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    const wh = signedWebhook({ sepayId: String(uid()), orderId: order.id, amount: 800000, accountNumber: bank.accountNumber });
    const r = await handleSepayWebhook({ ...wh });
    assert.equal(r.httpStatus, 200);
    assert.equal(r.telegram.type, 'reconcile', 'cancelled-order money flagged');
    const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.equal(payment.status, 'CANCELLED', 'payment stays CANCELLED, not revived');
    const freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(freshOrder.status, 'CANCELLED', 'order stays CANCELLED');
  });

  // ── 9. Wrong receiving account → ignored (not our money) ────────────────────
  await check('transfer to a different account is ignored', async () => {
    const { order } = await makeBankTransferOrder({ amount: 300000 });
    const wh = signedWebhook({ sepayId: String(uid()), orderId: order.id, amount: 300000, accountNumber: '0000000000' });
    const r = await handleSepayWebhook({ ...wh });
    assert.equal(r.httpStatus, 200);
    assert.ok(!r.telegram, 'not an anomaly — just not ours');
    const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.equal(payment.status, 'PENDING');
  });

  // ── 10. Race: two concurrent identical deliveries → exactly one PAID ────────
  await check('two concurrent identical webhooks settle exactly once (race-safe)', async () => {
    const { order, bank } = await makeBankTransferOrder({ amount: 4500000 });
    const sepayId = String(uid());
    const a = signedWebhook({ sepayId, orderId: order.id, amount: 4500000, accountNumber: bank.accountNumber });
    const b = signedWebhook({ sepayId, orderId: order.id, amount: 4500000, accountNumber: bank.accountNumber });
    const [ra, rb] = await Promise.all([handleSepayWebhook({ ...a }), handleSepayWebhook({ ...b })]);
    assert.equal(ra.httpStatus, 200); assert.equal(rb.httpStatus, 200);
    // Neither should raise a false double-payment alert.
    const alerts = [ra, rb].filter(r => r.telegram?.type === 'reconcile');
    assert.equal(alerts.length, 0, 'no false reconciliation alert on identical race');
    const paidAttempts = await prisma.paymentAttempt.findMany({ where: { payment: { orderId: order.id }, status: 'PAID' } });
    assert.equal(paidAttempts.length, 1, 'exactly one PAID attempt after race');
    const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
    assert.equal(payment.status, 'PAID');
  });
}

async function cleanup() {
  // Order of deletion respects FK restrictions (attempts → payment → order).
  for (const orderId of orderIds) {
    await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.orderStatusHistory.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => {});
  }
  if (userId) await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}

try {
  await run();
} catch (e) {
  failures++;
  console.error('FATAL', e.stack || e.message);
} finally {
  await cleanup();
  await prisma.$disconnect();
}

console.log(`\nSePay webhook integration: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
