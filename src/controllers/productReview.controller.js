import { createProductReview, deleteProductReview, getReviewEligibility, getMyReviewForProduct, listProductReviews, updateProductReview } from '../services/productStatistics.service.js';
import { discardReviewTemp, saveReviewImages } from '../services/reviewMedia.service.js';
import { parseReviewListQuery, parseReviewPayload, reviewError } from '../validators/productReview.validator.js';
import { logActivity } from '../services/activityLog.service.js';

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

function parseBody(req) {
  try { return parseReviewPayload(req.body); } catch (error) { if (error instanceof SyntaxError) throw reviewError('Dữ liệu đánh giá không hợp lệ.'); throw error; }
}

async function withImages(req, work) {
  let saved = [];
  try { saved = await saveReviewImages(req.files || [], req.user.userId); return await work(saved); }
  catch (error) { await Promise.all(saved.map(image => removeReviewImage(image.storageKey))); throw error; }
  finally { await discardReviewTemp(req.files || []); }
}

function removeReviewImage(key) { return import('../services/reviewMedia.service.js').then(({ removeReviewImage }) => removeReviewImage(key)); }

export const listReviews = asyncHandler(async (req, res) => {
  const query = parseReviewListQuery(req.query);
  const result = await listProductReviews(req.params.slug, query);
  res.json(result);
});

export const getEligibility = asyncHandler(async (req, res) => {
  const userId = req.user?.userId ?? null;
  const result = await getReviewEligibility(req.params.slug, userId);
  res.json(result);
});

export const getMyReview = asyncHandler(async (req, res) => {
  const review = await getMyReviewForProduct(req.params.slug, req.user.userId);
  res.json({ review });
});

export const createReview = asyncHandler(async (req, res) => withImages(req, async images => {
  const review = await createProductReview(req.params.slug, req.user.userId, parseBody(req), images.map(image => image.imageUrl));
  await logActivity({ req, action: 'create', module: 'reviews', targetId: review.id, description: `Đánh giá sản phẩm ${req.params.slug}` });
  res.status(201).json({ review, message: 'Gửi đánh giá thành công.' });
}));

export const updateReview = asyncHandler(async (req, res) => {
  const reviewId = parseInt(req.params.reviewId);
  if (!reviewId || reviewId <= 0) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const payload = parseBody(req);
  const review = await updateProductReview(req.params.slug, reviewId, req.user.userId, payload);
  res.json({ review, message: 'Cập nhật đánh giá thành công.' });
});

export const deleteReview = asyncHandler(async (req, res) => {
  await deleteProductReview(req.params.slug, req.params.reviewId, req.user.userId);
  res.json({ message: 'Đã xóa đánh giá.' });
});
