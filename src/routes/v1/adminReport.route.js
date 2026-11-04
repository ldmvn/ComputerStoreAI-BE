import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as controller from '../../controllers/adminReport.controller.js';

const router = Router();
router.use(authenticateToken, requireAdmin);

router.get('/', requirePermission('reports', 'view'), controller.summary);
router.get('/revenue', requirePermission('reports', 'view'), controller.revenue);
router.get('/top-products', requirePermission('reports', 'view'), controller.topProducts);
router.get('/daily', requirePermission('reports', 'view'), controller.dailyRevenue);

export default router;
