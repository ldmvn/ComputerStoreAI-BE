import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as controller from '../../controllers/adminCustomer.controller.js';

const router = Router();
router.use(authenticateToken, requireAdmin);

router.get('/stats',           requirePermission('customers', 'view'),       controller.stats);
router.get('/',                requirePermission('customers', 'view'),       controller.list);
router.post('/',               requirePermission('customers', 'manage'),     controller.create);
router.get('/:id',             requirePermission('customers', 'view'),       controller.detail);
router.put('/:id',             requirePermission('customers', 'manage'),     controller.update);
router.patch('/:id/role',      requirePermission('administrators', 'manage'), controller.updateRole);
router.delete('/:id',          requirePermission('customers', 'manage'),     controller.remove);
router.get('/:id/activity',    requirePermission('customers', 'view'),       controller.activityLogs);

export default router;
