import * as paymentService from '../services/payment.service.js';
import { handleSepayWebhook } from '../services/sepayWebhook.service.js';
import {
  notifyPaymentAwaitingVerification,
  notifyPaymentAutoConfirmed,
  notifyPaymentReconciliationNeeded,
} from '../../services/telegramNotification.service.js';
import { prisma } from '../../config/prisma.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// GET /api/payments/orders/:orderId/vietqr — reopen the same QR from Order
// Detail. Never creates a new Order or a new PaymentAttempt.
export const getVietQr = asyncHandler(async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (!orderId) return res.status(400).json({ success: false, message: 'ID đơn hàng không hợp lệ.' });
  const { payment, attempt } = await paymentService.getVietQrForOrder(orderId, req.user.userId);
  res.json({ success: true, data: { payment, attempt } });
});

// POST /api/payments/orders/:orderId/report-transfer — "Tôi đã chuyển khoản".
export const reportTransfer = asyncHandler(async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (!orderId) return res.status(400).json({ success: false, message: 'ID đơn hàng không hợp lệ.' });

  const { payment, attempt, alreadyReported } = await paymentService.reportBankTransfer(orderId, req.user.userId);

  if (!alreadyReported) {
    // Fire-and-forget, after the DB transaction already committed — a
    // Telegram failure must never roll back or appear to fail the order's
    // payment-status update the customer just triggered.
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, shippingName: true } });
    if (order) notifyPaymentAwaitingVerification(order, payment, attempt).catch(e => console.error('[Telegram]', e.message));
  }

  res.json({ success: true, data: { payment, attempt }, message: 'Đã ghi nhận báo chuyển khoản. Chúng tôi sẽ xác nhận sau khi đối chiếu sao kê.' });
});

// POST /api/payments/orders/:orderId/vnpay — customer-initiated, creates a
// fresh PaymentAttempt + signed redirect URL. Also doubles as "Thanh toán
// lại" (retry) — safe to call again while the order is still unpaid.
export const createVnpayPayment = asyncHandler(async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (!orderId) return res.status(400).json({ success: false, message: 'ID đơn hàng không hợp lệ.' });
  const ipAddr = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const { url, merchantReference } = await paymentService.createVnpayPaymentUrl(orderId, req.user.userId, ipAddr);
  res.json({ success: true, data: { url, merchantReference } });
});

// GET /api/payments/vnpay/ipn — PUBLIC, called server-to-server by VNPAY
// directly (no auth, no cookies, no CORS concept). Must ALWAYS respond with
// VNPAY's own documented {RspCode, Message} shape — never the app's usual
// {success,...} shape or a thrown-error page — or VNPAY will treat it as a
// delivery failure and keep retrying indefinitely. Never logs the raw query
// (it contains no secret, but logging full payment payloads is unnecessary
// noise) beyond the outcome.
export const vnpayIpn = asyncHandler(async (req, res) => {
  try {
    const result = await paymentService.handleVnpayIpn(req.query);
    console.info('[Payment callback]', JSON.stringify({
      provider: 'VNPAY', event: 'IPN', merchantReference: req.query?.vnp_TxnRef ?? null,
      responseCode: req.query?.vnp_ResponseCode ?? null, acknowledgement: result.rspCode,
    }));
    res.json({ RspCode: result.rspCode, Message: result.message });
  } catch (error) {
    console.error('[VNPAY IPN] unexpected error:', error.message);
    res.json({ RspCode: '99', Message: 'Unknown error' });
  }
});

// POST /api/payments/sepay/webhook — PUBLIC, called server-to-server by SePay
// when a bank transaction hits our MB Bank account. Verifies SePay's
// HMAC-SHA256 signature over the RAW body (req.rawBody, captured in server.js),
// never our auth. Must respond 2xx once accepted so SePay stops redelivering;
// only a rejected signature (401/503) or an unexpected server error (500 →
// SePay retries) is non-2xx. Telegram is fired fire-and-forget AFTER the DB
// work, exactly like reportTransfer — a Telegram outage never affects the ack.
export const sepayWebhook = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await handleSepayWebhook({
      rawBody: req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8'),
      signatureHeader: req.get('X-SePay-Signature'),
      timestampHeader: req.get('X-SePay-Timestamp'),
      body: req.body,
    });
  } catch (error) {
    // A genuine server fault (e.g. DB down) — 500 so SePay retries later,
    // rather than a 200 that would make it drop a real, unprocessed payment.
    console.error('[SePay webhook] unexpected error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal error' });
  }

  if (result.telegram) {
    const { type, payload } = result.telegram;
    const fn = type === 'confirmed' ? notifyPaymentAutoConfirmed : notifyPaymentReconciliationNeeded;
    fn(payload).catch(e => console.error('[Telegram]', e.message));
  }

  return res.status(result.httpStatus).json(result.ack);
});

// GET /api/payments/vnpay/return-check — called by the Frontend's Return
// page (not by VNPAY directly) to verify the signature server-side, where
// the Hash Secret actually lives, and report the REAL current Payment
// status. Public (no auth) — the customer's browser lands on the Return
// page fresh after VNPAY, not necessarily carrying our session in a form
// this endpoint depends on; the signature itself is what's verified.
export const vnpayReturnCheck = asyncHandler(async (req, res) => {
  const result = await paymentService.handleVnpayReturn(req.query);
  res.json({ success: true, data: result });
});

// POST /api/payments/orders/:orderId/momo — customer-initiated, creates a
// fresh PaymentAttempt and server-to-server calls MoMo's create API. Doubles
// as "Thanh toán lại" (retry) while the order is still unpaid.
export const createMomoPayment = asyncHandler(async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (!orderId) return res.status(400).json({ success: false, message: 'ID đơn hàng không hợp lệ.' });
  // momoType: 'atm' (payWithATM — Napas ATM card page, default) | 'wallet' (captureWallet/QR)
  const momoType = req.body?.momoType === 'wallet' ? 'wallet' : 'atm';
  const result = await paymentService.createMomoPaymentUrl(orderId, req.user.userId, momoType);
  res.json({ success: true, data: result });
});

// POST /api/payments/momo/ipn — PUBLIC, called server-to-server by MoMo. Must
// respond 204 No Content on acknowledgement (MoMo retries while it doesn't get
// a 2xx). Verifies MoMo's HMAC-SHA256 signature itself; never relies on our
// auth. Always responds 204 (even on invalid signature / unknown order) so MoMo
// does not retry a request that cannot succeed; genuine server faults throw and
// surface as 500 so MoMo retries later.
export const momoIpn = asyncHandler(async (req, res) => {
  try {
    const result = await paymentService.handleMomoIpn(req.body);
    console.info('[Payment callback]', JSON.stringify({
      provider: 'MOMO', event: 'IPN', merchantReference: req.body?.orderId ?? null,
      resultCode: req.body?.resultCode ?? null, outcome: result.outcome ?? result.reason ?? (result.invalid ? 'invalid_signature' : 'acknowledged'),
    }));
    return res.status(result.httpStatus).end();
  } catch (error) {
    console.error('[MoMo IPN] unexpected error:', error.message);
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
});

// GET /api/payments/momo/return-check — called by the Frontend's MoMo Return
// page (not by MoMo directly) to verify the signature server-side and report
// the REAL current Payment status. Public, mirrors vnpayReturnCheck.
export const momoReturnCheck = asyncHandler(async (req, res) => {
  const result = await paymentService.handleMomoReturn(req.query);
  res.json({ success: true, data: result });
});

// POST /api/payments/orders/:orderId/reconcile — authenticated. Actively asks
// the provider (VNPAY querydr / MoMo query) for the real transaction result and
// settles the Payment accordingly, for the customer's own order. Used by the
// Order Detail page so a payment syncs even if the IPN never arrived — PAID is
// still only ever set from a verified provider IPN/query response.
export const reconcilePayment = asyncHandler(async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (!orderId) return res.status(400).json({ success: false, message: 'ID đơn hàng không hợp lệ.' });
  const result = await paymentService.reconcilePaymentByOrder(orderId, req.user.userId);
  res.json({ success: true, data: result });
});
