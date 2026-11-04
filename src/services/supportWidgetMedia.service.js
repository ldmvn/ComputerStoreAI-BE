import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';

// sharp/libvips keeps an internal operation cache that mmaps/retains a handle
// on the source file passed to sharp(path). On Windows this makes an
// unlink() of that path fail with EBUSY even after .toFile() has resolved —
// reproduced locally: unlink still failed after 10 retries at 60ms with the
// cache on, and succeeded immediately every time with it off. The cache only
// helps when the same input is re-read, which never happens for a one-shot
// upload, so disabling it is free. This is a process-wide libvips setting
// (sharp has no per-call option), so it also prevents the identical leak in
// every sibling *Media.service.js in this backend, not just this one.
sharp.cache(false);

const backendRoot = fileURLToPath(new URL('../../', import.meta.url));
const mediaRoot = path.resolve(process.env.MEDIA_STORAGE_DIR || path.join(backendRoot, 'uploads'));
export const supportWidgetMediaDirectory = path.join(mediaRoot, 'support-widget');
const tempDirectory = path.join(mediaRoot, '.temporary-support-widget');

// Channel → setting key the uploaded file replaces. Whitelisted so the
// upload route can never be used to write an arbitrary StoreSetting key.
export const WIDGET_MEDIA_CHANNELS = {
  ai: 'widget.ai.avatarUrl',
  'ai-toggle': 'widget.ai.toggleAvatarUrl',
  zalo: 'widget.zalo.logoUrl',
  messenger: 'widget.messenger.logoUrl',
  telegram: 'widget.telegram.logoUrl',
};

const allowed = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] };

function widgetMediaError(msg) {
  const e = new Error(msg);
  e.statusCode = 400;
  return e;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => mkdir(tempDirectory, { recursive: true }).then(() => cb(null, tempDirectory), cb),
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 5, parts: 7 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed[file.mimetype]?.includes(ext)) return cb(null, true);
    cb(widgetMediaError('Chỉ chấp nhận JPG, PNG hoặc WebP với MIME đúng.'));
  },
}).single('image');

export function uploadWidgetMediaMiddleware(req, res, next) {
  upload(req, res, e => {
    if (!e) return next();
    next(widgetMediaError(e.code === 'LIMIT_FILE_SIZE' ? 'Ảnh tối đa 2 MB.' : e.statusCode ? e.message : 'Upload ảnh không hợp lệ.'));
  });
}

export async function saveWidgetMedia(file, channel) {
  if (!file) throw widgetMediaError('Vui lòng chọn file ảnh.');
  if (!WIDGET_MEDIA_CHANNELS[channel]) throw widgetMediaError('Kênh không được hỗ trợ.');
  const detected = await fileTypeFromFile(file.path).catch(() => null);
  if (!detected || !allowed[detected.mime]) throw widgetMediaError('Nội dung ảnh không khớp định dạng được hỗ trợ (JPG, PNG, WebP).');
  await mkdir(supportWidgetMediaDirectory, { recursive: true });
  const key = `${channel}-${randomUUID()}.webp`;
  const dest = path.join(supportWidgetMediaDirectory, key);
  try {
    await sharp(file.path, { limitInputPixels: 20_000_000, failOn: 'error' })
      .rotate()
      .resize({ width: 512, height: 512, fit: 'cover' })
      .webp({ quality: 88 })
      .toFile(dest);
  } catch {
    await removeWidgetMedia(key);
    throw widgetMediaError('Ảnh không hợp lệ hoặc vượt giới hạn 20 triệu pixel.');
  }
  const base = (process.env.MEDIA_PUBLIC_URL || '/media').replace(/\/$/, '');
  return { key, url: `${base}/support-widget/${key}` };
}

export async function discardWidgetMediaTemp(file) {
  if (!file?.path) return;
  await unlink(file.path).catch(e => {
    if (e.code !== 'ENOENT') console.error('Cannot remove temp widget media:', e.code);
  });
}

export async function removeWidgetMedia(key) {
  if (!key || !/^(ai|ai-toggle|zalo|messenger|telegram)-[a-f0-9-]+\.webp$/.test(key)) return;
  await unlink(path.join(supportWidgetMediaDirectory, key)).catch(e => {
    if (e.code !== 'ENOENT') console.error('Cannot remove support-widget media:', e.code);
  });
}

export function keyFromWidgetMediaUrl(url) {
  const match = typeof url === 'string' ? url.match(/\/support-widget\/((ai|ai-toggle|zalo|messenger|telegram)-[a-f0-9-]+\.webp)$/) : null;
  return match?.[1] ?? null;
}
