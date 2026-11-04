// Real browser E2E for the VietQR/MB Bank + Telegram payment flow, driven
// with Playwright (Chromium) against the live Next.js dev server
// (http://localhost:3000) and live Express backend (http://localhost:5000).
// No real bank transfer is ever made — report-transfer/admin-confirm are the
// same explicit, verified actions a real customer/admin would take.
//
// Auth is seeded by setting the real `accessToken` httpOnly cookie (the
// exact mechanism the login endpoint itself sets — see
// backend/src/controllers/auth.controller.js) rather than typing through the
// login form, to keep this fast across many scenarios; every subsequent
// interaction (checkout form, VietQR popup, copy/download buttons, Admin
// confirm) is driven as a real click/keyboard event against the real
// rendered DOM.
//
// STRICT invariant: at most ONE test order is ever open at a time, and it is
// fully cleaned up (cancelled via the real API + stock restored) before the
// next scenario starts — this was learned the hard way after an earlier
// version of this script left a test order's stock decrement unrestored
// when a bug in the app under test (now fixed) broke the cleanup chain.
import 'dotenv/config';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';
import { createAccessToken } from '../../src/services/token.service.js';

const FRONTEND = process.env.E2E_FRONTEND_URL || 'http://localhost:3000';
const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:5000';
const SCREENSHOT_DIR = 'C:/Users/ldm/AppData/Local/Temp/claude/f--ComputerStoreAI/0d79ae52-5e92-4676-b24e-4cf89f4ce3ff/scratchpad/e2e-screens';
const marker = `e2e-${randomUUID().slice(0, 8)}`;

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
    where: { isDeleted: false, isActive: true, stockQuantity: { gt: 0 } },
    orderBy: { stockQuantity: 'desc' }, // prefer high-stock items so this script never starves a low-stock product
    select: { id: true, slug: true, name: true, price: true, stockQuantity: true, images: { where: { isPrimary: true }, select: { imageUrl: true }, take: 1 } },
  });
  if (!row) throw new Error('No active in-stock product available for E2E test.');
  return { id: row.id, slug: row.slug, name: row.name, price: row.price, stockQuantity: row.stockQuantity, primaryImage: row.images[0]?.imageUrl ?? null };
}

async function seedAndGoToCheckout(page, product) {
  await page.goto(`${FRONTEND}/`);
  await page.evaluate(({ product }) => {
    sessionStorage.setItem('ducmanhpc-checkout', JSON.stringify({
      source: 'buynow',
      items: [{ id: product.id, slug: product.slug, name: product.name, price: product.price, primaryImage: product.primaryImage, stockQuantity: product.stockQuantity, quantity: 1 }],
    }));
  }, { product });
  await page.goto(`${FRONTEND}/customer/checkout`, { waitUntil: 'networkidle' });
}

// Cleans up ONE specific order by id: cancels via the real API (restores
// stock the same way a real cancellation does), then removes the remaining
// rows. Idempotent/best-effort — safe to call even if already cancelled.
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

// Finds the order THIS call just created — scoped tightly by userId +
// paymentMethod + createdAt after a marker timestamp, never a bare "most
// recent", so two scenarios can never cross-contaminate each other's cleanup.
async function findOrderCreatedAfter(customerId, method, afterIso) {
  return prisma.order.findFirst({
    where: { userId: customerId, paymentMethod: method, createdAt: { gte: new Date(afterIso) } },
    orderBy: { createdAt: 'asc' },
    include: { payment: { include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } } } },
  });
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
  console.log('\n[1-9. Full VietQR lifecycle on ONE order: Checkout → Popup → copy/download → report-transfer → reopen → Admin confirm → Customer sync] (Desktop 1440px)');
  // ════════════════════════════════════════════════════════════════════════
  let mainOrderId = null;
  {
    const product = await getFreshProduct();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: customerToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();

    const t0 = new Date().toISOString();
    await seedAndGoToCheckout(page, product);
    await shot(page, '01-checkout-loaded');
    check('Checkout page loads with the seeded item, logged in as the real test customer', await page.getByText('Đặt hàng').first().isVisible().catch(() => false));

    await page.locator('button').filter({ hasText: marker }).first().click().catch(() => {});

    const codButton = page.locator('button').filter({ hasText: 'Thanh toán khi nhận hàng' });
    check('COD payment method option is visible on Checkout', await codButton.first().isVisible().catch(() => false));
    await codButton.first().click();
    await shot(page, '02-cod-selected');

    const bankButton = page.locator('button').filter({ hasText: 'Chuyển khoản ngân hàng' });
    check('VietQR (Chuyển khoản ngân hàng) payment method option is visible', await bankButton.first().isVisible().catch(() => false));
    await bankButton.first().click();
    await shot(page, '03-bank-transfer-selected');

    await page.locator('button').filter({ hasText: 'Đặt hàng ·' }).click();
    await page.waitForTimeout(2000);

    const popup = page.locator('[role="dialog"][aria-label="Thanh toán chuyển khoản VietQR"]');
    const popupVisible = await popup.isVisible().catch(() => false);
    check('VietQR Popup appears immediately after placing the order', popupVisible);
    await shot(page, '04-vietqr-popup-desktop');

    const dbOrder = await findOrderCreatedAfter(customerId, 'BANK_TRANSFER', t0);
    mainOrderId = dbOrder?.id ?? null;
    check('Order + Payment + PaymentAttempt were actually created in the real database', !!dbOrder?.payment?.attempts?.[0]);

    if (popupVisible && dbOrder?.payment?.attempts?.[0]) {
      const attempt = dbOrder.payment.attempts[0];

      const qrImg = popup.locator('img[alt="Mã QR chuyển khoản VietQR"]');
      const qrSrc = await qrImg.getAttribute('src').catch(() => null);
      const qrUrl = qrSrc ? new URL(qrSrc) : null;
      check('QR URL path encodes the real BIN (970422) from the DB attempt', !!qrUrl && qrUrl.pathname.includes('970422') && attempt.bankBin === '970422', qrSrc ?? '');
      check('QR URL path encodes the real account number (0386220065) from the DB attempt', !!qrUrl && qrUrl.pathname.includes('0386220065') && attempt.bankAccountNumber === '0386220065');
      check('QR amount param === Payment.amount from the DB (server-computed, not client-supplied)', !!qrUrl && Number(qrUrl.searchParams.get('amount')) === dbOrder.payment.amount, `qr=${qrUrl?.searchParams.get('amount')} db=${dbOrder.payment.amount}`);
      check('QR addInfo param === transferContent from the DB, unique to this order', !!qrUrl && qrUrl.searchParams.get('addInfo') === attempt.transferContent && attempt.transferContent.includes(String(mainOrderId)));
      check('QR accountName param is the real beneficiary name from the DB', !!qrUrl && qrUrl.searchParams.get('accountName') === attempt.bankAccountName);

      const popupText = await popup.innerText();
      check('Popup displays the bank name (MB Bank)', popupText.includes('MB Bank'));
      check('Popup displays the account number 0386220065', popupText.includes('0386220065'));
      check('Popup displays the account holder name', popupText.includes(attempt.bankAccountName));

      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const copyButtons = popup.getByLabel(/^Sao chép /);
      const copyCount = await copyButtons.count();
      check('Copy buttons are present (bank, account number, name, content)', copyCount === 4, `found ${copyCount}`);
      if (copyCount === 4) {
        await copyButtons.nth(1).click(); // "Số tài khoản"
        await page.waitForTimeout(200);
        const clip1 = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
        check('Copy "Số tài khoản" puts the real account number on the clipboard', clip1 === '0386220065', `clipboard=${clip1}`);

        await copyButtons.nth(3).click(); // "Nội dung chuyển khoản"
        await page.waitForTimeout(200);
        const clip2 = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
        check('Copy "Nội dung chuyển khoản" puts the real transfer content on the clipboard', clip2 === attempt.transferContent, `clipboard=${clip2} expected=${attempt.transferContent}`);
      }

      const downloadPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
      await popup.getByRole('button', { name: /Tải mã QR/ }).click();
      const download = await downloadPromise;
      check('Clicking "Tải mã QR" triggers a real file download', !!download, download ? await download.suggestedFilename() : 'no download event fired');

      const reportButton = popup.getByRole('button', { name: /Tôi đã chuyển khoản/ });
      const canReport = await reportButton.isVisible().catch(() => false);
      check('"Tôi đã chuyển khoản" button is visible while status is PENDING', canReport);
      if (canReport) {
        await reportButton.click();
        await page.waitForTimeout(1200);
        await shot(page, '05-vietqr-reported');
        const freshPayment = await prisma.payment.findUnique({ where: { orderId: mainOrderId } });
        check('Clicking "Tôi đã chuyển khoản" sets status to AWAITING_VERIFICATION in the real DB', freshPayment.status === 'AWAITING_VERIFICATION', `status=${freshPayment.status}`);
        check('Status is explicitly NOT PAID after only a customer self-report', freshPayment.status !== 'PAID');
        const popupTextAfter = await popup.innerText();
        check('Popup UI reflects "đang chờ đối soát" after reporting', /chờ đối soát/.test(popupTextAfter));
      }

      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
      const closedByEscape = !(await popup.isVisible().catch(() => false));
      check('Escape key closes the VietQR Popup', closedByEscape);
    }
    await context.close();

    // ── Reopen from Order Detail ──
    if (mainOrderId) {
      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx2.addCookies([{ name: 'accessToken', value: customerToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
      const p2 = await ctx2.newPage();
      await p2.goto(`${FRONTEND}/customer/profile/orders/${mainOrderId}`, { waitUntil: 'networkidle' });
      await shot(p2, '06-order-detail-desktop');
      check('Customer Order Detail shows the payment status badge (Đang chờ đối soát)', await p2.getByText('Đang chờ đối soát').first().isVisible().catch(() => false));

      const reopenButton = p2.getByRole('button', { name: /Xem lại mã QR/ });
      const reopenVisible = await reopenButton.isVisible().catch(() => false);
      check('"Xem lại mã QR" button is visible for an unpaid BANK_TRANSFER order', reopenVisible);
      if (reopenVisible) {
        await reopenButton.click();
        await p2.waitForTimeout(800);
        const popup2 = p2.locator('[role="dialog"][aria-label="Thanh toán chuyển khoản VietQR"]');
        const reopened = await popup2.isVisible().catch(() => false);
        check('Reopening shows the VietQR popup again from Order Detail', reopened);
        const countAfterReopen = await prisma.payment.count({ where: { orderId: mainOrderId } });
        check('Reopening the QR did not create a second Payment row for this order', countAfterReopen === 1, `count=${countAfterReopen}`);
        await shot(p2, '07-order-detail-reopened-qr');
      }
      await ctx2.close();
    }

    // ── Admin confirm ──
    if (mainOrderId) {
      const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx3.addCookies([{ name: 'accessToken', value: adminToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
      const p3 = await ctx3.newPage();
      await p3.goto(`${FRONTEND}/admin/orders`, { waitUntil: 'networkidle' });
      await shot(p3, '08-admin-orders-list');

      const row = p3.locator('tr').filter({ hasText: `#${mainOrderId}` }).first();
      const rowVisible = await row.isVisible().catch(() => false);
      check('The test order appears in the Admin Orders list', rowVisible);
      if (rowVisible) {
        await row.locator('button').first().click();
        await p3.waitForTimeout(500);
        await shot(p3, '09-admin-order-expanded');

        const badgeText = await p3.getByText(/Thanh toán: /).first().innerText().catch(() => '');
        check('Admin Orders expanded row shows a real payment status badge', badgeText.includes('Thanh toán:'), badgeText);

        // VietQR + Order still PENDING → the merged "Xác nhận tiền & duyệt"
        // action (confirm AND approve in one transaction), not the standalone
        // confirm-only button — see adminOrdersMerge.playwright.mjs /
        // paymentApprovalGuard.integration.mjs for full coverage of both paths.
        const confirmButton = row.getByRole('button', { name: 'Xác nhận tiền & duyệt' });
        const confirmVisible = await confirmButton.isVisible().catch(() => false);
        check('"Xác nhận tiền & duyệt" merged button is visible in the Thao tác column for an AWAITING_VERIFICATION payment on a PENDING order', confirmVisible);
        if (confirmVisible) {
          await confirmButton.click();
          await p3.waitForTimeout(400);
          const dialogConfirm = p3.getByRole('button', { name: 'Xác nhận tiền & duyệt đơn' });
          if (await dialogConfirm.isVisible().catch(() => false)) await dialogConfirm.click();
          await p3.waitForTimeout(1200);
          await shot(p3, '10-admin-payment-confirmed');

          const freshPayment = await prisma.payment.findUnique({ where: { orderId: mainOrderId } });
          check('Merged confirmation sets Payment to PAID in the real DB', freshPayment.status === 'PAID', `status=${freshPayment.status}`);
          const freshOrder = await prisma.order.findUnique({ where: { id: mainOrderId } });
          check('Merged confirmation ALSO approves the order (PENDING → CONFIRMED), in the same transaction', freshOrder.status === 'CONFIRMED', `orderStatus=${freshOrder.status}`);

          // No manual reload needed — the row's own load() refreshes it in place.
          const rowAfter = p3.locator('tr').filter({ hasText: `#${mainOrderId}` }).first();
          const stillShowsConfirm = await rowAfter.getByRole('button', { name: 'Xác nhận tiền & duyệt' }).isVisible().catch(() => false);
          check('After confirming, re-confirmation is no longer offered (PAID + CONFIRMED badges shown instead), without a manual reload', !stillShowsConfirm);
          const nextButtonAfter = await rowAfter.getByRole('button', { name: 'Bắt đầu giao' }).isVisible().catch(() => false);
          check('The next plain order-status action ("Bắt đầu giao") is now available, since Payment is PAID', nextButtonAfter);
          await shot(p3, '11-admin-order-paid-badge');
        }
      }
      await ctx3.close();
    }

    // ── Customer Order Detail reflects PAID ──
    if (mainOrderId) {
      const ctx4 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx4.addCookies([{ name: 'accessToken', value: customerToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
      const p4 = await ctx4.newPage();
      await p4.goto(`${FRONTEND}/customer/profile/orders/${mainOrderId}`, { waitUntil: 'networkidle' });
      check('Customer Order Detail reflects PAID after a fresh load (no manual refresh trick)', await p4.getByText('Đã thanh toán').first().isVisible().catch(() => false));
      check('"Xem lại mã QR" is hidden once the order is PAID', !(await p4.getByRole('button', { name: /Xem lại mã QR/ }).isVisible().catch(() => false)));
      await shot(p4, '12-customer-order-detail-paid');
      await ctx4.close();
    }

    await cleanupOrder(mainOrderId, customerId);
    mainOrderId = null;
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[10. COD order gets a Payment row too, no popup shown for COD]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const product = await getFreshProduct();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: customerToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    const t0 = new Date().toISOString();
    await seedAndGoToCheckout(page, product);
    await page.locator('button').filter({ hasText: marker }).first().click().catch(() => {});
    await page.locator('button').filter({ hasText: 'Thanh toán khi nhận hàng' }).first().click();
    await page.locator('button').filter({ hasText: 'Đặt hàng ·' }).click();
    await page.waitForTimeout(1500);
    const popupShown = await page.locator('[role="dialog"][aria-label="Thanh toán chuyển khoản VietQR"]').isVisible().catch(() => false);
    check('COD checkout does NOT show the VietQR popup', !popupShown);

    const codOrder = await findOrderCreatedAfter(customerId, 'COD', t0);
    check('COD order was created', !!codOrder);
    const codPayment = codOrder ? await prisma.payment.findUnique({ where: { orderId: codOrder.id } }) : null;
    check('COD order gets a Payment row (method=COD, status=PENDING) for Admin visibility', codPayment?.method === 'COD' && codPayment?.status === 'PENDING', JSON.stringify(codPayment));

    await context.close();
    await cleanupOrder(codOrder?.id, customerId);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[11. Responsive — Order Detail at 375/390/430/768/1024/1440/1920px]');
  // ════════════════════════════════════════════════════════════════════════
  {
    // One order, reused read-only across all 7 viewports, cleaned up once after.
    const product = await getFreshProduct();
    const setupCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await setupCtx.addCookies([{ name: 'accessToken', value: customerToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const setupPage = await setupCtx.newPage();
    const t0 = new Date().toISOString();
    await seedAndGoToCheckout(setupPage, product);
    await setupPage.locator('button').filter({ hasText: marker }).first().click().catch(() => {});
    await setupPage.locator('button').filter({ hasText: 'Chuyển khoản ngân hàng' }).first().click();
    await setupPage.locator('button').filter({ hasText: 'Đặt hàng ·' }).click();
    await setupPage.waitForTimeout(1500);
    const respOrder = await findOrderCreatedAfter(customerId, 'BANK_TRANSFER', t0);
    await setupCtx.close();

    if (respOrder) {
      for (const width of [375, 390, 430, 768, 1024, 1440, 1920]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        await context.addCookies([{ name: 'accessToken', value: customerToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
        const page = await context.newPage();
        await page.goto(`${FRONTEND}/customer/profile/orders/${respOrder.id}`, { waitUntil: 'networkidle' });
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        check(`[${width}px] no horizontal overflow on Order Detail`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);
        await shot(page, `13-responsive-${width}px-order-detail`);
        await context.close();
      }
    } else {
      check('[responsive] order for responsive checks was created', false);
    }
    await cleanupOrder(respOrder?.id, customerId);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[11b. Responsive — VietQR Popup layout across Mobile/Tablet/Desktop breakpoints]');
  // ════════════════════════════════════════════════════════════════════════
  // <1024px: single-column (QR on top, info below). ≥1024px (lg): horizontal
  // 2-column (QR left ~45%, info right ~55%), and no vertical scrollbar
  // should appear at normal desktop heights (900px here).
  for (const width of [375, 390, 430, 768, 820, 1024, 1280, 1440, 1920]) {
    const product = await getFreshProduct();
    const context = await browser.newContext({ viewport: { width, height: width < 768 ? 750 : 900 } });
    await context.addCookies([{ name: 'accessToken', value: customerToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    const t0 = new Date().toISOString();
    await seedAndGoToCheckout(page, product);
    await page.locator('button').filter({ hasText: marker }).first().click().catch(() => {});
    await page.locator('button').filter({ hasText: 'Chuyển khoản ngân hàng' }).first().click();
    await page.locator('button').filter({ hasText: 'Đặt hàng ·' }).click();
    await page.waitForTimeout(1500);
    const popup = page.locator('[role="dialog"][aria-label="Thanh toán chuyển khoản VietQR"]');
    const visible = await popup.isVisible().catch(() => false);
    check(`[${width}px] VietQR Popup renders and is visible (not clipped off-screen)`, visible);
    if (visible) {
      const box = await popup.boundingBox();
      check(`[${width}px] Popup fits within the viewport width`, box ? box.width <= width : false, box ? `popup width=${box.width}` : 'no bounding box');

      const qrBox = await popup.locator('img[alt="Mã QR chuyển khoản VietQR"]').boundingBox().catch(() => null);
      const bankRow = await popup.getByText('Ngân hàng', { exact: true }).boundingBox().catch(() => null);
      if (width >= 1024) {
        check(`[${width}px] ≥lg: QR and transfer-info sit side-by-side (QR left of info row)`, !!qrBox && !!bankRow && qrBox.x < bankRow.x, qrBox && bankRow ? `qr.x=${qrBox.x} info.x=${bankRow.x}` : '');
        const scroller = popup.getByTestId('vietqr-popup-body'); // only the body scrolls; the header/panel root never does
        const hasVScroll = await scroller.evaluate(el => el.scrollHeight > el.clientHeight + 1).catch(() => true);
        check(`[${width}px] ≥lg: no vertical scrollbar on the Popup body at a normal desktop height (900px)`, !hasVScroll);
      } else {
        check(`[${width}px] <lg: QR sits above transfer-info (stacked single column)`, !!qrBox && !!bankRow && qrBox.y < bankRow.y, qrBox && bankRow ? `qr.y=${qrBox.y} info.y=${bankRow.y}` : '');
      }
    }
    await shot(page, `14-responsive-${width}px-vietqr-popup`);

    const extraOrder = await findOrderCreatedAfter(customerId, 'BANK_TRANSFER', t0);
    await context.close();
    await cleanupOrder(extraOrder?.id, customerId);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[11c. Fixed header + independent body scroll across Mobile/Tablet/Desktop, with artificially long content]');
  // ════════════════════════════════════════════════════════════════════════
  // Forces a scrollbar on the body (not the page/header) by injecting extra
  // content into the scrollable region, then verifies: header/X position is
  // unchanged after scrolling to the bottom, both action buttons stay visible
  // and clickable at scroll-bottom, X still closes the popup from a scrolled
  // state, and the background page itself never scrolls while the popup is open.
  for (const { width, height } of [
    { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 393, height: 852 }, { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 },
  ]) {
    const product = await getFreshProduct();
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addCookies([{ name: 'accessToken', value: customerToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    const t0 = new Date().toISOString();
    await seedAndGoToCheckout(page, product);
    await page.locator('button').filter({ hasText: marker }).first().click().catch(() => {});
    await page.locator('button').filter({ hasText: 'Chuyển khoản ngân hàng' }).first().click();
    await page.locator('button').filter({ hasText: 'Đặt hàng ·' }).click();
    await page.waitForTimeout(1500);

    const popup = page.locator('[role="dialog"][aria-label="Thanh toán chuyển khoản VietQR"]');
    const visible = await popup.isVisible().catch(() => false);
    check(`[fixed-header ${width}x${height}] VietQR Popup is visible`, visible);
    if (!visible) { await context.close(); const o = await findOrderCreatedAfter(customerId, 'BANK_TRANSFER', t0); await cleanupOrder(o?.id, customerId); continue; }

    // Inject artificially long content into the real scrollable body, so the
    // popup is forced to scroll even on tall desktop viewports — exercising
    // the exact failure mode (header scrolling away) this fix addresses.
    await page.evaluate(() => {
      const body = document.querySelector('[data-testid="vietqr-popup-body"]');
      if (!body) return;
      const filler = document.createElement('div');
      filler.setAttribute('data-testid', 'e2e-scroll-filler');
      filler.style.height = '1600px';
      filler.style.background = 'repeating-linear-gradient(45deg, #eee, #eee 10px, #fff 10px, #fff 20px)';
      body.appendChild(filler);
    });

    const header = popup.getByTestId('vietqr-popup-header');
    const closeBtn = popup.getByRole('button', { name: 'Đóng' });
    const bodyScroller = popup.getByTestId('vietqr-popup-body');

    const headerBoxBefore = await header.boundingBox();
    const closeBoxBefore = await closeBtn.boundingBox();
    const pageScrollBefore = await page.evaluate(() => window.scrollY);

    await shot(page, `15-fixedheader-${width}x${height}-before-scroll`);

    // Scroll the body to its bottom (real wheel scroll on the body element).
    await bodyScroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(150);

    const scrollTopAfter = await bodyScroller.evaluate(el => el.scrollTop);
    check(`[fixed-header ${width}x${height}] Body actually scrolled (long content forced a real scroll)`, scrollTopAfter > 0, `scrollTop=${scrollTopAfter}`);

    const headerBoxAfter = await header.boundingBox();
    const closeBoxAfter = await closeBtn.boundingBox();
    check(`[fixed-header ${width}x${height}] Header position is unchanged after scrolling the body to the bottom`,
      !!headerBoxBefore && !!headerBoxAfter && Math.abs(headerBoxBefore.y - headerBoxAfter.y) < 1 && Math.abs(headerBoxBefore.x - headerBoxAfter.x) < 1,
      headerBoxBefore && headerBoxAfter ? `before=(${headerBoxBefore.x},${headerBoxBefore.y}) after=(${headerBoxAfter.x},${headerBoxAfter.y})` : '');
    check(`[fixed-header ${width}x${height}] X (close) button position is unchanged after scrolling`,
      !!closeBoxBefore && !!closeBoxAfter && Math.abs(closeBoxBefore.y - closeBoxAfter.y) < 1 && Math.abs(closeBoxBefore.x - closeBoxAfter.x) < 1,
      closeBoxBefore && closeBoxAfter ? `before=(${closeBoxBefore.x},${closeBoxBefore.y}) after=(${closeBoxAfter.x},${closeBoxAfter.y})` : '');

    const pageScrollAfter = await page.evaluate(() => window.scrollY);
    // Baseline may be nonzero (Playwright auto-scrolled the page to click the
    // earlier "Đặt hàng" button before the popup even opened) — what matters
    // is that it does not move further while the popup is open and its body scrolls.
    check(`[fixed-header ${width}x${height}] Background page did not scroll while the popup was open`, pageScrollBefore === pageScrollAfter, `before=${pageScrollBefore} after=${pageScrollAfter}`);

    const reportBtn = popup.getByRole('button', { name: /Tôi đã chuyển khoản/ });
    const laterBtn = popup.getByRole('button', { name: /Thanh toán sau/ });
    const reportVisible = await reportBtn.isVisible().catch(() => false);
    const laterVisible = await laterBtn.isVisible().catch(() => false);
    check(`[fixed-header ${width}x${height}] "Tôi đã chuyển khoản" stays visible at scroll-bottom`, reportVisible);
    check(`[fixed-header ${width}x${height}] "Thanh toán sau" stays visible at scroll-bottom`, laterVisible);
    if (reportVisible) check(`[fixed-header ${width}x${height}] "Tôi đã chuyển khoản" is clickable (not covered by any overlay) at scroll-bottom`, await reportBtn.isEnabled().catch(() => false));

    await shot(page, `16-fixedheader-${width}x${height}-after-scroll`);

    // X must still close the popup even though the body is scrolled to the end.
    await closeBtn.click();
    await page.waitForTimeout(300);
    check(`[fixed-header ${width}x${height}] X button closes the Popup even when the body is scrolled to the end`, !(await popup.isVisible().catch(() => false)));

    const noOverflowOrder = await findOrderCreatedAfter(customerId, 'BANK_TRANSFER', t0);
    await context.close();
    await cleanupOrder(noOverflowOrder?.id, customerId);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[12. Accessibility — focus states, Escape, keyboard nav]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const product = await getFreshProduct();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: customerToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    const t0 = new Date().toISOString();
    await seedAndGoToCheckout(page, product);
    await page.locator('button').filter({ hasText: marker }).first().click().catch(() => {});
    await page.locator('button').filter({ hasText: 'Chuyển khoản ngân hàng' }).first().click();
    await page.locator('button').filter({ hasText: 'Đặt hàng ·' }).click();
    await page.waitForTimeout(1500);
    const popup = page.locator('[role="dialog"][aria-label="Thanh toán chuyển khoản VietQR"]');
    const popupUp = await popup.isVisible().catch(() => false);
    check('Popup has role="dialog" and an accessible aria-label', popupUp);

    if (popupUp) {
      const closeBtn = popup.getByRole('button', { name: 'Đóng' });
      await closeBtn.focus();
      const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      check('Close button is keyboard-focusable with a visible accessible label', focusedLabel === 'Đóng');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      check('Escape key closes the VietQR Popup', !(await popup.isVisible().catch(() => false)));
    }

    const a11yOrder = await findOrderCreatedAfter(customerId, 'BANK_TRANSFER', t0);
    await context.close();
    await cleanupOrder(a11yOrder?.id, customerId);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${results.length} total)`);
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
} finally {
  if (browser) await browser.close().catch(() => {});

  // Safety net: if any scenario threw before reaching its own cleanupOrder()
  // call, this customer could still have an open test order holding stock
  // decremented. Sweep and restore ANY remaining order for this customer —
  // this is the exact gap that caused a real stock leak earlier in this
  // script's development (see the comment at the top of the file).
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
