import * as service from '../services/wishlist.service.js';
import { positiveWishlistProductId } from '../validators/wishlist.validator.js';

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

export const list = asyncHandler(async (req, res) => {
  res.json({ items: await service.listWishlist(req.user.userId) });
});

export const add = asyncHandler(async (req, res) => {
  const productId = positiveWishlistProductId(req.params.productId);
  const result = await service.addWishlistItem(req.user.userId, productId);
  res.status(201).json({ item: result, message: 'Đã thêm vào yêu thích.' });
});

export const remove = asyncHandler(async (req, res) => {
  const productId = positiveWishlistProductId(req.params.productId);
  const removed = await service.removeWishlistItem(req.user.userId, productId);
  res.json({ removed, message: removed ? 'Đã xóa khỏi yêu thích.' : 'Sản phẩm chưa có trong danh sách yêu thích.' });
});

export const check = asyncHandler(async (req, res) => {
  const productId = positiveWishlistProductId(req.params.productId);
  res.json({ productId, favorited: await service.isFavorited(req.user.userId, productId) });
});