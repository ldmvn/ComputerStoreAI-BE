// Live-domain transport test for late gateway IPNs.
//
// This deliberately SIMULATES provider callbacks using the configured
// sandbox secrets; it does not claim that VNPAY/MoMo sent these requests.
// Unlike service-level integration tests, requests travel through the public
// ducmanh.store/Cloudflare/Next rewrite/Express route. Throwaway DB rows are
// always removed in finally.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { prisma } from '../../src/config/prisma.js';
import { createAccessToken } from '../../src/services/token.service.js';
import { signParams } from '../../src/payments/services/vnpayUtil.service.js';
import { signIpn } from '../../src/payments/services/momoUtil.service.js';

const DOMAIN = (process.env.E2E_FRONTEND_URL || 'https://ducmanh.store').replace(/\/$/, '');
const marker = `late-ipn-domain-${randomUUID().slice(0, 8)}`;
const orderIds = [];

async function expectReturnPopup({ path, params, provider, orderId, amount, sourcePath, expectedTitle, retryHost }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const orderOwner = await prisma.order.findUnique({ where: { id: orderId }, select: { user: true } });
    if (!orderOwner?.user) throw new Error(`Missing owner for order ${orderId}`);
    await context.addCookies([{
      name: 'accessToken', value: createAccessToken(orderOwner.user), url: DOMAIN,
      httpOnly: true, secure: DOMAIN.startsWith('https://'), sameSite: 'Lax',
    }]);
    await context.addInitScript(({ flow }) => {
      window.sessionStorage.setItem('ducmanhpc-payment-flow-v1', JSON.stringify(flow));
    }, {
      flow: { version: 1, id: `domain-${provider}-${orderId}-${Date.now()}`, provider, orderId, sourcePath, createdAt: Date.now() },
    });

    const page = await context.newPage();
    await page.goto(`${DOMAIN}${path}?${new URLSearchParams(params)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForURL(url => url.pathname === sourcePath, { timeout: 30000 });
    const popup = page.getByTestId('payment-result-popup');
    await popup.waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await popup.getByRole('heading').innerText(), expectedTitle);
    assert.match(await popup.innerText(), new RegExp(`#${orderId}\\b`));
    assert.match((await popup.innerText()).replace(/\D/g, ''), new RegExp(String(amount)));

    if (retryHost) {
      await Promise.all([
        page.waitForURL(url => url.hostname.includes(retryHost), { timeout: 30000 }),
        popup.getByRole('button', { name: 'Thanh toán lại' }).click(),
      ]);
      return;
    }

    await popup.getByRole('button', { name: 'Xem đơn hàng' }).click();
    await page.waitForURL(url => url.pathname === `/customer/profile/orders/${orderId}`, { timeout: 30000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    assert.equal(await page.getByTestId('payment-result-popup').count(), 0, 'popup must not repeat after navigation/reload');
  } finally {
    await browser.close();
  }
}

async function makeAttempt(method, amount) {
  const owner = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!owner) throw new Error('No active test owner is available.');
  const order = await prisma.order.create({
    data: {
      userId: owner.id, status: 'PENDING', paymentMethod: method,
      shippingName: marker, shippingPhone: '0900000000', shippingAddress: marker,
      subtotal: amount, discountAmount: 0,
    },
  });
  orderIds.push(order.id);
  const payment = await prisma.payment.create({ data: { orderId: order.id, method, status: 'PROCESSING', amount } });
  const merchantReference = method === 'VNPAY'
    ? `${order.id}${Date.now()}`
    : `DMPC${order.id}T${Date.now()}`;
  await prisma.paymentAttempt.create({ data: { paymentId: payment.id, method, merchantReference, amount, status: 'PENDING' } });
  return { orderId: order.id, merchantReference, amount };
}

function vnpayCallback(merchantReference, amount, { responseCode, transactionStatus, transactionNo }) {
  const query = {
    vnp_Amount: String(amount * 100), vnp_BankCode: 'NCB', vnp_CardType: 'ATM',
    vnp_OrderInfo: marker, vnp_PayDate: '20261025130000', vnp_ResponseCode: responseCode,
    vnp_TmnCode: process.env.VNPAY_TMN_CODE, vnp_TransactionNo: transactionNo,
    vnp_TransactionStatus: transactionStatus, vnp_TxnRef: merchantReference,
  };
  query.vnp_SecureHash = signParams(query, process.env.VNPAY_HASH_SECRET);
  return query;
}

function momoCallback(merchantReference, amount, { resultCode, transId }) {
  const body = {
    partnerCode: process.env.MOMO_PARTNER_CODE, orderId: merchantReference,
    requestId: `${merchantReference}-late-test`, amount, orderInfo: marker,
    orderType: 'momo_wallet', transId, resultCode,
    message: resultCode === 0 ? 'Successful.' : 'Cancelled.', payType: 'qr',
    responseTime: Date.now(), extraData: '',
  };
  body.signature = signIpn(body, process.env.MOMO_ACCESS_KEY, process.env.MOMO_SECRET_KEY);
  return body;
}

async function run() {
  const vnpay = await makeAttempt('VNPAY', 12345);
  const cancelQuery = vnpayCallback(vnpay.merchantReference, vnpay.amount, { responseCode: '24', transactionStatus: '02', transactionNo: '0' });
  const cancelResponse = await fetch(`${DOMAIN}/api/payments/vnpay/ipn?${new URLSearchParams(cancelQuery)}`);
  assert.deepEqual(await cancelResponse.json(), { RspCode: '00', Message: 'Confirm Success' });
  await expectReturnPopup({
    path: '/payment/vnpay/return', params: cancelQuery, provider: 'VNPAY',
    orderId: vnpay.orderId, amount: vnpay.amount, sourcePath: '/customer/checkout',
    expectedTitle: 'Thanh toán đã hủy', retryHost: 'sandbox.vnpayment.vn',
  });

  const successQuery = vnpayCallback(vnpay.merchantReference, vnpay.amount, { responseCode: '00', transactionStatus: '00', transactionNo: 'VNP-LATE-42' });
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${DOMAIN}/api/payments/vnpay/ipn?${new URLSearchParams(successQuery)}`);
    assert.deepEqual(await response.json(), { RspCode: '00', Message: 'Confirm Success' });
  }
  const vnpayAttempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference: vnpay.merchantReference }, include: { payment: true } });
  assert.equal(vnpayAttempt.payment.status, 'PAID');
  assert.equal(vnpayAttempt.status, 'CANCELLED');
  assert.match(vnpayAttempt.errorMessage, /LATE_CONFIRMATION_AFTER_TERMINAL/);
  await expectReturnPopup({
    path: '/payment/vnpay/return', params: successQuery, provider: 'VNPAY',
    orderId: vnpay.orderId, amount: vnpay.amount, sourcePath: `/customer/profile/orders/${vnpay.orderId}`,
    expectedTitle: 'Thanh toán thành công',
  });

  const momo = await makeAttempt('MOMO', 23456);
  const cancelBody = momoCallback(momo.merchantReference, momo.amount, { resultCode: 1006, transId: 0 });
  const cancelMomo = await fetch(`${DOMAIN}/api/payments/momo/ipn`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cancelBody),
  });
  assert.equal(cancelMomo.status, 204);
  await expectReturnPopup({
    path: '/payment/momo/return', params: Object.fromEntries(Object.entries(cancelBody).map(([key, value]) => [key, String(value)])),
    provider: 'MOMO', orderId: momo.orderId, amount: momo.amount, sourcePath: '/customer/checkout',
    expectedTitle: 'Thanh toán đã hủy', retryHost: 'test-payment.momo.vn',
  });

  const successBody = momoCallback(momo.merchantReference, momo.amount, { resultCode: 0, transId: 42424242 });
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${DOMAIN}/api/payments/momo/ipn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(successBody),
    });
    assert.equal(response.status, 204);
  }
  const momoAttempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference: momo.merchantReference }, include: { payment: true } });
  assert.equal(momoAttempt.payment.status, 'PAID');
  assert.equal(momoAttempt.status, 'CANCELLED');
  assert.match(momoAttempt.errorMessage, /LATE_CONFIRMATION_AFTER_TERMINAL/);
  await expectReturnPopup({
    path: '/payment/momo/return', params: Object.fromEntries(Object.entries(successBody).map(([key, value]) => [key, String(value)])),
    provider: 'MOMO', orderId: momo.orderId, amount: momo.amount, sourcePath: `/customer/profile/orders/${momo.orderId}`,
    expectedTitle: 'Thanh toán thành công',
  });

  console.log(JSON.stringify({
    transport: DOMAIN,
    simulatedSignedCallbacks: true,
    vnpay: { payment: vnpayAttempt.payment.status, attempt: vnpayAttempt.status, returnUx: ['cancelled-popup-and-retry', 'paid-popup-no-repeat'], duplicateRedelivery: 'idempotent' },
    momo: { payment: momoAttempt.payment.status, attempt: momoAttempt.status, returnUx: ['cancelled-popup-and-retry', 'paid-popup-no-repeat'], duplicateRedelivery: 'idempotent' },
  }, null, 2));
}

async function cleanup() {
  for (const orderId of orderIds) {
    await prisma.paymentAttempt.deleteMany({ where: { payment: { orderId } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.orderStatusHistory.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => {});
  }
}

try {
  await run();
} finally {
  await cleanup();
  await prisma.$disconnect();
}
