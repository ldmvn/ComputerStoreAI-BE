import * as service from '../services/review.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export const listMine = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  res.json(await service.listMyReviews(req.user.userId, { page, limit }));
});

export const updateMine = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id || id <= 0) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const { rating, content } = req.body;
  const r = Number(rating);
  if (!r || r < 1 || r > 5) return res.status(400).json({ message: 'Điểm đánh giá phải từ 1 đến 5.' });
  if (!content || !String(content).trim()) return res.status(400).json({ message: 'Nội dung đánh giá không được để trống.' });
  const review = await service.updateMyReview(req.user.userId, id, { rating: r, content: String(content) });
  if (!review) return res.status(404).json({ message: 'Đánh giá không tồn tại.' });
  res.json(review);
});

export const deleteMine = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id || id <= 0) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const deleted = await service.deleteMyReview(req.user.userId, id);
  if (!deleted) return res.status(404).json({ message: 'Đánh giá không tồn tại.' });
  res.json({ message: 'Đã xóa đánh giá.' });
});
