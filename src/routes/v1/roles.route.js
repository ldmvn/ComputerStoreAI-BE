import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as ctrl from '../../controllers/roles.controller.js';

const router = Router();
const auth = authenticateToken;

// Current user's own permissions — authentication only, no RBAC permission needed.
router.get('/my-permissions', auth, ctrl.myPermissions);

const canView   = requirePermission('roles', 'view');
const canCreate = requirePermission('roles', 'create');
const canUpdate = requirePermission('roles', 'update');
const canDelete = requirePermission('roles', 'delete');
const canManage = requirePermission('roles', 'manage');

router.get('/',                 auth, canView,   ctrl.listRoles);
router.get('/permissions',      auth, canView,   ctrl.listPermissions);
router.post('/',                auth, canCreate, ctrl.createRole);
router.put('/:id',              auth, canUpdate, ctrl.updateRole);
router.delete('/:id',           auth, canDelete, ctrl.deleteRole);
router.put('/:id/permissions',  auth, canManage, ctrl.setRolePermissions);

export default router;
