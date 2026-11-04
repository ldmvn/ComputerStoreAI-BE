import * as svc from '../services/storeSetting.service.js';
import { logActivity } from '../services/activityLog.service.js';
import {
  uploadLogoMiddleware,
  uploadFaviconMiddleware,
  saveBrandingLogo,
  saveBrandingFavicon,
  discardBrandingTemp,
  removeBrandingFile,
  keyFromBrandingUrl,
} from '../services/brandingMedia.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

async function bumpVersion() {
  await svc.setSettings({ 'store.brandingVersion': String(Date.now()) });
}

export { uploadLogoMiddleware as uploadLogoMw, uploadFaviconMiddleware as uploadFaviconMw };

export const getBranding = asyncHandler(async (_req, res) => {
  const logoUrl = await svc.getSetting('store.logoUrl') ?? '';
  const faviconUrl = await svc.getSetting('store.faviconUrl') ?? '';
  const version = await svc.getSetting('store.brandingVersion') ?? '1';
  res.json({ success: true, data: { logoUrl, faviconUrl, version } });
});

export const getPublicBranding = asyncHandler(async (_req, res) => {
  const logoUrl = await svc.getSetting('store.logoUrl') ?? '';
  const faviconUrl = await svc.getSetting('store.faviconUrl') ?? '';
  const version = await svc.getSetting('store.brandingVersion') ?? '1';
  res.json({ success: true, data: { logoUrl, faviconUrl, version } });
});

export const uploadLogo = asyncHandler(async (req, res) => {
  let saved;
  try {
    saved = await saveBrandingLogo(req.file);
    const old = await svc.getSetting('store.logoUrl');
    await svc.setSettings({ 'store.logoUrl': saved.url });
    await bumpVersion();
    if (old) await removeBrandingFile(keyFromBrandingUrl(old));
    await logActivity({ req, action: 'update_logo', module: 'branding', description: 'Đã tải logo mới lên', success: true }).catch(() => {});
    res.json({ success: true, data: { logoUrl: saved.url }, message: 'Đã cập nhật logo.' });
  } catch (e) {
    if (saved) await removeBrandingFile(saved.key);
    throw e;
  } finally {
    await discardBrandingTemp(req.file);
  }
});

export const uploadFavicon = asyncHandler(async (req, res) => {
  let saved;
  try {
    saved = await saveBrandingFavicon(req.file);
    const old = await svc.getSetting('store.faviconUrl');
    await svc.setSettings({ 'store.faviconUrl': saved.url });
    await bumpVersion();
    if (old) await removeBrandingFile(keyFromBrandingUrl(old));
    await logActivity({ req, action: 'update_favicon', module: 'branding', description: 'Đã tải favicon mới lên', success: true }).catch(() => {});
    res.json({ success: true, data: { faviconUrl: saved.url }, message: 'Đã cập nhật favicon.' });
  } catch (e) {
    if (saved) await removeBrandingFile(saved.key);
    throw e;
  } finally {
    await discardBrandingTemp(req.file);
  }
});

export const deleteLogo = asyncHandler(async (req, res) => {
  const old = await svc.getSetting('store.logoUrl');
  await svc.setSettings({ 'store.logoUrl': '' });
  await bumpVersion();
  if (old) await removeBrandingFile(keyFromBrandingUrl(old));
  await logActivity({ req, action: 'delete_logo', module: 'branding', description: 'Đã xóa logo tùy chỉnh, khôi phục mặc định', success: true }).catch(() => {});
  res.json({ success: true, message: 'Đã xóa logo tùy chỉnh, trả về logo mặc định.' });
});

export const deleteFavicon = asyncHandler(async (req, res) => {
  const old = await svc.getSetting('store.faviconUrl');
  await svc.setSettings({ 'store.faviconUrl': '' });
  await bumpVersion();
  if (old) await removeBrandingFile(keyFromBrandingUrl(old));
  await logActivity({ req, action: 'delete_favicon', module: 'branding', description: 'Đã xóa favicon tùy chỉnh, khôi phục mặc định', success: true }).catch(() => {});
  res.json({ success: true, message: 'Đã xóa favicon tùy chỉnh, trả về mặc định.' });
});
