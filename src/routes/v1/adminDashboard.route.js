import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as controller from '../../controllers/adminDashboard.controller.js';

const router = Router();
router.use(authenticateToken, requireAdmin);

router.get('/', requirePermission('dashboard', 'view'), controller.getDashboard);
router.get('/revenue-timeline', requirePermission('dashboard', 'view'), controller.getRevenueTimeline);
router.get('/category-revenue', requirePermission('dashboard', 'view'), controller.getCategoryRevenue);

export default router;
