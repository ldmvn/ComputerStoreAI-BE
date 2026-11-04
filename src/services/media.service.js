import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink } from 'node:fs/promises';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';
import { bannerError } from '../validators/banner.validator.js';

const backendRoot = fileURLToPath(new URL('../../', import.meta.url));
export const mediaDirectory = path.resolve(process.env.MEDIA_STORAGE_DIR || path.join(backendRoot, 'uploads'));
export const bannerMediaDirectory = path.join(mediaDirectory, 'banners');
const tempDirectory = path.join(mediaDirectory, '.temporary');
export const IMAGE_LIMIT = 10 * 1024 * 1024;
export const VIDEO_LIMIT = 50 * 1024 * 1024;
const imageMimes = ['image/jpeg', 'image/png', 'image/webp'];
const videoMimes = ['video/mp4', 'video/webm'];

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => mkdir(tempDirectory, { recursive: true }).then(() => callback(null, tempDirectory), callback),
    filename: (_req, _file, callback) => callback(null, randomUUID()),
  }),
  limits: { fileSize: VIDEO_LIMIT, files: 1, fields: 12, fieldSize: 4096, parts: 14 },
  fileFilter: (_req, file, callback) => {
    // Client filenames are not a format signal. Content signatures and image
    // decoding are verified again by saveBannerMedia before anything is stored.
    if (![...imageMimes, ...videoMimes].includes(file.mimetype)) return callback(bannerError('Định dạng không được hỗ trợ. Chỉ chấp nhận MIME của JPG, PNG, WEBP, MP4 hoặc WEBM.'));
    callback(null, true);
  },
}).single('media');

export function uploadBannerMedia(req, res, next) {
  upload(req, res, error => {
    if (!error) return next();
    next(bannerError(error.code === 'LIMIT_FILE_SIZE' ? 'Media vượt quá giới hạn 50 MB.' : error.statusCode ? error.message : 'Upload không hợp lệ. Chỉ chọn một file media.'));
  });
}

export async function discardTemporary(file) {
  if (file?.path) await unlink(file.path).catch(() => {});
}

// Storage boundary: replace these save/remove implementations for S3/R2/Cloudinary.
export async function saveBannerMedia(file, mediaType) {
  if (!file) throw bannerError('Vui lòng chọn ảnh hoặc video cho banner.');
  if (!file.size) throw bannerError('File media rỗng. Vui lòng chọn file khác.');
  const allowed = mediaType === 'IMAGE' ? imageMimes : videoMimes;
  if (!allowed.includes(file.mimetype)) throw bannerError('File không đúng loại media đã chọn.');
  if (file.size > (mediaType === 'IMAGE' ? IMAGE_LIMIT : VIDEO_LIMIT)) throw bannerError(mediaType === 'IMAGE' ? 'Ảnh tối đa 10 MB.' : 'Video tối đa 50 MB.');
  let detected;
  try { detected = await fileTypeFromFile(file.path); }
  catch { throw bannerError('File hỏng hoặc không đọc được định dạng media.'); }
  if (!detected || detected.mime !== file.mimetype) throw bannerError('Nội dung file không khớp định dạng/MIME khai báo.');
  await mkdir(bannerMediaDirectory, { recursive: true });
  // Decode and re-encode images to reject corrupt content and strip metadata/payloads.
  const key = `${randomUUID()}.${mediaType === 'IMAGE' ? 'webp' : detected.ext}`;
  const destination = path.join(bannerMediaDirectory, key);
  try {
    if (mediaType === 'IMAGE') {
      try {
        await sharp(file.path, { limitInputPixels: 40000000, failOn: 'error' }).rotate().webp({ quality: 90 }).toFile(destination);
      } catch { throw bannerError('Ảnh không hợp lệ hoặc vượt giới hạn 40 triệu pixel.'); }
    } else {
      await rename(file.path, destination);
    }
    const base = (process.env.MEDIA_PUBLIC_URL || '/media').replace(/\/$/, '');
    return { mediaKey: key, mediaUrl: `${base}/banners/${key}` };
  } catch (error) {
    await removeBannerMedia(key);
    throw error;
  }
}

export async function removeBannerMedia(key) {
  if (!/^[a-f0-9-]+\.(webp|mp4|webm)$/.test(key || '')) return;
  await unlink(path.join(bannerMediaDirectory, key)).catch(error => {
    if (error.code !== 'ENOENT') console.error('Cannot remove banner media:', error.code);
  });
}
