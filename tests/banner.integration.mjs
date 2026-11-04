import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { prisma } from '../src/config/prisma.js';
import { createAccessToken } from '../src/services/token.service.js';

const base = process.env.BANNER_TEST_API || `http://localhost:${process.env.PORT || 5000}/api`;
const marker = `banner-test-${randomUUID()}`;
const users = [];
const ids = new Set();
let originalOrders = [];
let adminToken;
const originalSideStates = await prisma.banner.findMany({ where: { group: 'SIDE' }, select: { id: true, isActive: true } });
const png = await sharp({ create: { width: 800, height: 350, channels: 3, background: '#f97316' } }).png().toBuffer();
const fields = { name: marker, group: 'MAIN', position: 'MAIN_HERO', mediaType: 'IMAGE', targetUrl: '/customer/products?category=laptop', altText: 'Banner kiểm thử', sortOrder: 999998, autoplayInterval: 1000, isActive: true };

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const response = await fetch(`${base}${path}`, { method, headers, body });
  return { status: response.status, data: await response.json() };
}
function form(values = {}, bytes = png, filename = 'banner.png', type = 'image/png') {
  const body = new FormData();
  for (const [key, value] of Object.entries({ ...fields, ...values })) body.set(key, String(value));
  if (bytes) body.set('media', new Blob([bytes], { type }), filename);
  return body;
}
async function create(values = {}, bytes = png, filename, type) {
  const result = await request('/admin/banners', { method: 'POST', body: form(values, bytes, filename, type) });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  ids.add(result.data.banner.id);
  return result.data.banner;
}

try {
  for (const [role, isActive] of [['ADMIN', true], ['USER', true], ['ADMIN', false]]) {
    const user = await prisma.user.create({ data: { fullName: marker, email: `${marker}-${users.length}@example.com`, phone: `${marker}-${users.length}`, passwordHash: 'unused-test-password', role, isActive } });
    users.push(user);
  }
  adminToken = createAccessToken(users[0]);
  const userToken = createAccessToken(users[1]);
  const disabledToken = createAccessToken(users[2]);
  assert.equal((await request('/admin/banners', { token: null })).status, 401);
  assert.equal((await request('/admin/banners', { token: userToken })).status, 403);
  assert.equal((await request('/admin/banners', { token: disabledToken })).status, 403);
  assert.equal((await request('/admin/banners', { token: createAccessToken({ ...users[1], role: 'ADMIN' }) })).status, 403);
  assert.equal((await request('/banners', { token: null })).status, 401);
  for (const [method, path, body] of [
    ['POST', '/admin/banners', form()], ['PUT', '/admin/banners/1', form()],
    ['DELETE', '/admin/banners/1'], ['PATCH', '/admin/banners/1/status', { isActive: false }],
    ['PATCH', '/admin/banners/reorder', { position: 'MAIN_HERO', ids: [] }],
  ]) assert.equal((await request(path, { method, body, token: userToken })).status, 403, `${method} ${path}`);
  console.log('PASS API: authentication, inactive accounts, forged role, all write permissions');

  assert.equal((await request('/admin/banners', { method: 'POST', body: form({ group: 'SIDE' }) })).status, 400);
  assert.equal((await request('/admin/banners', { method: 'POST', body: form({ group: 'SIDE', position: 'SIDE_LEFT', mediaType: 'VIDEO' }) })).status, 400);
  assert.equal((await request('/admin/banners', { method: 'POST', body: form({ targetUrl: 'javascript:alert(1)' }) })).status, 400);
  assert.equal((await request('/admin/banners', { method: 'POST', body: form({ targetUrl: '//evil.example' }) })).status, 400);
  assert.equal((await request('/admin/banners', { method: 'POST', body: form({}, Buffer.from('<script>bad</script>')) })).status, 400);
  assert.equal((await request('/admin/banners', { method: 'POST', body: form({}, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) })).status, 400);
  for (const [filename, type] of [['document.pdf', 'application/pdf'], ['text.txt', 'text/plain']]) {
    const rejected = await request('/admin/banners', { method: 'POST', body: form({}, png, filename, type) });
    assert.equal(rejected.status, 400);
    assert.match(rejected.data.message, /Định dạng/);
  }
  const oversized = await request('/admin/banners', { method: 'POST', body: form({}, Buffer.alloc(10 * 1024 * 1024 + 1)) });
  assert.equal(oversized.status, 400);
  assert.equal(oversized.data.message, 'Ảnh tối đa 10 MB.');
  const empty = await request('/admin/banners', { method: 'POST', body: form({}, Buffer.alloc(0)) });
  assert.equal(empty.status, 400);
  assert.match(empty.data.message, /rỗng/);
  const wrongField = form();
  wrongField.set('file', wrongField.get('media'));
  wrongField.delete('media');
  assert.equal((await request('/admin/banners', { method: 'POST', body: wrongField })).status, 400);
  // A valid MIME plus matching decoded bytes is sufficient, regardless of filename.
  for (const filename of ['a9f837c1', 'renamed.jpg', 'renamed.js']) {
    const renamed = await create({ name: marker + '-renamed', isActive: false }, png, filename, 'image/png');
    assert.match(renamed.mediaUrl, /\.webp$/);
  }
  assert.equal((await request('/admin/banners', { method: 'POST', body: form({ autoplayInterval: 0 }) })).status, 400);
  console.log('PASS API: position/group/media/link/MIME/signature/size/interval validation');

  for (const [format, mime] of [['jpeg', 'image/jpeg'], ['webp', 'image/webp']]) {
    const bytes = await sharp(png)[format]().toBuffer();
    await create({ name: marker + '-' + format, isActive: false }, bytes, `banner.${format}`, mime);
  }

  const a = await create();
  const b = await create({ name: marker + '-second', sortOrder: 999999 });
  const side = await create({ name: marker + '-side', group: 'SIDE', position: 'SIDE_RIGHT_TOP' });
  assert.equal((await request(`/banners/${a.id}`)).data.banner.name, marker);
  const served = await fetch(new URL(a.mediaUrl, base));
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/webp');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await sharp(Buffer.from(await served.arrayBuffer())).metadata()).width, 800);
  let home = (await request('/banners/home', { token: null })).data;
  assert.ok(home.mainHero.some(item => item.id === a.id));
  assert.ok(home.mainHero.findIndex(item => item.id === a.id) < home.mainHero.findIndex(item => item.id === b.id));
  assert.ok(!('mediaKey' in home.mainHero[0]));
  await request(`/admin/banners/${a.id}/status`, { method: 'PATCH', body: { isActive: false } });
  home = (await request('/banners/home', { token: null })).data;
  assert.ok(!home.mainHero.some(item => item.id === a.id));
  await request(`/admin/banners/${a.id}/status`, { method: 'PATCH', body: { isActive: true } });
  originalOrders = await prisma.banner.findMany({ where: { position: 'MAIN_HERO' }, select: { id: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  assert.equal((await request('/admin/banners/reorder', { method: 'PATCH', body: { position: 'MAIN_HERO', ids: [a.id, a.id] } })).status, 400);
  assert.equal((await request('/admin/banners/reorder', { method: 'PATCH', body: { position: 'MAIN_HERO', ids: [side.id] } })).status, 409);
  const reordered = [b.id, a.id, ...originalOrders.map(item => item.id).filter(id => id !== a.id && id !== b.id)];
  assert.equal((await request('/admin/banners/reorder', { method: 'PATCH', body: { position: 'MAIN_HERO', ids: reordered } })).status, 200);
  home = (await request('/banners/home', { token: null })).data;
  assert.equal(home.mainHero[0].id, b.id);
  const edit = await request(`/admin/banners/${a.id}`, { method: 'PUT', body: form({ name: marker + '-updated' }, null) });
  assert.equal(edit.status, 200); assert.equal(edit.data.banner.mediaUrl, a.mediaUrl);
  const replacement = await request(`/admin/banners/${a.id}`, { method: 'PUT', body: form({ name: marker + '-replacement' }) });
  assert.equal(replacement.status, 200); assert.notEqual(replacement.data.banner.mediaUrl, a.mediaUrl);
  assert.equal((await fetch(new URL(a.mediaUrl, base))).status, 404);
  assert.equal((await request(`/admin/banners/${a.id}`, { method: 'DELETE' })).status, 200); ids.delete(a.id);
  assert.equal((await fetch(new URL(replacement.data.banner.mediaUrl, base))).status, 404);
  assert.equal((await request(`/admin/banners/${a.id}`)).status, 404);
  assert.equal((await request(`/admin/banners/${a.id}/status`, { method: 'PATCH', body: { isActive: false } })).status, 404);
  console.log('PASS API: persisted CRUD, media serving/replacement/cleanup, active filtering, ordering, atomic reorder');

  assert.equal((await request('/admin/banners', { method: 'POST', body: form({ position: 'AUTO' }) })).status, 400, 'MAIN cannot use AUTO');
  const autoOrder = ['BOTTOM_LEFT', 'BOTTOM_RIGHT', 'SIDE_RIGHT_TOP', 'SIDE_RIGHT_MIDDLE', 'SIDE_RIGHT_BOTTOM', 'SIDE_LEFT'];
  const beforeAuto = await prisma.banner.findMany({ where: { group: 'SIDE', isActive: true }, select: { id: true, position: true } });
  const available = autoOrder.filter(position => !beforeAuto.some(item => item.position === position));
  const automatic = [];
  for (const position of available) {
    const banner = await create({ group: 'SIDE', position: 'AUTO', name: marker + '-auto-' + position });
    assert.equal(banner.position, position);
    assert.equal(banner.isAutoPlaced, true);
    automatic.push(banner);
  }
  if (automatic.length) {
    const original = automatic[0];
    const edit = await request(`/admin/banners/${original.id}`, { method: 'PUT', body: form({ group: 'SIDE', position: 'AUTO', name: marker + '-auto-edited' }, null) });
    assert.equal(edit.status, 200);
    assert.equal(edit.data.banner.position, original.position, 'AUTO edit keeps its available current slot');
  }
  const fullState = await prisma.banner.findMany({ where: { group: 'SIDE', isActive: true }, select: { id: true, position: true }, orderBy: { id: 'asc' } });
  assert.equal(new Set(fullState.map(item => item.position)).size, 6);
  assert.equal((await request('/admin/banners', { method: 'POST', body: form({ group: 'SIDE', position: 'AUTO' }) })).status, 409);
  assert.deepEqual(await prisma.banner.findMany({ where: { group: 'SIDE', isActive: true }, select: { id: true, position: true }, orderBy: { id: 'asc' } }), fullState, 'Full AUTO must not deactivate existing media');
  for (const existing of beforeAuto) assert.ok(fullState.some(item => item.id === existing.id));
  if (automatic.length >= 2) {
    for (const banner of automatic.slice(-2)) {
      assert.equal((await request(`/admin/banners/${banner.id}`, { method: 'DELETE' })).status, 200);
      ids.delete(banner.id);
    }
    const concurrent = await Promise.all([create({ group: 'SIDE', position: 'AUTO', name: marker + '-concurrent-a' }), create({ group: 'SIDE', position: 'AUTO', name: marker + '-concurrent-b' })]);
    assert.notEqual(concurrent[0].position, concurrent[1].position, 'Concurrent AUTO uploads get distinct slots');
    assert.equal(new Set((await prisma.banner.findMany({ where: { group: 'SIDE', isActive: true }, select: { position: true } })).map(item => item.position)).size, 6);
  }
  console.log('PASS API: AUTO fills free slots, preserves existing Active media, retains edited slot, rejects full slots and handles concurrent uploads');

  const ownAuto = await prisma.banner.findMany({ where: { name: { startsWith: marker }, isAutoPlaced: true } });
  if (ownAuto.length) {
    const automatic = ownAuto[0];
    assert.equal((await request('/admin/banners', { method: 'POST', body: form({ group: 'SIDE', position: automatic.position }) })).status, 409, 'Manual media cannot join an automatic slot');
    const inactive = await create({ group: 'SIDE', position: automatic.position, isActive: false, name: marker + '-inactive-reserved' });
    assert.equal((await request(`/admin/banners/${inactive.id}/status`, { method: 'PATCH', body: { isActive: true } })).status, 409, 'Toggle cannot join an automatic slot');
    assert.equal((await request('/banners/home', { token: null })).data.sideSlides[automatic.position].length, 1);
  }
  for (const automatic of ownAuto) {
    const result = await request(`/admin/banners/${automatic.id}`, { method: 'PUT', body: form({ group: 'SIDE', position: automatic.position, name: automatic.name }, null) });
    assert.equal(result.status, 200);
    assert.equal(result.data.banner.isAutoPlaced, false, 'Explicit position converts AUTO to slider-capable placement');
  }
  console.log('PASS API: AUTO remains static/exclusive; manual save and toggle cannot merge into AUTO; explicit edit enables slider');

  if (process.env.BANNER_TEST_VIDEO) {
    const bytes = await readFile(process.env.BANNER_TEST_VIDEO);
    const video = await create({ mediaType: 'VIDEO', position: 'MAIN_HERO', name: marker + '-video' }, bytes, 'banner.webm', 'video/webm');
    const response = await fetch(new URL(video.mediaUrl, base), { headers: { Range: 'bytes=0-99' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-type'), 'video/webm');
    assert.ok((await request('/banners/home', { token: null })).data.mainHero.some(item => item.id === video.id));
    const keys = { SIDE_LEFT: 'sideLeft', SIDE_RIGHT_TOP: 'sideRightTop', SIDE_RIGHT_MIDDLE: 'sideRightMiddle', SIDE_RIGHT_BOTTOM: 'sideRightBottom', BOTTOM_LEFT: 'bottomLeft', BOTTOM_RIGHT: 'bottomRight' };
    for (const [position, key] of Object.entries(keys)) {
      const sideVideo = await create({ group: 'SIDE', mediaType: 'VIDEO', position, name: marker + '-' + position }, bytes, 'side.webm', 'video/webm');
      assert.ok((await request('/banners/home', { token: null })).data.sideSlides[position].some(item => item.id === sideVideo.id));
      const replacement = await create({ group: 'SIDE', position, name: marker + '-replacement-' + position });
      assert.equal((await request(`/banners/${sideVideo.id}`)).data.banner.isActive, true);
      await request(`/admin/banners/${sideVideo.id}/status`, { method: 'PATCH', body: { isActive: true } });
      assert.equal((await request(`/banners/${replacement.id}`)).data.banner.isActive, true);
      const slides = (await request('/banners/home', { token: null })).data.sideSlides[position];
      assert.ok(slides.some(item => item.id === sideVideo.id && item.mediaType === 'VIDEO'));
      assert.ok(slides.some(item => item.id === replacement.id && item.mediaType === 'IMAGE'));
      assert.ok(!('mediaKey' in slides[0]));
      assert.ok(await prisma.banner.count({ where: { position, isActive: true } }) >= 2);
      await request(`/admin/banners/${replacement.id}/status`, { method: 'PATCH', body: { isActive: false } });
      const filtered = (await request('/banners/home', { token: null })).data.sideSlides[position];
      assert.ok(!filtered.some(item => item.id === replacement.id));
      assert.ok(filtered.some(item => item.id === sideVideo.id));
    }
    console.log('PASS API: multiple Active image/video media in every side slot; independent toggle and full slide payload');
    console.log('PASS API: real WebM upload, persistence, public video, byte ranges');
  }
} finally {
  if (adminToken) for (const id of ids) await request(`/admin/banners/${id}`, { method: 'DELETE' }).catch(() => {});
  for (const item of originalOrders) if (!ids.has(item.id)) await prisma.banner.updateMany({ where: { id: item.id }, data: { sortOrder: item.sortOrder } });
  for (const item of originalSideStates) await prisma.banner.updateMany({ where: { id: item.id }, data: { isActive: item.isActive } });
  await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  await prisma.$disconnect();
}
