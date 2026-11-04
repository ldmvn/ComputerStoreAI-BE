// Full end-to-end flow on real MySQL/InnoDB, over real HTTP:
// Checkout → Order → VietQR → "Tôi đã chuyển khoản" → Admin confirmation →
// Customer Order Detail reflecting PAID. No real bank transfer — amounts are
// supplied directly, exactly like the Admin's own manual reconciliation
// action does. Safe throwaway User/Address/Order, cleaned up in `finally`.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import { createAccessToken } from '../src/services/token.service.js';

const base = process.env.PAYMENT_FLOW_TEST_API || `http://localhost:${process.env.PORT || 5000}/api`;
const marker = `pflow-${randomUUID().slice(0, 8)}`;

let customerId, adminId, addressId, orderId;
let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok  — ${label}`); }
  catch (e) { failures++; console.error(`  FAIL — ${label}\n        ${e.message}`); }
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const response = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

try {
  const customer = await prisma.user.create({ data: {
    fullName: marker, email: `${marker}-customer@example.com`,
    phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`,
    passwordHash: 'payment-flow-test', role: 'CUSTOMER', isActive: true,
  } });
  customerId = customer.id;
  const customerToken = createAccessToken(customer);

  const admin = await prisma.user.create({ data: {
    fullName: marker, email: `${marker}-admin@example.com`,
    phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`,
    passwordHash: 'payment-flow-test', role: 'ADMIN', isActive: true,
  } });
  adminId = admin.id;
  const adminToken = createAccessToken(admin);

  const address = await prisma.address.create({ data: {
    userId: customerId, fullName: marker, phone: '0900000000',
    provinceCode: '01', provinceName: marker, communeCode: '001', communeName: marker,
    streetAddress: marker,
  } });
  addressId = address.id;

  const product = await prisma.product.findFirst({ where: { isDeleted: false, isActive: true, stockQuantity: { gt: 0 } }, select: { id: true, price: true, stockQuantity: true } });
  check('a real in-stock product exists to order against', () => assert.ok(product));
  if (!product) throw new Error('no product available — cannot continue payment flow test');

  console.log('\n[1. Checkout → Order → Payment created in the same transaction]');
  let orderData;
  {
    const res = await request('/orders', {
      method: 'POST', token: customerToken,
      body: { items: [{ productId: product.id, quantity: 1 }], addressId, paymentMethod: 'BANK_TRANSFER', note: marker },
    });
    check('order creation succeeds (201)', () => assert.equal(res.status, 201));
    orderData = res.data.order;
    orderId = orderData?.id;
    check('order.payment exists immediately in the create-order response (same transaction)', () => assert.ok(orderData.payment));
    check('payment method is BANK_TRANSFER, amount matches subtotal (no discount)', () => {
      assert.equal(orderData.payment.method, 'BANK_TRANSFER');
      assert.equal(orderData.payment.amount, orderData.subtotal - orderData.discountAmount);
    });
    check('payment status is PENDING, not PAID — placing an order never pays it', () => assert.equal(orderData.payment.status, 'PENDING'));
    const attempt = orderData.payment.attempts[0];
    check('a PaymentAttempt with the real MB Bank snapshot was created', () => {
      assert.ok(attempt);
      assert.equal(attempt.bankBin, '970422');
      assert.equal(attempt.bankAccountNumber, '0386220065');
      assert.ok(attempt.bankAccountName);
      assert.ok(attempt.transferContent?.includes(String(orderId)));
    });
    check('Order Status (PENDING) and Payment Status (PENDING) are independent fields', () => {
      assert.equal(orderData.status, 'PENDING');
      assert.equal(orderData.payment.status, 'PENDING');
    });
  }

  console.log('\n[2. Reopen VietQR from Order Detail — same attempt, no new Order]');
  {
    const res = await request(`/payments/orders/${orderId}/vietqr`, { token: customerToken });
    check('vietqr reopen succeeds (200)', () => assert.equal(res.status, 200));
    check('same merchantReference as the one created at checkout (no duplicate Order/Payment)', () => {
      assert.equal(res.data.data.attempt.merchantReference, orderData.payment.attempts[0].merchantReference);
    });

    const otherCustomer = await prisma.user.create({ data: { fullName: marker, email: `${marker}-other@example.com`, phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`, passwordHash: 'x', role: 'CUSTOMER', isActive: true } });
    const otherToken = createAccessToken(otherCustomer);
    const forbidden = await request(`/payments/orders/${orderId}/vietqr`, { token: otherToken });
    check('a different customer cannot reopen someone else\'s QR (404, not leaked)', () => assert.equal(forbidden.status, 404));
    await prisma.user.delete({ where: { id: otherCustomer.id } });
  }

  console.log('\n[3. "Tôi đã chuyển khoản" — AWAITING_VERIFICATION, never PAID]');
  {
    const res = await request(`/payments/orders/${orderId}/report-transfer`, { method: 'POST', token: customerToken });
    check('report-transfer succeeds (200)', () => assert.equal(res.status, 200));
    check('status becomes AWAITING_VERIFICATION — absolutely not PAID', () => {
      assert.equal(res.data.data.payment.status, 'AWAITING_VERIFICATION');
      assert.notEqual(res.data.data.payment.status, 'PAID');
    });
    const again = await request(`/payments/orders/${orderId}/report-transfer`, { method: 'POST', token: customerToken });
    check('clicking it twice is idempotent (still 200, still AWAITING_VERIFICATION)', () => {
      assert.equal(again.status, 200);
      assert.equal(again.data.data.payment.status, 'AWAITING_VERIFICATION');
    });

    const unauth = await request(`/payments/orders/${orderId}/report-transfer`, { method: 'POST' });
    check('unauthenticated report-transfer is rejected (401)', () => assert.equal(unauth.status, 401));
  }

  console.log('\n[4. Admin confirmation — separate from order-status approval, RBAC-gated, audited, idempotent]');
  {
    const customerAttempt = await request(`/admin/payments/orders/${orderId}/confirm`, { method: 'POST', token: customerToken });
    check('a plain customer (no admin role) cannot confirm payment (403/401)', () => assert.ok([401, 403].includes(customerAttempt.status)));

    const res = await request(`/admin/payments/orders/${orderId}/confirm`, { method: 'POST', token: adminToken });
    check('admin confirmation succeeds (200)', () => assert.equal(res.status, 200));
    check('outcome is "paid"', () => assert.equal(res.data.data.outcome, 'paid'));

    const freshOrder = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    check('confirming payment did NOT touch Order Status — stays PENDING (fulfillment is a separate action)', () => assert.equal(freshOrder.status, 'PENDING'));

    const freshPayment = await prisma.payment.findUnique({ where: { orderId } });
    check('Payment is now PAID in the real database', () => assert.equal(freshPayment.status, 'PAID'));

    const activityLog = await prisma.activityLog.findFirst({ where: { userId: adminId, action: 'confirm_payment', targetId: String(orderId) }, orderBy: { createdAt: 'desc' } });
    check('an audit log entry was written for the confirmation', () => assert.ok(activityLog));

    const again = await request(`/admin/payments/orders/${orderId}/confirm`, { method: 'POST', token: adminToken });
    check('confirming again is idempotent — does not error, does not double-process', () => {
      assert.equal(again.status, 200);
      assert.equal(again.data.data.outcome, 'duplicate_same_attempt');
    });
  }

  console.log('\n[5. Customer Order Detail reflects PAID]');
  {
    const res = await request(`/orders/${orderId}`, { token: customerToken });
    check('order detail shows payment.status = PAID', () => assert.equal(res.data.order.payment.status, 'PAID'));
    check('order detail still shows Order Status independently (PENDING, untouched)', () => assert.equal(res.data.order.status, 'PENDING'));
  }

  console.log('\n[6. Late/duplicate evidence is never silently discarded — spot check via the already-tested core]');
  {
    // Already covered exhaustively in tests/payment.integration.mjs — just a
    // smoke check here that the admin-confirm endpoint surfaces the outcome
    // field a Dashboard would use to show a reconciliation warning.
    const res = await request(`/admin/payments/orders/${orderId}/confirm`, { method: 'POST', token: adminToken });
    check('repeated confirm still reports a specific, non-generic outcome', () => assert.ok(typeof res.data.data.outcome === 'string' && res.data.data.outcome.length > 0));
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
} finally {
  if (orderId) {
    // Restore stock/inventory the same way the real app would — call the
    // actual cancel endpoint (Order Status is still PENDING throughout this
    // test; only Payment Status changed) rather than deleting rows directly,
    // so the Product's real stockQuantity is never left permanently decremented.
    try {
      const token = createAccessToken({ id: customerId, role: 'CUSTOMER' });
      await request(`/orders/${orderId}/cancel`, { method: 'PATCH', token });
    } catch { /* best-effort — fall through to direct row cleanup regardless */ }

    await prisma.inventoryLog.deleteMany({ where: { reference: `ĐH #${orderId}` } });
    await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId } } });
    await prisma.payment.deleteMany({ where: { orderId } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
    await prisma.orderItem.deleteMany({ where: { orderId } });
    await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
  }
  if (addressId) await prisma.address.delete({ where: { id: addressId } }).catch(() => {});
  if (adminId) await prisma.activityLog.deleteMany({ where: { userId: adminId } }).catch(() => {});
  if (customerId) await prisma.user.delete({ where: { id: customerId } }).catch(() => {});
  if (adminId) await prisma.user.delete({ where: { id: adminId } }).catch(() => {});
  await prisma.$disconnect();
  if (failures > 0) process.exitCode = 1;
}
