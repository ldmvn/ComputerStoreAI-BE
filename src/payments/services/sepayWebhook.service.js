// SePay webhook orchestration: verify the HMAC-SHA256 signature on the RAW
// body, validate the transfer is real incoming money into our MB Bank account,
// match it to its Order by the VietQR transfer code (DH<orderId>), then settle
// it through the one shared confirm-&-approve path (payment.service.js's
// confirmVietQrByWebhook → confirmPaymentAttempt). Anything that cannot be
// auto-applied cleanly is never silently dropped — it returns a reconciliation
// signal the controller forwards to Telegram so Admin handles the real money.
//
// This file makes NO HTTP response and fires NO Telegram message itself: it
// returns { httpStatus, ack, telegram? } so the controller stays the only place
// that touches the wire and the (fire-and-forget) Telegram call. That keeps
// this unit-testable and keeps a Telegram outage from ever affecting the ack.

import { prisma } from '../../config/prisma.js';
import { getBankConfig, confirmVietQrByWebhook } from './payment.service.js';
import { verifySepaySignature, parseSepayPayload, extractOrderId } from './sepayUtil.service.js';

function reconcile({ orderId, amount, sepayTransactionId, reason, transactionDate }, ack) {
  return {
    httpStatus: 200, // 200: we accepted & recorded the event; retrying won't help — a human must act
    ack: ack ?? { success: false, message: reason },
    telegram: { type: 'reconcile', payload: { orderId: orderId ?? null, amount, sepayTransactionId, reason, transactionDate } },
  };
}

/**
 * @param {{ rawBody: Buffer, signatureHeader?: string, timestampHeader?: string, body: any }} p
 * @returns {Promise<{ httpStatus:number, ack:{success:boolean,message:string}, telegram?:{type:'confirmed'|'reconcile', payload:object} }>}
 */
export async function handleSepayWebhook({ rawBody, signatureHeader, timestampHeader, body }) {
  // 1) Authenticity + anti-replay. A failure here is the ONLY non-2xx response
  //    — it tells SePay the request was rejected (bad/forged/stale signature).
  const sig = verifySepaySignature({
    rawBody, signatureHeader, timestampHeader,
    secret: process.env.SEPAY_WEBHOOK_SECRET,
  });
  if (!sig.ok) {
    return { httpStatus: sig.reason === 'missing_secret' ? 503 : 401, ack: { success: false, message: `Signature rejected: ${sig.reason}` } };
  }

  // 2) Parse. A signed-but-unusable body is acked 200 (no point in SePay
  //    retrying the same malformed payload) but recorded as an anomaly.
  const tx = parseSepayPayload(body);
  if (!tx) return { httpStatus: 200, ack: { success: false, message: 'Ignored: unparseable payload' } };

  // 3) Only incoming money into OUR account is a payment. Outgoing transfers
  //    and credits to a different account are acked and ignored (not anomalies).
  if (tx.transferType !== 'in') return { httpStatus: 200, ack: { success: true, message: 'Ignored: not an incoming transfer' } };
  const bank = await getBankConfig();
  if (tx.accountNumber && bank.accountNumber && tx.accountNumber !== bank.accountNumber) {
    return { httpStatus: 200, ack: { success: true, message: 'Ignored: different receiving account' } };
  }

  // 4) Which order? The VietQR content is "DUCMANHPC DH<orderId>".
  const orderId = extractOrderId({ content: tx.content, code: tx.code });
  if (!orderId) {
    return reconcile(
      { orderId: null, amount: tx.amount, sepayTransactionId: tx.id, reason: 'Không tìm thấy mã đơn (DH…) trong nội dung chuyển khoản', transactionDate: tx.transactionDate },
      { success: false, message: 'No order code in transfer content' },
    );
  }

  // 5) Exact-redelivery fast path: this SePay transaction id was already
  //    recorded on an attempt → idempotent no-op (SePay redelivers on any
  //    non-2xx or timeout). The in-transaction path below is still the real
  //    guarantee; this just avoids re-running it for the common redelivery.
  const already = await prisma.paymentAttempt.findFirst({
    where: { method: 'BANK_TRANSFER', providerTransactionId: tx.id },
    select: { id: true },
  });
  if (already) return { httpStatus: 200, ack: { success: true, message: 'Duplicate: already processed' } };

  // 6) Settle through the one shared gatekeeper (idempotency/amount/race safe).
  const result = await confirmVietQrByWebhook({
    orderId, sepayTransactionId: tx.id, verifiedAmount: tx.amount, responsePayload: body,
  });

  if (!result.matched) {
    const reasonMap = {
      order_not_found: 'Không tìm thấy đơn hàng khớp mã CK',
      not_bank_transfer: 'Đơn hàng không dùng phương thức chuyển khoản',
      no_payment_attempt: 'Đơn hàng chưa có giao dịch VietQR để đối chiếu',
    };
    return reconcile(
      { orderId, amount: tx.amount, sepayTransactionId: tx.id, reason: reasonMap[result.reason] || result.reason, transactionDate: tx.transactionDate },
      { success: false, message: result.reason },
    );
  }

  switch (result.outcome) {
    case 'paid':
    case 'late_confirmation_after_terminal':
      return {
        httpStatus: 200,
        ack: { success: true, message: `Confirmed (${result.outcome})` },
        telegram: { type: 'confirmed', payload: { orderId, amount: tx.amount, orderApproved: result.orderApproved === true, sepayTransactionId: tx.id, transactionDate: tx.transactionDate } },
      };

    case 'duplicate_same_attempt':
      // Same SePay id already on the attempt → benign redelivery that lost the
      // fast-path race above. A DIFFERENT id means the order was already settled
      // by another transaction (a second real transfer, or a prior Admin manual
      // confirm of this same money) — ambiguous real money → let Admin reconcile.
      if (result.settledProviderTransactionId === tx.id) {
        return { httpStatus: 200, ack: { success: true, message: 'Duplicate: idempotent redelivery' } };
      }
      return reconcile(
        { orderId, amount: tx.amount, sepayTransactionId: tx.id, reason: 'Đơn đã thanh toán trước đó bằng giao dịch khác — kiểm tra trùng/dư tiền (có thể cần hoàn)', transactionDate: tx.transactionDate },
        { success: true, message: 'Already paid by a different transaction — flagged for review' },
      );

    case 'amount_mismatch':
      return reconcile(
        { orderId, amount: tx.amount, sepayTransactionId: tx.id, reason: `Sai số tiền: đơn cần ${result.paymentAmount}₫, nhận ${tx.amount}₫ (thiếu/thừa tiền)`, transactionDate: tx.transactionDate },
        { success: false, message: 'Amount mismatch' },
      );

    case 'late_confirmation_needs_review':
      return reconcile(
        { orderId, amount: tx.amount, sepayTransactionId: tx.id, reason: 'Đơn đã hủy nhưng nhận được tiền — cần hoàn tiền', transactionDate: tx.transactionDate },
        { success: false, message: 'Order cancelled but money received' },
      );

    case 'payment_state_conflict':
      return reconcile(
        { orderId, amount: tx.amount, sepayTransactionId: tx.id, reason: `Trạng thái thanh toán không cho phép ghi PAID (${result.paymentStatus})`, transactionDate: tx.transactionDate },
        { success: false, message: `Payment state conflict (${result.paymentStatus})` },
      );

    case 'duplicate_different_attempt':
      return reconcile(
        { orderId, amount: tx.amount, sepayTransactionId: tx.id, reason: 'Đơn đã được một giao dịch khác thanh toán — cần đối soát/hoàn tiền', transactionDate: tx.transactionDate },
        { success: true, message: 'Settled by a different attempt — flagged for review' },
      );

    case 'unknown_reference':
      return reconcile(
        { orderId, amount: tx.amount, sepayTransactionId: tx.id, reason: 'Không khớp mã tham chiếu giao dịch', transactionDate: tx.transactionDate },
        { success: false, message: 'Unknown reference' },
      );

    default:
      return { httpStatus: 200, ack: { success: false, message: `Unhandled outcome: ${result.outcome}` } };
  }
}
