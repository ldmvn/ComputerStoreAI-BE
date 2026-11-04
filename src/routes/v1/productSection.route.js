import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import { add, create, detail, home, list, products, quickFilter, remove, removeImage, removeItem, reorder, reorderItems, sectionProducts, status, update, uploadImage } from '../../controllers/productSection.controller.js';

export const publicProductSectionRouter = Router();
publicProductSectionRouter.get('/home', home);

export const adminProductSectionRouter = Router();
adminProductSectionRouter.use(authenticateToken, requireAdmin);
adminProductSectionRouter.get('/products', requirePermission('product_sections', 'view'), products);
adminProductSectionRouter.get('/', requirePermission('product_sections', 'view'), list);
adminProductSectionRouter.get('/:id', requirePermission('product_sections', 'view'), detail);
adminProductSectionRouter.get('/:id/products', requirePermission('product_sections', 'view'), sectionProducts);
adminProductSectionRouter.post('/', requirePermission('product_sections', 'manage'), create);
adminProductSectionRouter.put('/:id', requirePermission('product_sections', 'manage'), update);
adminProductSectionRouter.delete('/:id', requirePermission('product_sections', 'manage'), remove);
adminProductSectionRouter.patch('/reorder', requirePermission('product_sections', 'manage'), reorder);
adminProductSectionRouter.patch('/:id/status', requirePermission('product_sections', 'manage'), status);
adminProductSectionRouter.post('/:id/products', requirePermission('product_sections', 'manage'), add);
adminProductSectionRouter.patch('/:id/products/reorder', requirePermission('product_sections', 'manage'), reorderItems);
adminProductSectionRouter.patch('/:id/reorder-products', requirePermission('product_sections', 'manage'), reorderItems);
adminProductSectionRouter.delete('/:id/products/:productId', requirePermission('product_sections', 'manage'), removeItem);
adminProductSectionRouter.put('/:id/quick-filter', requirePermission('product_sections', 'manage'), quickFilter);
adminProductSectionRouter.post('/:id/image', requirePermission('product_sections', 'manage'), ...uploadImage);
adminProductSectionRouter.delete('/:id/image', requirePermission('product_sections', 'manage'), removeImage);
