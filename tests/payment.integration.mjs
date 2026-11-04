// Real MySQL/InnoDB integration test for the Payment confirmation mechanism —
// NOT a simulation this time (see tests/unit/paymentConfirmation.concurrency.test.mjs
// for the in-memory version). This exercises confirmPaymentAttempt() through a
// genuine `prisma.$transaction(async tx => ...)` against the real
// Payment/PaymentAttempt tables just migrated in, with real concurrent
// requests racing on real row locks. No bank transaction of any kind is
// involved — "verifiedAmount"/"providerTransactionId" are values this test
// supplies directly, exactly as an already-verified IPN handler would.
//
// Runs in an isolated slice of data (one throwaway User + one throwaway
// Order created here) and cleans up everything in `finally`, regardless of
// pass/fail. Never touches the pre-existing 12 real Orders.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import { confirmPaymentAttempt } from '../src/payments/services/paymentConfirmation.service.js';

const marker = `payment-test-${randomUUID().slice(0, 8)}`;
let userId;
const orderIds = [];
let failures = 0;

function check(label, fn) {
  try { fn(); console.log(`  ok  — ${label}`); }
  catch (e) { failures++; console.error(`  FAIL — ${label}\n        ${e.message}`); }
}

async function makeOrderAndPayment({ method = 'MOMO', amount = 100000, orderStatus = 'PENDING' } = {}) {
  const order = await prisma.order.create({
    data: {
      userId, status: orderStatus, paymentMethod: method,
      shippingName: marker, shippingPhone: '0900000000', shippingAddress: marker,
      subtotal: amount, discountAmount: 0,
    },
  });
  orderIds.push(order.id);
  const payment = await prisma.payment.create({
    data: { orderId: order.id, method, status: 'PENDING', amount },
  });
  return { order, payment };
}

async function makeAttempt(paymentId, { method = 'MOMO', amount = 100000, status = 'PENDING', merchantReference } = {}) {
  return prisma.paymentAttempt.create({
    data: { paymentId, method, merchantReference: merchantReference ?? `${marker}-${randomUUID()}`, amount, status },
  });
}

try {
  const user = await prisma.user.create({ data: {
    fullName: marker, email: `${marker}@example.com`,
    phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`,
    passwordHash: 'payment-integration-test', role: 'CUSTOMER', isActive: true,
  } });
  userId = user.id;

  console.log('\n[Real MySQL — single confirmation]');
  {
    const { payment } = await makeOrderAndPayment({ amount: 150000 });
    const attempt = await makeAttempt(payment.id, { amount: 150000 });
    const result = await prisma.$transaction(tx => confirmPaymentAttempt({
      tx, merchantReference: attempt.merchantReference, verifiedAmount: 150000,
      providerTransactionId: `MOMO-${marker}-1`, responsePayload: { ok: true },
    }));
    check('PENDING -> PAID via a real $transaction', () => assert.equal(result.outcome, 'paid'));
    const reread = await prisma.payment.findUnique({ where: { id: payment.id } });
    check('Payment row is PAID in the real database', () => assert.equal(reread.status, 'PAID'));
    const rereadAttempt = await prisma.paymentAttempt.findUnique({ where: { id: attempt.id } });
    check('PaymentAttempt row is PAID in the real database', () => assert.equal(rereadAttempt.status, 'PAID'));
  }

  console.log('\n[Real MySQL — unique constraint enforcement at the DB level]');
  {
    const { payment } = await makeOrderAndPayment({ method: 'VNPAY', amount: 50000 });
    await makeAttempt(payment.id, { method: 'VNPAY', amount: 50000, merchantReference: `${marker}-dupref` });
    let dbRejected = false;
    try {
      await makeAttempt(payment.id, { method: 'VNPAY', amount: 50000, merchantReference: `${marker}-dupref` });
    } catch (e) {
      dbRejected = e.code === 'P2002'; // Prisma unique constraint violation
    }
    check('duplicate merchantReference is rejected by the real UNIQUE constraint (P2002), not just app logic', () => assert.equal(dbRejected, true));
  }
  {
    const { payment: p1 } = await makeOrderAndPayment({ method: 'MOMO', amount: 10000 });
    const { payment: p2 } = await makeOrderAndPayment({ method: 'MOMO', amount: 10000 });
    const a1 = await makeAttempt(p1.id, { method: 'MOMO', amount: 10000, status: 'PROCESSING' });
    await prisma.paymentAttempt.update({ where: { id: a1.id }, data: { providerTransactionId: `${marker}-sharedTxId` } });
    const a2 = await makeAttempt(p2.id, { method: 'MOMO', amount: 10000, status: 'PROCESSING' });
    let dbRejected = false;
    try {
      await prisma.paymentAttempt.update({ where: { id: a2.id }, data: { providerTransactionId: `${marker}-sharedTxId` } });
    } catch (e) {
      dbRejected = e.code === 'P2002';
    }
    check('the same providerTransactionId for the same method cannot be recorded twice, enforced by the real compound UNIQUE index', () => assert.equal(dbRejected, true));
  }

  console.log('\n[Real MySQL — true concurrent $transaction race on the same Payment]');
  {
    const { payment } = await makeOrderAndPayment({ amount: 200000 });
    const a1 = await makeAttempt(payment.id, { amount: 200000 });
    const a2 = await makeAttempt(payment.id, { amount: 200000 });

    const [r1, r2] = await Promise.all([
      prisma.$transaction(tx => confirmPaymentAttempt({ tx, merchantReference: a1.merchantReference, verifiedAmount: 200000, providerTransactionId: `${marker}-R1`, responsePayload: {} })),
      prisma.$transaction(tx => confirmPaymentAttempt({ tx, merchantReference: a2.merchantReference, verifiedAmount: 200000, providerTransactionId: `${marker}-R2`, responsePayload: {} })),
    ]);
    const outcomes = [r1.outcome, r2.outcome].sort();
    check('exactly one of two real concurrent $transaction calls wins PAID, the other is flagged for reconciliation', () => assert.deepEqual(outcomes, ['duplicate_different_attempt', 'paid']));

    const finalPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    check('Payment ends up PAID exactly once (no double-write, no inconsistent state)', () => assert.equal(finalPayment.status, 'PAID'));
    const attempts = await prisma.paymentAttempt.findMany({ where: { paymentId: payment.id } });
    const paidAttempts = attempts.filter(a => a.status === 'PAID');
    check('exactly one PaymentAttempt row ended up PAID', () => assert.equal(paidAttempts.length, 1));
    const loser = attempts.find(a => a.status !== 'PAID');
    check("the losing attempt's real confirmation evidence (paidAt, providerTransactionId) was preserved, not discarded", () => {
      assert.ok(loser.paidAt);
      assert.match(loser.errorMessage ?? '', /DUPLICATE_PAID_CONFIRMATION/);
    });
  }

  console.log('\n[Real MySQL — duplicate IPN redelivery is idempotent]');
  {
    const { payment } = await makeOrderAndPayment({ amount: 75000 });
    const attempt = await makeAttempt(payment.id, { amount: 75000 });
    const confirm = () => prisma.$transaction(tx => confirmPaymentAttempt({ tx, merchantReference: attempt.merchantReference, verifiedAmount: 75000, providerTransactionId: `${marker}-IDEM`, responsePayload: {} }));
    const first = await confirm();
    const second = await confirm();
    const third = await confirm();
    check('first call pays', () => assert.equal(first.outcome, 'paid'));
    check('redelivered IPNs are idempotent no-ops', () => { assert.equal(second.outcome, 'duplicate_same_attempt'); assert.equal(third.outcome, 'duplicate_same_attempt'); });
  }

  console.log('\n[Real MySQL — late callback after FAILED, gated by Order status]');
  {
    const { order, payment } = await makeOrderAndPayment({ amount: 60000, orderStatus: 'PENDING' });
    const attempt = await makeAttempt(payment.id, { amount: 60000, status: 'FAILED' });
    const liveOrder = await prisma.order.findUnique({ where: { id: order.id }, select: { status: true } });
    const result = await prisma.$transaction(tx => confirmPaymentAttempt({
      tx, merchantReference: attempt.merchantReference, verifiedAmount: 60000,
      providerTransactionId: `${marker}-LATE`, responsePayload: {}, orderStatus: liveOrder.status,
    }));
    check('late confirmation after FAILED auto-pays when the real Order is still open', () => assert.equal(result.outcome, 'late_confirmation_after_terminal'));
    const finalPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    check('Payment is PAID from the late evidence', () => assert.equal(finalPayment.status, 'PAID'));
    const finalAttempt = await prisma.paymentAttempt.findUnique({ where: { id: attempt.id } });
    check("the attempt's own status stays FAILED (state machine honored even for the winning late callback)", () => assert.equal(finalAttempt.status, 'FAILED'));
  }
  {
    const { order, payment } = await makeOrderAndPayment({ amount: 60000, orderStatus: 'PENDING' });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    const attempt = await makeAttempt(payment.id, { amount: 60000, status: 'EXPIRED' });
    const result = await prisma.$transaction(tx => confirmPaymentAttempt({
      tx, merchantReference: attempt.merchantReference, verifiedAmount: 60000,
      providerTransactionId: `${marker}-LATE-CANCELLED`, responsePayload: {}, orderStatus: 'CANCELLED',
    }));
    check('late confirmation after a CANCELLED order is held for manual review, not auto-paid', () => assert.equal(result.outcome, 'late_confirmation_needs_review'));
    const finalPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    check('Payment stays PENDING — never silently flipped to PAID for a cancelled order', () => assert.equal(finalPayment.status, 'PENDING'));
  }

  console.log('\n[Real MySQL — wrong amount and REFUNDED state are rejected]');
  {
    const { payment } = await makeOrderAndPayment({ amount: 40000 });
    const attempt = await makeAttempt(payment.id, { amount: 40000 });
    const result = await prisma.$transaction(tx => confirmPaymentAttempt({ tx, merchantReference: attempt.merchantReference, verifiedAmount: 39999, providerTransactionId: 'x', responsePayload: {} }));
    check('wrong amount is rejected against the real row', () => assert.equal(result.outcome, 'amount_mismatch'));
    const finalPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    check('Payment untouched', () => assert.equal(finalPayment.status, 'PENDING'));
  }
  {
    const { payment } = await makeOrderAndPayment({ amount: 1000 });
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED', paidAt: new Date() } });
    const attempt = await makeAttempt(payment.id, { amount: 1000 });
    const result = await prisma.$transaction(tx => confirmPaymentAttempt({ tx, merchantReference: attempt.merchantReference, verifiedAmount: 1000, providerTransactionId: 'y', responsePayload: {} }));
    check('a PAID confirmation against a REFUNDED Payment is rejected, not un-refunded', () => assert.equal(result.outcome, 'payment_state_conflict'));
    const finalPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    check('Payment stays REFUNDED', () => assert.equal(finalPayment.status, 'REFUNDED'));
  }

  console.log('\n[Real MySQL — Restrict FK protects transaction history]');
  {
    const { order, payment } = await makeOrderAndPayment({ amount: 5000 });
    await makeAttempt(payment.id, { amount: 5000 });
    let restricted = false;
    try { await prisma.order.delete({ where: { id: order.id } }); }
    catch (e) { restricted = e.code === 'P2003' || /foreign key constraint/i.test(e.message); }
    check('deleting an Order with a Payment is blocked by the RESTRICT foreign key', () => assert.equal(restricted, true));
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
} finally {
  // Teardown — only ever touches rows this run created.
  if (orderIds.length) {
    await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId: { in: orderIds } } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
  if (failures > 0) process.exitCode = 1;
}
