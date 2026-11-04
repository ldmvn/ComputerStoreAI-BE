import * as service from '../services/adminReview.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export const stats = asyncHandler(async (req, res) => {
  res.json(await service.getReviewStats());
});

export const list = asyncHandler(async (req, res) => {
  const { page, limit, search, rating, status, from, to } = req.query;
  res.json(await service.listAllReviews({
    page: page ? parseInt(page) : 1,
    limit: limit ? Math.min(parseInt(limit), 100) : 20,
    search, rating, status, from, to,
  }));
});

export const publish = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  await service.setPublished(id, true);
  res.json({ message: 'Đã duyệt đánh giá.' });
});

export const hide = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  await service.setPublished(id, false);
  res.json({ message: 'Đã ẩn đánh giá.' });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  await service.deleteReview(id);
  res.json({ message: 'Đã xóa đánh giá.' });
});
