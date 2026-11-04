const TIMEOUT_MS = 5_000;
// Bounded retry for transient failures only (timeout, network error, 5xx) —
// never for a permanent rejection (4xx: bad token/chat_id/payload, where
// retrying would just repeat the same failure). Capped at 2 extra attempts
// with a short fixed backoff — this is "an toàn, không gửi lại vô hạn":
// never retries indefinitely, and never retries a request that already
// succeeded (retry only wraps the single fetch call; dedupe at the caller
// — see reportTransfer()'s `alreadyReported` check — is what prevents the
// same real-world event from ever re-entering sendMessage() at all).
const MAX_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_000;

function isConfigured() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendOnce(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        signal: ctrl.signal,
      },
    );
    if (res.ok) return { ok: true };
    const body = await res.text();
    // 4xx = permanent (bad token/chat/payload) — do not retry. 5xx = transient.
    return { ok: false, retryable: res.status >= 500, detail: `API error ${res.status}: ${body.slice(0, 120)}` };
  } catch (e) {
    return { ok: false, retryable: true, detail: e.name === 'AbortError' ? 'Request timed out' : `Send failed: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function sendMessage(text) {
  if (!isConfigured()) return;

  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const result = await sendOnce(text);
    if (result.ok) return;
    if (!result.retryable || attempt === MAX_RETRY_ATTEMPTS) {
      console.error('[Telegram] %s%s', result.detail, attempt > 0 ? ` (after ${attempt + 1} attempts)` : '');
      return;
    }
    await sleep(RETRY_DELAY_MS);
  }
}

const STATUS_LABEL = {
  PENDING:   'Chờ xử lý',
  CONFIRMED: 'Đã xác nhận',
  SHIPPING:  'Đang giao',
  DELIVERED: 'Đã giao',
  CANCELLED: 'Đã hủy',
};

function fmtMoney(amount) {
  return new Intl.NumberFormat('vi-VN').format(Number(amount) || 0) + '₫';
}

function fmtTime(dt) {
  return new Date(dt || Date.now()).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

// In-memory dedup: one notification per (event key) within 10 s
const _sent = new Set();
function dedupe(key, ttlMs = 10_000) {
  if (_sent.has(key)) return false;
  _sent.add(key);
  setTimeout(() => _sent.delete(key), ttlMs);
  return true;
}

// ── Public helpers ────────────────────────────────────────────────────────────

export async function notifyNewOrder(order) {
  if (!dedupe(`new:${order.id}`)) return;

  const total = (Number(order.subtotal) || 0) - (Number(order.discountAmount) || 0);
  const payLabel = order.paymentMethod === 'COD' ? 'Tiền mặt (COD)' : 'Chuyển khoản';

  await sendMessage([
    '🛒 <b>ĐƠN HÀNG MỚI</b>',
    `Mã đơn: <b>#${order.id}</b>`,
    `Khách hàng: ${order.shippingName || '—'}`,
    `SĐT: ${order.shippingPhone || '—'}`,
    `Tổng tiền: <b>${fmtMoney(total)}</b>`,
    `Thanh toán: ${payLabel}`,
    `Số sản phẩm: ${order.items?.length ?? 0}`,
    `Thời gian: ${fmtTime(order.createdAt)}`,
  ].join('\n'));
}

export async function notifyOrderCancelled(order, cancelledBy = 'Khách hàng') {
  if (!dedupe(`cancel:${order.id}`)) return;

  const total = (Number(order.subtotal) || 0) - (Number(order.discountAmount) || 0);

  await sendMessage([
    '❌ <b>ĐƠN HÀNG BỊ HỦY</b>',
    `Mã đơn: <b>#${order.id}</b>`,
    `Hủy bởi: ${cancelledBy}`,
    `Khách hàng: ${order.shippingName || '—'}`,
    `Tổng tiền: ${fmtMoney(total)}`,
    `Thời gian: ${fmtTime(order.cancelledAt || new Date())}`,
  ].join('\n'));
}

export async function notifyStatusChanged(order, previousStatus) {
  if (!dedupe(`status:${order.id}:${previousStatus}->${order.status}`)) return;

  const total = (Number(order.subtotal) || 0) - (Number(order.discountAmount) || 0);

  await sendMessage([
    '📦 <b>CẬP NHẬT ĐƠN HÀNG</b>',
    `Mã đơn: <b>#${order.id}</b>`,
    `Trạng thái cũ: ${STATUS_LABEL[previousStatus] || previousStatus}`,
    `Trạng thái mới: <b>${STATUS_LABEL[order.status] || order.status}</b>`,
    `Tổng tiền: ${fmtMoney(total)}`,
  ].join('\n'));
}

// SePay webhook auto-confirmed a REAL, signature-verified bank transfer and
// the Payment is now PAID (and the order auto-approved when it was still
// PENDING). Unlike notifyPaymentAwaitingVerification above, this IS verified
// money received — the message says so, and whether the order was auto-approved.
export async function notifyPaymentAutoConfirmed({ orderId, amount, orderApproved, sepayTransactionId, transactionDate }) {
  if (!dedupe(`auto-confirmed:${orderId}:${sepayTransactionId}`)) return;

  await sendMessage([
    '✅ <b>TỰ ĐỘNG XÁC NHẬN THANH TOÁN — SePay (VietQR)</b>',
    `Mã đơn: <b>#${orderId}</b>`,
    `Số tiền đã nhận: <b>${fmtMoney(amount)}</b>`,
    `Mã GD SePay: <code>${sepayTransactionId}</code>`,
    orderApproved ? '📦 Đơn hàng đã được <b>tự động duyệt</b> (PENDING → Đã xác nhận).' : 'ℹ️ Thanh toán đã ghi nhận PAID; đơn không tự duyệt (không ở trạng thái chờ duyệt).',
    `Thời gian GD: ${fmtTime(transactionDate)}`,
  ].join('\n'));
}

// A SePay-verified transfer that could NOT be auto-applied cleanly and needs a
// human: wrong/too-little/too-much amount, order already cancelled, a second
// transfer onto an already-paid order (double-pay → refund), unknown order
// code, or order not found. Never silently swallowed — always surfaced here so
// Admin can reconcile the real money against the MB Bank statement.
export async function notifyPaymentReconciliationNeeded({ orderId, amount, sepayTransactionId, reason, transactionDate }) {
  if (!dedupe(`reconcile:${sepayTransactionId}:${reason}`)) return;

  await sendMessage([
    '⚠️ <b>GIAO DỊCH SePay CẦN ĐỐI SOÁT THỦ CÔNG</b>',
    orderId ? `Mã đơn: <b>#${orderId}</b>` : 'Mã đơn: <b>không xác định</b>',
    `Số tiền giao dịch: <b>${fmtMoney(amount)}</b>`,
    `Mã GD SePay: <code>${sepayTransactionId}</code>`,
    `Lý do: <b>${reason}</b>`,
    `Thời gian GD: ${fmtTime(transactionDate)}`,
    '⚠️ Tiền có thể đã vào tài khoản — vui lòng đối chiếu sao kê MB Bank và xử lý thủ công (xác nhận/hoàn tiền).',
  ].join('\n'));
}

// Customer clicked "Tôi đã chuyển khoản" — this is a SELF-REPORT, not a
// verified payment (see paymentStatus.validator.js: AWAITING_VERIFICATION is
// a distinct status from PAID). The message says so explicitly so whoever
// reads it on Telegram never mistakes it for confirmed money received.
export async function notifyPaymentAwaitingVerification(order, payment, attempt) {
  if (!dedupe(`awaiting-verification:${payment.id}`)) return;

  await sendMessage([
    '🔔 <b>KHÁCH BÁO ĐÃ CHUYỂN KHOẢN — CẦN ĐỐI SOÁT</b>',
    `Mã đơn: <b>#${order.id}</b>`,
    `Khách hàng: ${order.shippingName || '—'}`,
    `Số tiền cần đối chiếu: <b>${fmtMoney(payment.amount)}</b>`,
    `Nội dung CK: <code>${attempt.transferContent || '—'}</code>`,
    `Thời gian báo: ${fmtTime(attempt.reportedAt)}`,
    '⚠️ Chưa xác minh — vui lòng đối chiếu sao kê MB Bank trước khi xác nhận trong Dashboard.',
  ].join('\n'));
}
