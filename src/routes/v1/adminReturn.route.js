import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as controller from '../../controllers/adminReturn.controller.js';

const router = Router();
router.use(authenticateToken, requireAdmin);

router.get('/', requirePermission('returns', 'view'), controller.list);
router.get('/:id', requirePermission('returns', 'view'), controller.detail);
router.patch('/:id/status', requirePermission('returns', 'manage'), controller.updateStatus);

export default router;
