// Real browser E2E for the upgraded VietQR popup: auto-polling payment status,
// "Kiểm tra thanh toán" manual check, countdown, and auto-close-on-PAID driven
// ONLY by a genuine SePay webhook writing PAID to the DB (never a FE self-set).
// Seeds a throwaway BANK_TRANSFER order for the admin user, opens the popup on
// the order-detail page, fires a signed SePay webhook, and asserts the popup
// flips to success + closes and the order shows CONFIRMED. Cleans up in finally.
import 'dotenv/config';
import { chromium } from 'playwright';
import { randomUUID, createHmac } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';
import { getBankConfig } from '../../src/payments/services/payment.service.js';

const FRONTEND = process.env.E2E_FRONTEND_URL || 'http://localhost:3000';
const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:5000';
const marker = `e2e-sepay-${randomUUID().slice(0, 8)}`;
let failures = 0;
function check(label, pass, detail = '') {
  console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${label}${detail ? `\n        ${detail}` : ''}`);
  if (!pass) failures++;
}

let orderId;
const ADMIN_USER_ID = 4; // seeded admin@gmail.com

function signWebhook(body, secret) {
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  const ts = Math.floor(Date.now() / 1000);
  const sig = 'sha256=' + createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), raw])).digest('hex');
  return { raw, headers: { 'Content-Type': 'application/json', 'X-SePay-Signature': sig, 'X-SePay-Timestamp': String(ts) } };
}

async function run() {
  const bank = await getBankConfig();
  const amount = 3330000;
  const order = await prisma.order.create({
    data: {
      userId: ADMIN_USER_ID, status: 'PENDING', paymentMethod: 'BANK_TRANSFER',
      shippingName: marker, shippingPhone: '0900000000', shippingAddress: marker,
      subtotal: amount, discountAmount: 0,
    },
  });
  orderId = order.id;
  const payment = await prisma.payment.create({ data: { orderId, method: 'BANK_TRANSFER', status: 'PENDING', amount } });
  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id, method: 'BANK_TRANSFER',
      merchantReference: `BT-${orderId}-${randomUUID().slice(0, 8)}`, amount, status: 'PENDING',
      bankBin: bank.bin, bankName: 'MB Bank', bankAccountNumber: bank.accountNumber,
      bankAccountName: bank.accountName, transferContent: `DUCMANHPC DH${orderId}`,
    },
  });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  // Authenticate via the frontend proxy so the httpOnly cookie lands on :3000.
  const login = await context.request.post(`${FRONTEND}/api/auth/login`, {
    headers: { 'Content-Type': 'application/json', Origin: FRONTEND },
    data: { identifier: 'admin@gmail.com', password: '123456' },
  });
  check('admin login', login.status() === 200, `status ${login.status()}`);

  const page = await context.newPage();
  await page.goto(`${FRONTEND}/customer/profile/orders/${orderId}`, { waitUntil: 'networkidle', timeout: 30000 });

  // Open the VietQR popup.
  const openBtn = page.getByRole('button', { name: /Xem lại mã QR/i });
  await openBtn.waitFor({ timeout: 10000 });
  await openBtn.click();
  await page.locator('[data-testid="vietqr-popup-header"]').waitFor({ timeout: 8000 });

  // UI assertions per spec.
  check('"Kiểm tra thanh toán" button present', await page.getByRole('button', { name: /Kiểm tra thanh toán/i }).count() === 1);
  check('"Thanh toán sau" button removed', await page.getByRole('button', { name: /Thanh toán sau/i }).count() === 0);
  check('countdown timer shown', await page.getByText(/Mã QR còn hiệu lực/i).count() === 1);
  check('auto-verify banner shown', await page.getByText(/tự động kiểm tra thanh toán/i).count() === 1);
  check('QR image present', await page.getByAltText(/Mã QR chuyển khoản/i).count() === 1);

  // Manual check while still unpaid → should NOT show success.
  await page.getByRole('button', { name: /Kiểm tra thanh toán/i }).click();
  await page.waitForTimeout(1200);
  check('still open & unpaid after manual check', await page.getByText(/Thanh toán thành công/i).count() === 0);

  // Fire a REAL signed SePay webhook that marks this order PAID.
  const sepayId = String(Date.now()).slice(-9);
  const body = {
    id: Number(sepayId), gateway: 'MBBank', transactionDate: '2026-10-25 12:00:00',
    accountNumber: bank.accountNumber, code: `DH${orderId}`, content: `DUCMANHPC DH${orderId}`,
    transferType: 'in', transferAmount: amount, referenceCode: `FT${sepayId}`,
  };
  const { raw, headers } = signWebhook(body, process.env.SEPAY_WEBHOOK_SECRET);
  const whRes = await fetch(`${BACKEND}/api/payments/sepay/webhook`, { method: 'POST', headers, body: raw });
  const whJson = await whRes.json();
  check('webhook accepted (200 Confirmed)', whRes.status === 200 && whJson.success === true, JSON.stringify(whJson));

  // The popup should auto-detect PAID within the poll interval (~4s) and show
  // the success banner, then auto-close (~2s later).
  await page.getByText(/Thanh toán thành công — đơn hàng đã được xác nhận/i).waitFor({ timeout: 12000 });
  check('popup shows success on PAID (auto-detected via polling)', true);

  // Popup auto-closes.
  await page.locator('[data-testid="vietqr-popup-header"]').waitFor({ state: 'detached', timeout: 8000 });
  check('popup auto-closed after success', true);

  // Backend truth: Payment PAID + Order CONFIRMED.
  const p = await prisma.payment.findUnique({ where: { orderId } });
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  check('Payment is PAID in DB', p.status === 'PAID');
  check('Order auto-approved to CONFIRMED in DB', o.status === 'CONFIRMED');

  // Order detail reflects CONFIRMED without a manual reload.
  await page.waitForTimeout(1500);
  const bodyText = await page.locator('body').innerText();
  check('order detail shows confirmed/paid status without reload', /Chờ lấy hàng|Đã xác nhận|Hoàn thành/i.test(bodyText) && /Đã thanh toán/i.test(bodyText), bodyText.slice(0, 0));

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

try {
  await run();
} catch (e) {
  failures++;
  console.error('FATAL', e.stack || e.message);
} finally {
  await cleanup();
  await prisma.$disconnect();
}
console.log(`\nSePay popup E2E: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
