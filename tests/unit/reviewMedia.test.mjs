import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'review-media-'));
process.env.MEDIA_STORAGE_DIR = storageRoot;
const { removeReviewImage, saveReviewImages } = await import('../../src/services/reviewMedia.service.js');

test.after(async () => rm(storageRoot, { recursive: true, force: true }));

test('stores review images under the authenticated user directory', async () => {
  const temporaryFile = path.join(storageRoot, 'upload');
  await writeFile(temporaryFile, await sharp({ create: { width: 2, height: 2, channels: 3, background: '#f97316' } }).png().toBuffer());
  const [saved] = await saveReviewImages([{ path: temporaryFile, mimetype: 'image/png', originalname: 'review.png' }], 12);

  assert.match(saved.storageKey, /^user-12\/[0-9a-f-]+\.webp$/);
  assert.match(saved.imageUrl, /^\/media\/reviews\/user-12\/[0-9a-f-]+\.webp$/);
  assert.ok((await readFile(path.join(storageRoot, 'reviews', ...saved.storageKey.split('/')))).length > 0);

  await removeReviewImage(saved.imageUrl);
  await assert.rejects(readFile(path.join(storageRoot, 'reviews', ...saved.storageKey.split('/'))), { code: 'ENOENT' });
});

test('rejects a missing or untrusted user id before creating a directory', async () => {
  await assert.rejects(saveReviewImages([], '../products'), { statusCode: 401 });
});
