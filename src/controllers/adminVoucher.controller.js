import * as service from '../services/adminVoucher.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export const stats = asyncHandler(async (req, res) => {
  res.json(await service.getStats());
});

export const list = asyncHandler(async (req, res) => {
  const { page, limit, search, status } = req.query;
  res.json(await service.listVouchers({
    page: page ? parseInt(page) : 1,
    limit: limit ? Math.min(parseInt(limit), 100) : 20,
    search, status,
  }));
});

export const detail = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  res.json({ voucher: await service.getVoucher(id) });
});

export const create = asyncHandler(async (req, res) => {
  const voucher = await service.createVoucher(req.body);
  res.status(201).json({ voucher, message: 'Tạo voucher thành công.' });
});

export const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const voucher = await service.updateVoucher(id, req.body);
  res.json({ voucher, message: 'Cập nhật voucher thành công.' });
});

export const toggle = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') return res.status(400).json({ message: 'isActive phải là boolean.' });
  const voucher = await service.toggleActive(id, isActive);
  res.json({ voucher, message: isActive ? 'Đã bật voucher.' : 'Đã tắt voucher.' });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  await service.deleteVoucher(id);
  res.json({ message: 'Đã xóa voucher.' });
});
