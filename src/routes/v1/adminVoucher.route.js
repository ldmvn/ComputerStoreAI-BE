import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as controller from '../../controllers/adminVoucher.controller.js';

const router = Router();
router.use(authenticateToken, requireAdmin);

router.get('/stats', requirePermission('promotions', 'view'), controller.stats);
router.get('/', requirePermission('promotions', 'view'), controller.list);
router.get('/:id', requirePermission('promotions', 'view'), controller.detail);
router.post('/', requirePermission('promotions', 'create'), controller.create);
router.put('/:id', requirePermission('promotions', 'update'), controller.update);
router.patch('/:id/toggle', requirePermission('promotions', 'update'), controller.toggle);
router.delete('/:id', requirePermission('promotions', 'delete'), controller.remove);

export default router;
