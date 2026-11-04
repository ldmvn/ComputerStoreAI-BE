import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as ctrl from '../../controllers/activityLog.controller.js';

const router = Router();
const auth = authenticateToken;
const canView = requirePermission('activity_logs', 'view');

router.get('/',     auth, canView, ctrl.getLogs);
router.get('/:id',  auth, canView, ctrl.getLog);

export default router;
