import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { requirePermission } from '../../middlewares/permission.middleware.js';
import { active, menuInt, menuError, parseGroup, parseItem } from '../../validators/megaMenu.validator.js';
import * as service from '../../services/megaMenu.service.js';

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(error => {
  if (error.code === 'P2025') return next(menuError('Nhóm hoặc mục Mega Menu không tồn tại.', 404));
  if (error.code === 'P2003') return next(menuError('Dữ liệu tham chiếu đã bị xóa. Vui lòng tải lại.'));
  next(error);
});

export const publicMegaMenuRouter = Router();
publicMegaMenuRouter.get('/:slug?', wrap(async (req, res) => {
  const menus = await service.publicMenus(req.params.slug);
  if (req.params.slug && !menus.length) throw menuError('Danh mục không tồn tại.', 404);
  res.set('Cache-Control', 'public, max-age=30, must-revalidate').json({ menus });
}));

export const adminMegaMenuRouter = Router();
adminMegaMenuRouter.use(authenticateToken, requireAdmin);

adminMegaMenuRouter.get('/options', requirePermission('megamenu', 'view'), wrap(async (_req, res) => res.json({ attributes: await service.attributeOptions() })));
adminMegaMenuRouter.get('/categories/:categoryId', requirePermission('megamenu', 'view'), wrap(async (req, res) => res.json(await service.getAdminMenu(menuInt(req.params.categoryId)))));

adminMegaMenuRouter.put('/categories/:categoryId', requirePermission('megamenu', 'manage'), wrap(async (req, res) => {
  let ids = req.body.brandIds;
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.length > 30) throw menuError('Danh sách thương hiệu không hợp lệ.');
    ids = ids.map(id => menuInt(id));
    if (new Set(ids).size !== ids.length) throw menuError('Không chọn thương hiệu trùng.');
  }
  res.json({ menu: await service.saveMenu(menuInt(req.params.categoryId), active(req.body.isActive), ids) });
}));
adminMegaMenuRouter.post('/categories/:categoryId/groups', requirePermission('megamenu', 'manage'), wrap(async (req, res) => res.status(201).json({ group: await service.createGroup(menuInt(req.params.categoryId), parseGroup(req.body)) })));
adminMegaMenuRouter.put('/groups/:id', requirePermission('megamenu', 'manage'), wrap(async (req, res) => res.json({ group: await service.updateGroup(menuInt(req.params.id), parseGroup(req.body)) })));
adminMegaMenuRouter.delete('/groups/:id', requirePermission('megamenu', 'manage'), wrap(async (req, res) => { await service.deleteGroup(menuInt(req.params.id)); res.json({ message: 'Đã xóa nhóm.' }); }));
adminMegaMenuRouter.post('/groups/:groupId/items', requirePermission('megamenu', 'manage'), wrap(async (req, res) => res.status(201).json({ item: await service.saveItem(menuInt(req.params.groupId), null, parseItem(req.body)) })));
adminMegaMenuRouter.put('/groups/:groupId/items/:id', requirePermission('megamenu', 'manage'), wrap(async (req, res) => res.json({ item: await service.saveItem(menuInt(req.params.groupId), menuInt(req.params.id), parseItem(req.body)) })));
adminMegaMenuRouter.delete('/items/:id', requirePermission('megamenu', 'manage'), wrap(async (req, res) => { await service.deleteItem(menuInt(req.params.id)); res.json({ message: 'Đã xóa mục.' }); }));
