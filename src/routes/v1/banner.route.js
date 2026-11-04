import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import { uploadBannerMedia } from '../../services/media.service.js';
import { list, home, detail, save, remove, status, reorder } from '../../controllers/banner.controller.js';

export const publicBannerRouter = Router();
publicBannerRouter.get('/home', home);
// Management reads include inactive banners — require admin + permission.
publicBannerRouter.get('/', authenticateToken, requireAdmin, requirePermission('banners', 'view'), list);
publicBannerRouter.get('/:id', authenticateToken, requireAdmin, requirePermission('banners', 'view'), detail);

export const adminBannerRouter = Router();
adminBannerRouter.use(authenticateToken, requireAdmin);
adminBannerRouter.get('/', requirePermission('banners', 'view'), list);
adminBannerRouter.get('/:id', requirePermission('banners', 'view'), detail);
adminBannerRouter.post('/', requirePermission('banners', 'create'), uploadBannerMedia, save);
adminBannerRouter.put('/:id', requirePermission('banners', 'update'), uploadBannerMedia, save);
adminBannerRouter.patch('/reorder', requirePermission('banners', 'update'), reorder);
adminBannerRouter.patch('/:id/status', requirePermission('banners', 'update'), status);
adminBannerRouter.delete('/:id', requirePermission('banners', 'delete'), remove);
