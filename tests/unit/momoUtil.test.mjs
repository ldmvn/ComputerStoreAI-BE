// Pure unit tests for MoMo helpers — no DB, no network. Mirrors
// tests/unit/vnpayUtil.test.mjs / sepayUtil.test.mjs.
// Run: node --test tests/unit/momoUtil.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  buildCreateRawSignature, signCreateRequest,
  buildIpnRawSignature, signIpn, verifyIpnSignature,
  classifyMomoFailure, isMomoSuccess,
  buildQueryRawSignature, signQuery,
} from '../../src/payments/services/momoUtil.service.js';

const ACCESS_KEY = 'F8BBA842ECF85';
const SECRET = 'K951B6PE1waDMi640xX08PD3vg6EkVlz';

test('create raw signature is the exact alphabetical MoMo string', () => {
  const raw = buildCreateRawSignature({
    accessKey: 'AK', amount: 50000, extraData: '', ipnUrl: 'https://x/ipn', orderId: 'DMPC1T2',
    orderInfo: 'pay', partnerCode: 'MOMO', redirectUrl: 'https://x/return', requestId: 'R1', requestType: 'captureWallet',
  });
  assert.equal(raw, 'accessKey=AK&amount=50000&extraData=&ipnUrl=https://x/ipn&orderId=DMPC1T2&orderInfo=pay&partnerCode=MOMO&redirectUrl=https://x/return&requestId=R1&requestType=captureWallet');
});

test('signCreateRequest matches an independent HMAC-SHA256 hex', () => {
  const fields = { accessKey: ACCESS_KEY, amount: 10000, extraData: '', ipnUrl: 'https://x/ipn', orderId: 'DMPC9T1', orderInfo: 'o', partnerCode: 'MOMO', redirectUrl: 'https://x/r', requestId: 'R9', requestType: 'captureWallet' };
  const expected = createHmac('sha256', SECRET).update(buildCreateRawSignature(fields), 'utf8').digest('hex');
  assert.equal(signCreateRequest(fields, SECRET), expected);
});

test('IPN raw signature is the exact alphabetical MoMo string', () => {
  const body = { amount: 50000, extraData: '', message: 'Successful.', orderId: 'DMPC1T2', orderInfo: 'pay', orderType: 'momo_wallet', partnerCode: 'MOMO', payType: 'qr', requestId: 'R1', responseTime: 1700000000000, resultCode: 0, transId: 1234567890 };
  const raw = buildIpnRawSignature(body, 'AK');
  assert.equal(raw, 'accessKey=AK&amount=50000&extraData=&message=Successful.&orderId=DMPC1T2&orderInfo=pay&orderType=momo_wallet&partnerCode=MOMO&payType=qr&requestId=R1&responseTime=1700000000000&resultCode=0&transId=1234567890');
});

function signedIpn(overrides = {}) {
  const body = { partnerCode: 'MOMO', orderId: 'DMPC1T2', requestId: 'R1', amount: 50000, orderInfo: 'pay', orderType: 'momo_wallet', transId: 1234567890, resultCode: 0, message: 'Successful.', payType: 'qr', responseTime: 1700000000000, extraData: '', ...overrides };
  body.signature = signIpn(body, ACCESS_KEY, SECRET);
  return body;
}

test('verifyIpnSignature accepts a correctly signed IPN', () => {
  assert.equal(verifyIpnSignature(signedIpn(), ACCESS_KEY, SECRET), true);
});

test('verifyIpnSignature rejects a tampered amount', () => {
  const body = signedIpn();
  body.amount = 1; // attacker lowers amount after signing
  assert.equal(verifyIpnSignature(body, ACCESS_KEY, SECRET), false);
});

test('verifyIpnSignature rejects a tampered resultCode', () => {
  const body = signedIpn({ resultCode: 1006 }); // signed as failure…
  body.resultCode = 0;                           // …flipped to success
  assert.equal(verifyIpnSignature(body, ACCESS_KEY, SECRET), false);
});

test('verifyIpnSignature rejects a wrong secret', () => {
  assert.equal(verifyIpnSignature(signedIpn(), ACCESS_KEY, 'wrong-secret'), false);
});

test('verifyIpnSignature rejects missing/malformed signature', () => {
  const b1 = signedIpn(); delete b1.signature;
  assert.equal(verifyIpnSignature(b1, ACCESS_KEY, SECRET), false);
  const b2 = signedIpn(); b2.signature = 'xyz';
  assert.equal(verifyIpnSignature(b2, ACCESS_KEY, SECRET), false);
  assert.equal(verifyIpnSignature(null, ACCESS_KEY, SECRET), false);
});

test('classifyMomoFailure maps result codes', () => {
  assert.equal(classifyMomoFailure(1006), 'CANCELLED');
  assert.equal(classifyMomoFailure(1005), 'EXPIRED');
  assert.equal(classifyMomoFailure(1017), 'EXPIRED');
  assert.equal(classifyMomoFailure(1001), 'FAILED');
  assert.equal(classifyMomoFailure(99), 'FAILED');
});

test('isMomoSuccess only for resultCode 0', () => {
  assert.equal(isMomoSuccess(0), true);
  assert.equal(isMomoSuccess('0'), true);
  assert.equal(isMomoSuccess(9000), false);
  assert.equal(isMomoSuccess(1006), false);
});

test('query raw signature is the exact alphabetical MoMo string', () => {
  const raw = buildQueryRawSignature({ accessKey: 'AK', orderId: 'DMPC1T2', partnerCode: 'MOMO', requestId: 'Q1' });
  assert.equal(raw, 'accessKey=AK&orderId=DMPC1T2&partnerCode=MOMO&requestId=Q1');
});

test('signQuery matches an independent HMAC-SHA256 hex', () => {
  const fields = { accessKey: ACCESS_KEY, orderId: 'DMPC9T1', partnerCode: 'MOMO', requestId: 'Q9' };
  const expected = createHmac('sha256', SECRET).update(buildQueryRawSignature(fields), 'utf8').digest('hex');
  assert.equal(signQuery(fields, SECRET), expected);
});
