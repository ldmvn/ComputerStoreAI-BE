import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as controller from '../../controllers/adminReview.controller.js';

const router = Router();
router.use(authenticateToken, requireAdmin);

router.get('/stats', requirePermission('reviews', 'view'), controller.stats);
router.get('/', requirePermission('reviews', 'view'), controller.list);
router.patch('/:id/publish', requirePermission('reviews', 'manage'), controller.publish);
router.patch('/:id/hide', requirePermission('reviews', 'manage'), controller.hide);
router.delete('/:id', requirePermission('reviews', 'manage'), controller.remove);

export default router;
