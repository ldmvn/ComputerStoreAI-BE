import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { paymentReconcileRateLimit } from '../../middlewares/rateLimit.middleware.js';
import {
  getVietQr, reportTransfer, createVnpayPayment, vnpayIpn, vnpayReturnCheck, sepayWebhook,
  createMomoPayment, momoIpn, momoReturnCheck, reconcilePayment,
} from '../controllers/payment.controller.js';

export const paymentRouter = Router();

// PUBLIC — mounted BEFORE authenticateToken. VNPAY's own server calls the
// IPN endpoint directly (no session, no cookies); the Return-check endpoint
// is called by the Frontend's Return page right after the customer's
// browser lands there, also without relying on our auth cookie. Both verify
// the VNPAY signature themselves instead of relying on our auth.
paymentRouter.get('/vnpay/ipn', vnpayIpn);
paymentRouter.get('/vnpay/return-check', vnpayReturnCheck);

// PUBLIC — SePay calls this server-to-server when a transfer hits MB Bank.
// Authenticity is the HMAC-SHA256 signature over the raw body, not our auth.
paymentRouter.post('/sepay/webhook', sepayWebhook);

// PUBLIC — MoMo calls the IPN server-to-server; the return-check is called by
// the Frontend's MoMo Return page. Both verify MoMo's signature themselves.
paymentRouter.post('/momo/ipn', momoIpn);
paymentRouter.get('/momo/return-check', momoReturnCheck);

paymentRouter.use(authenticateToken);

paymentRouter.get('/orders/:orderId/vietqr', getVietQr);
paymentRouter.post('/orders/:orderId/report-transfer', reportTransfer);
paymentRouter.post('/orders/:orderId/vnpay', createVnpayPayment);
paymentRouter.post('/orders/:orderId/momo', createMomoPayment);
paymentRouter.post('/orders/:orderId/reconcile', paymentReconcileRateLimit, reconcilePayment);
