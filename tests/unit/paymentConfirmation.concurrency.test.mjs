// Simulates concurrent payment confirmations WITHOUT a real database or any
// real bank transaction, per the task's explicit instruction. The fake `tx`
// below implements exactly the Prisma Client method shapes
// confirmPaymentAttempt() calls (`payment.findUnique/updateMany`,
// `paymentAttempt.findUnique/update/updateMany`) with the one property that
// actually matters for correctness: each individual updateMany() call is
// atomic (read-condition-write under a lock), which is precisely the
// guarantee a single InnoDB UPDATE ... WHERE statement gives in production.
// Once the Payment/PaymentAttempt migration lands, confirmPaymentAttempt()
// can be called with the real `prisma.$transaction` callback's `tx` with
// zero code changes — this fake is not a parallel implementation, it is a
// stand-in for the same interface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmPaymentAttempt } from '../../src/payments/services/paymentConfirmation.service.js';

let nextId = 1;

function makeStore({ paymentStatus = 'PENDING', attempts = [] } = {}) {
  const payment = { id: 1, status: paymentStatus, paidAt: null };
  const byRef = new Map();
  const byId = new Map();
  for (const a of attempts) {
    const row = { id: nextId++, paymentId: payment.id, status: 'PENDING', amount: 100000, providerTransactionId: null, paidAt: null, responsePayload: null, errorMessage: null, ...a };
    byRef.set(row.merchantReference, row);
    byId.set(row.id, row.merchantReference);
  }

  // One mutex guards every write to simulate "a single UPDATE statement
  // holds a row lock for the duration of its read-condition-write" — this
  // is the only concurrency primitive the real system relies on too.
  let chain = Promise.resolve();
  function atomic(fn) {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  }

  return {
    tx: {
      payment: {
        async findUnique() { return { ...payment }; },
        updateMany: ({ where, data }) => atomic(() => {
          // Mirrors Prisma's where.status shape: either `{ in: [...] }`
          // (the predecessor-set claim) or a plain string equality (the
          // post-failure "is it PAID right now" probe — see
          // paymentConfirmation.service.js for why a plain read isn't safe there).
          const matches = where.status && typeof where.status === 'object' && 'in' in where.status
            ? where.status.in.includes(payment.status)
            : payment.status === where.status;
          if (!matches) return { count: 0 };
          Object.assign(payment, data);
          return { count: 1 };
        }),
      },
      paymentAttempt: {
        async findUnique({ where: { merchantReference, id } }) {
          const ref = merchantReference ?? byId.get(id);
          const row = byRef.get(ref);
          return row ? { ...row } : null;
        },
        update: ({ where: { id }, data }) => atomic(() => {
          const row = byRef.get(byId.get(id));
          Object.assign(row, data);
          return { ...row };
        }),
        updateMany: ({ where: { id, status }, data }) => atomic(() => {
          const row = byRef.get(byId.get(id));
          if (!row || row.status !== status) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
    },
    snapshot: () => ({ payment: { ...payment }, attempts: [...byRef.values()].map(a => ({ ...a })) }),
  };
}

// ── Basic single-attempt flows ───────────────────────────────────────────────

test('PENDING -> PAID with a valid confirmation', async () => {
  const { tx, snapshot } = makeStore({ attempts: [{ merchantReference: 'r1', status: 'PENDING', amount: 100000 }] });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 100000, providerTransactionId: 'MOMO-1', responsePayload: { ok: true } });
  assert.equal(result.outcome, 'paid');
  const s = snapshot();
  assert.equal(s.payment.status, 'PAID');
  assert.equal(s.attempts[0].status, 'PAID');
  assert.ok(s.attempts[0].paidAt);
});

test('AWAITING_VERIFICATION -> PAID (Admin confirms VietQR)', async () => {
  const { tx, snapshot } = makeStore({ attempts: [{ merchantReference: 'r1', status: 'AWAITING_VERIFICATION', amount: 50000 }] });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 50000, providerTransactionId: 'ADMIN-CONFIRM', responsePayload: {} });
  assert.equal(result.outcome, 'paid');
  assert.equal(snapshot().payment.status, 'PAID');
});

test('PROCESSING -> PAID via IPN', async () => {
  const { tx, snapshot } = makeStore({ attempts: [{ merchantReference: 'r1', status: 'PROCESSING', amount: 200000 }] });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 200000, providerTransactionId: 'VNP-1', responsePayload: {} });
  assert.equal(result.outcome, 'paid');
  assert.equal(snapshot().payment.status, 'PAID');
});

test('unknown merchantReference is rejected, not silently ignored', async () => {
  const { tx } = makeStore({ attempts: [] });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'nope', verifiedAmount: 1, providerTransactionId: 'x', responsePayload: {} });
  assert.equal(result.outcome, 'unknown_reference');
});

test('wrong amount is rejected and logged on the attempt, never silently accepted', async () => {
  const { tx, snapshot } = makeStore({ attempts: [{ merchantReference: 'r1', status: 'PENDING', amount: 100000 }] });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 99999, providerTransactionId: 'x', responsePayload: { raw: 1 } });
  assert.equal(result.outcome, 'amount_mismatch');
  const s = snapshot();
  assert.equal(s.payment.status, 'PENDING'); // never claimed
  assert.equal(s.attempts[0].status, 'PENDING'); // never finalized
  assert.match(s.attempts[0].errorMessage, /AMOUNT_MISMATCH/);
});

// ── Idempotency: duplicate IPN for the SAME attempt ──────────────────────────

test('duplicate IPN for the same attempt is a no-op, not a second write', async () => {
  const { tx, snapshot } = makeStore({ attempts: [{ merchantReference: 'r1', status: 'PENDING', amount: 100000 }] });
  const first = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 100000, providerTransactionId: 'MOMO-1', responsePayload: {} });
  assert.equal(first.outcome, 'paid');
  const second = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 100000, providerTransactionId: 'MOMO-1', responsePayload: {} });
  assert.equal(second.outcome, 'duplicate_same_attempt');
  const s = snapshot();
  assert.equal(s.payment.status, 'PAID');
  assert.equal(s.attempts[0].status, 'PAID');
});

// ── Two DIFFERENT attempts on the same Payment, run sequentially ────────────

test('a second, different attempt confirming after the Payment is already PAID preserves its evidence instead of silently failing', async () => {
  const { tx, snapshot } = makeStore({
    attempts: [
      { merchantReference: 'r1', status: 'PENDING', amount: 100000 },
      { merchantReference: 'r2', status: 'PENDING', amount: 100000 },
    ],
  });
  const first = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 100000, providerTransactionId: 'MOMO-1', responsePayload: {} });
  assert.equal(first.outcome, 'paid');

  const second = await confirmPaymentAttempt({ tx, merchantReference: 'r2', verifiedAmount: 100000, providerTransactionId: 'VNP-9', responsePayload: { real: true } });
  assert.equal(second.outcome, 'duplicate_different_attempt');

  const s = snapshot();
  assert.equal(s.payment.status, 'PAID');
  const a2 = s.attempts.find(a => a.merchantReference === 'r2');
  assert.equal(a2.status, 'FAILED'); // not PAID (only one attempt may be PAID) — but NOT dropped either
  assert.ok(a2.paidAt, 'real confirmation time must be preserved even though the attempt is not PAID');
  assert.equal(a2.providerTransactionId, 'VNP-9');
  assert.match(a2.errorMessage, /DUPLICATE_PAID_CONFIRMATION/);
  // The first attempt remains the single source of truth for what paid the order.
  const a1 = s.attempts.find(a => a.merchantReference === 'r1');
  assert.equal(a1.status, 'PAID');
});

// ── TRUE concurrency: both attempts confirm at the "same time" ──────────────

test('two different attempts racing to confirm the same Payment — exactly one becomes PAID, the other preserves evidence, run many trials with alternating call order', async () => {
  // The in-memory store's mutex makes "which request asked first" resolve
  // deterministically (the same real guarantee a single InnoDB row lock
  // gives two genuinely simultaneous UPDATEs) — what must hold regardless is
  // that the mechanism treats both attempts symmetrically. Alternating which
  // one is issued first across trials, and asserting both eventually win at
  // least once, rules out a hidden bug that always favors one specific slot.
  let aWon = 0, bWon = 0;
  for (let trial = 0; trial < 25; trial++) {
    const { tx, snapshot } = makeStore({
      attempts: [
        { merchantReference: `race-a-${trial}`, status: 'PENDING', amount: 150000 },
        { merchantReference: `race-b-${trial}`, status: 'PENDING', amount: 150000 },
      ],
    });

    const callA = () => confirmPaymentAttempt({ tx, merchantReference: `race-a-${trial}`, verifiedAmount: 150000, providerTransactionId: `A-${trial}`, responsePayload: {} });
    const callB = () => confirmPaymentAttempt({ tx, merchantReference: `race-b-${trial}`, verifiedAmount: 150000, providerTransactionId: `B-${trial}`, responsePayload: {} });
    const [r1, r2] = trial % 2 === 0 ? await Promise.all([callA(), callB()]) : await Promise.all([callB(), callA()]);

    const outcomes = [r1.outcome, r2.outcome].sort();
    assert.deepEqual(outcomes, ['duplicate_different_attempt', 'paid'], `trial ${trial}: exactly one must win`);

    const s = snapshot();
    assert.equal(s.payment.status, 'PAID');
    const paidAttempts = s.attempts.filter(a => a.status === 'PAID');
    assert.equal(paidAttempts.length, 1, `trial ${trial}: exactly one attempt row may end up PAID`);
    if (paidAttempts[0].merchantReference.startsWith('race-a')) aWon++; else bWon++;
    const loser = s.attempts.find(a => a.status !== 'PAID');
    assert.ok(loser.paidAt, `trial ${trial}: the losing attempt's real confirmation must still be recorded`);
    assert.match(loser.errorMessage, /DUPLICATE_PAID_CONFIRMATION/);
  }
  assert.ok(aWon > 0 && bWon > 0, `both sides must win at least once across trials (got a=${aWon}, b=${bWon}) — otherwise the "first" caller wins for a reason unrelated to being first`);
});

test('duplicate IPN redelivery racing with itself resolves to exactly one PAID, never a double-write', async () => {
  for (let trial = 0; trial < 25; trial++) {
    const ref = `dup-${trial}`;
    const { tx, snapshot } = makeStore({ attempts: [{ merchantReference: ref, status: 'PENDING', amount: 100000 }] });
    const [r1, r2, r3] = await Promise.all([
      confirmPaymentAttempt({ tx, merchantReference: ref, verifiedAmount: 100000, providerTransactionId: 'X', responsePayload: {} }),
      confirmPaymentAttempt({ tx, merchantReference: ref, verifiedAmount: 100000, providerTransactionId: 'X', responsePayload: {} }),
      confirmPaymentAttempt({ tx, merchantReference: ref, verifiedAmount: 100000, providerTransactionId: 'X', responsePayload: {} }),
    ]);
    const paidCount = [r1, r2, r3].filter(r => r.outcome === 'paid').length;
    assert.equal(paidCount, 1, `trial ${trial}: exactly one of the 3 racing identical IPNs should "win" the write`);
    assert.equal(snapshot().payment.status, 'PAID');
  }
});

// ── REFUNDED must never accept a PAID confirmation ───────────────────────────

test('REFUNDED Payment rejects a late PAID confirmation instead of un-refunding', async () => {
  const { tx, snapshot } = makeStore({ paymentStatus: 'REFUNDED', attempts: [{ merchantReference: 'r1', status: 'PAID', amount: 100000, paidAt: new Date() }] });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 100000, providerTransactionId: 'late', responsePayload: {} });
  // attempt itself already PAID -> idempotent no-op path, never re-examines Payment
  assert.equal(result.outcome, 'duplicate_same_attempt');
  assert.equal(snapshot().payment.status, 'REFUNDED');
});

test('a brand-new attempt confirming against an already-REFUNDED Payment is rejected as a state conflict, not silently accepted', async () => {
  const { tx, snapshot } = makeStore({ paymentStatus: 'REFUNDED', attempts: [{ merchantReference: 'late-ref', status: 'PENDING', amount: 100000 }] });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'late-ref', verifiedAmount: 100000, providerTransactionId: 'x', responsePayload: {} });
  assert.equal(result.outcome, 'payment_state_conflict');
  assert.equal(result.paymentStatus, 'REFUNDED');
  const s = snapshot();
  assert.equal(s.payment.status, 'REFUNDED'); // never moved back to PAID
  assert.match(s.attempts[0].errorMessage, /PAYMENT_STATE_CONFLICT/);
});

// ── Late callback after a terminal non-PAID attempt ──────────────────────────

test('a late confirmation after FAILED auto-pays the order ONLY when the Order is still open (not CANCELLED)', async () => {
  const { tx, snapshot } = makeStore({ attempts: [{ merchantReference: 'r1', status: 'FAILED', amount: 80000, errorMessage: 'timeout' }] });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 80000, providerTransactionId: 'late-x', responsePayload: { proof: true }, orderStatus: 'CONFIRMED' });
  assert.equal(result.outcome, 'late_confirmation_after_terminal');
  const s = snapshot();
  assert.equal(s.payment.status, 'PAID'); // the order DID get paid — real money, not discarded
  assert.equal(s.attempts[0].status, 'FAILED'); // state machine forbids rewriting a terminal attempt's status
  assert.ok(s.attempts[0].paidAt, 'the real clearing time must be recorded even though status stays FAILED');
  assert.match(s.attempts[0].errorMessage, /LATE_CONFIRMATION_AFTER_TERMINAL/);
});

test('redelivery of the same late confirmation is idempotent even though terminal attempt history is preserved', async () => {
  const { tx, snapshot } = makeStore({ attempts: [{ merchantReference: 'late-redelivery', status: 'CANCELLED', amount: 80000 }] });
  const payload = { proof: true };
  const first = await confirmPaymentAttempt({ tx, merchantReference: 'late-redelivery', verifiedAmount: 80000, providerTransactionId: 'provider-42', responsePayload: payload, orderStatus: 'PENDING' });
  assert.equal(first.outcome, 'late_confirmation_after_terminal');
  const errorAfterFirst = snapshot().attempts[0].errorMessage;

  const second = await confirmPaymentAttempt({ tx, merchantReference: 'late-redelivery', verifiedAmount: 80000, providerTransactionId: 'provider-42', responsePayload: payload, orderStatus: 'PENDING' });
  assert.equal(second.outcome, 'duplicate_same_attempt');
  const s = snapshot();
  assert.equal(s.payment.status, 'PAID');
  assert.equal(s.attempts[0].status, 'CANCELLED');
  assert.equal(s.attempts[0].errorMessage, errorAfterFirst, 'redelivery must not relabel the same late payment as a different attempt');
});

test('a late confirmation after EXPIRED behaves the same way as after FAILED, when the Order is open', async () => {
  const { tx, snapshot } = makeStore({ attempts: [{ merchantReference: 'r1', status: 'EXPIRED', amount: 80000 }] });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 80000, providerTransactionId: 'late-y', responsePayload: {}, orderStatus: 'PENDING' });
  assert.equal(result.outcome, 'late_confirmation_after_terminal');
  const s = snapshot();
  assert.equal(s.payment.status, 'PAID');
  assert.equal(s.attempts[0].status, 'EXPIRED');
  assert.ok(s.attempts[0].paidAt);
});

test('a late confirmation is held for manual review — NOT auto-paid — when the Order was CANCELLED', async () => {
  const { tx, snapshot } = makeStore({ attempts: [{ merchantReference: 'r1', status: 'FAILED', amount: 80000 }] });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 80000, providerTransactionId: 'late-cancelled', responsePayload: { proof: true }, orderStatus: 'CANCELLED' });
  assert.equal(result.outcome, 'late_confirmation_needs_review');
  const s = snapshot();
  assert.equal(s.payment.status, 'PENDING'); // NEVER auto-claimed — inventory/voucher already reversed for a cancelled order
  assert.equal(s.attempts[0].status, 'FAILED'); // unchanged
  assert.ok(s.attempts[0].paidAt, 'evidence still preserved even though not auto-applied');
  assert.match(s.attempts[0].errorMessage, /LATE_CONFIRMATION_NEEDS_MANUAL_REVIEW/);
});

test('a late confirmation defaults to "needs review" (never auto-pays) when the caller omits orderStatus — unknown is treated as unsafe, not safe', async () => {
  const { tx, snapshot } = makeStore({ attempts: [{ merchantReference: 'r1', status: 'EXPIRED', amount: 80000 }] });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'r1', verifiedAmount: 80000, providerTransactionId: 'late-unknown', responsePayload: {} }); // orderStatus omitted
  assert.equal(result.outcome, 'late_confirmation_needs_review');
  assert.equal(snapshot().payment.status, 'PENDING');
});

test('a late confirmation after a terminal attempt, when the Payment was ALREADY paid by another attempt, is still preserved as evidence (not lost, not double-paid)', async () => {
  const { tx, snapshot } = makeStore({
    attempts: [
      { merchantReference: 'winner', status: 'PENDING', amount: 100000 },
      { merchantReference: 'late-loser', status: 'FAILED', amount: 100000 },
    ],
  });
  await confirmPaymentAttempt({ tx, merchantReference: 'winner', verifiedAmount: 100000, providerTransactionId: 'W', responsePayload: {} });
  const result = await confirmPaymentAttempt({ tx, merchantReference: 'late-loser', verifiedAmount: 100000, providerTransactionId: 'L', responsePayload: {}, orderStatus: 'CONFIRMED' });
  assert.equal(result.outcome, 'duplicate_different_attempt');
  const s = snapshot();
  const loser = s.attempts.find(a => a.merchantReference === 'late-loser');
  assert.equal(loser.status, 'FAILED'); // stays FAILED — terminal status never rewritten
  assert.ok(loser.paidAt, 'evidence preserved despite being the loser AND already terminal');
  assert.equal(s.payment.status, 'PAID');
});
