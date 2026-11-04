// Admin support ticket routes — requires ADMIN role + per-action RBAC.

import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as controller from '../../controllers/adminSupport.controller.js';

const router = Router();
router.use(authenticateToken, requireAdmin);

router.get('/stats',             requirePermission('support', 'view'),   controller.getStats);
router.get('/',                  requirePermission('support', 'view'),   controller.listTickets);
router.get('/:id',               requirePermission('support', 'view'),   controller.getTicket);
router.post('/:id/messages',     requirePermission('support', 'reply'),  controller.addAdminReply);
router.patch('/:id/status',      requirePermission('support', 'update'), controller.updateStatus);
router.patch('/:id/assign',      requirePermission('support', 'assign'), controller.assignTicket);
router.post('/:id/notify',       requirePermission('support', 'reply'),  controller.retryNotify);

export default router;
