// PaymentStatus state machine — the single source of truth for which status
// transitions are legal, shared by Payment.status and PaymentAttempt.status
// (both enums use the exact same values and the same rules).
//
// This file has NO Prisma import and makes NO database call on purpose: it
// is pure, synchronous, and testable today even though the Payment/
// PaymentAttempt tables don't exist yet (migration pending approval). Once
// the migration lands, payment.service.js calls assertTransition() inside
// every DB write that changes a status — never writes a status directly.

export const PAYMENT_STATUSES = [
  'PENDING',
  'AWAITING_VERIFICATION',
  'PROCESSING',
  'PAID',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
];

// PAID is reachable from several states but is NOT a dead end: a paid
// payment can still move to REFUNDED through an authorized refund flow
// (not implemented yet — this only reserves the transition). Every other
// post-PAID transition is forbidden: once paid, an attempt/payment can never
// slide back to PENDING/FAILED/CANCELLED/EXPIRED.
export const VALID_TRANSITIONS = {
  PENDING: ['PROCESSING', 'AWAITING_VERIFICATION', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED'],
  AWAITING_VERIFICATION: ['PAID', 'FAILED', 'CANCELLED'],
  PROCESSING: ['PAID', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PAID: ['REFUNDED'],
  FAILED: ['PROCESSING'],
  CANCELLED: ['PROCESSING'],
  EXPIRED: ['PROCESSING'],
  REFUNDED: [],
};

// The exact set of statuses PAID can be reached from — derived from the
// table above so it can never drift out of sync with it. This is the
// condition payment.service.js's conditional UPDATE must use when claiming a
// Payment row for PAID — `status != 'PAID'` is NOT equivalent to this (it
// would wrongly also match REFUNDED, letting a stale confirmation move a
// refunded payment back to PAID).
export const PAID_PREDECESSOR_STATUSES = Object.entries(VALID_TRANSITIONS)
  .filter(([, targets]) => targets.includes('PAID'))
  .map(([from]) => from);

export function isValidTransition(from, to) {
  if (!PAYMENT_STATUSES.includes(from)) return false;
  if (!PAYMENT_STATUSES.includes(to)) return false;
  if (from === to) return false; // re-applying the same status is handled by callers as an idempotent no-op, not a "transition"
  return VALID_TRANSITIONS[from].includes(to);
}

function transitionError(from, to) {
  const error = new Error(`Không thể chuyển trạng thái thanh toán từ ${from} sang ${to}.`);
  error.statusCode = 409;
  error.code = 'PAYMENT_STATUS_TRANSITION_INVALID';
  return error;
}

/**
 * Throws unless `from -> to` is a legal transition. Callers use this as a
 * guard immediately before every status-changing write — never write a
 * status without calling this first.
 */
export function assertTransition(from, to) {
  if (!isValidTransition(from, to)) throw transitionError(from, to);
}

// True once a status can never change again (FAILED/CANCELLED/EXPIRED and,
// notably, NOT PAID — PAID can still move to REFUNDED).
export function isTerminal(status) {
  return (VALID_TRANSITIONS[status] ?? []).length === 0;
}
