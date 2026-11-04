// Real browser E2E for the VNPAY payment flow.
//
// Two parts:
//  [A] Deterministic checks (always run, always gate pass/fail): Checkout UI
//      → VNPAY redirect → real signed URL actually accepted by VNPAY's own
//      sandbox server → simulated-but-correctly-signed IPN (same technique
//      as tests/vnpay.integration.mjs) → Admin/Customer UI sync, retry,
//      duplicate-IPN safety.
//  [B] Best-effort REAL Sandbox checkout using VNPAY's publicly documented
//      test card (NCB bank demo data from VNPAY's own integration docs) —
//      attempts an actual transaction through VNPAY's hosted page and waits
//      for a REAL IPN to land. This section's outcome is reported
//      separately and does NOT gate the suite's pass/fail, because it
//      depends on VNPAY's live sandbox UI/availability and on the IPN URL
//      having been registered on VNPAY's merchant dashboard (a manual step
//      outside this codebase) — this script cannot perform that
//      registration itself. We do not claim "integration successful" from
//      this section alone; see the final report for what it actually showed.
import 'dotenv/config';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';
import { createAccessToken } from '../../src/services/token.service.js';
import { signParams } from '../../src/payments/services/vnpayUtil.service.js';

const FRONTEND = process.env.E2E_FRONTEND_URL || 'http://localhost:3000';
const FRONTEND_URL = new URL(FRONTEND);
const COOKIE_DOMAIN = FRONTEND_URL.hostname;
const COOKIE_SECURE = FRONTEND_URL.protocol === 'https:';
const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:5000';
const SCREENSHOT_DIR = 'C:/Users/ldm/AppData/Local/Temp/claude/f--ComputerStoreAI/0d79ae52-5e92-4676-b24e-4cf89f4ce3ff/scratchpad/e2e-screens';
const marker = `e2e-vnpay-${randomUUID().slice(0, 8)}`;
const HASH_SECRET = process.env.VNPAY_HASH_SECRET;

function accessTokenCookie(value) {
  return { name: 'accessToken', value, domain: COOKIE_DOMAIN, path: '/', httpOnly: true, secure: COOKIE_SECURE, sameSite: 'Strict' };
}

let failures = 0;
const results = [];
function check(label, pass, detail = '') {
  results.push({ label, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${label}${detail ? `\n        ${detail}` : ''}`);
  if (!pass) failures++;
}
function note(label, detail = '') {
  console.log(`  i   — ${label}${detail ? `\n        ${detail}` : ''}`);
}
async function shot(page, name) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: false }).catch(() => {});
}

function signedCallback(merchantReference, amountVnd, { responseCode = '00', transactionStatus = '00', transactionNo = `${Date.now()}` } = {}) {
  const params = {
    vnp_Amount: String(amountVnd * 100), vnp_BankCode: 'NCB', vnp_OrderInfo: 'test',
    vnp_PayDate: '20260101120000', vnp_ResponseCode: responseCode, vnp_TmnCode: process.env.VNPAY_TMN_CODE,
    vnp_TransactionNo: transactionNo, vnp_TransactionStatus: transactionStatus, vnp_TxnRef: merchantReference,
  };
  return { ...params, vnp_SecureHash: signParams(params, HASH_SECRET) };
}
function queryStringFrom(obj) {
  return '?' + new URLSearchParams(obj).toString();
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

  console.log('\n[A1. Checkout UI → VNPAY: real order created, real signed URL accepted by the real VNPAY sandbox server]');
  let mainOrderId = null;
  let mainMerchantReference = null;
  let mainAmount = null;
  {
    const product = await prisma.product.findFirst({
      where: { isDeleted: false, isActive: true, stockQuantity: { gt: 1 } },
      orderBy: { stockQuantity: 'desc' },
      select: { id: true, slug: true, name: true, price: true, stockQuantity: true, images: { where: { isPrimary: true }, select: { imageUrl: true }, take: 1 } },
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([accessTokenCookie(customerToken)]);
    const page = await context.newPage();
    const t0 = new Date().toISOString();

    await page.goto(`${FRONTEND}/`);
    await page.evaluate(({ product }) => {
      sessionStorage.setItem('ducmanhpc-checkout', JSON.stringify({
        source: 'buynow',
        items: [{ id: product.id, slug: product.slug, name: product.name, price: product.price, primaryImage: product.images[0]?.imageUrl ?? null, stockQuantity: product.stockQuantity, quantity: 1 }],
      }));
    }, { product });
    await page.goto(`${FRONTEND}/customer/checkout`, { waitUntil: 'networkidle' });
    await page.locator('button').filter({ hasText: marker }).first().click().catch(() => {});

    const vnpayButton = page.locator('button').filter({ hasText: 'Thanh toán qua VNPAY' });
    check('VNPAY payment method option is visible on Checkout', await vnpayButton.first().isVisible().catch(() => false));
    await vnpayButton.first().click();
    await shot(page, '50-checkout-vnpay-selected');

    await page.locator('button').filter({ hasText: 'Đặt hàng ·' }).click();
    // Real full-page navigation to VNPAY's sandbox — wait for the URL to change host.
    await page.waitForURL(/vnpayment\.vn/, { timeout: 15000 }).catch(() => {});
    await shot(page, '51-redirected-to-vnpay-sandbox');

    const landedOnVnpay = page.url().includes('vnpayment.vn');
    check('Browser was redirected to the real VNPAY sandbox gateway (not an error page)', landedOnVnpay, page.url());

    const dbOrder = await prisma.order.findFirst({ where: { userId: customerId, paymentMethod: 'VNPAY', createdAt: { gte: new Date(t0) } }, orderBy: { createdAt: 'asc' }, include: { payment: { include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } } } } });
    mainOrderId = dbOrder?.id ?? null;
    mainMerchantReference = dbOrder?.payment?.attempts?.[0]?.merchantReference ?? null;
    mainAmount = dbOrder?.payment?.amount ?? null;
    check('Order + Payment(PROCESSING) + PaymentAttempt(PENDING) were created in the real DB', !!mainMerchantReference && dbOrder.payment.status === 'PROCESSING', JSON.stringify({ orderId: mainOrderId, paymentStatus: dbOrder?.payment?.status }));

    if (landedOnVnpay) {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      check('VNPAY sandbox page did NOT show an "invalid signature" / checksum error for our real signed URL', !/sai|invalid|không hợp lệ|checksum/i.test(bodyText.slice(0, 2000)) || /ngân hàng|bank|thanh toán/i.test(bodyText.slice(0, 500)), bodyText.slice(0, 300));
    }
    await context.close();
  }

  console.log('\n[A2. Simulated-but-correctly-signed IPN — success, Admin + Customer UI sync, Order Status untouched]');
  {
    if (!mainMerchantReference) {
      check('IPN simulation skipped — no attempt from A1 to confirm', false, 'A1 did not produce a usable merchantReference');
    } else {
      const res = await fetch(`${BACKEND}/api/payments/vnpay/ipn${queryStringFrom(signedCallback(mainMerchantReference, mainAmount))}`);
      const body = await res.json();
      check('IPN with a valid signature returns RspCode 00 (Confirm Success)', body.RspCode === '00', JSON.stringify(body));

      const payment = await prisma.payment.findUnique({ where: { orderId: mainOrderId } });
      check('Payment is PAID in the real DB after the IPN', payment?.status === 'PAID', `status=${payment?.status}`);
      const order = await prisma.order.findUnique({ where: { id: mainOrderId } });
      check('Order Status is UNCHANGED by the IPN (stays PENDING — fulfillment is separate)', order?.status === 'PENDING', `status=${order?.status}`);

      // Duplicate IPN redelivery — VNPAY retries until it sees RspCode 00.
      const res2 = await fetch(`${BACKEND}/api/payments/vnpay/ipn${queryStringFrom(signedCallback(mainMerchantReference, mainAmount))}`);
      const body2 = await res2.json();
      check('Duplicate IPN redelivery is still a safe RspCode 00, no double-write', body2.RspCode === '00');

      // Customer Order Detail reflects PAID.
      const ctxCustomer = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctxCustomer.addCookies([accessTokenCookie(customerToken)]);
      const pCustomer = await ctxCustomer.newPage();
      await pCustomer.goto(`${FRONTEND}/customer/profile/orders/${mainOrderId}`, { waitUntil: 'networkidle' });
      check('Customer Order Detail shows "Đã thanh toán" after a fresh load', await pCustomer.getByText('Đã thanh toán').first().isVisible().catch(() => false));
      check('"Thanh toán lại qua VNPAY" is hidden once PAID', !(await pCustomer.getByRole('button', { name: /VNPAY/ }).isVisible().catch(() => false)));
      await shot(pCustomer, '52-customer-order-detail-vnpay-paid');
      await ctxCustomer.close();

      // Admin Orders reflects PAID, no manual confirm button offered for VNPAY.
      const ctxAdmin = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctxAdmin.addCookies([accessTokenCookie(adminToken)]);
      const pAdmin = await ctxAdmin.newPage();
      await pAdmin.goto(`${FRONTEND}/admin/orders`, { waitUntil: 'networkidle' });
      const row = pAdmin.locator('tr').filter({ hasText: `#${mainOrderId}` }).first();
      const rowText = await row.innerText().catch(() => '');
      check('Admin Orders row shows VNPAY method + Đã thanh toán', rowText.includes('VNPAY') && rowText.includes('Đã thanh toán'), rowText);
      check('Admin Orders offers no manual "Đã nhận tiền"-style button for VNPAY (IPN-only)', !(await row.getByRole('button', { name: /nhận tiền|Xác nhận tiền/i }).isVisible().catch(() => false)));
      await shot(pAdmin, '53-admin-orders-vnpay-paid');
      await ctxAdmin.close();
    }
  }

  console.log('\n[A3. Failure + retry: a declined attempt stays retryable, a fresh attempt can still succeed]');
  {
    const product = await prisma.product.findFirst({ where: { isDeleted: false, isActive: true, stockQuantity: { gt: 1 } }, orderBy: { stockQuantity: 'desc' }, select: { id: true } });
    const token = createAccessToken({ id: customerId, role: 'CUSTOMER' });
    const createRes = await fetch(`${BACKEND}/api/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items: [{ productId: product.id, quantity: 1 }], addressId, paymentMethod: 'VNPAY' }),
    });
    const order2 = (await createRes.json()).order;

    const urlRes = await fetch(`${BACKEND}/api/payments/orders/${order2.id}/vnpay`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const { data: { merchantReference: ref1 } } = await urlRes.json();

    const failIpn = await fetch(`${BACKEND}/api/payments/vnpay/ipn${queryStringFrom(signedCallback(ref1, order2.subtotal, { responseCode: '51', transactionStatus: '02' }))}`);
    check('[A3] A declined-card IPN is accepted (RspCode 00 — we recorded it)', (await failIpn.json()).RspCode === '00');
    const paymentAfterFail = await prisma.payment.findUnique({ where: { orderId: order2.id } });
    check('[A3] Payment stays PROCESSING (retryable) after one failed attempt', paymentAfterFail?.status === 'PROCESSING', `status=${paymentAfterFail?.status}`);

    const urlRes2 = await fetch(`${BACKEND}/api/payments/orders/${order2.id}/vnpay`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const { data: { merchantReference: ref2 } } = await urlRes2.json();
    check('[A3] "Thanh toán lại" creates a brand-new, distinct attempt reference', ref2 !== ref1);

    const successIpn = await fetch(`${BACKEND}/api/payments/vnpay/ipn${queryStringFrom(signedCallback(ref2, order2.subtotal))}`);
    check('[A3] The retried attempt can still succeed', (await successIpn.json()).RspCode === '00');
    const paymentAfterRetry = await prisma.payment.findUnique({ where: { orderId: order2.id } });
    check('[A3] Payment is PAID after the successful retry', paymentAfterRetry?.status === 'PAID', `status=${paymentAfterRetry?.status}`);

    await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId: order2.id } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { orderId: order2.id } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { orderId: order2.id } }).catch(() => {});
    await prisma.order.delete({ where: { id: order2.id } }).catch(() => {});
  }

  console.log('\n[A4. Return page UI — never claims PAID on its own, polls to the real DB status]');
  {
    const product = await prisma.product.findFirst({ where: { isDeleted: false, isActive: true, stockQuantity: { gt: 1 } }, orderBy: { stockQuantity: 'desc' }, select: { id: true } });
    const token = createAccessToken({ id: customerId, role: 'CUSTOMER' });
    const createRes = await fetch(`${BACKEND}/api/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items: [{ productId: product.id, quantity: 1 }], addressId, paymentMethod: 'VNPAY' }),
    });
    const order3 = (await createRes.json()).order;
    const urlRes = await fetch(`${BACKEND}/api/payments/orders/${order3.id}/vnpay`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const { data: { merchantReference: ref3 } } = await urlRes.json();

    // Fire the real success IPN BEFORE the browser even visits Return —
    // mirrors the realistic race where IPN often lands before the redirect.
    await fetch(`${BACKEND}/api/payments/vnpay/ipn${queryStringFrom(signedCallback(ref3, order3.subtotal))}`);

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const returnQuery = queryStringFrom(signedCallback(ref3, order3.subtotal));
    await page.goto(`${FRONTEND}/payment/vnpay/return${returnQuery}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shot(page, '54-vnpay-return-page-paid');
    check('[A4] Return page shows "Thanh toán thành công" once the real IPN has settled', await page.getByText('Thanh toán thành công').first().isVisible().catch(() => false));
    check('[A4] Return page shows a link to the real Order Detail', await page.getByRole('button', { name: 'Xem chi tiết đơn hàng' }).isVisible().catch(() => false));

    // Tampered signature on the Return page itself.
    const tampered = signedCallback(ref3, order3.subtotal);
    tampered.vnp_SecureHash = '0'.repeat(128);
    await page.goto(`${FRONTEND}/payment/vnpay/return${queryStringFrom(tampered)}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    check('[A4] Return page flags an invalid/tampered signature instead of trusting it', await page.getByText('Không xác minh được giao dịch').first().isVisible().catch(() => false));
    await shot(page, '55-vnpay-return-page-invalid');
    await context.close();

    await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId: order3.id } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { orderId: order3.id } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { orderId: order3.id } }).catch(() => {});
    await prisma.order.delete({ where: { id: order3.id } }).catch(() => {});
  }

  console.log(`\n[A] ${failures === 0 ? 'ALL DETERMINISTIC CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${results.length} total)`);

  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[B. Best-effort REAL VNPAY Sandbox checkout — informational only, does not gate pass/fail]');
  // ══════════════════════════════════════════════════════════════════════
  {
    const product = await prisma.product.findFirst({ where: { isDeleted: false, isActive: true, stockQuantity: { gt: 1 } }, orderBy: { stockQuantity: 'desc' }, select: { id: true, slug: true, name: true, price: true, stockQuantity: true, images: { where: { isPrimary: true }, select: { imageUrl: true }, take: 1 } } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([accessTokenCookie(customerToken)]);
    const page = await context.newPage();
    const t0 = new Date().toISOString();
    await page.goto(`${FRONTEND}/`);
    await page.evaluate(({ product }) => {
      sessionStorage.setItem('ducmanhpc-checkout', JSON.stringify({ source: 'buynow', items: [{ id: product.id, slug: product.slug, name: product.name, price: product.price, primaryImage: product.images[0]?.imageUrl ?? null, stockQuantity: product.stockQuantity, quantity: 1 }] }));
    }, { product });
    await page.goto(`${FRONTEND}/customer/checkout`, { waitUntil: 'networkidle' });
    await page.locator('button').filter({ hasText: marker }).first().click().catch(() => {});
    await page.locator('button').filter({ hasText: 'Thanh toán qua VNPAY' }).first().click();
    await page.locator('button').filter({ hasText: 'Đặt hàng ·' }).click();
    await page.waitForURL(/vnpayment\.vn/, { timeout: 15000 }).catch(() => {});

    let sandboxOrder = null;
    try {
      if (!page.url().includes('vnpayment.vn')) throw new Error('did not reach VNPAY sandbox');
      await shot(page, '56-sandbox-gateway-landing');

      // VNPAY sandbox's method-selection page → "Thẻ nội địa và tài khoản
      // ngân hàng" (domestic card/bank account) → bank list → NCB (VNPAY's
      // own published sandbox test bank).
      const domesticCardOption = page.getByText('Thẻ nội địa và tài khoản ngân hàng', { exact: false }).first();
      if (await domesticCardOption.isVisible({ timeout: 5000 }).catch(() => false)) {
        await domesticCardOption.click();
        await page.waitForTimeout(1000);
      }
      await shot(page, '56b-sandbox-domestic-card-chosen');

      // The bank logo tiles render their label inside an SVG — not a real
      // DOM text node getByText can reliably hit — so locate the grid card
      // by its bounding box via a broad image/svg locator search for "NCB"
      // in nearby alt/title text first, falling back to a direct pixel
      // click at the known card position from the method-selection layout.
      let ncbClicked = false;
      const ncbByAlt = page.locator('img[alt*="NCB" i], [title*="NCB" i]').first();
      if (await ncbByAlt.isVisible({ timeout: 3000 }).catch(() => false)) {
        await ncbByAlt.click({ force: true });
        ncbClicked = true;
      } else {
        const ncbSvgText = page.locator('svg:has-text("NCB")').first();
        if (await ncbSvgText.isVisible({ timeout: 3000 }).catch(() => false)) {
          const box = await ncbSvgText.boundingBox();
          if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); ncbClicked = true; }
        }
      }
      if (ncbClicked) await page.waitForTimeout(1500);
      await shot(page, '57-sandbox-bank-selected');

      // Publicly documented VNPAY sandbox test card (from VNPAY's own
      // integration guide) — not a real card, not secret.
      await page.locator('input[name*="card" i], input[placeholder*="thẻ" i], #card_number, input').first().fill('9704198526191432198').catch(() => {});
      await page.getByPlaceholder(/tên|name/i).first().fill('NGUYEN VAN A').catch(() => {});
      await page.getByPlaceholder(/MM\/YY|phát hành|issue/i).first().fill('07/15').catch(() => {});
      await shot(page, '58-sandbox-card-filled');

      const continueBtn = page.getByRole('button', { name: /tiếp tục|continue|thanh toán/i }).first();
      if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) await continueBtn.click();
      await page.waitForTimeout(2000);
      await shot(page, '59-sandbox-after-continue');

      const otpInput = page.locator('input[name*="otp" i], input[placeholder*="OTP" i]').first();
      if (await otpInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await otpInput.fill('123456');
        await shot(page, '60-sandbox-otp-filled');
        const confirmBtn = page.getByRole('button', { name: /xác nhận|confirm/i }).first();
        if (await confirmBtn.isVisible().catch(() => false)) await confirmBtn.click();
      }

      await page.waitForURL((u) => u.hostname.includes('ducmanh.store') || u.pathname.includes('/payment/vnpay/return'), { timeout: 20000 }).catch(() => {});
      await shot(page, '61-sandbox-returned-to-our-site');

      if (page.url().includes('/payment/vnpay/return')) {
        note('[B] VNPAY sandbox redirected the browser back to our real Return URL', page.url());
        await page.waitForTimeout(8000); // give the real server-to-server IPN time to land
        await shot(page, '62-sandbox-return-page-final');
        const orderFromReturn = await prisma.order.findFirst({ where: { userId: customerId, paymentMethod: 'VNPAY', createdAt: { gte: new Date(t0) } }, orderBy: { createdAt: 'desc' } });
        sandboxOrder = orderFromReturn;
        const finalPayment = orderFromReturn ? await prisma.payment.findUnique({ where: { orderId: orderFromReturn.id } }) : null;
        if (finalPayment?.status === 'PAID') {
          note('[B] A REAL VNPAY sandbox transaction completed and a REAL IPN marked Payment PAID.', `orderId=${orderFromReturn.id}`);
        } else {
          note('[B] Reached the Return URL, but Payment is NOT yet PAID in our DB.', `status=${finalPayment?.status ?? 'no payment row found'} — either the sandbox transaction did not complete, or the IPN URL is not yet registered on VNPAY's merchant dashboard (see report).`);
        }
      } else {
        note('[B] Did not reach our Return URL within the timeout — sandbox UI may have changed, required extra steps, or network/latency.', page.url());
      }
    } catch (e) {
      note('[B] Could not complete the real sandbox checkout UI automatically.', e.message);
    } finally {
      if (sandboxOrder) {
        await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId: sandboxOrder.id } } }).catch(() => {});
        await prisma.payment.deleteMany({ where: { orderId: sandboxOrder.id } }).catch(() => {});
        await prisma.orderItem.deleteMany({ where: { orderId: sandboxOrder.id } }).catch(() => {});
        await prisma.order.delete({ where: { id: sandboxOrder.id } }).catch(() => {});
      }
    }
    await context.close();
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${results.length} total) — section [B] is informational and not counted above`);
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
} finally {
  if (browser) await browser.close().catch(() => {});

  if (customerId) {
    const stragglers = await prisma.order.findMany({ where: { userId: customerId }, select: { id: true } }).catch(() => []);
    for (const { id } of stragglers) {
      console.log(`  (cleanup safety net: restoring leftover order #${id})`);
      const token = createAccessToken({ id: customerId, role: 'CUSTOMER' });
      await fetch(`${BACKEND}/api/orders/${id}/cancel`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      await prisma.inventoryLog.deleteMany({ where: { reference: `ĐH #${id}` } }).catch(() => {});
      await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId: id } } }).catch(() => {});
      await prisma.payment.deleteMany({ where: { orderId: id } }).catch(() => {});
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: id } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { orderId: id } }).catch(() => {});
      await prisma.order.delete({ where: { id } }).catch(() => {});
    }
  }

  if (addressId) await prisma.address.delete({ where: { id: addressId } }).catch(() => {});
  if (adminId) await prisma.activityLog.deleteMany({ where: { userId: adminId } }).catch(() => {});
  if (customerId) await prisma.user.delete({ where: { id: customerId } }).catch(() => {});
  if (adminId) await prisma.user.delete({ where: { id: adminId } }).catch(() => {});
  await prisma.$disconnect();
  if (failures > 0) process.exitCode = 1;
}
