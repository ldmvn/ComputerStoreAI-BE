import { createBrand, deleteBrand, getAdminBrand, listAdminBrands, setBrandStatus, updateBrand } from '../services/brand.service.js';
import { discardBrandLogoTemp, removeBrandLogoUrl, saveBrandLogo } from '../services/brandMedia.service.js';
import { brandId, parseBrandPayload, parseBrandStatus } from '../validators/brand.validator.js';

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

async function save(req, work) {
  let uploaded;
  try {
    uploaded = await saveBrandLogo(req.file);
    return await work(uploaded);
  } catch (error) {
    if (uploaded) await removeBrandLogoUrl(uploaded.logoUrl);
    throw error;
  } finally {
    await discardBrandLogoTemp(req.file);
  }
}

export const adminList = asyncHandler(async (req, res) => res.json({ brands: await listAdminBrands({ search: String(req.query.search || '').trim(), status: req.query.status }) }));
export const adminDetail = asyncHandler(async (req, res) => res.json({ brand: await getAdminBrand(brandId(req.params.id)) }));
export const create = asyncHandler(async (req, res) => save(req, async uploaded => res.status(201).json({ brand: await createBrand({ ...parseBrandPayload(req.body), ...(uploaded ? { logoUrl: uploaded.logoUrl } : {}) }), message: 'Đã tạo thương hiệu.' })));
export const update = asyncHandler(async (req, res) => save(req, async uploaded => {
  const id = brandId(req.params.id);
  const current = await getAdminBrand(id);
  const brand = await updateBrand(id, { ...parseBrandPayload(req.body), logoUrl: uploaded?.logoUrl || current.logoUrl });
  if (uploaded) await removeBrandLogoUrl(current.logoUrl);
  return res.json({ brand, message: 'Đã cập nhật thương hiệu.' });
}));
export const remove = asyncHandler(async (req, res) => {
  const deleted = await deleteBrand(brandId(req.params.id));
  await removeBrandLogoUrl(deleted.logoUrl);
  res.json({ result: { id: deleted.id }, message: 'Đã xóa thương hiệu.' });
});
export const status = asyncHandler(async (req, res) => res.json({ brand: await setBrandStatus(brandId(req.params.id), parseBrandStatus(req.body?.isActive)), message: 'Đã cập nhật trạng thái thương hiệu.' }));