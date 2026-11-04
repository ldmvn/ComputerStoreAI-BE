import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';

const backendRoot = fileURLToPath(new URL('../../', import.meta.url));
const mediaRoot = path.resolve(process.env.MEDIA_STORAGE_DIR || path.join(backendRoot, 'uploads'));
export const promoMediaDirectory = path.join(mediaRoot, 'promo-sections');
const tempDirectory = path.join(mediaRoot, '.temporary-promo');

const allowed = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] };
const IMAGE_LIMIT = 10 * 1024 * 1024;

function promoError(msg) {
  const e = new Error(msg); e.statusCode = 400; return e;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) =>
      mkdir(tempDirectory, { recursive: true }).then(() => cb(null, tempDirectory), cb),
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: IMAGE_LIMIT, files: 1, fields: 5, parts: 7 },
  fileFilter: (_req, file, cb) => {
    if (allowed[file.mimetype]?.includes(path.extname(file.originalname).toLowerCase())) return cb(null, true);
    cb(promoError('Chỉ chấp nhận JPG, PNG hoặc WEBP.'));
  },
}).single('image');

export function uploadPromoImageMiddleware(req, res, next) {
  upload(req, res, e => {
    if (!e) return next();
    next(promoError(e.code === 'LIMIT_FILE_SIZE' ? 'Ảnh tối đa 10 MB.' : e.statusCode ? e.message : 'Upload ảnh không hợp lệ.'));
  });
}

export async function savePromoImage(file) {
  if (!file) throw promoError('Vui lòng chọn ảnh.');
  const detected = await fileTypeFromFile(file.path).catch(() => null);
  if (!detected || !allowed[detected.mime]) throw promoError('Nội dung ảnh không khớp định dạng được hỗ trợ.');
  await mkdir(promoMediaDirectory, { recursive: true });
  const key = `${randomUUID()}.webp`;
  const dest = path.join(promoMediaDirectory, key);
  try {
    await sharp(file.path, { limitInputPixels: 40000000, failOn: 'error' })
      .rotate().webp({ quality: 88 }).toFile(dest);
  } catch {
    await unlink(dest).catch(() => {});
    throw promoError('Ảnh không hợp lệ hoặc vượt giới hạn 40 triệu pixel.');
  } finally {
    await unlink(file.path).catch(() => {});
  }
  const base = (process.env.MEDIA_PUBLIC_URL || '/media').replace(/\/$/, '');
  return { key, imageUrl: `${base}/promo-sections/${key}` };
}

export async function removePromoImage(imageUrl) {
  if (!imageUrl) return;
  const key = imageUrl.split('/').pop();
  if (!/^[a-f0-9-]+\.webp$/.test(key || '')) return;
  await unlink(path.join(promoMediaDirectory, key)).catch(e => {
    if (e.code !== 'ENOENT') console.error('Cannot remove promo image:', e.code);
  });
}
