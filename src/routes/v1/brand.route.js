import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import { adminDetail, adminList, create, remove, status, update } from '../../controllers/brand.controller.js';
import { uploadBrandLogo } from '../../services/brandMedia.service.js';

export const adminBrandRouter = Router();
adminBrandRouter.use(authenticateToken, requireAdmin);
adminBrandRouter.get('/', requirePermission('brands', 'view'), adminList);
adminBrandRouter.get('/:id', requirePermission('brands', 'view'), adminDetail);
adminBrandRouter.post('/', requirePermission('brands', 'create'), uploadBrandLogo, create);
adminBrandRouter.put('/:id', requirePermission('brands', 'update'), uploadBrandLogo, update);
adminBrandRouter.patch('/:id/status', requirePermission('brands', 'update'), status);
adminBrandRouter.delete('/:id', requirePermission('brands', 'delete'), remove);
