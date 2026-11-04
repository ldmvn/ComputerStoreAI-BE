// Real MySQL/InnoDB integration test for the VNPAY payment service
// functions — createVnpayPaymentUrl(), handleVnpayIpn(), handleVnpayReturn().
//
// IPN/Return requests are simulated by building a query object the EXACT
// same way VNPAY's own gateway would — signed with the REAL
// VNPAY_HASH_SECRET from backend/.env via vnpayUtil.service.js's own
// signParams() — so this genuinely exercises the signature-verification
// code path end-to-end. It does NOT drive VNPAY's actual hosted payment
// page (that requires a real browser + their sandbox test card — see
// tests/e2e/vnpayFlow.playwright.mjs for that). This test proves the
// callback-handling logic is correct; it is not a substitute for a real
// Sandbox checkout.
//
// Runs in an isolated slice of data (throwaway User + Orders created here)
// and cleans up everything in `finally`, regardless of pass/fail.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import { createVnpayPaymentUrl, handleVnpayIpn, handleVnpayReturn } from '../src/payments/services/payment.service.js';
import { signParams, vnpAmountToVnd } from '../src/payments/services/vnpayUtil.service.js';

const HASH_SECRET = process.env.VNPAY_HASH_SECRET;
if (!HASH_SECRET) throw new Error('VNPAY_HASH_SECRET not set — cannot run this test.');

const marker = `vnpay-test-${randomUUID().slice(0, 8)}`;
let userId;
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

async function makeVnpayOrder(amount = 150000) {
  const order = await prisma.order.create({
    data: {
      userId, status: 'PENDING', paymentMethod: 'VNPAY',
      shippingName: marker, shippingPhone: '0900000000', shippingAddress: marker,
      subtotal: amount, discountAmount: 0,
    },
  });
  orderIds.push(order.id);
  await prisma.payment.create({ data: { orderId: order.id, method: 'VNPAY', status: 'PENDING', amount } });
  return order;
}

// Builds a query object shaped exactly like what VNPAY sends back on
// IPN/Return, correctly signed with the real Hash Secret — simulating a
// genuine VNPAY callback for a given attempt.
function signedCallback(merchantReference, amountVnd, { responseCode = '00', transactionStatus = '00', transactionNo = `${Date.now()}` } = {}) {
  const params = {
    vnp_Amount: String(amountVnd * 100),
    vnp_BankCode: 'NCB',
    vnp_OrderInfo: 'test',
    vnp_PayDate: '20260101120000',
    vnp_ResponseCode: responseCode,
    vnp_TmnCode: process.env.VNPAY_TMN_CODE,
    vnp_TransactionNo: transactionNo,
    vnp_TransactionStatus: transactionStatus,
    vnp_TxnRef: merchantReference,
  };
  const hash = signParams(params, HASH_SECRET);
  return { ...params, vnp_SecureHash: hash };
}

try {
  const user = await prisma.user.create({ data: {
    fullName: marker, email: `${marker}-customer@example.com`,
    phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`,
    passwordHash: 'test', role: 'CUSTOMER', isActive: true,
  } });
  userId = user.id;

  console.log('\n[createVnpayPaymentUrl — builds a real, independently-verifiable signed URL]');
  {
    const order = await makeVnpayOrder(200000);
    let url, merchantReference;
    await checkAsync('Creates a PaymentAttempt + signed redirect URL, Payment moves to PROCESSING', async () => {
      const res = await createVnpayPaymentUrl(order.id, userId, '203.0.113.5');
      url = res.url; merchantReference = res.merchantReference;
      assert.ok(url.startsWith(process.env.VNPAY_URL));
      const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      assert.equal(payment.status, 'PROCESSING');
      const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference } });
      assert.equal(attempt.status, 'PENDING');
      assert.equal(attempt.amount, 200000);
    });

    check('The URL this function built verifies correctly against the real Hash Secret (round-trip)', () => {
      const query = Object.fromEntries(new URL(url).searchParams.entries());
      const { vnp_SecureHash, ...rest } = query;
      const expected = signParams(rest, HASH_SECRET);
      assert.equal(expected.toLowerCase(), vnp_SecureHash.toLowerCase());
    });

    await checkAsync('Retrying (calling again while unpaid) creates a SECOND, independent attempt — "Thanh toán lại"', async () => {
      const res2 = await createVnpayPaymentUrl(order.id, userId, '203.0.113.5');
      assert.notEqual(res2.merchantReference, merchantReference);
      const count = await prisma.paymentAttempt.count({ where: { payment: { orderId: order.id } } });
      assert.equal(count, 2);
    });
  }

  console.log('\n[handleVnpayIpn — success path: the ONLY way VNPAY can mark Payment PAID]');
  {
    const order = await makeVnpayOrder(350000);
    const { merchantReference } = await createVnpayPaymentUrl(order.id, userId, '203.0.113.5');

    await checkAsync('[#1 equivalent] Correctly-signed success IPN marks Payment PAID + Attempt PAID', async () => {
      const result = await handleVnpayIpn(signedCallback(merchantReference, 350000));
      assert.equal(result.rspCode, '00');
      const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      assert.equal(payment.status, 'PAID');
      const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference } });
      assert.equal(attempt.status, 'PAID');
      const freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
      assert.equal(freshOrder.status, 'PENDING', 'IPN must never touch Order Status');
    });

    await checkAsync('[#7 duplicate] Re-delivering the SAME success IPN is a safe idempotent no-op (VNPAY redelivers until it sees RspCode 00)', async () => {
      const result = await handleVnpayIpn(signedCallback(merchantReference, 350000));
      assert.equal(result.rspCode, '00');
      const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      assert.equal(payment.status, 'PAID');
    });
  }

  console.log('\n[handleVnpayIpn — security: invalid signature, wrong amount, unknown reference]');
  {
    const order = await makeVnpayOrder(100000);
    const { merchantReference } = await createVnpayPaymentUrl(order.id, userId, '203.0.113.5');

    await checkAsync('A callback with a tampered/invalid signature is rejected (RspCode 97), Payment untouched', async () => {
      const tampered = signedCallback(merchantReference, 100000);
      tampered.vnp_SecureHash = '0'.repeat(128);
      const result = await handleVnpayIpn(tampered);
      assert.equal(result.rspCode, '97');
      const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      assert.equal(payment.status, 'PROCESSING');
    });

    await checkAsync('A correctly-SIGNED but wrong-amount callback is rejected (RspCode 04), Payment untouched', async () => {
      // Signed honestly for 999999 VND — amount itself (not the signature) is the attack.
      const wrongAmount = signedCallback(merchantReference, 999999);
      const result = await handleVnpayIpn(wrongAmount);
      assert.equal(result.rspCode, '04');
      const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      assert.equal(payment.status, 'PROCESSING');
    });

    await checkAsync('A callback for an unknown vnp_TxnRef is rejected (RspCode 01)', async () => {
      const result = await handleVnpayIpn(signedCallback('no-such-reference-ever', 100000));
      assert.equal(result.rspCode, '01');
    });
  }

  console.log('\n[handleVnpayIpn — failure/cancel/timeout: attempt-level only, Payment stays retryable]');
  {
    // Failed (generic non-00 code).
    const orderFailed = await makeVnpayOrder(120000);
    const { merchantReference: refFailed } = await createVnpayPaymentUrl(orderFailed.id, userId, '203.0.113.5');
    await checkAsync('[#6] A failed-card response (e.g. 51) marks the ATTEMPT FAILED, Payment stays PROCESSING (retryable)', async () => {
      const result = await handleVnpayIpn(signedCallback(refFailed, 120000, { responseCode: '51', transactionStatus: '02' }));
      assert.equal(result.rspCode, '00'); // VNPAY still expects "Confirm Success" once we've recorded it
      const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference: refFailed } });
      assert.equal(attempt.status, 'FAILED');
      const payment = await prisma.payment.findUnique({ where: { orderId: orderFailed.id } });
      assert.equal(payment.status, 'PROCESSING');
    });
    await checkAsync('[retry after failure] A brand-new attempt can still be created and paid for the same order', async () => {
      const { merchantReference: retryRef } = await createVnpayPaymentUrl(orderFailed.id, userId, '203.0.113.5');
      const result = await handleVnpayIpn(signedCallback(retryRef, 120000));
      assert.equal(result.rspCode, '00');
      const payment = await prisma.payment.findUnique({ where: { orderId: orderFailed.id } });
      assert.equal(payment.status, 'PAID');
    });

    // Customer cancelled (code 24).
    const orderCancelled = await makeVnpayOrder(80000);
    const { merchantReference: refCancelled } = await createVnpayPaymentUrl(orderCancelled.id, userId, '203.0.113.5');
    await checkAsync('[#6] Customer-cancelled response (24) marks the ATTEMPT CANCELLED, Payment stays retryable', async () => {
      await handleVnpayIpn(signedCallback(refCancelled, 80000, { responseCode: '24', transactionStatus: '02' }));
      const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference: refCancelled } });
      assert.equal(attempt.status, 'CANCELLED');
      const payment = await prisma.payment.findUnique({ where: { orderId: orderCancelled.id } });
      assert.equal(payment.status, 'PROCESSING');
    });

    await checkAsync('A late success IPN after a cancel is safely applied while the Order remains open', async () => {
      const result = await handleVnpayIpn(signedCallback(refCancelled, 80000, { transactionNo: '42424242' }));
      assert.equal(result.rspCode, '00');
      const payment = await prisma.payment.findUnique({ where: { orderId: orderCancelled.id } });
      assert.equal(payment.status, 'PAID');
      const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference: refCancelled } });
      assert.equal(attempt.status, 'CANCELLED', 'terminal attempt history is preserved');
      assert.match(attempt.errorMessage, /LATE_CONFIRMATION_AFTER_TERMINAL/);
    });

    // Timeout (code 11).
    const orderTimeout = await makeVnpayOrder(60000);
    const { merchantReference: refTimeout } = await createVnpayPaymentUrl(orderTimeout.id, userId, '203.0.113.5');
    await checkAsync('[#6] Timeout response (11) marks the ATTEMPT EXPIRED', async () => {
      await handleVnpayIpn(signedCallback(refTimeout, 60000, { responseCode: '11', transactionStatus: '02' }));
      const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference: refTimeout } });
      assert.equal(attempt.status, 'EXPIRED');
    });

    await checkAsync('A late FAILED IPN arriving AFTER a success must never override the already-PAID attempt', async () => {
      const order = await makeVnpayOrder(90000);
      const { merchantReference } = await createVnpayPaymentUrl(order.id, userId, '203.0.113.5');
      await handleVnpayIpn(signedCallback(merchantReference, 90000)); // success first
      const resultLate = await handleVnpayIpn(signedCallback(merchantReference, 90000, { responseCode: '51', transactionStatus: '02' }));
      assert.equal(resultLate.rspCode, '02'); // "already confirmed" — not accepted as a failure
      const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference } });
      assert.equal(attempt.status, 'PAID', 'must stay PAID — a late failure report is not trusted over a confirmed success');
    });
  }

  console.log('\n[handleVnpayReturn — Return URL never marks PAID itself; reports the REAL current status]');
  {
    const order = await makeVnpayOrder(70000);
    const { merchantReference } = await createVnpayPaymentUrl(order.id, userId, '203.0.113.5');

    await checkAsync('Before any IPN arrives, Return reports the real current status (PROCESSING), not a guess', async () => {
      const result = await handleVnpayReturn(signedCallback(merchantReference, 70000));
      assert.equal(result.valid, true);
      assert.equal(result.orderId, order.id);
      assert.equal(result.paymentStatus, 'PROCESSING');
    });

    await checkAsync('After a real IPN success, Return reflects the REAL PAID status (IPN, not Return, did the work)', async () => {
      await handleVnpayIpn(signedCallback(merchantReference, 70000));
      const result = await handleVnpayReturn(signedCallback(merchantReference, 70000));
      assert.equal(result.paymentStatus, 'PAID');
      const freshPayment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      assert.equal(freshPayment.status, 'PAID', 'sanity: Return handler itself must not have been what set this');
    });

    await checkAsync('An invalid-signature Return is flagged, never trusted for orderId/status', async () => {
      const tampered = signedCallback(merchantReference, 70000);
      tampered.vnp_SecureHash = '1'.repeat(128);
      const result = await handleVnpayReturn(tampered);
      assert.equal(result.valid, false);
    });
  }

  console.log('\n[vnpAmountToVnd sanity against the real amounts used above]');
  check('890000 example from the docs round-trips correctly', () => assert.equal(vnpAmountToVnd(89000000), 890000));

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
} finally {
  for (const id of orderIds) {
    await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId: id } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { orderId: id } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { orderId: id } }).catch(() => {});
    await prisma.order.delete({ where: { id } }).catch(() => {});
  }
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
  if (failures > 0) process.exitCode = 1;
}
