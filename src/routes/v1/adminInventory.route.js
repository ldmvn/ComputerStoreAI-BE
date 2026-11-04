import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as controller from '../../controllers/adminInventory.controller.js';

const router = Router();
router.use(authenticateToken, requireAdmin);

router.get('/stats', requirePermission('inventory', 'view'), controller.stats);
router.get('/logs', requirePermission('inventory', 'view'), controller.logs);
router.get('/', requirePermission('inventory', 'view'), controller.list);
router.post('/:id/import', requirePermission('inventory', 'manage'), controller.importStock);
router.post('/:id/adjust', requirePermission('inventory', 'manage'), controller.adjustStock);

export default router;
