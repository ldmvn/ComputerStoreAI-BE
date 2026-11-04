import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as controller from '../../controllers/adminOrder.controller.js';

const router = Router();
router.use(authenticateToken, requireAdmin);

router.get('/stats', requirePermission('orders', 'view'), controller.stats);
router.get('/', requirePermission('orders', 'view'), controller.list);
router.get('/:id', requirePermission('orders', 'view'), controller.detail);
router.patch('/:id/status', requirePermission('orders', 'update'), controller.updateStatus);
router.patch('/:id/shipping', requirePermission('orders', 'manage'), controller.updateShipping);

export default router;
