import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import { adminDetail, adminList, create, order, publicMenu, remove, status, update } from '../../controllers/category.controller.js';

export const publicCategoryRouter = Router();
publicCategoryRouter.get('/', publicMenu);
publicCategoryRouter.get('/menu', publicMenu);

export const adminCategoryRouter = Router();
adminCategoryRouter.use(authenticateToken, requireAdmin);
adminCategoryRouter.get('/', requirePermission('categories', 'view'), adminList);
adminCategoryRouter.get('/:id', requirePermission('categories', 'view'), adminDetail);
adminCategoryRouter.post('/', requirePermission('categories', 'create'), create);
adminCategoryRouter.put('/:id', requirePermission('categories', 'update'), update);
adminCategoryRouter.delete('/:id', requirePermission('categories', 'delete'), remove);
adminCategoryRouter.patch('/:id/status', requirePermission('categories', 'update'), status);
adminCategoryRouter.patch('/:id/order', requirePermission('categories', 'update'), order);
