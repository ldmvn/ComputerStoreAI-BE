// Real browser E2E for the "hợp nhất quản lý Đơn hàng và Thanh toán" merge:
// /admin/orders must show payment method + payment status columns/filters
// and the VietQR confirm action that used to live on the now-removed
// /admin/payments page, and /admin/payments itself must redirect there.
import 'dotenv/config';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';
import { createAccessToken } from '../../src/services/token.service.js';

const FRONTEND = process.env.E2E_FRONTEND_URL || 'http://localhost:3000';
const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:5000';
const SCREENSHOT_DIR = 'C:/Users/ldm/AppData/Local/Temp/claude/f--ComputerStoreAI/0d79ae52-5e92-4676-b24e-4cf89f4ce3ff/scratchpad/e2e-screens';
const marker = `e2e-merge-${randomUUID().slice(0, 8)}`;

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

  // ── Seed 3 orders: VietQR (reported, awaiting verification), COD, and a
  // "legacy" order with its Payment row stripped off to simulate a pre-
  // Payment-Module record. ──
  const bankOrder = await createOrder(customerToken, addressId, await getFreshProduct(), 'BANK_TRANSFER');
  await fetch(`${BACKEND}/api/payments/orders/${bankOrder.id}/report-transfer`, { method: 'POST', headers: { Authorization: `Bearer ${customerToken}` } });

  const codOrder = await createOrder(customerToken, addressId, await getFreshProduct(), 'COD');

  const legacyOrder = await createOrder(customerToken, addressId, await getFreshProduct(), 'BANK_TRANSFER');
  await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId: legacyOrder.id } } });
  await prisma.payment.deleteMany({ where: { orderId: legacyOrder.id } });

  browser = await chromium.launch();

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[1. /admin/orders shows unified columns: Phương thức + Thanh toán, independent of Order Status]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: adminToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.goto(`${FRONTEND}/admin/orders`, { waitUntil: 'networkidle' });
    await shot(page, '20-admin-orders-merged-desktop');

    const headerRow = page.locator('thead tr').first();
    // The header cells are visually `uppercase` via CSS — innerText reflects
    // the rendered (uppercase) text, not the source-case string.
    const headerText = (await headerRow.innerText()).toUpperCase();
    check('Table header has "Phương thức" column', headerText.includes('PHƯƠNG THỨC'));
    check('Table header has "Thanh toán" column', headerText.includes('THANH TOÁN'));
    check('Table header has "Trạng thái đơn" column', headerText.includes('TRẠNG THÁI ĐƠN'));
    check('Table header order matches spec (Đơn hàng → Khách hàng → Phương thức → Thanh toán → Trạng thái đơn → Tổng tiền → Thao tác)',
      /ĐƠN HÀNG[\s\S]*KHÁCH HÀNG[\s\S]*PHƯƠNG THỨC[\s\S]*THANH TOÁN[\s\S]*TRẠNG THÁI ĐƠN[\s\S]*TỔNG TIỀN[\s\S]*THAO TÁC/.test(headerText));

    const bankRow = page.locator('tr').filter({ hasText: `#${bankOrder.id}` }).first();
    const bankRowText = await bankRow.innerText().catch(() => '');
    check('[VietQR order] row shows "VietQR" method badge', bankRowText.includes('VietQR'));
    check('[VietQR order] row shows "Đang chờ đối soát" payment status (self-report, not verified)', bankRowText.includes('Đang chờ đối soát'));

    const codRow = page.locator('tr').filter({ hasText: `#${codOrder.id}` }).first();
    const codRowText = await codRow.innerText().catch(() => '');
    check('[COD order] row shows "COD" method badge', codRowText.includes('COD'));
    check('[COD order] row shows "Chờ thanh toán" (COD never auto-PAID)', codRowText.includes('Chờ thanh toán'));

    const legacyRow = page.locator('tr').filter({ hasText: `#${legacyOrder.id}` }).first();
    const legacyRowText = await legacyRow.innerText().catch(() => '');
    check('[Legacy order w/o Payment row] shows "Chưa có dữ liệu" instead of assuming paid', legacyRowText.includes('Chưa có dữ liệu'));
    check('[Legacy order] does NOT show "Đã thanh toán" (no false-positive PAID assumption)', !legacyRowText.includes('Đã thanh toán'));

    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[2. Filters actually scope the query — paymentMethod + paymentStatus]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: adminToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.goto(`${FRONTEND}/admin/orders`, { waitUntil: 'networkidle' });

    await page.selectOption('select[aria-label="Lọc theo phương thức thanh toán"]', 'COD');
    await page.waitForTimeout(600);
    const afterMethodFilter = await page.locator('tbody').innerText();
    check('Filter "COD" hides the VietQR order', !afterMethodFilter.includes(`#${bankOrder.id}`));
    check('Filter "COD" still shows the COD order', afterMethodFilter.includes(`#${codOrder.id}`));
    await shot(page, '21-admin-orders-filter-method-cod');

    await page.selectOption('select[aria-label="Lọc theo phương thức thanh toán"]', '');
    await page.selectOption('select[aria-label="Lọc theo trạng thái thanh toán"]', 'AWAITING_VERIFICATION');
    await page.waitForTimeout(600);
    const afterStatusFilter = await page.locator('tbody').innerText();
    check('Filter "Chờ xác minh" shows the VietQR order', afterStatusFilter.includes(`#${bankOrder.id}`));
    check('Filter "Chờ xác minh" hides the COD order (different payment status)', !afterStatusFilter.includes(`#${codOrder.id}`));
    check('Filter "Chờ xác minh" correctly excludes the legacy order with no Payment row', !afterStatusFilter.includes(`#${legacyOrder.id}`));
    await shot(page, '22-admin-orders-filter-status-awaiting');

    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[3. VietQR merged "Xác nhận tiền & duyệt" action works directly from the Order row]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: adminToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.goto(`${FRONTEND}/admin/orders`, { waitUntil: 'networkidle' });

    const row = page.locator('tr').filter({ hasText: `#${bankOrder.id}` }).first();
    await row.locator('button').first().click(); // expand — informational detail still lives there
    await page.waitForTimeout(400);
    await shot(page, '23-admin-orders-expanded-vietqr-detail');

    const expandedText = await page.locator(`tr:has-text("#${bankOrder.id}") + tr`).innerText().catch(() => '');
    check('Expanded row shows the beneficiary bank account info', expandedText.includes('STK:'));
    check('Expanded row shows the transfer content', /Nội dung CK:/.test(expandedText));
    check('Expanded row shows when the customer reported the transfer', /Khách báo CK lúc:/.test(expandedText));

    // bankOrder is still PENDING with an AWAITING_VERIFICATION payment at
    // this point — exactly the case the merged action targets. No separate
    // "duyệt" button should exist for it.
    check('No separate plain "Xác nhận" (duyệt) button exists while unpaid — only the merged action', !(await row.getByRole('button', { name: 'Xác nhận', exact: true }).isVisible().catch(() => false)));

    const confirmBtn = row.getByRole('button', { name: 'Xác nhận tiền & duyệt' });
    const confirmVisible = await confirmBtn.isVisible().catch(() => false);
    check('"Xác nhận tiền & duyệt" merged button is present directly in the Thao tác column', confirmVisible);
    if (confirmVisible) {
      await confirmBtn.click();
      await page.waitForTimeout(400);
      const dialogConfirm = page.getByRole('button', { name: 'Xác nhận tiền & duyệt đơn' });
      if (await dialogConfirm.isVisible().catch(() => false)) await dialogConfirm.click();
      await page.waitForTimeout(1200);

      const freshPayment = await prisma.payment.findUnique({ where: { orderId: bankOrder.id } });
      check('Merged action sets Payment to PAID in the real DB', freshPayment?.status === 'PAID', `status=${freshPayment?.status}`);
      const freshOrder = await prisma.order.findUnique({ where: { id: bankOrder.id } });
      check('Merged action ALSO approves the Order (PENDING → CONFIRMED) in the same transaction', freshOrder?.status === 'CONFIRMED', `orderStatus=${freshOrder?.status}`);

      const rowAfter = page.locator('tr').filter({ hasText: `#${bankOrder.id}` }).first();
      check('Merged button disappears; plain "Bắt đầu giao" now available since Payment is PAID', await rowAfter.getByRole('button', { name: 'Bắt đầu giao' }).isVisible().catch(() => false));
    }

    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[3b. VietQR merge Dialog: Hủy does not mutate data; duplicate request is a safe no-op; legacy unpaid-but-advanced order gets the standalone confirm instead]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const bankOrder2 = await createOrder(customerToken, addressId, await getFreshProduct(), 'BANK_TRANSFER');
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: adminToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.goto(`${FRONTEND}/admin/orders`, { waitUntil: 'networkidle' });
    const row = page.locator('tr').filter({ hasText: `#${bankOrder2.id}` }).first();

    const confirmBtn = row.getByRole('button', { name: 'Xác nhận tiền & duyệt' });
    check('"Xác nhận tiền & duyệt" button is visible directly in the Thao tác column (no expand click)', await confirmBtn.isVisible().catch(() => false));
    await shot(page, '26-admin-orders-action-column-confirm-button');

    // Clicking Hủy (Cancel) in the Dialog must NOT mutate Payment OR Order.
    await confirmBtn.click();
    await page.waitForTimeout(300);
    const cancelBtn = page.getByRole('button', { name: 'Hủy' }).last();
    await cancelBtn.click();
    await page.waitForTimeout(300);
    const paymentAfterCancelDialog = await prisma.payment.findUnique({ where: { orderId: bankOrder2.id } });
    const orderAfterCancelDialog = await prisma.order.findUnique({ where: { id: bankOrder2.id } });
    check('[#3 required] Clicking "Hủy" in the Confirmation Dialog leaves Payment unchanged (still PENDING)', paymentAfterCancelDialog?.status === 'PENDING', `status=${paymentAfterCancelDialog?.status}`);
    check('[#3 required] Clicking "Hủy" in the Confirmation Dialog leaves Order unchanged (still PENDING)', orderAfterCancelDialog?.status === 'PENDING', `status=${orderAfterCancelDialog?.status}`);

    // Now actually confirm — the real Dialog flow, with the full set of
    // fields the spec requires: mã đơn, khách hàng, số tiền, ngân hàng, nội
    // dung CK, trạng thái thanh toán hiện tại + the mandated warning text.
    await confirmBtn.click();
    await page.waitForTimeout(300);
    const dialogText = await page.getByRole('alertdialog').innerText();
    check('Dialog shows mã đơn hàng', dialogText.includes(`#${bankOrder2.id}`));
    check('Dialog shows khách hàng', dialogText.includes(marker));
    check('Dialog shows số tiền cần nhận', /\d/.test(dialogText));
    check('Dialog shows ngân hàng thụ hưởng (MB Bank + STK)', dialogText.includes('MB Bank') && dialogText.includes('0386220065'));
    check('Dialog shows nội dung chuyển khoản', /DUCMANHPC DH\d+/.test(dialogText));
    check('Dialog shows trạng thái thanh toán hiện tại', dialogText.includes('Đang chờ đối soát') || dialogText.includes('Chờ thanh toán'));
    check('Dialog shows the mandated warning that a customer self-report is not proof of payment', dialogText.includes('không phải bằng chứng đã nhận tiền'));
    const realConfirmBtn = page.getByRole('button', { name: 'Xác nhận tiền & duyệt đơn' });
    check('Dialog has a dedicated "Xác nhận tiền & duyệt đơn" button (not generic "Xác nhận")', await realConfirmBtn.isVisible().catch(() => false));
    await realConfirmBtn.click();
    await page.waitForTimeout(1000);
    await shot(page, '27-admin-orders-action-column-confirmed');

    const paymentAfterConfirm = await prisma.payment.findUnique({ where: { orderId: bankOrder2.id } });
    const orderAfterConfirm = await prisma.order.findUnique({ where: { id: bankOrder2.id } });
    check('[#1] Payment.status is PAID after confirming, without a manual page reload', paymentAfterConfirm?.status === 'PAID', `status=${paymentAfterConfirm?.status}`);
    check('[#1] Order.status is CONFIRMED after confirming, in the same transaction', orderAfterConfirm?.status === 'CONFIRMED', `status=${orderAfterConfirm?.status}`);
    const rowAfter = page.locator('tr').filter({ hasText: `#${bankOrder2.id}` }).first();
    check('"Xác nhận tiền & duyệt" button disappears once approved', !(await rowAfter.getByRole('button', { name: 'Xác nhận tiền & duyệt' }).isVisible().catch(() => false)));
    check('Payment badge shows "Đã thanh toán" in place, no manual reload', (await rowAfter.innerText()).includes('Đã thanh toán'));
    check('Order badge shows "Đã xác nhận" in place, no manual reload', (await rowAfter.innerText()).includes('Đã xác nhận'));

    // [#12] Click-many-times guard: re-driving the same merge request via
    // the API after the UI button is already gone (simulating a stale
    // double-submit) must still resolve to a safe idempotent no-op on BOTH
    // Payment and Order — never a duplicate approval or a second History row.
    const historyCountBefore = await prisma.orderStatusHistory.count({ where: { orderId: bankOrder2.id, status: 'CONFIRMED' } });
    const res = await fetch(`${BACKEND}/api/admin/payments/orders/${bankOrder2.id}/confirm-and-approve`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
    const body = await res.json();
    // By now the Order is already CONFIRMED (not PENDING), so the service's
    // own upfront guard rejects the duplicate request outright (409, no
    // second write attempted at all) — a stricter, equally-safe outcome than
    // routing through confirmPaymentAttempt()'s "duplicate_same_attempt" path,
    // which only applies while the Order is still genuinely PENDING.
    check('[#12] A duplicate merge request after the button is gone is safely rejected (no success, no second write)', res.status === 409 && body.success === false, JSON.stringify(body));
    const historyCountAfter = await prisma.orderStatusHistory.count({ where: { orderId: bankOrder2.id, status: 'CONFIRMED' } });
    check('[#12] No duplicate OrderStatusHistory("CONFIRMED") row was created by the duplicate request', historyCountAfter === historyCountBefore, `before=${historyCountBefore} after=${historyCountAfter}`);

    await context.close();
    await cleanupOrder(bankOrder2.id, customerId);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[3c. VietQR legacy exception — Order already advanced past PENDING, still unpaid → standalone "Xác nhận đã nhận tiền", never the merge button, never touches Order Status]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const legacyUnpaidOrder = await createOrder(customerToken, addressId, await getFreshProduct(), 'BANK_TRANSFER');
    // Approve it directly via a real COD-like path is not possible for
    // BANK_TRANSFER anymore (the new guard blocks it) — so this legacy state
    // is simulated the same way real pre-existing data got into it: directly
    // setting Order.status, exactly mirroring an order approved before this
    // guard existed. This does not touch Payment, which stays PENDING.
    await prisma.order.update({ where: { id: legacyUnpaidOrder.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: adminToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.goto(`${FRONTEND}/admin/orders`, { waitUntil: 'networkidle' });
    const row = page.locator('tr').filter({ hasText: `#${legacyUnpaidOrder.id}` }).first();

    check('[#8] Merge button is NOT offered for an order already past PENDING', !(await row.getByRole('button', { name: 'Xác nhận tiền & duyệt' }).isVisible().catch(() => false)));
    check('[#8] Plain "Bắt đầu giao" is also NOT offered while unpaid (guard applies to SHIPPING too)', !(await row.getByRole('button', { name: 'Bắt đầu giao' }).isVisible().catch(() => false)));
    const standaloneBtn = row.getByRole('button', { name: 'Xác nhận đã nhận tiền' });
    check('[#8] Standalone "Xác nhận đã nhận tiền" is offered instead', await standaloneBtn.isVisible().catch(() => false));
    await standaloneBtn.click();
    await page.waitForTimeout(300);
    // Scoped to the dialog itself — the trigger button in the row behind it
    // has the exact same accessible name ("Xác nhận đã nhận tiền"), which
    // would otherwise make this locator ambiguous.
    const dialogConfirm = page.getByRole('alertdialog').getByRole('button', { name: 'Xác nhận đã nhận tiền' });
    if (await dialogConfirm.isVisible().catch(() => false)) await dialogConfirm.click();
    await page.waitForTimeout(1000);

    const freshPayment = await prisma.payment.findUnique({ where: { orderId: legacyUnpaidOrder.id } });
    const freshOrder = await prisma.order.findUnique({ where: { id: legacyUnpaidOrder.id } });
    check('[#8] Standalone confirm sets Payment to PAID', freshPayment?.status === 'PAID', `status=${freshPayment?.status}`);
    check('[#8] Standalone confirm does NOT touch Order Status (stays CONFIRMED, not re-approved/re-ordered)', freshOrder?.status === 'CONFIRMED', `status=${freshOrder?.status}`);

    const rowAfter = page.locator('tr').filter({ hasText: `#${legacyUnpaidOrder.id}` }).first();
    check('"Bắt đầu giao" now becomes available once Payment is PAID', await rowAfter.getByRole('button', { name: 'Bắt đầu giao' }).isVisible().catch(() => false));

    await context.close();
    await cleanupOrder(legacyUnpaidOrder.id, customerId);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[3c. Secondary "Hủy đơn hàng" action moved into the "···" kebab menu]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const cancelableOrder = await createOrder(customerToken, addressId, await getFreshProduct(), 'COD');
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: adminToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.goto(`${FRONTEND}/admin/orders`, { waitUntil: 'networkidle' });
    const row = page.locator('tr').filter({ hasText: `#${cancelableOrder.id}` }).first();

    check('"Hủy đơn hàng" is NOT shown as an inline button in the row (moved to the kebab menu)', !(await row.getByRole('button', { name: 'Hủy', exact: true }).isVisible().catch(() => false)));
    const kebab = row.getByRole('button', { name: 'Thao tác khác' });
    check('"···" kebab menu trigger is visible for a cancellable order', await kebab.isVisible().catch(() => false));
    await kebab.click();
    await page.waitForTimeout(200);
    const cancelMenuItem = page.getByRole('button', { name: 'Hủy đơn hàng' });
    check('Kebab menu reveals "Hủy đơn hàng"', await cancelMenuItem.isVisible().catch(() => false));
    await shot(page, '28-admin-orders-kebab-menu-open');
    await context.close();
    await cleanupOrder(cancelableOrder.id, customerId);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[4. /admin/payments redirects to /admin/orders; Sidebar no longer has "Thanh toán"]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: adminToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.goto(`${FRONTEND}/admin/payments`, { waitUntil: 'networkidle' });
    await page.waitForURL('**/admin/orders', { timeout: 5000 }).catch(() => {});
    check('Visiting /admin/payments redirects to /admin/orders', page.url().includes('/admin/orders'), page.url());
    await shot(page, '24-admin-payments-redirected');

    const sidebarText = await page.locator('aside, nav').first().innerText().catch(() => '');
    check('Sidebar no longer contains a "Thanh toán" menu item', !sidebarText.includes('Thanh toán'));
    check('Sidebar still contains "Đơn hàng"', sidebarText.includes('Đơn hàng'));

    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[5. Responsive — /admin/orders at 375/390/430/768/1024/1440/1920px, no horizontal overflow]');
  // ════════════════════════════════════════════════════════════════════════
  for (const width of [375, 390, 430, 768, 1024, 1440, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'accessToken', value: adminToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.goto(`${FRONTEND}/admin/orders`, { waitUntil: 'networkidle' });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    check(`[${width}px] no horizontal page overflow on /admin/orders`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);
    if (width < 640) {
      const codRowText = await page.locator('tr').filter({ hasText: `#${codOrder.id}` }).first().innerText().catch(() => '');
      check(`[${width}px] method + payment-status badges still visible on mobile (via the compact under-ID layout)`, codRowText.includes('COD') && codRowText.includes('Chờ thanh toán'));
    }
    await shot(page, `25-admin-orders-responsive-${width}px`);
    await context.close();
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
