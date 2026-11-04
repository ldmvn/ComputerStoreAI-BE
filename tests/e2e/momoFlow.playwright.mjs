// Real browser E2E for the MoMo redirect flow: seeds a throwaway MOMO order
// for the admin user, opens the order-detail page, clicks "Thanh toán qua MoMo",
// and verifies the browser is redirected to MoMo's real sandbox hosted page
// (test-payment.momo.vn) — i.e. the FE → createMomoPayment → real MoMo create →
// payUrl → redirect wiring works end to end. Cleans up in finally. Marking the
// order PAID is covered by the IPN integration test (a real sandbox payment
// needs the public domain + a manual app payment).
import 'dotenv/config';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';

const FRONTEND = process.env.E2E_FRONTEND_URL || 'http://localhost:3000';
const marker = `e2e-momo-${randomUUID().slice(0, 8)}`;
const ADMIN_USER_ID = 4;
let orderId;
let failures = 0;
function check(label, pass, detail = '') {
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${label}${detail ? `\n        ${detail}` : ''}`);
  if (!pass) failures++;
}

async function run() {
  const amount = 50000;
  const order = await prisma.order.create({
    data: {
      userId: ADMIN_USER_ID, status: 'PENDING', paymentMethod: 'MOMO',
      shippingName: marker, shippingPhone: '0900000000', shippingAddress: marker,
      subtotal: amount, discountAmount: 0,
    },
  });
  orderId = order.id;
  await prisma.payment.create({ data: { orderId, method: 'MOMO', status: 'PENDING', amount } });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const login = await context.request.post(`${FRONTEND}/api/auth/login`, {
    headers: { 'Content-Type': 'application/json', Origin: FRONTEND },
    data: { identifier: 'admin@gmail.com', password: '123456' },
  });
  check('admin login', login.status() === 200, `status ${login.status()}`);

  const page = await context.newPage();
  await page.goto(`${FRONTEND}/customer/profile/orders/${orderId}`, { waitUntil: 'networkidle', timeout: 30000 });

  const payBtn = page.getByRole('button', { name: /Thanh toán.*MoMo/i });
  await payBtn.waitFor({ timeout: 10000 });
  check('"Thanh toán qua MoMo" button present on MOMO order', true);

  // Clicking triggers createMomoPayment → real MoMo create → window.location to payUrl.
  await Promise.all([
    page.waitForURL(/test-payment\.momo\.vn/i, { timeout: 30000 }),
    payBtn.click(),
  ]);
  check('redirected to MoMo sandbox hosted page', /test-payment\.momo\.vn/i.test(page.url()), page.url().slice(0, 80));

  // Our DB recorded a PROCESSING MoMo attempt for this order.
  const attempt = await prisma.paymentAttempt.findFirst({ where: { payment: { orderId }, method: 'MOMO' } });
  check('a MoMo PaymentAttempt was created', !!attempt && attempt.merchantReference.startsWith(`DMPC${orderId}T`), attempt?.merchantReference);
  const payment = await prisma.payment.findUnique({ where: { orderId } });
  check('Payment moved to PROCESSING (not PAID — awaits IPN)', payment.status === 'PROCESSING');

  await browser.close();
}

async function cleanup() {
  if (orderId) {
    await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.orderStatusHistory.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => {});
  }
}

try { await run(); }
catch (e) { failures++; console.error('FATAL', e.stack || e.message); }
finally { await cleanup(); await prisma.$disconnect(); }
console.log(`\nMoMo flow E2E: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
