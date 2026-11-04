import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as controller from '../../controllers/adminBuildPc.controller.js';

const router = Router();
router.use(authenticateToken, requireAdmin);

const canView   = requirePermission('build_pc', 'view');
const canManage = requirePermission('build_pc', 'manage');

router.get('/summary',                     canView,   controller.summary);
router.get('/data-issues',                 canView,   controller.dataIssues);

router.get('/rules',                       canView,   controller.listRules);
router.post('/rules',                      canManage, controller.createRule);
router.put('/rules/:id',                   canManage, controller.updateRule);
router.delete('/rules/:id',                canManage, controller.deleteRule);

router.get('/presets',                     canView,   controller.listPresets);
router.get('/presets/:id',                 canView,   controller.getPreset);
router.post('/presets',                    canManage, controller.createPreset);
router.put('/presets/:id',                 canManage, controller.updatePreset);
router.delete('/presets/:id',              canManage, controller.deletePreset);

router.get('/attributes/coverage',         canView,   controller.attributeCoverage);
router.get('/attributes/missing-products', canView,   controller.missingAttributeProducts);

router.get('/sessions',                    canView,   controller.listBuildSessions);
router.get('/sessions/:id',                canView,   controller.getBuildSession);

export default router;
