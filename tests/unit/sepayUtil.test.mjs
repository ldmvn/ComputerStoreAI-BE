// Pure unit tests for SePay webhook helpers — no DB, no network. Mirrors the
// style of tests/unit/vnpayUtil.test.mjs. Run: node --test tests/unit/sepayUtil.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  verifySepaySignature, parseSepayPayload, extractOrderId,
  SEPAY_REPLAY_TOLERANCE_SEC,
} from '../../src/payments/services/sepayUtil.service.js';

const SECRET = 'whsec_test_secret_123';

function sign(rawBody, timestamp, secret = SECRET) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const message = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), body]);
  return 'sha256=' + createHmac('sha256', secret).update(message).digest('hex');
}

const SAMPLE = JSON.stringify({
  id: 92704, gateway: 'MBBank', transactionDate: '2026-10-25 11:08:33',
  accountNumber: '0386220065', subAccount: '', code: 'DH1234',
  content: 'DUCMANHPC DH1234', transferType: 'in',
  description: 'NGUYEN VAN A chuyen tien', transferAmount: 7290000,
  accumulated: 105000000, referenceCode: 'FT26012345678',
});

test('verifySepaySignature: accepts a correctly signed request', () => {
  const now = Math.floor(Date.now() / 1000);
  const r = verifySepaySignature({ rawBody: SAMPLE, signatureHeader: sign(SAMPLE, now), timestampHeader: String(now), secret: SECRET, nowSec: now });
  assert.deepEqual(r, { ok: true });
});

test('verifySepaySignature: rejects a tampered body (mismatch)', () => {
  const now = Math.floor(Date.now() / 1000);
  const sig = sign(SAMPLE, now);
  const tampered = SAMPLE.replace('7290000', '1'); // attacker lowers the amount
  const r = verifySepaySignature({ rawBody: tampered, signatureHeader: sig, timestampHeader: String(now), secret: SECRET, nowSec: now });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'mismatch');
});

test('verifySepaySignature: rejects a wrong secret', () => {
  const now = Math.floor(Date.now() / 1000);
  const sig = sign(SAMPLE, now, 'attacker-secret');
  const r = verifySepaySignature({ rawBody: SAMPLE, signatureHeader: sig, timestampHeader: String(now), secret: SECRET, nowSec: now });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'mismatch');
});

test('verifySepaySignature: rejects a stale timestamp (replay)', () => {
  const now = Math.floor(Date.now() / 1000);
  const old = now - SEPAY_REPLAY_TOLERANCE_SEC - 5;
  // Correctly signed for the OLD timestamp, but replayed later.
  const r = verifySepaySignature({ rawBody: SAMPLE, signatureHeader: sign(SAMPLE, old), timestampHeader: String(old), secret: SECRET, nowSec: now });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'replay');
});

test('verifySepaySignature: rejects a future timestamp beyond tolerance', () => {
  const now = Math.floor(Date.now() / 1000);
  const future = now + SEPAY_REPLAY_TOLERANCE_SEC + 5;
  const r = verifySepaySignature({ rawBody: SAMPLE, signatureHeader: sign(SAMPLE, future), timestampHeader: String(future), secret: SECRET, nowSec: now });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'replay');
});

test('verifySepaySignature: missing headers / secret', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(verifySepaySignature({ rawBody: SAMPLE, signatureHeader: undefined, timestampHeader: String(now), secret: SECRET }).reason, 'missing_headers');
  assert.equal(verifySepaySignature({ rawBody: SAMPLE, signatureHeader: sign(SAMPLE, now), timestampHeader: undefined, secret: SECRET }).reason, 'missing_headers');
  assert.equal(verifySepaySignature({ rawBody: SAMPLE, signatureHeader: sign(SAMPLE, now), timestampHeader: String(now), secret: '' }).reason, 'missing_secret');
});

test('verifySepaySignature: rejects a malformed signature header', () => {
  const now = Math.floor(Date.now() / 1000);
  for (const bad of ['deadbeef', 'sha256=xyz', 'md5=' + 'a'.repeat(64), 'sha256=' + 'a'.repeat(63)]) {
    const r = verifySepaySignature({ rawBody: SAMPLE, signatureHeader: bad, timestampHeader: String(now), secret: SECRET, nowSec: now });
    assert.equal(r.ok, false, `should reject ${bad}`);
    assert.equal(r.reason, 'bad_format');
  }
});

test('verifySepaySignature: rejects a non-numeric timestamp', () => {
  const now = Math.floor(Date.now() / 1000);
  const r = verifySepaySignature({ rawBody: SAMPLE, signatureHeader: sign(SAMPLE, now), timestampHeader: 'not-a-number', secret: SECRET, nowSec: now });
  assert.equal(r.reason, 'bad_timestamp');
});

test('verifySepaySignature: signature must cover the raw body bytes exactly', () => {
  const now = Math.floor(Date.now() / 1000);
  // Signature computed over a re-serialized (reordered) body must NOT validate
  // against the original raw bytes — proving we bind to raw, not parsed.
  const reserialized = JSON.stringify(JSON.parse(SAMPLE));
  const sigOverReserialized = sign(reserialized, now);
  const spacedRaw = SAMPLE.replace(/}$/, '  }'); // same JSON, different bytes
  const r = verifySepaySignature({ rawBody: spacedRaw, signatureHeader: sigOverReserialized, timestampHeader: String(now), secret: SECRET, nowSec: now });
  assert.equal(r.ok, false);
});

test('parseSepayPayload: normalizes a valid incoming transfer', () => {
  const p = parseSepayPayload(JSON.parse(SAMPLE));
  assert.equal(p.id, '92704');
  assert.equal(p.amount, 7290000);
  assert.equal(p.transferType, 'in');
  assert.equal(p.accountNumber, '0386220065');
  assert.equal(p.content, 'DUCMANHPC DH1234');
});

test('parseSepayPayload: accepts numeric-string id and amount', () => {
  const p = parseSepayPayload({ id: '555', transferAmount: '1000', transferType: 'IN', content: 'DH9' });
  assert.equal(p.id, '555');
  assert.equal(p.amount, 1000);
  assert.equal(p.transferType, 'in');
});

test('parseSepayPayload: rejects missing id or amount', () => {
  assert.equal(parseSepayPayload({ transferAmount: 1000, content: 'x' }), null);
  assert.equal(parseSepayPayload({ id: 1, content: 'x' }), null);
  assert.equal(parseSepayPayload(null), null);
  assert.equal(parseSepayPayload('string'), null);
});

test('extractOrderId: parses DH<id> from content and code, case/zero tolerant', () => {
  assert.equal(extractOrderId({ content: 'DUCMANHPC DH1234' }), 1234);
  assert.equal(extractOrderId({ content: 'ducmanhpc dh56 chuyen tien' }), 56);
  assert.equal(extractOrderId({ content: 'CT DH0042' }), 42); // leading zeros
  assert.equal(extractOrderId({ content: 'noise', code: 'DH777' }), 777); // code checked too
  assert.equal(extractOrderId({ content: 'no code here' }), null);
  assert.equal(extractOrderId({ content: '', code: null }), null);
  assert.equal(extractOrderId({}), null);
});
