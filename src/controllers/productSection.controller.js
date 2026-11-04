import {
  addProducts,
  createSection,
  deleteSection,
  getHomeSections,
  getSection,
  listSections,
  removeProduct,
  reorderProducts,
  reorderSections,
  saveQuickFilterConfig,
  searchProducts,
  setSectionStatus,
  updateSection,
  updateSectionImage,
  deleteSectionImage,
} from '../services/productSection.service.js';
import { productId, sectionId, validateProductIds, validateQuickFilterConfig, validateReorderIds, validateSection, validatePromoSection } from '../validators/productSection.validator.js';
import { savePromoImage, uploadPromoImageMiddleware } from '../services/promoMedia.service.js';

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

function pickValidator(body) {
  return body?.type === 'PROMOTIONAL_SECTION' ? validatePromoSection : validateSection;
}

export const home = asyncHandler(async (_req, res) => res.json({ sections: await getHomeSections() }));
export const list = asyncHandler(async (_req, res) => res.json({ sections: await listSections() }));
export const detail = asyncHandler(async (req, res) => res.json({ section: await getSection(sectionId(req.params.id)) }));
export const sectionProducts = asyncHandler(async (req, res) => res.json({ products: (await getSection(sectionId(req.params.id))).products }));
export const products = asyncHandler(async (req, res) => res.json({ products: await searchProducts(req.query.search) }));
export const create = asyncHandler(async (req, res) => {
  const data = pickValidator(req.body)(req.body);
  res.status(201).json({ section: await createSection(data), message: `Đã tạo khối.` });
});
export const update = asyncHandler(async (req, res) => {
  const id = sectionId(req.params.id);
  const existing = await getSection(id);
  const data = pickValidator({ type: existing.type, ...req.body })(req.body);
  res.json({ section: await updateSection(id, data), message: 'Đã cập nhật khối.' });
});
export const remove = asyncHandler(async (req, res) => { await deleteSection(sectionId(req.params.id)); res.json({ message: 'Đã xóa khối.' }); });
export const status = asyncHandler(async (req, res) => {
  const value = req.body?.isActive === true || req.body?.isActive === 'true';
  res.json({ section: await setSectionStatus(sectionId(req.params.id), value), message: value ? 'Đã bật khối.' : 'Đã tắt khối.' });
});
export const add = asyncHandler(async (req, res) => res.json({ section: await addProducts(sectionId(req.params.id), validateProductIds(req.body)), message: 'Đã thêm sản phẩm vào khối.' }));
export const removeItem = asyncHandler(async (req, res) => res.json({ section: await removeProduct(sectionId(req.params.id), productId(req.params.productId)), message: 'Đã xóa sản phẩm khỏi khối.' }));
export const reorderItems = asyncHandler(async (req, res) => res.json({ section: await reorderProducts(sectionId(req.params.id), validateReorderIds(req.body, 'sản phẩm')), message: 'Đã lưu thứ tự sản phẩm.' }));
export const reorder = asyncHandler(async (req, res) => res.json({ sections: await reorderSections(validateReorderIds(req.body, 'khối').map(Number)), message: 'Đã lưu thứ tự khối.' }));
export const quickFilter = asyncHandler(async (req, res) => res.json({ section: await saveQuickFilterConfig(sectionId(req.params.id), validateQuickFilterConfig(req.body)), message: 'Đã lưu cấu hình Quick Filter.' }));

export const uploadImage = [
  uploadPromoImageMiddleware,
  asyncHandler(async (req, res) => {
    const id = sectionId(req.params.id);
    const { imageUrl } = await savePromoImage(req.file);
    const section = await updateSectionImage(id, imageUrl);
    res.json({ section, message: 'Đã cập nhật ảnh khối.' });
  }),
];

export const removeImage = asyncHandler(async (req, res) => {
  const id = sectionId(req.params.id);
  const section = await deleteSectionImage(id);
  res.json({ section, message: 'Đã xóa ảnh khối.' });
});
