import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';

const backendRoot = fileURLToPath(new URL('../../', import.meta.url));
const mediaRoot = path.resolve(process.env.MEDIA_STORAGE_DIR || path.join(backendRoot, 'uploads'));
export const brandingMediaDirectory = path.join(mediaRoot, 'branding');
const tempDirectory = path.join(mediaRoot, '.temporary-branding');

const logoAllowed = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] };
const faviconAllowed = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/x-icon': ['.ico'],
  'image/vnd.microsoft.icon': ['.ico'],
};

function brandingError(msg) {
  const e = new Error(msg);
  e.statusCode = 400;
  return e;
}

function makeUpload(fieldName, allowedMimes) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) =>
        mkdir(tempDirectory, { recursive: true }).then(() => cb(null, tempDirectory), cb),
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, parts: 7 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowedMimes[file.mimetype]?.includes(ext)) return cb(null, true);
      // ICO files sometimes arrive without extension — allow if MIME matches
      if ((file.mimetype === 'image/x-icon' || file.mimetype === 'image/vnd.microsoft.icon') && fieldName === 'favicon') return cb(null, true);
      cb(brandingError('Định dạng file không hợp lệ. Chỉ chấp nhận JPG, PNG, WebP' + (fieldName === 'favicon' ? ', ICO' : '') + '.'));
    },
  }).single(fieldName);
}

const logoMulter = makeUpload('logo', logoAllowed);
const faviconMulter = makeUpload('favicon', faviconAllowed);

export function uploadLogoMiddleware(req, res, next) {
  logoMulter(req, res, e => {
    if (!e) return next();
    next(brandingError(e.code === 'LIMIT_FILE_SIZE' ? 'Logo tối đa 5 MB.' : e.statusCode ? e.message : 'Upload logo không hợp lệ.'));
  });
}

export function uploadFaviconMiddleware(req, res, next) {
  faviconMulter(req, res, e => {
    if (!e) return next();
    next(brandingError(e.code === 'LIMIT_FILE_SIZE' ? 'Favicon tối đa 5 MB.' : e.statusCode ? e.message : 'Upload favicon không hợp lệ.'));
  });
}

export async function saveBrandingLogo(file) {
  if (!file) throw brandingError('Vui lòng chọn file logo.');
  const detected = await fileTypeFromFile(file.path).catch(() => null);
  if (!detected || !logoAllowed[detected.mime]) throw brandingError('Nội dung logo không khớp định dạng được hỗ trợ (JPG, PNG, WebP).');
  await mkdir(brandingMediaDirectory, { recursive: true });
  const key = `logo-${randomUUID()}.webp`;
  const dest = path.join(brandingMediaDirectory, key);
  try {
    await sharp(file.path, { limitInputPixels: 40_000_000, failOn: 'error' })
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88 })
      .toFile(dest);
  } catch {
    await removeBrandingFile(key);
    throw brandingError('Logo không hợp lệ hoặc vượt giới hạn 40 triệu pixel.');
  }
  const base = (process.env.MEDIA_PUBLIC_URL || '/media').replace(/\/$/, '');
  return { key, url: `${base}/branding/${key}` };
}

export async function saveBrandingFavicon(file) {
  if (!file) throw brandingError('Vui lòng chọn file favicon.');
  const detected = await fileTypeFromFile(file.path).catch(() => null);
  const validExts = ['jpg', 'jpeg', 'png', 'webp', 'ico'];
  if (!detected || !validExts.includes(detected.ext)) throw brandingError('Nội dung favicon không hợp lệ hoặc không được hỗ trợ.');
  await mkdir(brandingMediaDirectory, { recursive: true });
  const key = `favicon-${randomUUID()}.png`;
  const dest = path.join(brandingMediaDirectory, key);
  try {
    await sharp(file.path, { limitInputPixels: 10_000_000, failOn: 'error' })
      .resize({ width: 96, height: 96, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(dest);
  } catch {
    await removeBrandingFile(key);
    throw brandingError('Favicon không hợp lệ hoặc không thể xử lý.');
  }
  const base = (process.env.MEDIA_PUBLIC_URL || '/media').replace(/\/$/, '');
  return { key, url: `${base}/branding/${key}` };
}

export async function discardBrandingTemp(file) {
  if (file?.path) await unlink(file.path).catch(() => {});
}

export async function removeBrandingFile(key) {
  if (!key || !/^(logo|favicon)-[a-f0-9-]+\.(webp|png)$/.test(key)) return;
  await unlink(path.join(brandingMediaDirectory, key)).catch(e => {
    if (e.code !== 'ENOENT') console.error('Cannot remove branding file:', e.code);
  });
}

export function keyFromBrandingUrl(url) {
  const match = typeof url === 'string' ? url.match(/\/branding\/((logo|favicon)-[a-f0-9-]+\.(webp|png))$/) : null;
  return match?.[1] ?? null;
}
