// Pure, Prisma-free SePay webhook helpers — signature verification and
// payload parsing only, so every branch is exercisable in isolation
// (tests/unit/sepayUtil.test.mjs) exactly like vnpayUtil.service.js. Nothing
// here touches the database or decides payment outcomes; that lives in
// payment.service.js (confirmVietQrByWebhook), which reuses the one shared
// confirmPaymentAttempt() gatekeeper like every other provider.
//
// Scheme implemented is SePay's official "HMAC-SHA256 (recommended)" webhook
// authentication (https://developer.sepay.vn/en/sepay-webhooks/xac-thuc):
//   header  X-SePay-Signature: sha256=<hex hmac>
//   header  X-SePay-Timestamp: <unix seconds at signing time>
//   message signed = `${timestamp}.${rawBody}`   (RAW bytes, never re-serialized)
//   hmac    = HMAC_SHA256(secret, message), lowercase hex
//   replay  = reject if |now - timestamp| > 300s

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SEPAY_SIGNATURE_HEADER = 'x-sepay-signature';
export const SEPAY_TIMESTAMP_HEADER = 'x-sepay-timestamp';
export const SEPAY_REPLAY_TOLERANCE_SEC = 300;

/**
 * Constant-time compare of two ASCII strings without leaking length via early
 * return. Returns false on any shape mismatch instead of throwing.
 */
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a SePay webhook's HMAC-SHA256 signature against the RAW request body.
 *
 * @param {{ rawBody: Buffer|string, signatureHeader: string|undefined, timestampHeader: string|undefined, secret: string, nowSec?: number, toleranceSec?: number }} p
 * @returns {{ ok: true } | { ok: false, reason: 'missing_secret'|'missing_headers'|'bad_timestamp'|'replay'|'bad_format'|'mismatch' }}
 */
export function verifySepaySignature({ rawBody, signatureHeader, timestampHeader, secret, nowSec = Math.floor(Date.now() / 1000), toleranceSec = SEPAY_REPLAY_TOLERANCE_SEC }) {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!signatureHeader || !timestampHeader) return { ok: false, reason: 'missing_headers' };

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp) || timestamp <= 0) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowSec - timestamp) > toleranceSec) return { ok: false, reason: 'replay' };

  // Accept the documented "sha256=<hex>" form; reject anything else rather
  // than silently treating a raw hex string as valid.
  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(signatureHeader.trim());
  if (!match) return { ok: false, reason: 'bad_format' };
  const provided = match[1].toLowerCase();

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody ?? '', 'utf8');
  const message = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), body]);
  const expected = createHmac('sha256', secret).update(message).digest('hex');

  return safeEqualHex(provided, expected) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/**
 * Normalize the SePay webhook JSON body into the fields we actually use,
 * validating types. Returns null when the body is unusable.
 * @param {any} body
 * @returns {null | { id: string, gateway: string|null, accountNumber: string|null, code: string|null, content: string, transferType: string, amount: number, referenceCode: string|null, transactionDate: string|null }}
 */
export function parseSepayPayload(body) {
  if (!body || typeof body !== 'object') return null;
  // SePay's `id` is a number in the example; accept number or numeric string,
  // always store as a string (PaymentAttempt.providerTransactionId is VarChar).
  const rawId = body.id;
  const id = typeof rawId === 'number' ? String(rawId) : (typeof rawId === 'string' && rawId.trim() ? rawId.trim() : null);
  if (!id) return null;

  const amount = typeof body.transferAmount === 'number' ? body.transferAmount
    : (typeof body.transferAmount === 'string' && body.transferAmount.trim() !== '' && Number.isFinite(Number(body.transferAmount)) ? Number(body.transferAmount) : NaN);
  if (!Number.isFinite(amount)) return null;

  const str = v => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
  return {
    id,
    gateway: body.gateway ? str(body.gateway) : null,
    accountNumber: body.accountNumber ? str(body.accountNumber).trim() : null,
    code: body.code ? str(body.code).trim() : null,
    content: str(body.content),
    transferType: str(body.transferType).trim().toLowerCase(),
    amount,
    referenceCode: body.referenceCode ? str(body.referenceCode) : null,
    transactionDate: body.transactionDate ? str(body.transactionDate) : null,
  };
}

/**
 * Extract our Order id from a SePay transaction. The VietQR transfer content
 * created at checkout is `DUCMANHPC DH<orderId>` (payment.service.js's
 * buildTransferContent). Banks may upper/lower-case and strip punctuation, so
 * match case-insensitively on the "DH<digits>" token, checking `code` (SePay's
 * own parsed code) first, then the free-form `content`. Returns a positive
 * integer or null.
 * @param {{ content?: string, code?: string|null }} tx
 */
export function extractOrderId({ content = '', code = null } = {}) {
  const re = /DH0*(\d+)/i;
  for (const source of [code, content]) {
    if (typeof source !== 'string' || !source) continue;
    const m = re.exec(source);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }
  return null;
}
