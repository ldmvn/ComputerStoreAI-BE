// Real MySQL/InnoDB integration test for:
//  1. The centralized "payment-before-fulfillment" guard in
//     adminOrder.service.js's updateOrderStatus() — BANK_TRANSFER/MOMO/VNPAY
//     must be PAID before CONFIRMED/SHIPPING; COD is exempt.
//  2. adminConfirmPaymentAndApprove() — the merged VietQR "Xác nhận tiền &
//     duyệt đơn" action — including real concurrent-request racing against
//     real row locks (not a simulation).
//
// Runs in an isolated slice of data (throwaway User + Orders created here)
// and cleans up everything in `finally`, regardless of pass/fail. Never
// touches pre-existing real Orders. No real bank/MoMo/VNPAY transaction of
// any kind — amounts/references are test-supplied the same way an
// already-verified IPN handler would supply them.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import { updateOrderStatus } from '../src/services/adminOrder.service.js';
import { adminConfirmPaymentAndApprove } from '../src/payments/services/payment.service.js';

const marker = `approval-guard-${randomUUID().slice(0, 8)}`;
let userId, adminUserId;
const orderIds = [];
let failures = 0;

function check(label, fn) {
  try { fn(); console.log(`  ok  — ${label}`); }
  catch (e) { failures++; console.error(`  FAIL — ${label}\n        ${e.message}`); }
}
async function checkAsync(label, fn) {
  try { await fn(); console.log(`  ok  — ${label}`); }
  catch (e) { failures++; console.error(`  FAIL — ${label}\n        ${e.message}`); }
}

async function makeOrder({ method, orderStatus = 'PENDING', amount = 150000 }) {
  const order = await prisma.order.create({
    data: {
      userId, status: orderStatus, paymentMethod: method,
      shippingName: marker, shippingPhone: '0900000000', shippingAddress: marker,
      subtotal: amount, discountAmount: 0,
    },
  });
  orderIds.push(order.id);
  return order;
}

async function makePayment(orderId, { method, status = 'PENDING', amount = 150000 }) {
  return prisma.payment.create({ data: { orderId, method, status, amount } });
}

async function makeAttempt(paymentId, { method = 'BANK_TRANSFER', amount = 150000, status = 'PENDING', merchantReference } = {}) {
  return prisma.paymentAttempt.create({
    data: {
      paymentId, method, amount, status,
      merchantReference: merchantReference ?? `${marker}-${randomUUID()}`,
      bankBin: '970422', bankName: 'MB Bank', bankAccountNumber: '0386220065', bankAccountName: 'LUU DUC MANH',
      transferContent: `${marker}-content`,
    },
  });
}

try {
  const user = await prisma.user.create({ data: {
    fullName: marker, email: `${marker}-customer@example.com`,
    phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`,
    passwordHash: 'test', role: 'CUSTOMER', isActive: true,
  } });
  userId = user.id;
  const admin = await prisma.user.create({ data: {
    fullName: marker, email: `${marker}-admin@example.com`,
    phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`,
    passwordHash: 'test', role: 'ADMIN', isActive: true,
  } });
  adminUserId = admin.id;

  console.log('\n[Guard — BANK_TRANSFER/MOMO/VNPAY must be PAID before CONFIRMED/SHIPPING; COD is exempt]');
  {
    // [#9] MoMo unpaid → blocked at CONFIRMED.
    const momoOrder = await makeOrder({ method: 'MOMO' });
    await makePayment(momoOrder.id, { method: 'MOMO', status: 'PENDING' });
    await checkAsync('[#9] MoMo PENDING payment blocks CONFIRMED at the Backend', async () => {
      await assert.rejects(
        () => updateOrderStatus(momoOrder.id, { status: 'CONFIRMED' }, adminUserId),
        (e) => e.statusCode === 409 && e.code === 'PAYMENT_NOT_CONFIRMED',
      );
    });

    // [#10] MoMo PAID → allowed.
    const momoPaidOrder = await makeOrder({ method: 'MOMO' });
    await makePayment(momoPaidOrder.id, { method: 'MOMO', status: 'PAID' });
    await checkAsync('[#10] MoMo PAID payment allows CONFIRMED at the Backend', async () => {
      const updated = await updateOrderStatus(momoPaidOrder.id, { status: 'CONFIRMED' }, adminUserId);
      assert.equal(updated.status, 'CONFIRMED');
    });

    // VNPAY unpaid → blocked at SHIPPING too (order already CONFIRMED).
    const vnpayOrder = await makeOrder({ method: 'VNPAY', orderStatus: 'CONFIRMED' });
    await makePayment(vnpayOrder.id, { method: 'VNPAY', status: 'PENDING' });
    await checkAsync('VNPAY unpaid order blocks SHIPPING too (not just CONFIRMED)', async () => {
      await assert.rejects(
        () => updateOrderStatus(vnpayOrder.id, { status: 'SHIPPING' }, adminUserId),
        (e) => e.statusCode === 409 && e.code === 'PAYMENT_NOT_CONFIRMED',
      );
    });

    // [#11] COD unpaid → still allowed to be approved and shipped (exempt).
    const codOrder = await makeOrder({ method: 'COD' });
    await makePayment(codOrder.id, { method: 'COD', status: 'PENDING' });
    await checkAsync('[#11] COD PENDING payment does NOT block CONFIRMED (exempt)', async () => {
      const updated = await updateOrderStatus(codOrder.id, { status: 'CONFIRMED' }, adminUserId);
      assert.equal(updated.status, 'CONFIRMED');
    });
    await checkAsync('[#11] COD PENDING payment does NOT block SHIPPING either (exempt)', async () => {
      const updated = await updateOrderStatus(codOrder.id, { status: 'SHIPPING' }, adminUserId);
      assert.equal(updated.status, 'SHIPPING');
    });

    // [#13] CANCELLED order rejects any further status transition attempt.
    const cancelOrder = await makeOrder({ method: 'BANK_TRANSFER', orderStatus: 'CANCELLED' });
    await makePayment(cancelOrder.id, { method: 'BANK_TRANSFER', status: 'CANCELLED' });
    await checkAsync('[#13] CANCELLED order rejects a status transition attempt', async () => {
      await assert.rejects(() => updateOrderStatus(cancelOrder.id, { status: 'CONFIRMED' }, adminUserId));
    });
  }

  console.log('\n[adminConfirmPaymentAndApprove — merged VietQR "Xác nhận tiền & duyệt đơn"]');
  {
    // [#1] PENDING + Payment PENDING → PAID + CONFIRMED, one transaction.
    const order1 = await makeOrder({ method: 'BANK_TRANSFER' });
    const payment1 = await makePayment(order1.id, { method: 'BANK_TRANSFER', status: 'PENDING' });
    const attempt1 = await makeAttempt(payment1.id, { status: 'PENDING' });
    await checkAsync('[#1] VietQR PENDING + Payment PENDING → outcome "paid" and Order CONFIRMED', async () => {
      const result = await adminConfirmPaymentAndApprove(order1.id, adminUserId);
      assert.equal(result.outcome, 'paid');
      assert.equal(result.orderApproved, true);
      const freshPayment = await prisma.payment.findUnique({ where: { id: payment1.id } });
      const freshAttempt = await prisma.paymentAttempt.findUnique({ where: { id: attempt1.id } });
      const freshOrder = await prisma.order.findUnique({ where: { id: order1.id } });
      assert.equal(freshPayment.status, 'PAID');
      assert.equal(freshAttempt.status, 'PAID');
      assert.equal(freshOrder.status, 'CONFIRMED');
      assert.ok(freshOrder.confirmedAt);
    });

    // [#2] AWAITING_VERIFICATION → merged confirm succeeds.
    const order2 = await makeOrder({ method: 'BANK_TRANSFER' });
    const payment2 = await makePayment(order2.id, { method: 'BANK_TRANSFER', status: 'AWAITING_VERIFICATION' });
    await makeAttempt(payment2.id, { status: 'AWAITING_VERIFICATION' });
    await checkAsync('[#2] AWAITING_VERIFICATION → merged confirm succeeds (PAID + CONFIRMED)', async () => {
      const result = await adminConfirmPaymentAndApprove(order2.id, adminUserId);
      assert.equal(result.outcome, 'paid');
      assert.equal(result.orderApproved, true);
    });

    // [#7] Already PAID + Order still PENDING → only approves, does not re-confirm.
    const order3 = await makeOrder({ method: 'BANK_TRANSFER' });
    const payment3 = await makePayment(order3.id, { method: 'BANK_TRANSFER', status: 'PAID' });
    await makeAttempt(payment3.id, { status: 'PAID' });
    await checkAsync('[#7] VietQR already PAID + Order PENDING → merge endpoint just approves (idempotent on payment)', async () => {
      const result = await adminConfirmPaymentAndApprove(order3.id, adminUserId);
      assert.equal(result.outcome, 'duplicate_same_attempt');
      assert.equal(result.orderApproved, true);
      const freshOrder = await prisma.order.findUnique({ where: { id: order3.id } });
      assert.equal(freshOrder.status, 'CONFIRMED');
    });

    // [#8] Order already past PENDING (legacy, never paid) → merge endpoint refuses; use standalone confirm instead.
    const order4 = await makeOrder({ method: 'BANK_TRANSFER', orderStatus: 'DELIVERED' });
    const payment4 = await makePayment(order4.id, { method: 'BANK_TRANSFER', status: 'PENDING' });
    await makeAttempt(payment4.id, { status: 'PENDING' });
    await checkAsync('[#8] Order already DELIVERED (legacy unpaid) → merge endpoint rejects with 409, Order Status untouched', async () => {
      await assert.rejects(
        () => adminConfirmPaymentAndApprove(order4.id, adminUserId),
        (e) => e.statusCode === 409,
      );
      const freshOrder = await prisma.order.findUnique({ where: { id: order4.id } });
      assert.equal(freshOrder.status, 'DELIVERED'); // never silently moved
    });

    // [#13] CANCELLED order → backend must refuse the merge action outright.
    const order5 = await makeOrder({ method: 'BANK_TRANSFER', orderStatus: 'CANCELLED' });
    const payment5 = await makePayment(order5.id, { method: 'BANK_TRANSFER', status: 'CANCELLED' });
    await makeAttempt(payment5.id, { status: 'CANCELLED' });
    await checkAsync('[#13] CANCELLED order → merge endpoint rejects (409, not PENDING)', async () => {
      await assert.rejects(() => adminConfirmPaymentAndApprove(order5.id, adminUserId), (e) => e.statusCode === 409);
    });

    // [#6] Invalid Payment state (REFUNDED) → merge endpoint must not approve the order.
    const order6 = await makeOrder({ method: 'BANK_TRANSFER' });
    const payment6 = await makePayment(order6.id, { method: 'BANK_TRANSFER', status: 'PENDING' });
    const attempt6 = await makeAttempt(payment6.id, { status: 'PENDING' });
    // Force the Payment into REFUNDED directly at the DB level (simulating a
    // payment that was refunded through a channel outside this test's
    // control) — the merge action must detect this via confirmPaymentAttempt()
    // and refuse to approve, rather than approving on top of a bad payment state.
    await prisma.payment.update({ where: { id: payment6.id }, data: { status: 'REFUNDED' } });
    await checkAsync('[#6] Invalid Payment state (REFUNDED) → Order is NOT approved', async () => {
      const result = await adminConfirmPaymentAndApprove(order6.id, adminUserId);
      assert.equal(result.outcome, 'payment_state_conflict');
      assert.equal(result.orderApproved, false);
      const freshOrder = await prisma.order.findUnique({ where: { id: order6.id } });
      assert.equal(freshOrder.status, 'PENDING'); // untouched
    });

    // [#4] Two Admins click the merge button at the same time — must resolve
    // to exactly one real PAID+CONFIRMED, never a double-write.
    const order7 = await makeOrder({ method: 'BANK_TRANSFER' });
    const payment7 = await makePayment(order7.id, { method: 'BANK_TRANSFER', status: 'PENDING' });
    await makeAttempt(payment7.id, { status: 'PENDING' });
    await checkAsync('[#4] Two concurrent "confirm & approve" requests resolve to exactly one real approval, no duplicate', async () => {
      const [r1, r2] = await Promise.all([
        adminConfirmPaymentAndApprove(order7.id, adminUserId),
        adminConfirmPaymentAndApprove(order7.id, adminUserId),
      ]);
      const approvedCount = [r1, r2].filter(r => r.orderApproved).length;
      assert.equal(approvedCount, 1, `expected exactly 1 orderApproved, got ${approvedCount} (${JSON.stringify([r1, r2])})`);
      const freshOrder = await prisma.order.findUnique({ where: { id: order7.id } });
      const freshPayment = await prisma.payment.findUnique({ where: { id: payment7.id } });
      assert.equal(freshOrder.status, 'CONFIRMED');
      assert.equal(freshPayment.status, 'PAID');

      // Re-running the whole sequence many times catches intermittent races
      // that a single trial could miss — same methodology as the existing
      // in-memory concurrency unit tests, but against real row locks.
    });

    // Run the same race 10 more times on fresh orders to shake out
    // intermittent timing-dependent bugs (mirrors the "run many trials"
    // methodology in tests/unit/paymentConfirmation.concurrency.test.mjs).
    for (let i = 0; i < 10; i++) {
      const o = await makeOrder({ method: 'BANK_TRANSFER' });
      const p = await makePayment(o.id, { method: 'BANK_TRANSFER', status: 'PENDING' });
      await makeAttempt(p.id, { status: 'PENDING' });
      const [ra, rb] = await Promise.all([
        adminConfirmPaymentAndApprove(o.id, adminUserId),
        adminConfirmPaymentAndApprove(o.id, adminUserId),
      ]);
      const approvedCount = [ra, rb].filter(r => r.orderApproved).length;
      check(`[#4 trial ${i + 1}/10] exactly one approval`, () => assert.equal(approvedCount, 1));
    }
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
} finally {
  for (const id of orderIds) {
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: id } }).catch(() => {});
    await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId: id } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { orderId: id } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { orderId: id } }).catch(() => {});
    await prisma.order.delete({ where: { id } }).catch(() => {});
  }
  if (adminUserId) await prisma.activityLog.deleteMany({ where: { userId: adminUserId } }).catch(() => {});
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  if (adminUserId) await prisma.user.delete({ where: { id: adminUserId } }).catch(() => {});
  await prisma.$disconnect();
  if (failures > 0) process.exitCode = 1;
}
