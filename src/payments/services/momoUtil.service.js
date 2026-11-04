// Pure MoMo helpers — HMAC-SHA256 signing/verifying for the /v2/gateway/api/create
// flow and its IPN callback. No DB, no network, no process.env reads (config is
// passed in), so this is fully unit-testable on its own — same philosophy as
// vnpayUtil.service.js and sepayUtil.service.js.
//
// Signature scheme follows MoMo's official v2 sample EXACTLY: build a raw string
// of the relevant fields in FIXED ALPHABETICAL order joined by '&', then
// HMAC-SHA256 that raw string with the merchant Secret Key, lowercase hex.
// The field set differs between the create request and the IPN callback — the
// two raw strings below are quoted verbatim from MoMo's documentation and must
// not be reordered or have fields added/removed.
import crypto from 'node:crypto';

export function hmacSha256Hex(raw, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(raw, 'utf8').digest('hex');
}

// MoMo renders every field as a plain string; an absent field is the empty
// string in its raw-signature string, never the literal "undefined".
const s = (v) => (v === undefined || v === null ? '' : String(v));

/**
 * CREATE request signature. Raw string (alphabetical):
 * accessKey=..&amount=..&extraData=..&ipnUrl=..&orderId=..&orderInfo=..&partnerCode=..&redirectUrl=..&requestId=..&requestType=..
 */
export function buildCreateRawSignature({ accessKey, amount, extraData, ipnUrl, orderId, orderInfo, partnerCode, redirectUrl, requestId, requestType }) {
  return `accessKey=${s(accessKey)}&amount=${s(amount)}&extraData=${s(extraData)}&ipnUrl=${s(ipnUrl)}&orderId=${s(orderId)}&orderInfo=${s(orderInfo)}&partnerCode=${s(partnerCode)}&redirectUrl=${s(redirectUrl)}&requestId=${s(requestId)}&requestType=${s(requestType)}`;
}

export function signCreateRequest(fields, secretKey) {
  return hmacSha256Hex(buildCreateRawSignature(fields), secretKey);
}

/**
 * IPN/return signature. Raw string (alphabetical):
 * accessKey=..&amount=..&extraData=..&message=..&orderId=..&orderInfo=..&orderType=..&partnerCode=..&payType=..&requestId=..&responseTime=..&resultCode=..&transId=..
 * `accessKey` is NOT sent in the callback — it is added from our own config.
 */
export function buildIpnRawSignature(body, accessKey) {
  return `accessKey=${s(accessKey)}&amount=${s(body.amount)}&extraData=${s(body.extraData)}&message=${s(body.message)}&orderId=${s(body.orderId)}&orderInfo=${s(body.orderInfo)}&orderType=${s(body.orderType)}&partnerCode=${s(body.partnerCode)}&payType=${s(body.payType)}&requestId=${s(body.requestId)}&responseTime=${s(body.responseTime)}&resultCode=${s(body.resultCode)}&transId=${s(body.transId)}`;
}

export function signIpn(body, accessKey, secretKey) {
  return hmacSha256Hex(buildIpnRawSignature(body, accessKey), secretKey);
}

/**
 * Constant-time verify of a MoMo IPN/return callback's `signature` field.
 * Returns false on any shape mismatch instead of throwing.
 */
export function verifyIpnSignature(body, accessKey, secretKey) {
  const received = body?.signature;
  if (typeof received !== 'string' || !/^[0-9a-fA-F]{64}$/.test(received)) return false;
  const expected = signIpn(body, accessKey, secretKey);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(received.toLowerCase(), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Map a MoMo resultCode to one of our terminal PaymentAttempt statuses for a
 * NON-success callback. resultCode 0 (and 9000 "authorized" for 2-phase, which
 * we don't use with autoCapture) are success and never reach here.
 *   1006 — user rejected/cancelled on the MoMo app        → CANCELLED
 *   1005 — payUrl/QR expired, 1017 — merchant-cancelled    → EXPIRED
 *   everything else                                         → FAILED
 * Source: MoMo official result-code table.
 */
export function classifyMomoFailure(resultCode) {
  const code = Number(resultCode);
  if (code === 1006) return 'CANCELLED';
  if (code === 1005 || code === 1017) return 'EXPIRED';
  return 'FAILED';
}

export function isMomoSuccess(resultCode) {
  return Number(resultCode) === 0;
}

/**
 * QUERY (truy vấn trạng thái giao dịch) request signature. Raw string
 * (alphabetical): accessKey=..&orderId=..&partnerCode=..&requestId=..
 * Used to ask MoMo directly for the authenticated result when the IPN is
 * missing/late. The query RESPONSE carries the same fields as the IPN, so
 * verifyIpnSignature() above verifies it unchanged.
 */
export function buildQueryRawSignature({ accessKey, orderId, partnerCode, requestId }) {
  return `accessKey=${s(accessKey)}&orderId=${s(orderId)}&partnerCode=${s(partnerCode)}&requestId=${s(requestId)}`;
}

export function signQuery(fields, secretKey) {
  return hmacSha256Hex(buildQueryRawSignature(fields), secretKey);
}
