import { createCategory, deleteCategory, getAdminCategory, listAdminCategories, listPublicCategoryMenu, setCategoryOrder, setCategoryStatus, updateCategory } from '../services/category.service.js';
import { categoryId, parseCategoryListQuery, parseCategoryOrder, parseCategoryPayload, parseCategoryStatus } from '../validators/category.validator.js';

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

export const adminList = asyncHandler(async (req, res) => res.json({ categories: await listAdminCategories(parseCategoryListQuery(req.query)) }));
export const adminDetail = asyncHandler(async (req, res) => res.json({ category: await getAdminCategory(categoryId(req.params.id)) }));
export const create = asyncHandler(async (req, res) => res.status(201).json({ category: await createCategory(parseCategoryPayload(req.body)), message: 'Đã tạo danh mục.' }));
export const update = asyncHandler(async (req, res) => res.json({ category: await updateCategory(categoryId(req.params.id), parseCategoryPayload(req.body)), message: 'Đã cập nhật danh mục.' }));
export const remove = asyncHandler(async (req, res) => res.json({ result: await deleteCategory(categoryId(req.params.id)), message: 'Đã xóa danh mục.' }));
export const status = asyncHandler(async (req, res) => res.json({ category: await setCategoryStatus(categoryId(req.params.id), parseCategoryStatus(req.body?.isActive)), message: 'Đã cập nhật trạng thái danh mục.' }));
export const order = asyncHandler(async (req, res) => res.json({ category: await setCategoryOrder(categoryId(req.params.id), parseCategoryOrder(req.body?.sortOrder)), message: 'Đã cập nhật thứ tự danh mục.' }));
export const publicMenu = asyncHandler(async (_req, res) => res.json({ categories: await listPublicCategoryMenu() }));