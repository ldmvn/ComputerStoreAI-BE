import { Router } from 'express';
import { authenticateToken as authenticate } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as ctrl from '../../controllers/storeBranding.controller.js';

const router = Router();

router.use(authenticate);

router.get('/',             requirePermission('settings', 'view'),   ctrl.getBranding);
router.post('/logo',        requirePermission('settings', 'manage'), ctrl.uploadLogoMw,    ctrl.uploadLogo);
router.post('/favicon',     requirePermission('settings', 'manage'), ctrl.uploadFaviconMw, ctrl.uploadFavicon);
router.delete('/logo',      requirePermission('settings', 'manage'), ctrl.deleteLogo);
router.delete('/favicon',   requirePermission('settings', 'manage'), ctrl.deleteFavicon);

export default router;
