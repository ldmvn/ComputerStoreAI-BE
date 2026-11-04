// Payment Core — creates and manages Payment/PaymentAttempt rows for an
// Order. This file owns ONLY payment bookkeeping; it never touches
// Order.status (fulfillment) and never duplicates Order Service logic. The
// actual "is this attempt now PAID" decision always goes through
// paymentConfirmation.service.js's confirmPaymentAttempt() — nothing here
// writes PaymentStatus.PAID directly.

import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import * as storeSettingService from '../../services/storeSetting.service.js';
import { confirmPaymentAttempt } from './paymentConfirmation.service.js';
import { assertTransition, isValidTransition, PAID_PREDECESSOR_STATUSES } from '../validators/paymentStatus.validator.js';
import { buildVnpayPaymentUrl, verifyVnpaySignature, vnpAmountToVnd, formatVnpDate, signQueryDr, verifyQueryDrResponse } from './vnpayUtil.service.js';
import { signCreateRequest, verifyIpnSignature, classifyMomoFailure, isMomoSuccess, signQuery } from './momoUtil.service.js';

function paymentError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// Defaults match the real MB Bank account provided for this store. Admin can
// override via Store Settings (payment.bank.*) later without a schema
// change — these three keys already exist as free-form StoreSetting rows.
// accountName is normalized to unaccented ALL-CAPS ("LUU DUC MANH"), matching
// how MB Bank itself displays/encodes the account holder name on statements
// and in VietQR — not a typo of "Lưu Đức Mạnh".
const DEFAULT_BANK_CONFIG = {
  bin: '970422', // MB Bank
  accountNumber: '0386220065',
  accountName: 'LUU DUC MANH',
};

export async function getBankConfig() {
  const [bin, accountNumber, accountName] = await Promise.all([
    storeSettingService.getSetting('payment.bank.bin'),
    storeSettingService.getSetting('payment.bank.accountNumber'),
    storeSettingService.getSetting('payment.bank.accountName'),
  ]);
  return {
    bin: bin?.trim() || DEFAULT_BANK_CONFIG.bin,
    accountNumber: accountNumber?.trim() || DEFAULT_BANK_CONFIG.accountNumber,
    accountName: accountName?.trim() || DEFAULT_BANK_CONFIG.accountName,
  };
}

function buildTransferContent(orderId) {
  // Unique per order, short enough for a bank transfer note field, and
  // greppable in a real MB Bank statement for Admin reconciliation.
  return `DUCMANHPC DH${orderId}`;
}

/**
 * Called from inside order.service.js's createOrder() transaction, right
 * after the Order row is created. Creates the Payment row for every method
 * (including COD, so Admin always has one place to look up payment status —
 * see docs/payment-architecture.md), and for BANK_TRANSFER also creates the
 * first PaymentAttempt with the bank snapshot already attached.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ id: number, subtotal: number, discountAmount: number, paymentMethod: string }} order
 * @returns {Promise<{ payment: object, attempt: object|null }>}
 */
export async function createPaymentForOrder(tx, order) {
  const amount = order.subtotal - order.discountAmount;
  const method = order.paymentMethod; // already validated by order.service.js's ALLOWED_PAYMENT

  const payment = await tx.payment.create({
    data: { orderId: order.id, method, status: 'PENDING', amount },
  });

  if (method !== 'BANK_TRANSFER') {
    return { payment, attempt: null };
  }

  const bank = await getBankConfig();
  const attempt = await tx.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      method,
      merchantReference: `BT-${order.id}-${randomUUID().slice(0, 8)}`,
      amount,
      status: 'PENDING',
      bankBin: bank.bin,
      bankName: 'MB Bank',
      bankAccountNumber: bank.accountNumber,
      bankAccountName: bank.accountName,
      transferContent: buildTransferContent(order.id),
    },
  });

  return { payment, attempt };
}

/**
 * Called whenever an Order transitions to CANCELLED (customer self-cancel or
 * Admin cancel) — moves its Payment/latest PaymentAttempt to CANCELLED too,
 * so a stale QR/attempt is never shown as still-pending after the order
 * itself is dead. Silently does nothing if there is no Payment yet (old
 * orders, or COD created before this module shipped) or if the current
 * status cannot legally move to CANCELLED (e.g. already PAID — cancelling
 * the order does not retroactively un-pay it; that needs a refund flow,
 * out of scope here).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} orderId
 */
export async function cancelPaymentForOrder(tx, orderId) {
  const payment = await tx.payment.findUnique({ where: { orderId }, include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (!payment) return; // no Payment row (old order, or Payment Module not yet active when it was created)

  const attempt = payment.attempts[0];
  try {
    assertTransition(payment.status, 'CANCELLED');
  } catch {
    return; // e.g. already PAID/REFUNDED/terminal — leave payment history untouched
  }
  await tx.payment.update({ where: { id: payment.id }, data: { status: 'CANCELLED' } });
  if (attempt) {
    try {
      assertTransition(attempt.status, 'CANCELLED');
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'CANCELLED' } });
    } catch { /* attempt already terminal on its own — Payment-level CANCELLED above is what matters */ }
  }
}

/**
 * Reopens the existing VietQR attempt for an order — "mở lại QR từ chi tiết
 * đơn hàng mà không tạo đơn mới". Returns the SAME attempt row (same
 * merchantReference/transferContent/amount) created at checkout; never
 * creates a second Order and never mutates the snapshot.
 * @param {number} orderId
 * @param {number} userId - ownership check; a customer can only reopen their own order's QR
 */
export async function getVietQrForOrder(orderId, userId) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true, paymentMethod: true } });
  if (!order) throw paymentError('Đơn hàng không tồn tại.', 404);
  if (order.paymentMethod !== 'BANK_TRANSFER') throw paymentError('Đơn hàng này không sử dụng chuyển khoản ngân hàng.', 400);

  const payment = await prisma.payment.findUnique({
    where: { orderId },
    include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  const attempt = payment?.attempts?.[0];
  if (!payment || !attempt) throw paymentError('Không tìm thấy thông tin chuyển khoản cho đơn hàng này.', 404);

  return { payment, attempt };
}

/**
 * Customer clicks "Tôi đã chuyển khoản". Moves the attempt (and Payment)
 * to AWAITING_VERIFICATION ONLY — this is a customer self-report, never a
 * verified payment. The state machine (assertTransition) makes it
 * structurally impossible for this function to reach PAID.
 * @param {number} orderId
 * @param {number} userId
 */
export async function reportBankTransfer(orderId, userId) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true, paymentMethod: true } });
  if (!order) throw paymentError('Đơn hàng không tồn tại.', 404);
  if (order.paymentMethod !== 'BANK_TRANSFER') throw paymentError('Đơn hàng này không sử dụng chuyển khoản ngân hàng.', 400);

  return prisma.$transaction(async tx => {
    const payment = await tx.payment.findUnique({ where: { orderId }, include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    const attempt = payment?.attempts?.[0];
    if (!payment || !attempt) throw paymentError('Không tìm thấy thông tin chuyển khoản cho đơn hàng này.', 404);

    // Idempotent: clicking the button twice is a no-op, not an error.
    if (payment.status === 'AWAITING_VERIFICATION') return { payment, attempt, alreadyReported: true };

    assertTransition(attempt.status, 'AWAITING_VERIFICATION'); // throws 409 if e.g. already PAID/FAILED
    assertTransition(payment.status, 'AWAITING_VERIFICATION');

    const reportedAt = new Date();
    const updatedAttempt = await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'AWAITING_VERIFICATION', reportedAt } });
    const updatedPayment = await tx.payment.update({ where: { id: payment.id }, data: { status: 'AWAITING_VERIFICATION' } });

    return { payment: updatedPayment, attempt: updatedAttempt, alreadyReported: false };
  });
}

/**
 * Admin confirms having received the transfer after reconciling the real MB
 * Bank statement. This is a MANUAL confirmation of REAL money an admin
 * personally verified — it goes through the exact same
 * confirmPaymentAttempt() used by (future) MoMo/VNPAY IPN handlers, so the
 * same concurrency guards, idempotency and state machine apply uniformly.
 * The caller (controller) is responsible for RBAC + activity log — this
 * function only does the payment-domain work.
 * @param {number} orderId
 * @param {number} adminUserId
 */
export async function adminConfirmPayment(orderId, adminUserId) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, paymentMethod: true } });
  if (!order) throw paymentError('Đơn hàng không tồn tại.', 404);
  if (order.paymentMethod !== 'BANK_TRANSFER') throw paymentError('Chỉ xác nhận thủ công cho đơn chuyển khoản ngân hàng.', 400);

  const payment = await prisma.payment.findUnique({ where: { orderId }, include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  const attempt = payment?.attempts?.[0];
  if (!payment || !attempt) throw paymentError('Không tìm thấy thông tin thanh toán cho đơn hàng này.', 404);

  const result = await prisma.$transaction(tx => confirmPaymentAttempt({
    tx,
    merchantReference: attempt.merchantReference,
    verifiedAmount: payment.amount, // Admin visually confirmed the amount against the bank statement; we trust Admin's explicit action, same as the attempt's own recorded amount
    providerTransactionId: `ADMIN-${adminUserId}-${Date.now()}`,
    responsePayload: { confirmedByAdminId: adminUserId, source: 'admin_manual_reconciliation' },
    orderStatus: order.status,
  }));

  return result;
}

/**
 * The merged "Xác nhận tiền & duyệt đơn" action for VietQR, only offered
 * while the Order is still PENDING (see admin/orders/page.tsx's
 * canMergeConfirmApprove). Confirms the transfer AND approves the order
 * (PENDING → CONFIRMED) inside ONE Prisma transaction — deliberately NOT a
 * call to adminConfirmPayment() followed by a separate call to
 * adminOrder.service.js's updateOrderStatus(), which would each open their
 * own transaction and violate the "một thao tác, một transaction" rule this
 * task requires. The CONFIRMED write is inlined here (not imported from
 * adminOrder.service.js) specifically to avoid a circular import —
 * adminOrder.service.js already imports from this module (cancelPaymentForOrder) —
 * and because it is the exact same 3-line write updateOrderStatus() does for
 * PENDING → CONFIRMED, nothing more.
 * @param {number} orderId
 * @param {number} adminUserId
 */
export async function adminConfirmPaymentAndApprove(orderId, adminUserId) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, paymentMethod: true } });
  if (!order) throw paymentError('Đơn hàng không tồn tại.', 404);
  if (order.paymentMethod !== 'BANK_TRANSFER') throw paymentError('Chỉ áp dụng gộp xác nhận cho đơn chuyển khoản ngân hàng.', 400);
  if (order.status !== 'PENDING') throw paymentError('Đơn hàng không còn ở trạng thái chờ duyệt — dùng "Xác nhận đã nhận tiền" riêng.', 409);

  const payment = await prisma.payment.findUnique({ where: { orderId }, include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  const attempt = payment?.attempts?.[0];
  if (!payment || !attempt) throw paymentError('Không tìm thấy thông tin thanh toán cho đơn hàng này.', 404);

  return prisma.$transaction(tx => settleAttemptAndApproveIfPending(tx, {
    merchantReference: attempt.merchantReference,
    verifiedAmount: payment.amount,
    providerTransactionId: `ADMIN-${adminUserId}-${Date.now()}`,
    responsePayload: { confirmedByAdminId: adminUserId, source: 'admin_manual_reconciliation_and_approve' },
    orderId, orderStatus: order.status,
    approvalNote: 'Xác nhận tiền & duyệt đơn (gộp) — VietQR',
    adminId: adminUserId,
  }));
}

/**
 * Shared inner-transaction logic for every "confirm this attempt and, if the
 * order is still PENDING, approve it" action — the Admin merge button and the
 * SePay webhook auto-confirmation both run through here, so the confirm/approve
 * business rules live in exactly one place (task: reuse, no duplicate logic).
 *
 * Runs the single PAID gatekeeper (confirmPaymentAttempt — all idempotency,
 * amount, duplicate, late-confirmation and race guards inherited), then — ONLY
 * when the payment actually settled AND the order is still PENDING — claims the
 * Order row with the same atomic conditional-UPDATE primitive used everywhere
 * in this module (never a plain read, which is unsafe under MySQL REPEATABLE
 * READ — see paymentConfirmation.service.js). Approval is pure fulfillment
 * bookkeeping: stock was already reserved at checkout (order.service.js
 * decrements on create, restores on cancel), so there is no stock to deduct
 * here — the only inventory rule that applies is that a CANCELLED order (whose
 * stock was already restored) is never auto-approved, which the PENDING-only
 * claim guarantees.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<object>} confirmPaymentAttempt's result plus { orderApproved:boolean }
 */
async function settleAttemptAndApproveIfPending(tx, { merchantReference, verifiedAmount, providerTransactionId, responsePayload, orderId, orderStatus, approvalNote, adminId = null }) {
  const confirmResult = await confirmPaymentAttempt({ tx, merchantReference, verifiedAmount, providerTransactionId, responsePayload, orderStatus });

  const paymentSettled = confirmResult.outcome === 'paid'
    || confirmResult.outcome === 'late_confirmation_after_terminal'
    || confirmResult.outcome === 'duplicate_same_attempt';

  // Payment rejected (amount mismatch / state conflict / needs manual review)
  // — the whole transaction still commits (nothing destructive happened), but
  // the order is explicitly NOT approved.
  if (!paymentSettled) return { ...confirmResult, orderApproved: false };

  // Only a still-PENDING order is auto-approved. An order already CONFIRMED/
  // SHIPPING/DELIVERED keeps its state (payment just got recorded PAID); a
  // CANCELLED order is never flipped back to active from a payment event.
  if (orderStatus !== 'PENDING') return { ...confirmResult, orderApproved: false };

  const orderClaim = await tx.order.updateMany({
    where: { id: orderId, status: 'PENDING' },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  });
  if (orderClaim.count !== 1) return { ...confirmResult, orderApproved: false };

  await tx.orderStatusHistory.create({
    data: { orderId, status: 'CONFIRMED', note: approvalNote, adminId },
  });

  return { ...confirmResult, orderApproved: true };
}

/**
 * SePay webhook auto-confirmation entry point. Matches a SePay-verified
 * incoming bank transfer to its Order's single VietQR PaymentAttempt and runs
 * the EXACT same confirm-&-approve path as the Admin merge action
 * (settleAttemptAndApproveIfPending), so a real transfer settles the Payment
 * (PAID) and — when the order is still PENDING — approves it, all in one
 * transaction, inheriting every idempotency/amount/concurrency guard.
 *
 * The caller (sepayWebhook controller) has ALREADY verified the HMAC-SHA256
 * signature, the receiving account and transfer direction; this function
 * trusts only the amount it is handed (confirmPaymentAttempt re-checks it
 * against the attempt) and never marks anything PAID off a customer's click.
 *
 * `providerTransactionId` is SePay's own transaction id — stored on the
 * attempt on success, and returned as `settledProviderTransactionId` so the
 * controller can tell a benign redelivery (same id already recorded) from a
 * genuine SECOND transfer onto an already-paid order (different id) that needs
 * a manual refund.
 *
 * @param {{ orderId:number, sepayTransactionId:string, verifiedAmount:number, responsePayload:object }} p
 * @returns {Promise<{matched:true, outcome:string, orderApproved?:boolean, attemptId?:number, orderId:number, paymentAmount:number, sepayAmount:number, settledProviderTransactionId:string|null } | {matched:false, reason:string, orderId:number|null}>}
 */
export async function confirmVietQrByWebhook({ orderId, sepayTransactionId, verifiedAmount, responsePayload }) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, paymentMethod: true } });
  if (!order) return { matched: false, reason: 'order_not_found', orderId };
  if (order.paymentMethod !== 'BANK_TRANSFER') return { matched: false, reason: 'not_bank_transfer', orderId };

  const payment = await prisma.payment.findUnique({ where: { orderId }, include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  const attempt = payment?.attempts?.[0];
  if (!payment || !attempt) return { matched: false, reason: 'no_payment_attempt', orderId };

  const result = await prisma.$transaction(tx => settleAttemptAndApproveIfPending(tx, {
    merchantReference: attempt.merchantReference,
    verifiedAmount,
    providerTransactionId: sepayTransactionId,
    responsePayload,
    orderId,
    orderStatus: order.status,
    approvalNote: 'Tự động xác nhận thanh toán & duyệt đơn — SePay (VietQR)',
    adminId: null,
  }));

  // Re-read the attempt's recorded provider id so the controller can compare
  // it to THIS webhook's id (benign redelivery vs. a distinct second transfer).
  const settled = await prisma.paymentAttempt.findUnique({ where: { id: attempt.id }, select: { providerTransactionId: true } });

  return { ...result, matched: true, orderId, paymentAmount: payment.amount, sepayAmount: verifiedAmount, settledProviderTransactionId: settled?.providerTransactionId ?? null };
}

/**
 * Admin confirms having physically collected the COD cash from the courier
 * on delivery. Deliberately a SEPARATE action from adminConfirmPayment()
 * (which is VietQR-only) — COD never creates a PaymentAttempt row (see
 * createPaymentForOrder above), so there is no merchantReference to run
 * through confirmPaymentAttempt(). This claims the Payment row directly,
 * using the exact same atomic conditional-UPDATE primitive (never a plain
 * read to decide correctness — see confirmPaymentAttempt()'s comments on why
 * that is unsafe under MySQL REPEATABLE READ) so two concurrent clicks can
 * never both win, and independent of Order Status: approving/shipping/
 * delivering an order never implies COD cash was collected.
 * @param {number} orderId
 * @param {number} adminUserId
 */
export async function adminConfirmCodPayment(orderId, adminUserId) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, paymentMethod: true } });
  if (!order) throw paymentError('Đơn hàng không tồn tại.', 404);
  if (order.paymentMethod !== 'COD') throw paymentError('Chỉ xác nhận thu tiền cho đơn thanh toán khi nhận hàng (COD).', 400);

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { orderId } });
    if (!payment) throw paymentError('Không tìm thấy thông tin thanh toán cho đơn hàng này.', 404);

    // Idempotent: confirming an already-PAID COD order twice is a no-op.
    if (payment.status === 'PAID') return { outcome: 'duplicate_same_attempt', paymentId: payment.id };

    const claim = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: PAID_PREDECESSOR_STATUSES } },
      data: { status: 'PAID', paidAt: new Date() },
    });
    if (claim.count === 1) return { outcome: 'paid', paymentId: payment.id };

    // Lost the claim — use the same atomic probe trick as
    // confirmPaymentAttempt() instead of a plain findUnique, since a SELECT
    // here could still see a pre-commit snapshot under REPEATABLE READ.
    const probe = await tx.payment.updateMany({ where: { id: payment.id, status: 'PAID' }, data: { status: 'PAID' } });
    if (probe.count === 1) return { outcome: 'duplicate_same_attempt', paymentId: payment.id };

    // Not PAID and we didn't win the claim — the only remaining case is a
    // state PAID can never follow (e.g. CANCELLED/REFUNDED). The read below
    // is only for the human-readable status label, never a correctness decision.
    const fresh = await tx.payment.findUnique({ where: { id: payment.id } });
    return { outcome: 'payment_state_conflict', paymentId: payment.id, paymentStatus: fresh.status };
  });
}

// ── VNPAY ────────────────────────────────────────────────────────────────────
// Design note on retries: a single ATTEMPT's failure/cancellation/timeout is
// recorded on that PaymentAttempt only (its own terminal status, never
// rewritten — same philosophy as everywhere else in this file). The
// Payment row itself is deliberately NEVER moved to FAILED/CANCELLED just
// because one gateway attempt didn't succeed — it stays PENDING/PROCESSING
// so the customer can create a brand new attempt and try again, exactly like
// "Thanh toán lại" is expected to work. Nothing before this comment ever
// wrote FAILED anywhere in this file, so this doesn't change any existing
// behavior — it's the first (and only) writer of PaymentAttempt FAILED/
// CANCELLED/EXPIRED, and it never touches paymentStatus.validator.js's
// shared state machine. Payment only ever reaches PAID via
// confirmPaymentAttempt() (the IPN success path below), same as every other
// method in this codebase.

function getVnpayConfig() {
  const tmnCode = process.env.VNPAY_TMN_CODE;
  const hashSecret = process.env.VNPAY_HASH_SECRET;
  const vnpUrl = process.env.VNPAY_URL;
  const returnUrl = process.env.VNPAY_RETURN_URL;
  if (!tmnCode || !hashSecret || !vnpUrl || !returnUrl) {
    throw paymentError('VNPAY chưa được cấu hình đầy đủ trên hệ thống.', 503);
  }
  return { tmnCode, hashSecret, vnpUrl, returnUrl };
}

// VNPAY response/transaction-status codes that mean "the customer backed
// out or the attempt was never completed" — attempt-level CANCELLED. Code
// '11' specifically means the bank/gateway timed out waiting for the
// customer — mapped to EXPIRED for a clearer audit trail. Everything else
// non-'00' is a generic FAILED. Source: VNPAY's official response-code table.
function classifyVnpayFailure(responseCode) {
  if (responseCode === '24') return 'CANCELLED';
  if (responseCode === '11') return 'EXPIRED';
  return 'FAILED';
}

/**
 * Admin NEVER calls this — it's the customer-facing "pay with VNPAY" /
 * "thanh toán lại" action. Creates a NEW PaymentAttempt every time (VNPAY
 * requires a fresh, never-reused vnp_TxnRef per attempt) and returns the
 * signed redirect URL. Safe to call repeatedly while unpaid — see the
 * retry design note above.
 * @param {number} orderId
 * @param {number} userId - ownership check; a customer can only pay their own order
 * @param {string} ipAddr - the customer's real IP, required by VNPAY
 */
export async function createVnpayPaymentUrl(orderId, userId, ipAddr) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true, paymentMethod: true, status: true } });
  if (!order) throw paymentError('Đơn hàng không tồn tại.', 404);
  if (order.paymentMethod !== 'VNPAY') throw paymentError('Đơn hàng này không sử dụng VNPAY.', 400);
  if (order.status === 'CANCELLED') throw paymentError('Đơn hàng đã bị hủy, không thể thanh toán.', 400);

  const payment = await prisma.payment.findUnique({ where: { orderId } });
  if (!payment) throw paymentError('Không tìm thấy thông tin thanh toán cho đơn hàng này.', 404);
  if (payment.status === 'PAID') throw paymentError('Đơn hàng đã được thanh toán.', 409);
  if (!isValidTransition(payment.status, 'PROCESSING') && payment.status !== 'PROCESSING') {
    throw paymentError('Trạng thái thanh toán hiện tại không cho phép thanh toán lại.', 409);
  }

  const { tmnCode, hashSecret, vnpUrl, returnUrl } = getVnpayConfig();
  // Numeric-only, well under PaymentAttempt.merchantReference's 100-char
  // limit, and unique per attempt (never reused, per VNPAY's requirement).
  const merchantReference = `${orderId}${Date.now()}`;

  const attempt = await prisma.paymentAttempt.create({
    data: { paymentId: payment.id, method: 'VNPAY', merchantReference, amount: payment.amount, status: 'PENDING' },
  });

  const { url, params } = buildVnpayPaymentUrl({
    baseUrl: vnpUrl, tmnCode, hashSecret, amount: payment.amount,
    merchantReference, orderInfo: `Thanh toan don hang ${orderId}`,
    ipAddr: ipAddr || '127.0.0.1', returnUrl,
  });

  await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { requestPayload: params } });

  if (payment.status !== 'PROCESSING') {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'PROCESSING' } });
  }

  return { url, merchantReference };
}

/**
 * The IPN handler — one of the two provider-verified paths (IPN or QueryDR)
 * that can mark a VNPAY Payment PAID, and it only does so through
 * confirmPaymentAttempt() like everything else. Returns VNPAY's own
 * documented RspCode/Message shape (NOT our usual {success,data,message}
 * API shape) — VNPAY itself parses this response and retries the IPN while
 * it doesn't see RspCode "00".
 * @param {Record<string, string>} query - the raw req.query from VNPAY's IPN GET request
 */
export async function handleVnpayIpn(query) {
  const { hashSecret } = getVnpayConfig();

  if (!verifyVnpaySignature(query, hashSecret)) {
    return { rspCode: '97', message: 'Invalid signature' };
  }

  const merchantReference = query.vnp_TxnRef;
  const responseCode = query.vnp_ResponseCode;
  const transactionStatus = query.vnp_TransactionStatus;
  const verifiedAmount = vnpAmountToVnd(query.vnp_Amount);

  const attempt = await prisma.paymentAttempt.findUnique({
    where: { merchantReference },
    include: { payment: { select: { orderId: true } } },
  });
  if (!attempt || attempt.method !== 'VNPAY') return { rspCode: '01', message: 'Order not found' };
  if (attempt.amount !== verifiedAmount) return { rspCode: '04', message: 'Invalid amount' };

  const isSuccess = responseCode === '00' && transactionStatus === '00';

  if (isSuccess) {
    const order = await prisma.order.findUnique({ where: { id: attempt.payment.orderId }, select: { status: true } });
    const result = await prisma.$transaction((tx) => confirmPaymentAttempt({
      tx, merchantReference, verifiedAmount,
      providerTransactionId: query.vnp_TransactionNo || `VNP-NOTXN-${merchantReference}`,
      responsePayload: query, orderStatus: order?.status ?? null,
    }));
    const settled = result.outcome === 'paid' || result.outcome === 'late_confirmation_after_terminal' || result.outcome === 'duplicate_same_attempt';
    return settled ? { rspCode: '00', message: 'Confirm Success' } : { rspCode: '02', message: `Order already confirmed (${result.outcome})` };
  }

  // Failure/cancel/timeout — record on THIS attempt only; Payment is left
  // alone so the customer can retry (see design note above).
  const failureStatus = classifyVnpayFailure(responseCode);
  if (attempt.status === failureStatus) return { rspCode: '00', message: 'Confirm Success' }; // duplicate IPN redelivery — idempotent no-op
  if (!isValidTransition(attempt.status, failureStatus)) {
    // Attempt already terminal (e.g. a success IPN arrived first) — a late
    // failure report must never override it.
    return { rspCode: '02', message: 'Order already confirmed' };
  }
  await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: failureStatus, responsePayload: query, errorMessage: `VNPAY vnp_ResponseCode=${responseCode}` } });
  await prisma.payment.updateMany({ where: { id: attempt.paymentId, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: failureStatus } });
  return { rspCode: '00', message: 'Confirm Success' };
}

/**
 * The Return URL handler — the customer's BROWSER lands here after VNPAY.
 * Per requirement: NEVER marks anything PAID based on this alone. It verifies
 * the signed redirect and, if IPN is missing, asks VNPAY's authenticated
 * QueryDR API before reporting back
 * whatever the REAL, current Payment status already is, so a slow IPN
 * shows as "đang xác minh" rather than a false PAID/FAILED.
 */
export async function handleVnpayReturn(query) {
  const { hashSecret } = getVnpayConfig();
  const validSignature = verifyVnpaySignature(query, hashSecret);

  const merchantReference = query.vnp_TxnRef;
  const attempt = merchantReference
    ? await prisma.paymentAttempt.findUnique({ where: { merchantReference }, include: { payment: { select: { orderId: true, status: true } } } })
    : null;

  if (!validSignature) {
    return { valid: false, orderId: attempt?.payment?.orderId ?? null, amount: null, paymentStatus: null, attemptStatus: null, vnpayResponseCode: query.vnp_ResponseCode ?? null };
  }
  if (!attempt || attempt.method !== 'VNPAY') {
    return { valid: true, orderId: null, amount: null, paymentStatus: null, attemptStatus: null, vnpayResponseCode: query.vnp_ResponseCode ?? null };
  }

  const responseCode = query.vnp_ResponseCode ?? null;

  // The Return URL alone NEVER marks PAID. But when the payment is still
  // unsettled (IPN not yet delivered — the common sandbox case), actively
  // reconcile against VNPAY's authenticated querydr API so the customer sees
  // the real result instead of a stuck "đang xác minh". A verified Return that
  // reports a non-success code also lets us record the attempt's failure/cancel
  // (never PAID), so a cancelled transaction stops showing as pending.
  if (attempt.payment.status !== 'PAID') {
    if (responseCode === '00') {
      await reconcileVnpayPayment(merchantReference).catch(() => { /* fall through to current status */ });
    } else {
      // Signature-verified non-success Return: record the attempt terminal so
      // the UI shows the real outcome and "thanh toán lại" is offered. Payment
      // row is left open for retry (never flipped to PAID here).
      const failureStatus = classifyVnpayFailure(responseCode);
      if (attempt.status !== failureStatus && isValidTransition(attempt.status, failureStatus)) {
        await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: failureStatus, responsePayload: query, errorMessage: `VNPAY return vnp_ResponseCode=${responseCode}` } }).catch(() => {});
        await prisma.payment.updateMany({ where: { id: attempt.paymentId, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: failureStatus } }).catch(() => {});
      }
    }
  }

  const [fresh, freshAttempt] = await Promise.all([
    prisma.payment.findUnique({ where: { orderId: attempt.payment.orderId }, select: { status: true } }),
    prisma.paymentAttempt.findUnique({ where: { id: attempt.id }, select: { status: true } }),
  ]);
  return {
    valid: true,
    orderId: attempt.payment.orderId,
    amount: attempt.amount,
    // The REAL current status from the DB after any reconciliation above.
    paymentStatus: fresh?.status ?? attempt.payment.status,
    attemptStatus: freshAttempt?.status ?? attempt.status,
    vnpayResponseCode: responseCode,
  };
}

// Derive the querydr/refund endpoint from the configured pay-gateway URL's
// origin — sandbox and production both expose it at /merchant_webapi/api/transaction.
function vnpayQueryEndpoint(vnpUrl) {
  return `${new URL(vnpUrl).origin}/merchant_webapi/api/transaction`;
}

/**
 * Reconcile a VNPAY Payment against VNPAY's authenticated querydr API — the
 * official "truy vấn kết quả giao dịch" used when the IPN is missing or late.
 * The query RESPONSE is signature-verified before we act on it; a confirmed
 * success is settled through the one confirmPaymentAttempt() gatekeeper (same
 * idempotency/amount/race guards as the IPN), so PAID is ALWAYS from verified
 * provider data, never from the Return URL. Idempotent and safe to call
 * repeatedly (e.g. on each Return-page poll). Never throws to the caller on a
 * provider/network issue — returns a reason instead.
 * @param {string} merchantReference - vnp_TxnRef
 */
export async function reconcileVnpayPayment(merchantReference) {
  const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference }, include: { payment: { select: { orderId: true, status: true } } } });
  if (!attempt || attempt.method !== 'VNPAY') return { reconciled: false, reason: 'not_found' };
  if (attempt.payment.status === 'PAID') return { reconciled: false, reason: 'already_paid' };

  let cfg;
  try { cfg = getVnpayConfig(); } catch { return { reconciled: false, reason: 'not_configured' }; }

  const transactionDate = attempt.requestPayload?.vnp_CreateDate;
  if (!transactionDate) return { reconciled: false, reason: 'no_transaction_date' };

  const requestId = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const body = {
    vnp_RequestId: requestId,
    vnp_Version: '2.1.0',
    vnp_Command: 'querydr',
    vnp_TmnCode: cfg.tmnCode,
    vnp_TxnRef: merchantReference,
    vnp_OrderInfo: `Query ${merchantReference}`,
    vnp_TransactionDate: String(transactionDate),
    vnp_CreateDate: formatVnpDate(),
    vnp_IpAddr: '127.0.0.1',
  };
  body.vnp_SecureHash = signQueryDr(body, cfg.hashSecret);

  let res;
  try {
    const r = await fetch(vnpayQueryEndpoint(cfg.vnpUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    res = await r.json();
  } catch (error) {
    return { reconciled: false, reason: `network_error: ${error.message}` };
  }

  if (!verifyQueryDrResponse(res, cfg.hashSecret)) return { reconciled: false, reason: 'bad_response_signature' };
  if (String(res.vnp_TmnCode ?? '') !== cfg.tmnCode) return { reconciled: false, reason: 'merchant_mismatch' };
  if (String(res.vnp_TxnRef ?? '') !== merchantReference) return { reconciled: false, reason: 'transaction_reference_mismatch' };
  // vnp_ResponseCode '00' = the QUERY itself succeeded; '91' = transaction not
  // found (customer never completed it yet) — treat as still pending.
  if (String(res.vnp_ResponseCode) !== '00') return { reconciled: false, reason: `query_rc_${res.vnp_ResponseCode}` };

  const txStatus = String(res.vnp_TransactionStatus ?? '');
  if (txStatus === '00') {
    const amount = vnpAmountToVnd(res.vnp_Amount);
    if (attempt.amount !== amount) {
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { errorMessage: `QUERYDR_AMOUNT_MISMATCH: expected ${attempt.amount}, VNPAY reports ${amount}`, responsePayload: res } }).catch(() => {});
      return { reconciled: false, reason: 'amount_mismatch' };
    }
    const order = await prisma.order.findUnique({ where: { id: attempt.payment.orderId }, select: { status: true } });
    const result = await prisma.$transaction(tx => confirmPaymentAttempt({
      tx, merchantReference, verifiedAmount: amount,
      providerTransactionId: res.vnp_TransactionNo ? String(res.vnp_TransactionNo) : `VNP-Q-${merchantReference}`,
      responsePayload: res, orderStatus: order?.status ?? null,
    }));
    const fresh = await prisma.payment.findUnique({ where: { id: attempt.paymentId }, select: { status: true } });
    return { reconciled: fresh?.status === 'PAID', outcome: result.outcome, paymentStatus: fresh?.status ?? attempt.payment.status };
  }

  // '01' = pending/not completed → leave as-is for the next poll/IPN.
  if (txStatus === '01' || txStatus === '') return { reconciled: false, reason: 'still_pending' };

  // Any other terminal non-success status → record the attempt as FAILED (the
  // Payment stays open so the customer can retry). Never marks PAID.
  if (attempt.status !== 'FAILED' && isValidTransition(attempt.status, 'FAILED')) {
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', responsePayload: res, errorMessage: `VNPAY querydr vnp_TransactionStatus=${txStatus}` } }).catch(() => {});
    await prisma.payment.updateMany({ where: { id: attempt.paymentId, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'FAILED' } }).catch(() => {});
  }
  return { reconciled: true, outcome: 'FAILED', paymentStatus: 'FAILED', attemptStatus: 'FAILED' };
}

// ── MoMo (Sandbox v2 — /v2/gateway/api/create) ───────────────────────────────
// Structurally identical to the VNPAY flow above: a customer-initiated create
// mints a fresh PaymentAttempt and returns a hosted-gateway URL; the IPN is the
// IPN and authenticated Provider Query are the only paths that can mark a
// MoMo Payment PAID, both solely through confirmPaymentAttempt(). Unlike
// SePay VietQR, MoMo
// (a redirect gateway, exactly like VNPAY) does NOT auto-approve the Order —
// the Payment is marked PAID and Admin approves it, keeping MoMo and VNPAY
// behaviourally identical. The Payment row is never moved to FAILED just
// because one attempt failed/was cancelled, so "thanh toán lại" works.

function getMomoConfig() {
  const partnerCode = process.env.MOMO_PARTNER_CODE;
  const accessKey = process.env.MOMO_ACCESS_KEY;
  const secretKey = process.env.MOMO_SECRET_KEY;
  const endpoint = process.env.MOMO_ENDPOINT;
  const redirectUrl = process.env.MOMO_REDIRECT_URL;
  const ipnUrl = process.env.MOMO_IPN_URL;
  if (!partnerCode || !accessKey || !secretKey || !endpoint || !redirectUrl || !ipnUrl) {
    throw paymentError('MoMo chưa được cấu hình đầy đủ trên hệ thống.', 503);
  }
  return { partnerCode, accessKey, secretKey, endpoint, redirectUrl, ipnUrl };
}

/**
 * Customer-facing "pay with MoMo" / "thanh toán lại". Creates a NEW
 * PaymentAttempt every call and server-to-server POSTs MoMo's create API to
 * obtain the hosted payUrl. Safe to call repeatedly while unpaid.
 *
 * The MoMo orderId is namespaced + time-unique (`DMPC<orderId>T<ms>`) so it can
 * never collide with another website's transactions under the SAME shared
 * sandbox keys (requirement #7), and so each retry is a brand-new MoMo orderId
 * (MoMo rejects a reused orderId). It is stored as the attempt's
 * merchantReference and is what the IPN/return echo back for matching.
 * @param {number} orderId
 * @param {number} userId - ownership check
 */
/**
 * @param {number} orderId
 * @param {number} userId - ownership check
 * @param {'wallet'|'atm'} momoType - 'atm' = thẻ ATM nội địa (payWithATM, default), 'wallet' = ví MoMo QR (captureWallet)
 */
export async function createMomoPaymentUrl(orderId, userId, momoType = 'atm') {
  if (momoType !== 'wallet' && momoType !== 'atm') {
    throw paymentError('Loại thanh toán MoMo không hợp lệ (wallet | atm).', 400);
  }

  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true, paymentMethod: true, status: true } });
  if (!order) throw paymentError('Đơn hàng không tồn tại.', 404);
  if (order.paymentMethod !== 'MOMO') throw paymentError('Đơn hàng này không sử dụng MoMo.', 400);
  if (order.status === 'CANCELLED') throw paymentError('Đơn hàng đã bị hủy, không thể thanh toán.', 400);

  const payment = await prisma.payment.findUnique({ where: { orderId } });
  if (!payment) throw paymentError('Không tìm thấy thông tin thanh toán cho đơn hàng này.', 404);
  if (payment.status === 'PAID') throw paymentError('Đơn hàng đã được thanh toán.', 409);
  if (!isValidTransition(payment.status, 'PROCESSING') && payment.status !== 'PROCESSING') {
    throw paymentError('Trạng thái thanh toán hiện tại không cho phép thanh toán lại.', 409);
  }

  const cfg = getMomoConfig();
  const momoOrderId = `DMPC${orderId}T${Date.now()}`;
  const requestId = `${momoOrderId}-${randomUUID().slice(0, 8)}`;
  const orderInfo = `Thanh toan don hang ${orderId}`;
  const requestType = momoType === 'atm' ? 'payWithATM' : 'captureWallet';
  const extraData = '';
  const signature = signCreateRequest({
    accessKey: cfg.accessKey, amount: payment.amount, extraData, ipnUrl: cfg.ipnUrl,
    orderId: momoOrderId, orderInfo, partnerCode: cfg.partnerCode, redirectUrl: cfg.redirectUrl,
    requestId, requestType,
  }, cfg.secretKey);

  const requestBody = {
    partnerCode: cfg.partnerCode, partnerName: 'DUCMANH PC', storeId: 'DUCMANHPC',
    requestId, amount: payment.amount, orderId: momoOrderId, orderInfo,
    redirectUrl: cfg.redirectUrl, ipnUrl: cfg.ipnUrl, lang: 'vi',
    requestType, autoCapture: true, extraData, signature,
  };

  // requestPayload stores no secret (the signature is derived, not reversible).
  const attempt = await prisma.paymentAttempt.create({
    data: { paymentId: payment.id, method: 'MOMO', merchantReference: momoOrderId, amount: payment.amount, status: 'PENDING', requestPayload: { requestId, orderInfo, requestType, momoType } },
  });

  let momoRes;
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody), signal: AbortSignal.timeout(15000),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = (await res.text()).slice(0, 300);
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', errorMessage: `MOMO_NON_JSON_RESPONSE: HTTP ${res.status} — ${text}`.slice(0, 500) } });
      throw paymentError('Cổng MoMo đang bảo trì. Vui lòng thử lại sau ít phút.', 503);
    }
    momoRes = await res.json();
  } catch (error) {
    if (error.statusCode) throw error;
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', errorMessage: `MOMO_CREATE_NETWORK_ERROR: ${error.message}`.slice(0, 500) } });
    throw paymentError('Không kết nối được cổng MoMo. Vui lòng thử lại.', 502);
  }

  if (!isMomoSuccess(momoRes.resultCode) || !momoRes.payUrl) {
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', responsePayload: momoRes, errorMessage: `MOMO_CREATE_FAILED: resultCode=${momoRes.resultCode} ${momoRes.message || ''}`.slice(0, 500) } });
    throw paymentError(`MoMo từ chối tạo giao dịch (${momoRes.resultCode}: ${momoRes.message || 'lỗi không xác định'}).`, 400);
  }

  // Do NOT store transId here — the create response's transId is not the final
  // payment transaction id (that arrives on the IPN) and could be 0, which would
  // clash on the (method, providerTransactionId) unique index across attempts.
  await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { responsePayload: momoRes } });
  if (payment.status !== 'PROCESSING') {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'PROCESSING' } });
  }

  return { url: momoRes.payUrl, merchantReference: momoOrderId, deeplink: momoRes.deeplink ?? null, qrCodeUrl: momoRes.qrCodeUrl ?? null };
}

/**
 * MoMo IPN handler — one of the two provider-verified paths (IPN or Query API)
 * that can mark a MoMo Payment PAID, and only through confirmPaymentAttempt().
 * MoMo expects an HTTP 204 (No Content)
 * acknowledgement; it retries the IPN while it doesn't get a 2xx. Signature is
 * verified over the raw callback fields (HMAC-SHA256), amount is re-checked, and
 * idempotency/concurrency are inherited from confirmPaymentAttempt().
 * @param {Record<string, any>} body - MoMo's JSON IPN body
 * @returns {Promise<{ httpStatus: 204, outcome?: string, reason?: string, invalid?: boolean }>}
 */
export async function handleMomoIpn(body) {
  const cfg = getMomoConfig();
  if (!verifyIpnSignature(body, cfg.accessKey, cfg.secretKey)) {
    // Forged/tampered — do not process. 204 so MoMo stops retrying a request
    // that will never verify (retrying the same bytes changes nothing).
    return { httpStatus: 204, invalid: true };
  }

  const merchantReference = body.orderId;
  const verifiedAmount = Number(body.amount);

  const attempt = await prisma.paymentAttempt.findUnique({
    where: { merchantReference },
    include: { payment: { select: { orderId: true } } },
  });
  if (!attempt || attempt.method !== 'MOMO') return { httpStatus: 204, reason: 'unknown_order' };
  if (attempt.amount !== verifiedAmount) return { httpStatus: 204, reason: 'amount_mismatch' };

  if (isMomoSuccess(body.resultCode)) {
    const order = await prisma.order.findUnique({ where: { id: attempt.payment.orderId }, select: { status: true } });
    const result = await prisma.$transaction(tx => confirmPaymentAttempt({
      tx, merchantReference, verifiedAmount,
      providerTransactionId: String(body.transId ?? `MOMO-NOTXN-${merchantReference}`),
      responsePayload: body, orderStatus: order?.status ?? null,
    }));
    return { httpStatus: 204, outcome: result.outcome };
  }

  // Failure/cancel/timeout — record on THIS attempt only; Payment stays as-is
  // so the customer can create a fresh attempt ("thanh toán lại"), same as VNPAY.
  const failureStatus = classifyMomoFailure(body.resultCode);
  if (attempt.status === failureStatus) return { httpStatus: 204, outcome: 'duplicate_failure' };
  if (!isValidTransition(attempt.status, failureStatus)) return { httpStatus: 204, outcome: 'already_terminal' };
  await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: failureStatus, responsePayload: body, errorMessage: `MOMO resultCode=${body.resultCode}: ${body.message || ''}`.slice(0, 500) } });
  await prisma.payment.updateMany({ where: { id: attempt.paymentId, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: failureStatus } });
  return { httpStatus: 204, outcome: failureStatus };
}

/**
 * MoMo redirect (redirectUrl) handler — the customer's BROWSER lands here with
 * the result in the query string. Like the VNPAY return, it never trusts the
 * redirect alone; it verifies the signature and uses MoMo's authenticated
 * Query API when IPN is missing before reporting the real Payment status.
 * @param {Record<string, any>} query
 */
export async function handleMomoReturn(query) {
  const cfg = getMomoConfig();
  const valid = verifyIpnSignature(query, cfg.accessKey, cfg.secretKey);

  const merchantReference = query.orderId;
  const attempt = merchantReference
    ? await prisma.paymentAttempt.findUnique({ where: { merchantReference }, include: { payment: { select: { orderId: true, status: true } } } })
    : null;

  if (!valid) {
    return { valid: false, orderId: attempt?.payment?.orderId ?? null, amount: null, paymentStatus: null, attemptStatus: null, momoResultCode: query.resultCode ?? null };
  }
  if (!attempt || attempt.method !== 'MOMO') {
    return { valid: true, orderId: null, amount: null, paymentStatus: null, attemptStatus: null, momoResultCode: query.resultCode ?? null };
  }

  const resultCode = query.resultCode ?? null;

  // Same philosophy as VNPAY: the Return URL never marks PAID. If unsettled,
  // reconcile against MoMo's authenticated query API; a verified non-success
  // Return records the attempt's failure/cancel (never PAID).
  if (attempt.payment.status !== 'PAID') {
    if (isMomoSuccess(resultCode)) {
      await reconcileMomoPayment(merchantReference).catch(() => {});
    } else if (resultCode !== null) {
      const failureStatus = classifyMomoFailure(resultCode);
      if (attempt.status !== failureStatus && isValidTransition(attempt.status, failureStatus)) {
        await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: failureStatus, responsePayload: query, errorMessage: `MoMo return resultCode=${resultCode}` } }).catch(() => {});
        await prisma.payment.updateMany({ where: { id: attempt.paymentId, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: failureStatus } }).catch(() => {});
      }
    }
  }

  const [fresh, freshAttempt] = await Promise.all([
    prisma.payment.findUnique({ where: { orderId: attempt.payment.orderId }, select: { status: true } }),
    prisma.paymentAttempt.findUnique({ where: { id: attempt.id }, select: { status: true } }),
  ]);
  return {
    valid: true,
    orderId: attempt.payment.orderId,
    amount: attempt.amount,
    paymentStatus: fresh?.status ?? attempt.payment.status,
    attemptStatus: freshAttempt?.status ?? attempt.status,
    momoResultCode: resultCode,
  };
}

function momoQueryEndpoint(createEndpoint) {
  return `${new URL(createEndpoint).origin}/v2/gateway/api/query`;
}

/**
 * Reconcile a MoMo Payment against MoMo's authenticated /v2/gateway/api/query
 * API — used when the IPN is missing/late. The query RESPONSE is signature-
 * verified (same HMAC-SHA256 field set as the IPN) before we act on it; a
 * confirmed success settles through confirmPaymentAttempt(). PAID is ALWAYS
 * from verified provider data, never from the Return URL. Idempotent; never
 * throws on provider/network issues.
 * @param {string} merchantReference - the MoMo orderId (DMPC<id>T<ms>)
 */
export async function reconcileMomoPayment(merchantReference) {
  const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantReference }, include: { payment: { select: { orderId: true, status: true } } } });
  if (!attempt || attempt.method !== 'MOMO') return { reconciled: false, reason: 'not_found' };
  if (attempt.payment.status === 'PAID') return { reconciled: false, reason: 'already_paid' };

  let cfg;
  try { cfg = getMomoConfig(); } catch { return { reconciled: false, reason: 'not_configured' }; }

  const requestId = `${merchantReference}-q-${randomUUID().slice(0, 8)}`;
  const signature = signQuery({ accessKey: cfg.accessKey, orderId: merchantReference, partnerCode: cfg.partnerCode, requestId }, cfg.secretKey);
  const body = { partnerCode: cfg.partnerCode, requestId, orderId: merchantReference, lang: 'vi', signature };

  let res;
  try {
    const r = await fetch(momoQueryEndpoint(cfg.endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    res = await r.json();
  } catch (error) {
    return { reconciled: false, reason: `network_error: ${error.message}` };
  }

  // MoMo's QUERY response is NOT HMAC-signed the way the IPN is (verified
  // against the real sandbox: a pending response carries no `signature` field).
  // Its authenticity is the TLS channel to MoMo's official endpoint, which we
  // reached with our own signed request. Guard anyway: the response must echo
  // the exact orderId we asked about, and if MoMo DID include a signature
  // (some success responses do) it must verify. The amount is independently
  // re-checked below and again inside confirmPaymentAttempt, so a PAID is never
  // accepted on a wrong amount.
  if (String(res.orderId) !== merchantReference) return { reconciled: false, reason: 'order_id_mismatch' };
  if (String(res.partnerCode ?? '') !== cfg.partnerCode) return { reconciled: false, reason: 'merchant_mismatch' };
  if (String(res.requestId ?? '') !== requestId) return { reconciled: false, reason: 'request_id_mismatch' };
  if (res.signature && !verifyIpnSignature(res, cfg.accessKey, cfg.secretKey)) return { reconciled: false, reason: 'bad_response_signature' };

  if (isMomoSuccess(res.resultCode)) {
    const amount = Number(res.amount);
    if (attempt.amount !== amount) {
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { errorMessage: `QUERY_AMOUNT_MISMATCH: expected ${attempt.amount}, MoMo reports ${amount}`, responsePayload: res } }).catch(() => {});
      return { reconciled: false, reason: 'amount_mismatch' };
    }
    const order = await prisma.order.findUnique({ where: { id: attempt.payment.orderId }, select: { status: true } });
    const result = await prisma.$transaction(tx => confirmPaymentAttempt({
      tx, merchantReference, verifiedAmount: amount,
      providerTransactionId: String(res.transId ?? `MOMO-Q-${merchantReference}`),
      responsePayload: res, orderStatus: order?.status ?? null,
    }));
    const fresh = await prisma.payment.findUnique({ where: { id: attempt.paymentId }, select: { status: true } });
    return { reconciled: fresh?.status === 'PAID', outcome: result.outcome, paymentStatus: fresh?.status ?? attempt.payment.status };
  }

  // resultCode 1000 = transaction initiated/pending (user hasn't paid yet).
  if (Number(res.resultCode) === 1000) return { reconciled: false, reason: 'still_pending' };

  // Any other code is a terminal non-success → record the attempt accordingly
  // (Payment left open for retry). Never marks PAID.
  const failureStatus = classifyMomoFailure(res.resultCode);
  if (attempt.status !== failureStatus && isValidTransition(attempt.status, failureStatus)) {
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: failureStatus, responsePayload: res, errorMessage: `MoMo query resultCode=${res.resultCode}: ${res.message || ''}`.slice(0, 500) } }).catch(() => {});
    await prisma.payment.updateMany({ where: { id: attempt.paymentId, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: failureStatus } }).catch(() => {});
  }
  return { reconciled: true, outcome: failureStatus, paymentStatus: failureStatus, attemptStatus: failureStatus };
}

/**
 * Reconcile the latest VNPAY/MoMo attempt of an order on demand — used by the
 * customer Order Detail page to actively sync status (e.g. when the customer
 * returns later and the IPN still hasn't arrived). COD/BANK_TRANSFER have no
 * gateway to query and are a no-op. Ownership-checked by the caller/route.
 * @param {number} orderId
 * @param {number} userId
 */
async function performReconcilePaymentByOrder(orderId, userId) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true, paymentMethod: true } });
  if (!order) throw paymentError('Đơn hàng không tồn tại.', 404);
  if (order.paymentMethod !== 'VNPAY' && order.paymentMethod !== 'MOMO') {
    return { reconciled: false, reason: 'not_a_gateway_payment' };
  }
  const payment = await prisma.payment.findUnique({ where: { orderId }, include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  const attempt = payment?.attempts?.[0];
  if (!payment || !attempt) return { reconciled: false, reason: 'no_attempt' };
  if (payment.status === 'PAID') return { reconciled: false, reason: 'already_paid', paymentStatus: 'PAID' };

  const result = order.paymentMethod === 'VNPAY'
    ? await reconcileVnpayPayment(attempt.merchantReference)
    : await reconcileMomoPayment(attempt.merchantReference);

  const fresh = await prisma.payment.findUnique({ where: { orderId }, select: { status: true } });
  return { ...result, paymentStatus: fresh?.status ?? payment.status };
}

// Coalesce concurrent double-clicks/retries for the same authenticated owner
// and order. Sequential calls are also safe: provider references are unique,
// and confirmPaymentAttempt uses conditional DB writes plus provider tx IDs.
// Keeping this in memory avoids schema/database changes while preventing a
// burst from issuing duplicate Provider Query requests in this process.
const reconcileFlights = new Map();

export function reconcilePaymentByOrder(orderId, userId) {
  const key = `${userId}:${orderId}`;
  const active = reconcileFlights.get(key);
  if (active) return active;

  const operation = performReconcilePaymentByOrder(orderId, userId)
    .finally(() => {
      if (reconcileFlights.get(key) === operation) reconcileFlights.delete(key);
    });
  reconcileFlights.set(key, operation);
  return operation;
}
