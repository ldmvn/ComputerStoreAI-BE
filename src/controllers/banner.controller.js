import { prisma } from '../config/prisma.js';
import { listBanners, findBanner, homeBanners, reorderBanners, saveBannerRecord, changeBannerStatus } from '../services/banner.service.js';
import { discardTemporary, saveBannerMedia, removeBannerMedia } from '../services/media.service.js';
import { activeValue, bannerError, bannerId, validateBanner, validateReorder } from '../validators/banner.validator.js';

export const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
export const list = asyncHandler(async (_req, res) => res.json({ banners: await listBanners() }));
export const home = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await homeBanners());
});
export const detail = asyncHandler(async (req, res) => res.json({ banner: await findBanner(bannerId(req.params.id)) }));

export const save = asyncHandler(async (req, res) => {
  let uploaded;
  let persisted = false;
  try {
    const id = req.params.id ? bannerId(req.params.id) : null;
    const old = id ? await findBanner(id) : null;
    const data = validateBanner(req.body);
    if (!req.file && (!old || old.mediaType !== data.mediaType)) throw bannerError('Vui lòng upload media phù hợp.');
    uploaded = req.file ? await saveBannerMedia(req.file, data.mediaType) : null;
    const banner = await saveBannerRecord(id, { ...data, ...uploaded });
    persisted = true;
    if (uploaded && old) await removeBannerMedia(old.mediaKey);
    res.status(id ? 200 : 201).json({ banner, message: 'Đã lưu banner.' });
  } finally {
    await discardTemporary(req.file);
    if (uploaded && !persisted) await removeBannerMedia(uploaded.mediaKey);
  }
});

export const remove = asyncHandler(async (req, res) => {
  const old = await prisma.banner.delete({ where: { id: bannerId(req.params.id) } });
  await removeBannerMedia(old.mediaKey);
  res.json({ message: 'Đã xóa banner.' });
});
export const status = asyncHandler(async (req, res) => {
  const banner = await changeBannerStatus(bannerId(req.params.id), activeValue(req.body.isActive));
  res.json({ banner, message: 'Đã cập nhật trạng thái.' });
});
export const reorder = asyncHandler(async (req, res) => res.json({ banners: await reorderBanners(validateReorder(req.body)), message: 'Đã lưu thứ tự banner.' }));
