// The single function allowed to mark a PaymentAttempt/Payment as PAID.
// Every caller — MoMo IPN, VNPAY IPN, Admin VietQR reconciliation — goes
// through this exact function, inside a DB transaction, so there is exactly
// one place in the codebase that can ever write PaymentStatus.PAID.
//
// `tx` is whatever object exposes the Prisma Client shape this function
// uses (`payment.{findUnique,updateMany}`, `paymentAttempt.{findUnique,update,updateMany}`).
// In production that is the callback argument of `prisma.$transaction(async tx => ...)`.
// Tests pass an in-memory fake with the same method shapes (see
// tests/unit/paymentConfirmation.concurrency.test.mjs) — this file has NO
// Prisma import, so it is fully exercisable today even though the
// Payment/PaymentAttempt tables don't exist yet (migration pending).
//
// Concurrency guarantee this function relies on, and that both the real
// Prisma/MySQL path and the in-memory test fake must provide: a single
// `updateMany({ where: { id, <condition> }, data })` call is atomic — it
// reads and writes under one row lock, so two concurrent calls racing on the
// same row can never both see the condition as true. That single guarantee
// (not a bigger transaction-level lock) is what makes every branch below
// race-safe; see docs/payment-architecture.md §"Concurrency model" for why.

import { isTerminal, PAID_PREDECESSOR_STATUSES } from '../validators/paymentStatus.validator.js';

/**
 * @param {{
 *   tx: { payment: object, paymentAttempt: object },
 *   merchantReference: string,
 *   verifiedAmount: number,
 *   providerTransactionId: string,
 *   responsePayload: object,
 *   orderStatus?: string, // the Order's current OrderStatus — required to safely auto-confirm a LATE callback (see 'late_confirmation_after_terminal' below); omit/null is treated as "unsafe", never as "safe"
 * }} params
 * @returns {Promise<{ outcome: string, attemptId?: number, paymentStatus?: string }>}
 *
 * outcome values:
 *   'unknown_reference'            — no PaymentAttempt has this merchantReference; caller should reject the callback (400/404)
 *   'duplicate_same_attempt'       — this exact attempt was already PAID; idempotent no-op, caller should ack 200
 *   'amount_mismatch'              — provider-confirmed amount != what we created the attempt for; evidence logged, caller rejects
 *   'payment_state_conflict'       — the Payment is in a state PAID can never follow (e.g. REFUNDED); evidence logged, caller rejects
 *   'duplicate_different_attempt'  — a DIFFERENT attempt already settled this Payment; THIS attempt's real money is preserved for reconciliation, caller should still ack 200 (not retry) but must alert Admin
 *   'late_confirmation_needs_review' — this attempt was already terminal (FAILED/CANCELLED/EXPIRED) AND the Order is CANCELLED (or its status is unknown) — NOT safe to auto-apply; Payment is left untouched, evidence recorded, requires manual reconciliation
 *   'late_confirmation_after_terminal' — this attempt was already terminal, but the Order is still open (not CANCELLED) — safe to auto-confirm: the Payment is marked PAID from this evidence, while the attempt's own status is left as-is (state machine forbids rewriting it)
 *   'paid'                         — the normal path: this attempt and its Payment are now PAID
 */
export async function confirmPaymentAttempt({ tx, merchantReference, verifiedAmount, providerTransactionId, responsePayload, orderStatus = null }) {
  const attempt = await tx.paymentAttempt.findUnique({ where: { merchantReference } });
  if (!attempt) return { outcome: 'unknown_reference' };

  // Idempotent: the exact same attempt reporting PAID again (classic IPN
  // redelivery) is a no-op, not an error — the caller should still ack 200.
  if (attempt.status === 'PAID'
    || (attempt.paidAt && attempt.providerTransactionId === providerTransactionId)) {
    return { outcome: 'duplicate_same_attempt', attemptId: attempt.id };
  }

  if (attempt.amount !== verifiedAmount) {
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: { errorMessage: `AMOUNT_MISMATCH: expected ${attempt.amount}, provider confirmed ${verifiedAmount}.`, responsePayload },
    });
    return { outcome: 'amount_mismatch', attemptId: attempt.id };
  }

  const wasTerminalNonPaid = isTerminal(attempt.status); // FAILED / CANCELLED / EXPIRED / REFUNDED

  // Safety gate for a LATE callback (this attempt already reached a terminal
  // non-PAID status before the provider's confirmation arrived): only
  // auto-apply it to the Payment when the Order is still open. An Order the
  // admin already cancelled had its inventory/voucher usage reversed — a
  // stale callback must never silently flip it back to paid. `orderStatus`
  // missing counts as "unsafe", never as "safe": the caller not knowing the
  // Order's state is not evidence that it is fine to proceed.
  if (wasTerminalNonPaid && (orderStatus === 'CANCELLED' || orderStatus === null)) {
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        providerTransactionId, paidAt: new Date(), responsePayload,
        errorMessage: `LATE_CONFIRMATION_NEEDS_MANUAL_REVIEW: provider confirmed PAID after this attempt was already '${attempt.status}' (Order status: ${orderStatus ?? 'unknown'}) — not auto-applying to Payment. Needs manual reconciliation/refund.`,
      },
    });
    return { outcome: 'late_confirmation_needs_review', attemptId: attempt.id };
  }

  // Claim the PAYMENT row first, atomically, using the exact predecessor set
  // the state machine allows — never a blanket `status != 'PAID'` (that
  // would also match REFUNDED and let a stale confirmation un-refund an order).
  const claim = await tx.payment.updateMany({
    where: { id: attempt.paymentId, status: { in: PAID_PREDECESSOR_STATUSES } },
    data: { status: 'PAID', paidAt: new Date() },
  });

  if (claim.count === 0) {
    // First: did THIS SAME attempt just become PAID under us? That happens
    // when the very same attempt is confirmed concurrently — e.g. a SePay
    // webhook redelivered and processed in parallel, both reading the attempt
    // as non-PAID before either committed, then racing on the Payment claim.
    // (VNPAY can't hit this — it mints a unique merchantReference per attempt —
    // and Admin confirm is a single click, which is why it surfaced first with
    // SePay.) Without this check the loser would fall through and mislabel its
    // own attempt as a DIFFERENT-attempt duplicate AND overwrite the winner's
    // PAID with FAILED. Use the same atomic conditional-UPDATE probe (never a
    // stale snapshot read) on THIS attempt's id: if it is now PAID, this is an
    // idempotent no-op, exactly like the classic redelivery early-return above.
    const selfProbe = await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: 'PAID' }, data: { status: 'PAID' } });
    if (selfProbe.count === 1) return { outcome: 'duplicate_same_attempt', attemptId: attempt.id };

    // We did not win the right to mark this Payment PAID. We must NOT decide
    // why with a plain `findUnique` here: under MySQL's default REPEATABLE
    // READ isolation, a SELECT inside this transaction can still see the
    // snapshot from before a concurrent winner's commit — even though our
    // own failed conditional UPDATE above already proves that commit
    // happened (confirmed against real MySQL/InnoDB, not just simulation —
    // see tests/payment.integration.mjs). Reuse the same atomic
    // conditional-UPDATE primitive as a "locking probe" instead of a
    // possibly-stale snapshot read: it always operates on the current
    // committed row, exactly like the claim above.
    const probe = await tx.payment.updateMany({ where: { id: attempt.paymentId, status: 'PAID' }, data: { status: 'PAID' } });
    const paymentIsPaid = probe.count === 1;
    // A plain read is fine here ONLY for the human-readable status string in
    // the error message below — it never drives a correctness decision.
    const payment = await tx.payment.findUnique({ where: { id: attempt.paymentId } });

    if (paymentIsPaid) {
      // Two real confirmed transactions for one order: a DIFFERENT attempt
      // already settled it first. This attempt's money is still real and
      // must not be silently classified as an ordinary failure.
      const data = {
        providerTransactionId, paidAt: new Date(), responsePayload,
        errorMessage: 'DUPLICATE_PAID_CONFIRMATION: provider verified this attempt but a different attempt already settled this order. Requires manual reconciliation/refund — do not discard.',
      };
      // Only move the attempt's own status if the state machine allows it —
      // a terminal attempt's historical status is never rewritten, even here.
      if (!wasTerminalNonPaid) data.status = 'FAILED';
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data });
      return { outcome: 'duplicate_different_attempt', attemptId: attempt.id };
    }

    // Payment sits in a state PAID is not reachable from (e.g. REFUNDED) —
    // a confirmation arriving here is itself the anomaly worth recording.
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: { errorMessage: `PAYMENT_STATE_CONFLICT: Payment is '${payment.status}', a PAID confirmation cannot be accepted.`, responsePayload },
    });
    return { outcome: 'payment_state_conflict', attemptId: attempt.id, paymentStatus: payment.status };
  }

  // We hold the claim: this Payment is now PAID. If this specific attempt
  // was already terminal, we only reach here because the safety gate above
  // confirmed the Order is still open — the state machine still forbids
  // rewriting the attempt's own `status`, so record full evidence instead.
  if (wasTerminalNonPaid) {
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        providerTransactionId, paidAt: new Date(), responsePayload,
        errorMessage: `LATE_CONFIRMATION_AFTER_TERMINAL: provider confirmed PAID after this attempt was already '${attempt.status}' (Order was still open: ${orderStatus}). The order was marked PAID from this evidence — review for reconciliation.`,
      },
    });
    return { outcome: 'late_confirmation_after_terminal', attemptId: attempt.id };
  }

  // Normal path. Optimistic-lock the attempt on the exact status we read —
  // extremely unlikely to lose given merchantReference is unique to this
  // attempt and we already hold the Payment claim, but never assume it.
  const finalized = await tx.paymentAttempt.updateMany({
    where: { id: attempt.id, status: attempt.status },
    data: { status: 'PAID', providerTransactionId, paidAt: new Date(), responsePayload },
  });
  if (finalized.count === 0) {
    // Leaving Payment=PAID with no finalized attempt would be inconsistent.
    // Throwing rolls back the whole $transaction (including the Payment
    // claim above) so the caller's retry/IPN redelivery can resolve it cleanly.
    throw new Error('ATTEMPT_STATE_RACE: PaymentAttempt changed unexpectedly while holding the Payment claim; transaction rolled back for retry.');
  }

  return { outcome: 'paid', attemptId: attempt.id };
}
