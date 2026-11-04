import * as paymentService from '../services/payment.service.js';
import { logActivity } from '../../services/activityLog.service.js';
import { getAdminOrder } from '../../services/adminOrder.service.js';
import { notifyStatusChanged } from '../../services/telegramNotification.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// POST /api/admin/payments/orders/:orderId/confirm — Admin confirms having
// received the transfer after reconciling the real MB Bank statement.
// Deliberately a SEPARATE endpoint from PATCH /admin/orders/:id/status —
// this never touches OrderStatus, and order status approval never touches
// PaymentStatus. Goes through confirmPaymentAttempt() (the same
// concurrency-safe, idempotent, state-machine-checked function used
// everywhere else payment confirmation can happen) — RBAC-gated here, not
// duplicated there.
export const confirmPayment = asyncHandler(async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (!orderId) return res.status(400).json({ success: false, message: 'ID đơn hàng không hợp lệ.' });

  const result = await paymentService.adminConfirmPayment(orderId, req.user.userId);

  const outcomeMessage = {
    paid: 'Đã xác nhận nhận thanh toán.',
    late_confirmation_after_terminal: 'Đã xác nhận nhận thanh toán (giao dịch đến muộn).',
    duplicate_same_attempt: 'Đơn hàng này đã được xác nhận thanh toán trước đó.',
    duplicate_different_attempt: 'Đơn hàng đã được xác nhận bởi một giao dịch khác — ghi nhận để đối soát, không ghi đè.',
    late_confirmation_needs_review: 'Đơn hàng đã bị hủy — cần đối soát thủ công trước khi xác nhận.',
    payment_state_conflict: 'Trạng thái thanh toán hiện tại không cho phép xác nhận (ví dụ đã hoàn tiền).',
    amount_mismatch: 'Số tiền không khớp — vui lòng kiểm tra lại.',
  }[result.outcome] ?? `Kết quả: ${result.outcome}`;

  const success = result.outcome === 'paid' || result.outcome === 'late_confirmation_after_terminal' || result.outcome === 'duplicate_same_attempt';

  await logActivity({
    req, action: 'confirm_payment', module: 'orders',
    targetId: orderId, targetLabel: `Order:${orderId}`,
    description: `Xác nhận thanh toán thủ công cho đơn #${orderId} — kết quả: ${result.outcome}`,
    success,
  }).catch(() => {});

  res.status(success ? 200 : 409).json({ success, data: result, message: outcomeMessage });
});

// POST /api/admin/payments/orders/:orderId/confirm-and-approve — the merged
// "Xác nhận tiền & duyệt đơn" action, VietQR-only, only valid while the
// Order is still PENDING. Both writes happen inside ONE transaction in
// adminConfirmPaymentAndApprove() — this controller only adds RBAC/audit
// (already enforced by the route) and the post-commit Telegram notification,
// which must never fire before the transaction committed; `logActivity` and
// `notifyStatusChanged` below only run after `await` on the service call
// returns, i.e. strictly after commit.
export const confirmPaymentAndApprove = asyncHandler(async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (!orderId) return res.status(400).json({ success: false, message: 'ID đơn hàng không hợp lệ.' });

  const before = await getAdminOrder(orderId);
  const result = await paymentService.adminConfirmPaymentAndApprove(orderId, req.user.userId);

  const paymentSettled = result.outcome === 'paid' || result.outcome === 'late_confirmation_after_terminal' || result.outcome === 'duplicate_same_attempt';

  let message;
  if (paymentSettled && result.orderApproved) {
    message = 'Đã xác nhận thanh toán và duyệt đơn hàng.';
  } else if (paymentSettled && !result.orderApproved) {
    message = 'Đã xác nhận thanh toán — đơn hàng đã được xử lý trước đó nên không duyệt lại.';
  } else {
    message = {
      duplicate_different_attempt: 'Đơn hàng đã được xác nhận bởi một giao dịch khác — ghi nhận để đối soát, không ghi đè.',
      late_confirmation_needs_review: 'Đơn hàng đã bị hủy — cần đối soát thủ công trước khi xác nhận.',
      payment_state_conflict: 'Trạng thái thanh toán hiện tại không cho phép xác nhận (ví dụ đã hoàn tiền).',
      amount_mismatch: 'Số tiền không khớp — vui lòng kiểm tra lại.',
    }[result.outcome] ?? `Kết quả: ${result.outcome}`;
  }

  await logActivity({
    req, action: 'confirm_payment_and_approve', module: 'orders',
    targetId: orderId, targetLabel: `Order:${orderId}`,
    description: `Xác nhận tiền & duyệt đơn (gộp) cho đơn #${orderId} — kết quả: ${result.outcome}, đã duyệt: ${result.orderApproved}`,
    success: paymentSettled,
  }).catch(() => {});

  if (result.orderApproved && before) {
    const after = await getAdminOrder(orderId);
    if (after) notifyStatusChanged(after, before.status).catch(e => console.error('[Telegram]', e.message));
  }

  res.status(paymentSettled ? 200 : 409).json({ success: paymentSettled, data: result, message });
});

// POST /api/admin/payments/orders/:orderId/confirm-cod — Admin confirms the
// courier actually handed over the COD cash. Separate action/wording from
// confirmPayment() above (which is VietQR-only, worded "đã nhận tiền" for a
// bank transfer) — COD has no PaymentAttempt/merchantReference, so it goes
// through adminConfirmCodPayment() instead of confirmPaymentAttempt().
export const confirmCodPayment = asyncHandler(async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (!orderId) return res.status(400).json({ success: false, message: 'ID đơn hàng không hợp lệ.' });

  const result = await paymentService.adminConfirmCodPayment(orderId, req.user.userId);

  const outcomeMessage = {
    paid: 'Đã xác nhận thu tiền COD.',
    duplicate_same_attempt: 'Đơn hàng này đã được xác nhận thu tiền COD trước đó.',
    payment_state_conflict: 'Trạng thái thanh toán hiện tại không cho phép xác nhận (ví dụ đơn đã hủy hoặc đã hoàn tiền).',
  }[result.outcome] ?? `Kết quả: ${result.outcome}`;

  const success = result.outcome === 'paid' || result.outcome === 'duplicate_same_attempt';

  await logActivity({
    req, action: 'confirm_cod_payment', module: 'orders',
    targetId: orderId, targetLabel: `Order:${orderId}`,
    description: `Xác nhận thu tiền COD cho đơn #${orderId} — kết quả: ${result.outcome}`,
    success,
  }).catch(() => {});

  res.status(success ? 200 : 409).json({ success, data: result, message: outcomeMessage });
});
