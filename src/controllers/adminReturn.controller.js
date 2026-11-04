import * as service from '../services/adminReturn.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export const list = asyncHandler(async (req, res) => {
  const { page, limit, status, search } = req.query;
  const result = await service.listReturns({
    page: page ? parseInt(page) : 1,
    limit: limit ? Math.min(parseInt(limit), 100) : 20,
    status, search,
  });
  res.json(result);
});

export const detail = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const ret = await service.getReturn(id);
  if (!ret) return res.status(404).json({ message: 'Yêu cầu đổi trả không tồn tại.' });
  res.json({ return: ret });
});

export const updateStatus = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const { status, adminNote } = req.body;
  if (!status) return res.status(400).json({ message: 'Vui lòng cung cấp trạng thái mới.' });
  const ret = await service.updateReturnStatus(id, { status, adminNote });
  res.json({ return: ret, message: 'Cập nhật trạng thái thành công.' });
});
