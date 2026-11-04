// Pure VNPAY helpers — signing, verifying, URL building. No DB, no network,
// no process.env reads (config is passed in), so this is fully unit-testable
// on its own, same philosophy as paymentStatus.validator.js.
//
// Signing scheme follows VNPAY's official merchant sample exactly: sort
// params by key, encodeURIComponent each VALUE and replace "%20" with "+"
// (VNPAY's own convention, not standard query encoding), join as
// "key=value&key=value...", HMAC-SHA512 that string with the Hash Secret.
// The same encoded string is also what gets appended to the payment URL —
// not re-encoded a second time — so the signature matches byte-for-byte
// what VNPAY itself recomputes from the URL/IPN query it receives.
import crypto from 'node:crypto';

function sortedEncodedEntries(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => [key, encodeURIComponent(String(params[key])).replace(/%20/g, '+')]);
}

function buildSignData(params) {
  return sortedEncodedEntries(params).map(([k, v]) => `${k}=${v}`).join('&');
}

export function signParams(params, hashSecret) {
  const signData = buildSignData(params);
  return crypto.createHmac('sha512', hashSecret).update(Buffer.from(signData, 'utf-8')).digest('hex');
}

// yyyyMMddHHmmss in Asia/Ho_Chi_Minh (UTC+7), per VNPAY's spec — computed
// explicitly from UTC rather than relying on the host's local timezone.
export function formatVnpDate(date = new Date()) {
  const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${vn.getUTCFullYear()}${pad(vn.getUTCMonth() + 1)}${pad(vn.getUTCDate())}${pad(vn.getUTCHours())}${pad(vn.getUTCMinutes())}${pad(vn.getUTCSeconds())}`;
}

/**
 * @param {object} cfg
 * @param {string} cfg.baseUrl - VNPAY_URL (sandbox gateway endpoint)
 * @param {string} cfg.tmnCode
 * @param {string} cfg.hashSecret
 * @param {number} cfg.amount - real VND amount (NOT pre-multiplied by 100)
 * @param {string} cfg.merchantReference - vnp_TxnRef, unique per attempt
 * @param {string} cfg.orderInfo
 * @param {string} cfg.ipAddr
 * @param {string} cfg.returnUrl
 * @param {string} [cfg.createDate] - defaults to now()
 * @param {string} [cfg.bankCode]
 * @param {string} [cfg.locale]
 * @returns {{ url: string, params: object }} params is the full param set actually signed (for audit storage — contains no secret)
 */
export function buildVnpayPaymentUrl({
  baseUrl, tmnCode, hashSecret, amount, merchantReference, orderInfo, ipAddr, returnUrl,
  createDate = formatVnpDate(), bankCode, locale = 'vn',
}) {
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: tmnCode,
    vnp_Amount: Math.round(amount * 100),
    vnp_CurrCode: 'VND',
    vnp_TxnRef: merchantReference,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: 'other',
    vnp_Locale: locale,
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: ipAddr,
    vnp_CreateDate: createDate,
    ...(bankCode ? { vnp_BankCode: bankCode } : {}),
  };
  const signData = buildSignData(params);
  const secureHash = signParams(params, hashSecret);
  return { url: `${baseUrl}?${signData}&vnp_SecureHash=${secureHash}`, params };
}

/**
 * Verifies a VNPAY IPN/Return query against the Hash Secret. `query` is the
 * raw req.query object (already URL-decoded by Express) — every vnp_* field
 * VNPAY sent, including vnp_SecureHash/vnp_SecureHashType which are excluded
 * from the recomputed signature (as VNPAY's own spec requires).
 */
export function verifyVnpaySignature(query, hashSecret) {
  const receivedHash = query.vnp_SecureHash;
  if (!receivedHash || typeof receivedHash !== 'string') return false;
  const { vnp_SecureHash: _h, vnp_SecureHashType: _t, ...rest } = query;
  const expected = signParams(rest, hashSecret);
  try {
    const a = Buffer.from(expected.toLowerCase(), 'hex');
    const b = Buffer.from(receivedHash.toLowerCase(), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// VNPAY amounts are the real VND amount × 100 — converts back for comparison.
export function vnpAmountToVnd(vnpAmount) {
  return Math.round(Number(vnpAmount) / 100);
}

// ── QueryDR (truy vấn kết quả giao dịch) ─────────────────────────────────────
// The querydr API uses a DIFFERENT signing scheme from the payment URL/IPN: a
// PIPE-delimited string of a FIXED field order (not sorted, not URL-encoded),
// HMAC-SHA512. Field order verified against VNPAY's official spec and the
// widely-used lehuygiang28/vnpay library. This lets us ask VNPAY directly for
// the authenticated transaction result when the IPN is missing/late — the
// response is verified the same way before we ever act on it.

const QUERYDR_REQUEST_FIELDS = ['vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_TransactionDate', 'vnp_CreateDate', 'vnp_IpAddr', 'vnp_OrderInfo'];
const QUERYDR_RESPONSE_FIELDS = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo', 'vnp_PromotionCode', 'vnp_PromotionAmount'];

function pipeJoin(obj, fields) {
  return fields.map((k) => (obj[k] === undefined || obj[k] === null ? '' : String(obj[k]))).join('|');
}

/**
 * Sign a querydr REQUEST body. `body` must contain the QUERYDR_REQUEST_FIELDS.
 * @returns {string} HMAC-SHA512 hex
 */
export function signQueryDr(body, hashSecret) {
  return crypto.createHmac('sha512', hashSecret).update(Buffer.from(pipeJoin(body, QUERYDR_REQUEST_FIELDS), 'utf-8')).digest('hex');
}

/**
 * Verify a querydr RESPONSE's vnp_SecureHash against the Hash Secret, so we
 * never settle a Payment off an unverified query response.
 */
export function verifyQueryDrResponse(res, hashSecret) {
  const received = res?.vnp_SecureHash;
  if (!received || typeof received !== 'string') return false;
  const expected = crypto.createHmac('sha512', hashSecret).update(Buffer.from(pipeJoin(res, QUERYDR_RESPONSE_FIELDS), 'utf-8')).digest('hex');
  try {
    const a = Buffer.from(expected.toLowerCase(), 'hex');
    const b = Buffer.from(received.toLowerCase(), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
