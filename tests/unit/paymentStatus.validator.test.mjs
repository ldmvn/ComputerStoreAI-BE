import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_STATUSES, VALID_TRANSITIONS, PAID_PREDECESSOR_STATUSES, isValidTransition, assertTransition, isTerminal,
} from '../../src/payments/validators/paymentStatus.validator.js';

test('every listed transition target is itself a known status (no typos in the table)', () => {
  for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
    assert.ok(PAYMENT_STATUSES.includes(from), `"${from}" is not a known status`);
    for (const to of targets) assert.ok(PAYMENT_STATUSES.includes(to), `"${to}" (from ${from}) is not a known status`);
  }
});

test('PENDING can move to every active/terminal state except REFUNDED directly', () => {
  for (const to of ['PROCESSING', 'AWAITING_VERIFICATION', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED']) {
    assert.equal(isValidTransition('PENDING', to), true, `PENDING -> ${to} should be valid`);
  }
  assert.equal(isValidTransition('PENDING', 'REFUNDED'), false, 'cannot refund something never paid');
});

test('AWAITING_VERIFICATION (VietQR "tôi đã chuyển khoản") only resolves to PAID/FAILED/CANCELLED', () => {
  assert.equal(isValidTransition('AWAITING_VERIFICATION', 'PAID'), true);
  assert.equal(isValidTransition('AWAITING_VERIFICATION', 'FAILED'), true);
  assert.equal(isValidTransition('AWAITING_VERIFICATION', 'CANCELLED'), true);
  assert.equal(isValidTransition('AWAITING_VERIFICATION', 'PROCESSING'), false);
  assert.equal(isValidTransition('AWAITING_VERIFICATION', 'EXPIRED'), false);
});

test('PROCESSING (MoMo/VNPAY redirected, awaiting IPN) resolves to PAID/FAILED/CANCELLED/EXPIRED', () => {
  for (const to of ['PAID', 'FAILED', 'CANCELLED', 'EXPIRED']) {
    assert.equal(isValidTransition('PROCESSING', to), true);
  }
  assert.equal(isValidTransition('PROCESSING', 'AWAITING_VERIFICATION'), false);
});

test('PAID is reachable but not a dead end — only REFUNDED is allowed next, nothing else', () => {
  assert.equal(isValidTransition('PAID', 'REFUNDED'), true);
  for (const to of ['PENDING', 'PROCESSING', 'AWAITING_VERIFICATION', 'FAILED', 'CANCELLED', 'EXPIRED']) {
    assert.equal(isValidTransition('PAID', to), false, `PAID -> ${to} must be rejected`);
  }
});

test('FAILED/CANCELLED/EXPIRED/REFUNDED are fully terminal — no transition out, including to PAID', () => {
  for (const from of ['FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED']) {
    assert.equal(isTerminal(from), true, `${from} should be terminal`);
    for (const to of PAYMENT_STATUSES) assert.equal(isValidTransition(from, to), false, `${from} -> ${to} must be rejected`);
  }
});

test('PAID is NOT terminal (REFUNDED is still reachable) — isTerminal must reflect that', () => {
  assert.equal(isTerminal('PAID'), false);
});

test('re-applying the same status is never a "valid transition" — callers must treat it as an idempotent no-op instead', () => {
  for (const status of PAYMENT_STATUSES) assert.equal(isValidTransition(status, status), false);
});

test('assertTransition throws a 409 with a stable error code on an illegal transition, and is silent on a legal one', () => {
  assert.doesNotThrow(() => assertTransition('PENDING', 'PAID'));
  assert.throws(() => assertTransition('PAID', 'PENDING'), (e) => {
    assert.equal(e.statusCode, 409);
    assert.equal(e.code, 'PAYMENT_STATUS_TRANSITION_INVALID');
    assert.match(e.message, /PAID sang PENDING/);
    return true;
  });
});

test('PAID_PREDECESSOR_STATUSES is exactly {PENDING, AWAITING_VERIFICATION, PROCESSING} — REFUNDED must never be in it', () => {
  assert.deepEqual([...PAID_PREDECESSOR_STATUSES].sort(), ['AWAITING_VERIFICATION', 'PENDING', 'PROCESSING']);
  assert.ok(!PAID_PREDECESSOR_STATUSES.includes('REFUNDED'), 'a blanket status != PAID check would wrongly include REFUNDED here');
  assert.ok(!PAID_PREDECESSOR_STATUSES.includes('PAID'));
});

test('unknown status values are always rejected, not silently coerced', () => {
  assert.equal(isValidTransition('PAID', 'NOT_A_REAL_STATUS'), false);
  assert.equal(isValidTransition('NOT_A_REAL_STATUS', 'PAID'), false);
  assert.throws(() => assertTransition('NOT_A_REAL_STATUS', 'PAID'));
});
