import { readFile, stat, unlink } from 'node:fs/promises';
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Lớp lưu trữ ảnh dùng chung. STORAGE_DRIVER=r2 (và đủ biến R2_*) thì ảnh mới được đẩy lên Cloudflare R2
// rồi xóa bản tạm trên đĩa; mặc định (local) giữ nguyên hành vi cũ: ảnh nằm trong thư mục uploads/.
// Key trên R2 trùng đường dẫn tương đối trong uploads/ (ví dụ products/<uuid>.webp) để dễ đối chiếu và chuyển ảnh cũ.

const REQUIRED = ['R2_ENDPOINT', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BASE_URL'];
const CONTENT_TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4', webm: 'video/webm', ico: 'image/x-icon', svg: 'image/svg+xml' };

let client;

export function isR2Enabled() {
  return (process.env.STORAGE_DRIVER || 'local').toLowerCase() === 'r2' && REQUIRED.every(name => process.env[name]);
}

export function assertR2Configured() {
  const missing = REQUIRED.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Thiếu biến môi trường R2: ${missing.join(', ')}`);
}

function s3() {
  assertR2Configured();
  client ??= new S3Client({
    region: process.env.R2_REGION || 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  return client;
}

export const r2PublicBase = () => (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
export const contentTypeFor = key => CONTENT_TYPES[String(key).split('.').pop().toLowerCase()] || 'application/octet-stream';

// Địa chỉ công khai của một key: tên miền R2 khi bật R2, ngược lại theo MEDIA_PUBLIC_URL (mặc định /media).
export function publicUrlFor(key) {
  const base = isR2Enabled() ? r2PublicBase() : (process.env.MEDIA_PUBLIC_URL || '/media').replace(/\/$/, '');
  return `${base}/${key}`;
}

export async function putObject(key, body, contentType = contentTypeFor(key)) {
  await s3().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
    // Tên file là UUID nên nội dung không bao giờ đổi: cho trình duyệt/CDN lưu đệm lâu dài.
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

export async function objectExists(key) {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NotFound') return false;
    throw error;
  }
}

export async function deleteObject(key) {
  await s3().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
}

/**
 * Sau khi đã ghi file xử lý xong ở `localPath`: nếu bật R2 thì đẩy lên R2 rồi xóa bản trên đĩa,
 * trả về địa chỉ công khai. Nếu tắt R2 thì giữ file tại chỗ như cũ.
 */
export async function publishFile(localPath, key) {
  if (isR2Enabled()) {
    const size = (await stat(localPath)).size;
    if (!size) throw new Error('File ảnh rỗng, không thể đẩy lên R2.');
    await putObject(key, await readFile(localPath));
    await unlink(localPath).catch(() => {});
  }
  return publicUrlFor(key);
}

/** Xóa bản trên R2 khi bật R2 (lỗi mạng chỉ ghi log để không chặn thao tác xóa trong DB). */
export async function removePublished(key) {
  if (!isR2Enabled() || !key) return;
  try {
    await deleteObject(key);
  } catch (error) {
    console.error('Cannot remove R2 object:', key, error.name || error.code);
  }
}
