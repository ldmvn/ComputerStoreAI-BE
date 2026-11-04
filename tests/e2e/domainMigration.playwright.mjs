// Real browser E2E for the "Frontend/Backend dùng chung domain" migration —
// verifies the browser NEVER talks to the backend directly anymore (no
// :5000 requests, no CORS needed) and instead goes through Next.js
// rewrites() at the SAME origin. Run against localhost:3000 (default) or
// the live domain via E2E_FRONTEND_URL=https://ducmanh.store — cookie
// domain/secure flags below are derived from that URL so the same script
// works against either target unmodified.
import 'dotenv/config';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';
import { createAccessToken } from '../../src/services/token.service.js';

const FRONTEND = process.env.E2E_FRONTEND_URL || 'http://localhost:3000';
const FRONTEND_URL = new URL(FRONTEND);
const COOKIE_DOMAIN = FRONTEND_URL.hostname;
const COOKIE_SECURE = FRONTEND_URL.protocol === 'https:';
const SCREENSHOT_DIR = 'C:/Users/ldm/AppData/Local/Temp/claude/f--ComputerStoreAI/0d79ae52-5e92-4676-b24e-4cf89f4ce3ff/scratchpad/e2e-screens';
const marker = `e2e-domain-${randomUUID().slice(0, 8)}`;

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

function accessTokenCookie(value) {
  return { name: 'accessToken', value, domain: COOKIE_DOMAIN, path: '/', httpOnly: true, secure: COOKIE_SECURE, sameSite: 'Strict' };
}

// Tracks every outgoing request URL on a page, to assert none of them ever
// hit the backend port directly (the whole point of the rewrite migration).
function trackDirectBackendCalls(page, offenders) {
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes(':5000') || url.includes('127.0.0.1:5000')) offenders.push(url);
  });
}

// Catches real browser-reported CORS/Mixed-Content failures — these surface
// as console errors or failed requests, never as thrown JS exceptions.
function trackConsoleViolations(page, violations) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/cors|cross-origin|mixed content|blocked:mixed-content/i.test(text)) violations.push(text);
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText || '';
    if (/mixed-content|blocked/i.test(failure)) violations.push(`${req.url()} :: ${failure}`);
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
  console.log('\n[1. Home — Banner + Product sections load via the /api rewrite, no direct :5000 calls]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const offenders = [];
    const violations = [];
    let categoryMenuStatus = null;
    trackDirectBackendCalls(page, offenders);
    trackConsoleViolations(page, violations);
    page.on('response', (res) => { if (res.url().includes('/api/categories/menu') || res.url().includes('/api/mega-menu')) categoryMenuStatus = res.status(); });
    await page.goto(`${FRONTEND}/`, { waitUntil: 'networkidle' });
    await shot(page, '40-domain-home-desktop');

    check('No browser request ever hit the backend port directly (:5000)', offenders.length === 0, JSON.stringify(offenders.slice(0, 5)));
    check('Home page rendered without a hard error boundary', !(await page.getByText('Application error').isVisible().catch(() => false)));
    check('No CORS or Mixed-Content violation reported by the browser itself', violations.length === 0, JSON.stringify(violations.slice(0, 5)));

    const img = page.locator('img').first();
    const imgSrc = await img.getAttribute('src').catch(() => null);
    check('Images resolve to a relative/same-origin path (via the /media rewrite or Next/Image), not an absolute :5000 URL', !imgSrc || !imgSrc.includes(':5000'), imgSrc ?? '');

    // Danh mục (category/mega-menu) — exercises the categories API through the rewrite.
    check('Danh mục (category/mega-menu) API call through the rewrite returned 200', categoryMenuStatus === 200, `status=${categoryMenuStatus}`);

    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[2. Sản phẩm — product catalog + detail load correctly]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const offenders = [];
    const violations = [];
    trackDirectBackendCalls(page, offenders);
    trackConsoleViolations(page, violations);
    await page.goto(`${FRONTEND}/customer/products`, { waitUntil: 'networkidle' });
    await shot(page, '41-domain-products-desktop');
    check('Product catalog page loads with at least one product card', await page.locator('a[href^="/products/"]').first().isVisible().catch(() => false));
    check('No direct :5000 calls while browsing the catalog', offenders.length === 0, JSON.stringify(offenders.slice(0, 5)));
    check('No CORS or Mixed-Content violation on the catalog', violations.length === 0, JSON.stringify(violations.slice(0, 5)));

    const firstProduct = page.locator('a[href^="/products/"]').first();
    const href = await firstProduct.getAttribute('href').catch(() => null);
    if (href) {
      await page.goto(`${FRONTEND}${href}`, { waitUntil: 'networkidle' });
      await shot(page, '42-domain-product-detail-desktop');
      check('Product Detail page renders (name/price visible)', await page.locator('h1').first().isVisible().catch(() => false));
    }
    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[3. Đăng nhập — real login round-trip through the same-origin API]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const realPassword = 'E2eDomain#12345';
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.default.hash(realPassword, 10);
    await prisma.user.update({ where: { id: customerId }, data: { passwordHash: hash } });

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const offenders = [];
    const violations = [];
    trackDirectBackendCalls(page, offenders);
    trackConsoleViolations(page, violations);
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'networkidle' });
    await page.locator('#modal-login-email').fill(customer.email);
    await page.locator('#modal-login-password').fill(realPassword);
    await shot(page, '43-domain-login-filled');
    await page.locator('button[type="submit"]').filter({ hasText: 'Đăng nhập' }).click();
    // Poll instead of a fixed sleep — the real domain (Cloudflare Tunnel)
    // has meaningfully higher round-trip latency than loopback localhost.
    let hasAccessCookie = false;
    for (let i = 0; i < 20 && !hasAccessCookie; i++) {
      await page.waitForTimeout(500);
      hasAccessCookie = (await context.cookies()).some(c => c.name === 'accessToken');
    }
    check('Login sets the real accessToken cookie via the same-origin /api/auth call', hasAccessCookie);
    check('No direct :5000 calls during login', offenders.length === 0, JSON.stringify(offenders.slice(0, 5)));
    check('No CORS or Mixed-Content violation during login', violations.length === 0, JSON.stringify(violations.slice(0, 5)));
    await shot(page, '44-domain-login-success');
    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[4. Giỏ hàng + Checkout — session/cart flow and order creation through the same-origin API]');
  // ════════════════════════════════════════════════════════════════════════
  let smokeOrderId = null;
  {
    const product = await prisma.product.findFirst({
      where: { isDeleted: false, isActive: true, stockQuantity: { gt: 1 } },
      orderBy: { stockQuantity: 'desc' },
      select: { id: true, slug: true, name: true, price: true, stockQuantity: true, images: { where: { isPrimary: true }, select: { imageUrl: true }, take: 1 } },
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([accessTokenCookie(customerToken)]);
    const page = await context.newPage();
    const offenders = [];
    const violations = [];
    trackDirectBackendCalls(page, offenders);
    trackConsoleViolations(page, violations);

    await page.goto(`${FRONTEND}/`);
    await page.evaluate(({ product }) => {
      sessionStorage.setItem('ducmanhpc-checkout', JSON.stringify({
        source: 'buynow',
        items: [{ id: product.id, slug: product.slug, name: product.name, price: product.price, primaryImage: product.images[0]?.imageUrl ?? null, stockQuantity: product.stockQuantity, quantity: 1 }],
      }));
    }, { product });
    await page.goto(`${FRONTEND}/customer/checkout`, { waitUntil: 'networkidle' });
    await shot(page, '45-domain-checkout-desktop');
    check('Checkout page loads the seeded item (giỏ hàng/session flow works)', await page.getByText('Đặt hàng').first().isVisible().catch(() => false));

    await page.locator('button').filter({ hasText: marker }).first().click().catch(() => {});
    const codButton = page.locator('button').filter({ hasText: 'Thanh toán khi nhận hàng' });
    if (await codButton.first().isVisible().catch(() => false)) await codButton.first().click();
    const t0 = new Date().toISOString();
    await page.locator('button').filter({ hasText: 'Đặt hàng ·' }).click();

    // Poll instead of a fixed sleep — same higher-latency reasoning as login above.
    let createdOrder = null;
    for (let i = 0; i < 20 && !createdOrder; i++) {
      await page.waitForTimeout(500);
      createdOrder = await prisma.order.findFirst({ where: { userId: customerId, createdAt: { gte: new Date(t0) } }, orderBy: { createdAt: 'asc' } });
    }
    smokeOrderId = createdOrder?.id ?? null;
    check('Order was actually created in the real DB through the same-origin API', !!createdOrder);
    check('No direct :5000 calls during checkout', offenders.length === 0, JSON.stringify(offenders.slice(0, 5)));
    check('No CORS or Mixed-Content violation during checkout', violations.length === 0, JSON.stringify(violations.slice(0, 5)));
    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[5. Admin — /admin/orders loads real data through the same-origin API]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([accessTokenCookie(adminToken)]);
    const page = await context.newPage();
    const offenders = [];
    const violations = [];
    trackDirectBackendCalls(page, offenders);
    trackConsoleViolations(page, violations);
    await page.goto(`${FRONTEND}/admin/orders`, { waitUntil: 'networkidle' });
    await shot(page, '46-domain-admin-orders-desktop');
    check('Admin Orders table renders with real rows', await page.locator('table tbody tr').first().isVisible().catch(() => false));
    check('Admin Orders page shows the just-created smoke-test order', smokeOrderId ? await page.getByText(`#${smokeOrderId}`).first().isVisible().catch(() => false) : true);
    check('No direct :5000 calls on the Admin dashboard', offenders.length === 0, JSON.stringify(offenders.slice(0, 5)));
    check('No CORS or Mixed-Content violation on the Admin dashboard', violations.length === 0, JSON.stringify(violations.slice(0, 5)));
    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[6. Mobile — Home + Checkout at 390px through the same rewrite path]');
  // ════════════════════════════════════════════════════════════════════════
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const offenders = [];
    const violations = [];
    trackDirectBackendCalls(page, offenders);
    trackConsoleViolations(page, violations);
    await page.goto(`${FRONTEND}/`, { waitUntil: 'networkidle' });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    check('[390px] No horizontal overflow on Home', scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);
    check('[390px] No direct :5000 calls on mobile Home', offenders.length === 0, JSON.stringify(offenders.slice(0, 5)));
    check('[390px] No CORS or Mixed-Content violation on mobile Home', violations.length === 0, JSON.stringify(violations.slice(0, 5)));
    await shot(page, '47-domain-home-mobile');
    await context.close();
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${results.length} total)`);
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
} finally {
  if (browser) await browser.close().catch(() => {});

  // Safety net: clean up the smoke-test order (COD → cancel restores stock)
  // and all throwaway users/address, regardless of pass/fail.
  if (customerId) {
    const stragglers = await prisma.order.findMany({ where: { userId: customerId }, select: { id: true } }).catch(() => []);
    for (const { id } of stragglers) {
      const token = createAccessToken({ id: customerId, role: 'CUSTOMER' });
      await fetch(`${process.env.E2E_BACKEND_URL || 'http://localhost:5000'}/api/orders/${id}/cancel`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
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
