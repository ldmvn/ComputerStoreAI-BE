// Real browser E2E for "Fix đồng bộ trạng thái thanh toán và xác nhận đơn
// hàng" — verifies Order Status and Payment Status are managed completely
// independently for VietQR AND COD, that confirming payment never depends
// on (or mutates) Order Status, that COD now has its own confirm action
// (previously missing entirely — adminConfirmPayment() only accepted
// BANK_TRANSFER), and that Customer Order Detail shows the REAL Payment
// Status for COD too (previously derived from Order Status — see
// frontend/src/app/customer/profile/orders/[id]/page.tsx).
import 'dotenv/config';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';
import { createAccessToken } from '../../src/services/token.service.js';

const FRONTEND = process.env.E2E_FRONTEND_URL || 'http://localhost:3000';
const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:5000';
const SCREENSHOT_DIR = 'C:/Users/ldm/AppData/Local/Temp/claude/f--ComputerStoreAI/0d79ae52-5e92-4676-b24e-4cf89f4ce3ff/scratchpad/e2e-screens';
const marker = `e2e-sync-${randomUUID().slice(0, 8)}`;

let failures = 0;
const results = [];
function check(label, pass, detail = '') {
  results.push({ label, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${label}${detail ? `\n        ${detail}` : ''}`);
  if (!pass) failures++;
}
async function shot(page, name) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: false }).catch(() => {});
}

async function getFreshProduct() {
  const row = await prisma.product.findFirst({
    where: { isDeleted: false, isActive: true, stockQuantity: { gt: 1 } },
    orderBy: { stockQuantity: 'desc' },
    select: { id: true },
  });
  if (!row) throw new Error('No active in-stock product available for E2E test.');
  return row.id;
}

async function createOrder(customerToken, addressId, productId, paymentMethod) {
  const res = await fetch(`${BACKEND}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({ items: [{ productId, quantity: 1 }], addressId, paymentMethod }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`createOrder failed: ${JSON.stringify(body)}`);
  return body.order;
}

async function advanceOrder(adminToken, orderId, status) {
  const res = await fetch(`${BACKEND}/api/admin/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`advanceOrder(${status}) failed: ${JSON.stringify(await res.json())}`);
}

async function cleanupOrder(orderId, customerId) {
  if (!orderId) return;
  const token = createAccessToken({ id: customerId, role: 'CUSTOMER' });
  await fetch(`${BACKEND}/api/orders/${orderId}/cancel`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  await prisma.inventoryLog.deleteMany({ where: { reference: `ĐH #${orderId}` } }).catch(() => {});
  await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId } } }).catch(() => {});
  await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
  await prisma.orderStatusHistory.deleteMany({ where: { orderId } }).catch(() => {});
  await prisma.orderItem.deleteMany({ where: { orderId } }).catch(() => {});
  await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
}

let customerId, adminId, addressId;
let browser;

try {
  const customer = await prisma.user.create({ data: {
    fullName: marker, email: `${marker}-customer@example.com`,
    phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`,
    passwordHash: 'e2e-test', role: 'CUSTOMER', isActive: true,
  } });
  customerId = customer.id;
  const admin = await prisma.user.create({ data: {
    fullName: marker, email: `${marker}-admin@example.com`,
    phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`,
    passwordHash: 'e2e-test', role: 'ADMIN', isActive: true,
  } });
  adminId = admin.id;
  const address = await prisma.address.create({ data: {
    userId: customerId, fullName: marker, phone: '0900000000',
    provinceCode: '01', provinceName: 'Hà Nội', communeCode: '001', communeName: 'Phường Test',
    streetAddress: `${marker} street`, isDefault: true,
  } });
  addressId = address.id;

  const customerToken = createAccessToken(customer);
  const adminToken = createAccessToken(admin);

  browser = await chromium.launch();

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[1. VietQR PENDING → Admin xác nhận → PAID]');
  // ════════════════════════════════════════════════════════════════════════
  let order1 = await createOrder(customerToken, addressId, await getFreshProduct(), 'BANK_TRANSFER');
  {
    const res = await fetch(`${BACKEND}/api/admin/payments/orders/${order1.id}/confirm`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
    const body = await res.json();
    check('VietQR PENDING → confirm → outcome "paid"', body.data?.outcome === 'paid', JSON.stringify(body.data));
    const p = await prisma.payment.findUnique({ where: { orderId: order1.id } });
    check('Payment.status is PAID in the real DB', p?.status === 'PAID', `status=${p?.status}`);
    const o = await prisma.order.findUnique({ where: { id: order1.id } });
    check('Order Status is untouched (stays PENDING)', o?.status === 'PENDING', `status=${o?.status}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[2. VietQR AWAITING_VERIFICATION → Admin xác nhận → PAID]');
  // ════════════════════════════════════════════════════════════════════════
  let order2 = await createOrder(customerToken, addressId, await getFreshProduct(), 'BANK_TRANSFER');
  {
    await fetch(`${BACKEND}/api/payments/orders/${order2.id}/report-transfer`, { method: 'POST', headers: { Authorization: `Bearer ${customerToken}` } });
    const before = await prisma.payment.findUnique({ where: { orderId: order2.id } });
    check('Payment is AWAITING_VERIFICATION after customer self-report', before?.status === 'AWAITING_VERIFICATION', `status=${before?.status}`);

    const res = await fetch(`${BACKEND}/api/admin/payments/orders/${order2.id}/confirm`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
    const body = await res.json();
    check('AWAITING_VERIFICATION → confirm → outcome "paid"', body.data?.outcome === 'paid', JSON.stringify(body.data));
    const after = await prisma.payment.findUnique({ where: { orderId: order2.id } });
    check('Payment.status is PAID in the real DB', after?.status === 'PAID', `status=${after?.status}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[3+4+8. NEW RULE: VietQR unpaid can no longer be approved/shipped at all; legacy unpaid-but-advanced orders still get a standalone confirm that never touches Order Status]');
  // ════════════════════════════════════════════════════════════════════════
  // Superseded by the "Tối ưu quy trình thanh toán" task: Admin approving an
  // unpaid VietQR order used to be allowed (Payment just stayed PENDING).
  // The new payment-before-fulfillment guard in adminOrder.service.js now
  // REJECTS that outright — VietQR must be confirmed (merged into the
  // approval itself) before the order can move past PENDING at all.
  let order3 = await createOrder(customerToken, addressId, await getFreshProduct(), 'BANK_TRANSFER');
  {
    const res = await fetch(`${BACKEND}/api/admin/orders/${order3.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'CONFIRMED' }),
    });
    const body = await res.json();
    check('[#4, new rule] Backend REJECTS approving an unpaid VietQR order (409, PAYMENT_NOT_CONFIRMED)', res.status === 409 && body.success === false, JSON.stringify(body));
    const paymentStillPending = await prisma.payment.findUnique({ where: { orderId: order3.id } });
    const orderStillPending = await prisma.order.findUnique({ where: { id: order3.id } });
    check('Order Status and Payment Status both remain untouched by the rejected attempt', orderStillPending?.status === 'PENDING' && paymentStillPending?.status === 'PENDING');

    // Legacy exception: an order that reached CONFIRMED/DELIVERED unpaid
    // BEFORE this guard existed (simulated here the same way real legacy
    // data got into that state — a direct Order.status write, never through
    // the gated endpoint) must still be reconcilable via the standalone
    // confirm action, without retroactively touching Order Status.
    await prisma.order.update({ where: { id: order3.id }, data: { status: 'DELIVERED', confirmedAt: new Date(), shippedAt: new Date(), deliveredAt: new Date() } });
    const orderAfterDelivered = await prisma.order.findUnique({ where: { id: order3.id } });
    check('[#3] (legacy-simulated) Order Status is DELIVERED', orderAfterDelivered?.status === 'DELIVERED');

    const res2 = await fetch(`${BACKEND}/api/admin/payments/orders/${order3.id}/confirm`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
    const body2 = await res2.json();
    check('[#3] Confirming payment on an already-DELIVERED (legacy) order still succeeds → outcome "paid"', body2.data?.outcome === 'paid', JSON.stringify(body2.data));
    const paymentAfterConfirm = await prisma.payment.findUnique({ where: { orderId: order3.id } });
    check('Payment.status is now PAID', paymentAfterConfirm?.status === 'PAID', `status=${paymentAfterConfirm?.status}`);
    const orderAfterConfirm = await prisma.order.findUnique({ where: { id: order3.id } });
    check('[#8] Order Status is UNCHANGED by the payment confirmation (still DELIVERED)', orderAfterConfirm?.status === 'DELIVERED', `status=${orderAfterConfirm?.status}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[5+6. COD đã giao nhưng chưa xác nhận thu tiền → không tự PAID; sau đó Admin xác nhận thu COD → PAID]');
  // ════════════════════════════════════════════════════════════════════════
  let order4 = await createOrder(customerToken, addressId, await getFreshProduct(), 'COD');
  {
    const paymentAtCreate = await prisma.payment.findUnique({ where: { orderId: order4.id } });
    check('COD order creates a Payment row (method=COD, status=PENDING)', paymentAtCreate?.method === 'COD' && paymentAtCreate?.status === 'PENDING');

    await advanceOrder(adminToken, order4.id, 'CONFIRMED');
    await advanceOrder(adminToken, order4.id, 'SHIPPING');
    await advanceOrder(adminToken, order4.id, 'DELIVERED');
    const afterDelivered = await prisma.payment.findUnique({ where: { orderId: order4.id } });
    check('[#5] COD order DELIVERED but Payment is STILL PENDING — delivery never auto-confirms COD cash collection', afterDelivered?.status === 'PENDING', `status=${afterDelivered?.status}`);

    // The confirm button must actually be reachable from the UI — drive it
    // through a real browser click, not just the API, since this is a
    // brand-new action this fix adds.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: adminToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.goto(`${FRONTEND}/admin/orders`, { waitUntil: 'networkidle' });
    const row = page.locator('tr').filter({ hasText: `#${order4.id}` }).first();
    await shot(page, '30-admin-orders-cod-confirm-button');

    // The confirm action now lives directly in the Thao tác column of the
    // main row — no need to expand the row anymore.
    const codConfirmBtn = row.getByRole('button', { name: 'Đã thu COD' });
    const codConfirmVisible = await codConfirmBtn.isVisible().catch(() => false);
    check('[#6] "Đã thu COD" button is visible in the Thao tác column for a PENDING COD payment', codConfirmVisible);
    if (codConfirmVisible) {
      await codConfirmBtn.click();
      await page.waitForTimeout(400);
      const dialogConfirm = page.getByRole('button', { name: 'Xác nhận đã thu tiền' });
      check('Confirmation Dialog shows the dedicated "Xác nhận đã thu tiền" button', await dialogConfirm.isVisible().catch(() => false));
      const dialogText = await page.getByRole('alertdialog').innerText().catch(() => '');
      check('Dialog shows the order id, method and amount before confirming', dialogText.includes(`#${order4.id}`) && dialogText.includes('COD'));
      await dialogConfirm.click();
      await page.waitForTimeout(1000);
      await shot(page, '31-admin-orders-cod-confirmed');

      const freshPayment = await prisma.payment.findUnique({ where: { orderId: order4.id } });
      check('[#6] Confirming COD sets Payment.status to PAID in the real DB', freshPayment?.status === 'PAID', `status=${freshPayment?.status}`);
      const freshOrder = await prisma.order.findUnique({ where: { id: order4.id } });
      check('Order Status is unaffected (still DELIVERED)', freshOrder?.status === 'DELIVERED', `status=${freshOrder?.status}`);

      // No manual reload — the row's own `load()` after confirm must refresh the badge in place.
      const rowAfter = page.locator('tr').filter({ hasText: `#${order4.id}` }).first();
      const codConfirmGone = await rowAfter.getByRole('button', { name: 'Đã thu COD' }).isVisible().catch(() => false);
      check('"Đã thu COD" button disappears once PAID, without a manual page reload', !codConfirmGone);
      const rowTextAfter = await rowAfter.innerText().catch(() => '');
      check('Payment badge in the table updates to "Đã thanh toán" without a manual reload', rowTextAfter.includes('Đã thanh toán'));
    }
    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[7. Không xác nhận trùng — VietQR và COD]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const res1 = await fetch(`${BACKEND}/api/admin/payments/orders/${order1.id}/confirm`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
    const body1 = await res1.json();
    check('[VietQR] Re-confirming an already-PAID payment is idempotent (outcome "duplicate_same_attempt", not an error or a second write)', body1.data?.outcome === 'duplicate_same_attempt', JSON.stringify(body1.data));

    const res2 = await fetch(`${BACKEND}/api/admin/payments/orders/${order4.id}/confirm-cod`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
    const body2 = await res2.json();
    check('[COD] Re-confirming an already-PAID COD payment is idempotent (outcome "duplicate_same_attempt")', body2.data?.outcome === 'duplicate_same_attempt', JSON.stringify(body2.data));

    // Concurrency: two simultaneous confirm-cod requests on the SAME still-
    // unpaid order must result in exactly one real transition, never both
    // reporting "paid" as if two separate writes happened.
    let order5 = await createOrder(customerToken, addressId, await getFreshProduct(), 'COD');
    const [raceA, raceB] = await Promise.all([
      fetch(`${BACKEND}/api/admin/payments/orders/${order5.id}/confirm-cod`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } }).then(r => r.json()),
      fetch(`${BACKEND}/api/admin/payments/orders/${order5.id}/confirm-cod`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } }).then(r => r.json()),
    ]);
    const outcomes = [raceA.data?.outcome, raceB.data?.outcome].sort();
    check('[COD concurrency] Two simultaneous confirm-cod calls resolve to exactly one "paid" + one "duplicate_same_attempt"', JSON.stringify(outcomes) === JSON.stringify(['duplicate_same_attempt', 'paid']), JSON.stringify(outcomes));
    const finalPayment5 = await prisma.payment.findUnique({ where: { orderId: order5.id } });
    check('[COD concurrency] Exactly one PAID write landed in the real DB', finalPayment5?.status === 'PAID');
    await cleanupOrder(order5.id, customerId);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[9. Khách hàng và Admin nhìn thấy dữ liệu nhất quán — COD PAID hiển thị đúng Payment Status thực, không suy ra từ Order Status]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: customerToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.goto(`${FRONTEND}/customer/profile/orders/${order4.id}`, { waitUntil: 'networkidle' });
    await shot(page, '32-customer-order-detail-cod-paid');
    check('Customer Order Detail shows "Đã thanh toán" for the now-PAID COD order (from real Payment Status, not Order Status)', await page.getByText('Đã thanh toán').first().isVisible().catch(() => false));

    // A second COD order that is DELIVERED but NOT yet confirmed must show
    // the real PENDING payment status — this is exactly the bug that used
    // to read `order.status === 'DELIVERED' ? 'Đã thanh toán' : ...`.
    let order6 = await createOrder(customerToken, addressId, await getFreshProduct(), 'COD');
    await advanceOrder(adminToken, order6.id, 'CONFIRMED');
    await advanceOrder(adminToken, order6.id, 'SHIPPING');
    await advanceOrder(adminToken, order6.id, 'DELIVERED');
    await page.goto(`${FRONTEND}/customer/profile/orders/${order6.id}`, { waitUntil: 'networkidle' });
    await shot(page, '33-customer-order-detail-cod-delivered-unpaid');
    const bodyText = await page.locator('body').innerText();
    check('[regression] COD order DELIVERED but unconfirmed shows "Chờ thanh toán" (real Payment Status), NOT "Đã thanh toán"', bodyText.includes('Chờ thanh toán') && !bodyText.includes('Đã thanh toán'), bodyText.includes('Đã thanh toán') ? 'found "Đã thanh toán" incorrectly' : '');

    await context.close();
    await cleanupOrder(order6.id, customerId);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${results.length} total)`);
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
} finally {
  if (browser) await browser.close().catch(() => {});

  if (customerId) {
    const stragglers = await prisma.order.findMany({ where: { userId: customerId }, select: { id: true } }).catch(() => []);
    for (const { id } of stragglers) {
      console.log(`  (cleanup safety net: restoring leftover order #${id})`);
      await cleanupOrder(id, customerId);
    }
  }

  if (addressId) await prisma.address.delete({ where: { id: addressId } }).catch(() => {});
  if (adminId) await prisma.activityLog.deleteMany({ where: { userId: adminId } }).catch(() => {});
  if (customerId) await prisma.user.delete({ where: { id: customerId } }).catch(() => {});
  if (adminId) await prisma.user.delete({ where: { id: adminId } }).catch(() => {});
  await prisma.$disconnect();
  if (failures > 0) process.exitCode = 1;
}
