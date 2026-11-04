import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';
import { brandError } from '../validators/brand.validator.js';

const backendRoot = fileURLToPath(new URL('../../', import.meta.url));
const mediaRoot = path.resolve(process.env.MEDIA_STORAGE_DIR || path.join(backendRoot, 'uploads'));
export const brandMediaDirectory = path.join(mediaRoot, 'brands');
const tempDirectory = path.join(mediaRoot, '.temporary-brands');
const allowed = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] };

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => mkdir(tempDirectory, { recursive: true }).then(() => callback(null, tempDirectory), callback),
    filename: (_req, _file, callback) => callback(null, randomUUID()),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10, fieldSize: 200000, parts: 12 },
  fileFilter: (_req, file, callback) => allowed[file.mimetype]?.includes(path.extname(file.originalname).toLowerCase()) ? callback(null, true) : callback(brandError('Chỉ chấp nhận logo JPG, PNG hoặc WEBP với MIME đúng.')),
}).single('logo');

export function uploadBrandLogo(req, res, next) {
  upload(req, res, error => {
    if (!error) return next();
    next(brandError(error.code === 'LIMIT_FILE_SIZE' ? 'Logo tối đa 5 MB.' : error.statusCode ? error.message : 'Upload logo không hợp lệ.'));
  });
}

export async function saveBrandLogo(file) {
  if (!file) return null;
  const detected = await fileTypeFromFile(file.path);
  if (!detected || !allowed[file.mimetype]?.includes(path.extname(file.originalname).toLowerCase()) || detected.mime !== file.mimetype) throw brandError('Nội dung logo không khớp MIME khai báo.');
  await mkdir(brandMediaDirectory, { recursive: true });
  const key = `${randomUUID()}.webp`;
  try {
    await sharp(file.path, { limitInputPixels: 40000000, failOn: 'error' }).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toFile(path.join(brandMediaDirectory, key));
  } catch {
    await removeBrandLogo(key);
    throw brandError('Logo không hợp lệ hoặc vượt giới hạn 40 triệu pixel.');
  }
  return { key, logoUrl: `${(process.env.MEDIA_PUBLIC_URL || '/media').replace(/\/$/, '')}/brands/${key}` };
}

export async function discardBrandLogoTemp(file) {
  if (file?.path) await unlink(file.path).catch(() => {});
}

export async function removeBrandLogo(key) {
  if (!/^[a-f0-9-]+\.webp$/.test(key || '')) return;
  await unlink(path.join(brandMediaDirectory, key)).catch(error => { if (error.code !== 'ENOENT') console.error('Cannot remove brand logo:', error.code); });
}

export async function removeBrandLogoUrl(url) {
  const match = typeof url === 'string' ? url.match(/\/brands\/([a-f0-9-]+\.webp)$/) : null;
  if (match) await removeBrandLogo(match[1]);
}