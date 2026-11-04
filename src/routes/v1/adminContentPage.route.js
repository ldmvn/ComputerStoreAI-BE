import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import { adminGetPage, adminUpdatePage } from '../../controllers/contentPage.controller.js';

const router = Router();

router.use(authenticateToken, requireAdmin);

router.get('/:key',  requirePermission('settings', 'view'),   adminGetPage);
router.put('/:key',  requirePermission('settings', 'manage'), adminUpdatePage);

export default router;
