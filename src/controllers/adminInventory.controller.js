import * as service from '../services/adminInventory.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export const stats = asyncHandler(async (req, res) => {
  res.json(await service.getStats());
});

export const list = asyncHandler(async (req, res) => {
  const { page, limit, status, search, sort } = req.query;
  res.json(await service.listInventory({
    page: page ? parseInt(page) : 1,
    limit: limit ? Math.min(parseInt(limit), 100) : 20,
    status, search, sort,
  }));
});

export const importStock = asyncHandler(async (req, res) => {
  const productId = parseInt(req.params.id);
  if (!productId) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const { quantity, reference, note } = req.body;
  const result = await service.importStock(productId, { quantity, reference, note }, req.user.userId);
  res.json({ ...result, message: 'Nhập hàng thành công.' });
});

export const adjustStock = asyncHandler(async (req, res) => {
  const productId = parseInt(req.params.id);
  if (!productId) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const { mode, value, reason } = req.body;
  const result = await service.adjustStock(productId, { mode, value, reason }, req.user.userId);
  res.json({ ...result, message: 'Điều chỉnh tồn kho thành công.' });
});

export const logs = asyncHandler(async (req, res) => {
  const { page, limit, productId, type, from, to } = req.query;
  res.json(await service.listLogs({
    page: page ? parseInt(page) : 1,
    limit: limit ? Math.min(parseInt(limit), 100) : 30,
    productId: productId ? parseInt(productId) : undefined,
    type, from, to,
  }));
});
