import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import * as controller from '../../controllers/attribute.controller.js';

export const publicAttributeRouter = Router();
publicAttributeRouter.get('/category/:slug', controller.publicByCategory);

export const adminAttributeRouter = Router();
adminAttributeRouter.use(authenticateToken, requireAdmin);

// ── AttributeGroup ─────────────────────────────────────────────────────────────
adminAttributeRouter.get('/groups',                    requirePermission('attributes', 'view'),   controller.listGroups);
adminAttributeRouter.post('/groups',                   requirePermission('attributes', 'create'), controller.createGroup);
adminAttributeRouter.put('/groups/:id',                requirePermission('attributes', 'update'), controller.updateGroup);
adminAttributeRouter.delete('/groups/:id',             requirePermission('attributes', 'delete'), controller.removeGroup);
adminAttributeRouter.patch('/groups/:id/status',       requirePermission('attributes', 'update'), controller.groupStatus);
adminAttributeRouter.patch('/groups/:id/order',        requirePermission('attributes', 'update'), controller.groupOrder);
adminAttributeRouter.put('/groups/:id/members',        requirePermission('attributes', 'update'), controller.groupMembers);

// ── Attribute ─────────────────────────────────────────────────────────────────
adminAttributeRouter.get('/',                          requirePermission('attributes', 'view'),   controller.list);
adminAttributeRouter.get('/category/:categoryId',      requirePermission('attributes', 'view'),   controller.byCategory);
adminAttributeRouter.post('/',                         requirePermission('attributes', 'create'), controller.create);
adminAttributeRouter.put('/:id',                       requirePermission('attributes', 'update'), controller.update);
adminAttributeRouter.delete('/:id',                    requirePermission('attributes', 'delete'), controller.remove);
adminAttributeRouter.patch('/:id/status',              requirePermission('attributes', 'update'), controller.status);
adminAttributeRouter.patch('/:id/order',               requirePermission('attributes', 'update'), controller.order);
adminAttributeRouter.put('/:id/categories',            requirePermission('attributes', 'update'), controller.categories);
adminAttributeRouter.put('/:id/category-links',        requirePermission('attributes', 'update'), controller.categoryLinks);

// ── AttributeValue ────────────────────────────────────────────────────────────
adminAttributeRouter.post('/:id/values',               requirePermission('attributes', 'update'), controller.createValue);
adminAttributeRouter.put('/values/:valueId',           requirePermission('attributes', 'update'), controller.updateValue);
adminAttributeRouter.delete('/values/:valueId',        requirePermission('attributes', 'update'), controller.removeValue);
adminAttributeRouter.patch('/values/:valueId/status',  requirePermission('attributes', 'update'), controller.valueStatus);
adminAttributeRouter.patch('/values/:valueId/order',   requirePermission('attributes', 'update'), controller.valueOrder);
