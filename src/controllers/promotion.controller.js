import * as service from '../services/promotion.service.js';
import { parsePromotionListQuery, promotionId } from '../validators/promotion.validator.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export const stats = asyncHandler(async (req, res) => {
  res.json(await service.getStats());
});

export const list = asyncHandler(async (req, res) => {
  res.json(await service.listPromotions(parsePromotionListQuery(req.query)));
});

export const detail = asyncHandler(async (req, res) => {
  res.json({ promotion: await service.getPromotion(promotionId(req.params.id)) });
});

export const create = asyncHandler(async (req, res) => {
  const promotion = await service.createPromotion(req.body);
  res.status(201).json({ promotion, message: 'Đã tạo chương trình khuyến mãi.' });
});

export const update = asyncHandler(async (req, res) => {
  const promotion = await service.updatePromotion(promotionId(req.params.id), req.body);
  res.json({ promotion, message: 'Đã cập nhật chương trình.' });
});

export const toggle = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') return res.status(400).json({ message: 'isActive phải là boolean.' });
  const promotion = await service.toggleActive(promotionId(req.params.id), isActive);
  res.json({ promotion, message: isActive ? 'Đã bật chương trình.' : 'Đã tắt chương trình.' });
});

export const remove = asyncHandler(async (req, res) => {
  await service.deletePromotion(promotionId(req.params.id));
  res.json({ message: 'Đã xóa chương trình.' });
});

export const categories = asyncHandler(async (req, res) => {
  res.json({ categories: await service.listCategoriesFlat() });
});

export const products = asyncHandler(async (req, res) => {
  res.json({ products: await service.searchPromotionProducts(req.query.search) });
});
