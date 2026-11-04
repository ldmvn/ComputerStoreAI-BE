// Pure unit tests for VNPAY signing/verification — no DB, no network. Verifies
// against VNPAY's own documented signing scheme (sorted params, encodeURIComponent
// + %20→+ on values, HMAC-SHA512) using a fixed test secret, not the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  buildVnpayPaymentUrl, verifyVnpaySignature, signParams, vnpAmountToVnd, formatVnpDate,
  signQueryDr, verifyQueryDrResponse,
} from '../../src/payments/services/vnpayUtil.service.js';

const HASH_SECRET = 'TEST_SECRET_DO_NOT_USE_IN_PROD';

test('buildVnpayPaymentUrl produces a URL whose own query, when re-verified, matches its signature', () => {
  const { url, params } = buildVnpayPaymentUrl({
    baseUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    tmnCode: 'TESTCODE', hashSecret: HASH_SECRET, amount: 890000,
    merchantReference: 'VNP123456', orderInfo: 'Thanh toan don hang 123',
    ipAddr: '127.0.0.1', returnUrl: 'https://ducmanh.store/payment/vnpay/return',
  });
  assert.ok(url.startsWith('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?'));
  assert.equal(params.vnp_Amount, 89000000); // 890000 * 100
  assert.equal(params.vnp_TxnRef, 'VNP123456');

  const query = Object.fromEntries(new URL(url).searchParams.entries());
  assert.ok(verifyVnpaySignature(query, HASH_SECRET), 'a URL this function built must verify against the same secret');
});

test('verifyVnpaySignature rejects a tampered amount (classic fraud vector)', () => {
  const { url } = buildVnpayPaymentUrl({
    baseUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    tmnCode: 'TESTCODE', hashSecret: HASH_SECRET, amount: 100000,
    merchantReference: 'VNP999', orderInfo: 'Test', ipAddr: '127.0.0.1',
    returnUrl: 'https://ducmanh.store/payment/vnpay/return',
  });
  const query = Object.fromEntries(new URL(url).searchParams.entries());
  query.vnp_Amount = '100'; // attacker lowers the amount after the signature was computed
  assert.equal(verifyVnpaySignature(query, HASH_SECRET), false);
});

test('verifyVnpaySignature rejects a wrong secret (e.g. someone else\'s TMN code/secret)', () => {
  const { url } = buildVnpayPaymentUrl({
    baseUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    tmnCode: 'TESTCODE', hashSecret: HASH_SECRET, amount: 50000,
    merchantReference: 'VNP1', orderInfo: 'Test', ipAddr: '127.0.0.1',
    returnUrl: 'https://ducmanh.store/payment/vnpay/return',
  });
  const query = Object.fromEntries(new URL(url).searchParams.entries());
  assert.equal(verifyVnpaySignature(query, 'WRONG_SECRET'), false);
});

test('verifyVnpaySignature returns false (not throws) on a missing or malformed hash', () => {
  assert.equal(verifyVnpaySignature({ vnp_Amount: '1000' }, HASH_SECRET), false);
  assert.equal(verifyVnpaySignature({ vnp_Amount: '1000', vnp_SecureHash: 'not-hex!!' }, HASH_SECRET), false);
  assert.equal(verifyVnpaySignature({ vnp_Amount: '1000', vnp_SecureHash: 'ab' }, HASH_SECRET), false);
});

test('signParams ignores key order — same params in a different order sign identically', () => {
  const a = signParams({ vnp_Amount: '1000', vnp_TxnRef: 'X1' }, HASH_SECRET);
  const b = signParams({ vnp_TxnRef: 'X1', vnp_Amount: '1000' }, HASH_SECRET);
  assert.equal(a, b);
});

test('a value containing special characters (space, &, =) round-trips through sign + URL correctly', () => {
  const { url } = buildVnpayPaymentUrl({
    baseUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    tmnCode: 'TESTCODE', hashSecret: HASH_SECRET, amount: 1000,
    merchantReference: 'VNP-special', orderInfo: 'Thanh toan don hang & ký tự = đặc biệt test',
    ipAddr: '127.0.0.1', returnUrl: 'https://ducmanh.store/payment/vnpay/return',
  });
  const query = Object.fromEntries(new URL(url).searchParams.entries());
  assert.equal(query.vnp_OrderInfo, 'Thanh toan don hang & ký tự = đặc biệt test');
  assert.ok(verifyVnpaySignature(query, HASH_SECRET));
});

test('vnpAmountToVnd converts VNPAY\'s ×100 amount back to the real VND integer', () => {
  assert.equal(vnpAmountToVnd('89000000'), 890000);
  assert.equal(vnpAmountToVnd(100), 1);
});

test('formatVnpDate returns a 14-digit yyyyMMddHHmmss string', () => {
  const d = formatVnpDate(new Date('2026-01-15T10:30:00.000Z'));
  assert.match(d, /^\d{14}$/);
});

test('signQueryDr signs the exact PIPE-delimited field order (not sorted)', () => {
  const body = {
    vnp_RequestId: 'REQ1', vnp_Version: '2.1.0', vnp_Command: 'querydr', vnp_TmnCode: 'TC',
    vnp_TxnRef: '12345', vnp_TransactionDate: '20261025100000', vnp_CreateDate: '20261025110000',
    vnp_IpAddr: '127.0.0.1', vnp_OrderInfo: 'Query 12345',
  };
  const expected = createHmac('sha512', HASH_SECRET)
    .update(Buffer.from('REQ1|2.1.0|querydr|TC|12345|20261025100000|20261025110000|127.0.0.1|Query 12345', 'utf-8'))
    .digest('hex');
  assert.equal(signQueryDr(body, HASH_SECRET), expected);
});

test('verifyQueryDrResponse accepts a correctly signed response and rejects tampering', () => {
  const res = {
    vnp_ResponseId: 'RID', vnp_Command: 'querydr', vnp_ResponseCode: '00', vnp_Message: 'Success',
    vnp_TmnCode: 'TC', vnp_TxnRef: '12345', vnp_Amount: '89000000', vnp_BankCode: 'NCB',
    vnp_PayDate: '20261025100500', vnp_TransactionNo: '14200000', vnp_TransactionType: '01',
    vnp_TransactionStatus: '00', vnp_OrderInfo: 'pay', vnp_PromotionCode: '', vnp_PromotionAmount: '',
  };
  const signData = ['RID', 'querydr', '00', 'Success', 'TC', '12345', '89000000', 'NCB', '20261025100500', '14200000', '01', '00', 'pay', '', ''].join('|');
  res.vnp_SecureHash = createHmac('sha512', HASH_SECRET).update(Buffer.from(signData, 'utf-8')).digest('hex');
  assert.equal(verifyQueryDrResponse(res, HASH_SECRET), true);
  // Tamper with the settled status → signature must fail.
  const tampered = { ...res, vnp_TransactionStatus: '02' };
  assert.equal(verifyQueryDrResponse(tampered, HASH_SECRET), false);
  // Wrong secret → fail.
  assert.equal(verifyQueryDrResponse(res, 'other-secret'), false);
});
