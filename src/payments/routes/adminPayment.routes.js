import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import { confirmPayment, confirmCodPayment, confirmPaymentAndApprove } from '../controllers/adminPayment.controller.js';

export const adminPaymentRouter = Router();
adminPaymentRouter.use(authenticateToken, requireAdmin);

// Reuses the existing orders:manage permission (same scope as shipping/
// refund handling) — kept as a separate endpoint/action from order status
// updates, not a separate RBAC module, to avoid requiring a Permission-table
// seed for this task (see docs/payment-architecture.md).
adminPaymentRouter.post('/orders/:orderId/confirm', requirePermission('orders', 'manage'), confirmPayment);
adminPaymentRouter.post('/orders/:orderId/confirm-cod', requirePermission('orders', 'manage'), confirmCodPayment);
adminPaymentRouter.post('/orders/:orderId/confirm-and-approve', requirePermission('orders', 'manage'), confirmPaymentAndApprove);
