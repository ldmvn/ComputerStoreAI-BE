// Controlled integration test for the Floating Support Widget settings API.
// Mutates the *real* shared StoreSetting rows (widget.*/social.*) the same
// way the Dashboard does over HTTP — there is no per-test tenant for a
// singleton key/value table — so it snapshots every row it might touch
// before running and restores them byte-for-byte in `finally`, regardless
// of pass/fail. Temp users created for auth are deleted at the end too.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { prisma } from '../src/config/prisma.js';
import { createAccessToken } from '../src/services/token.service.js';
import { supportWidgetMediaDirectory } from '../src/services/supportWidgetMedia.service.js';

const base = process.env.SUPPORT_WIDGET_TEST_API || `http://localhost:${process.env.PORT || 5000}/api`;
const marker = `widget-test-${randomUUID().slice(0, 8)}`;

const TOUCHED_PREFIXES = ['widget.', 'social.'];
let snapshot = [];
let adminId;
let customerId;
let adminToken;
let customerToken;
let tmpDir;

async function request(path, { method = 'GET', body, token, isForm = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function makePngFile(name, { width = 64, height = 64 } = {}) {
  const filePath = path.join(tmpDir, name);
  await sharp({ create: { width, height, channels: 4, background: { r: 200, g: 60, b: 20, alpha: 1 } } }).png().toFile(filePath);
  return filePath;
}

async function uploadForm(fieldValue, filename, mime) {
  const form = new FormData();
  form.append('image', new Blob([fieldValue], { type: mime }), filename);
  return form;
}

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok  — ${label}`); }
  catch (e) { failures++; console.error(`  FAIL — ${label}\n        ${e.message}`); }
}

try {
  // ── Setup: snapshot existing rows, create temp admin + customer ────────────
  snapshot = await prisma.storeSetting.findMany({
    where: { OR: TOUCHED_PREFIXES.map(p => ({ key: { startsWith: p } })) },
  });

  const admin = await prisma.user.create({ data: {
    fullName: marker, email: `${marker}-admin@example.com`,
    phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`,
    passwordHash: 'support-widget-integration-test', role: 'ADMIN', isActive: true,
  } });
  adminId = admin.id;
  adminToken = createAccessToken(admin);

  const customer = await prisma.user.create({ data: {
    fullName: marker, email: `${marker}-customer@example.com`,
    phone: `9${randomUUID().replace(/\D/g, '').slice(0, 10)}`,
    passwordHash: 'support-widget-integration-test', role: 'CUSTOMER', isActive: true,
  } });
  customerId = customer.id;
  customerToken = createAccessToken(customer);

  tmpDir = await mkdtemp(path.join(tmpdir(), 'widget-media-test-'));

  console.log('\n[RBAC]');
  {
    const anon = await request('/admin/settings', { method: 'PUT', body: { 'widget.order': 'ai,zalo,messenger,telegram' } });
    check('unauthenticated PUT is rejected (401)', () => assert.equal(anon.status, 401));

    const forbidden = await request('/admin/settings', { method: 'PUT', token: customerToken, body: { 'widget.order': 'ai,zalo,messenger,telegram' } });
    check('customer without settings:manage is rejected (403)', () => assert.equal(forbidden.status, 403));

    const anonUpload = await request('/admin/settings/widget-media/zalo', { method: 'POST' });
    check('unauthenticated media upload is rejected (401)', () => assert.equal(anonUpload.status, 401));
  }

  console.log('\n[widget.order — this was the reported bug]');
  {
    // The exact payload the Save button sent before the fix: every other key
    // present, 'widget.order' empty because the admin never touched the
    // reorder buttons. Must now be rejected clearly, not silently accepted.
    const emptyOrder = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.order': '' } });
    check('empty order string is rejected (400) — the pre-fix Save payload', () => {
      assert.equal(emptyOrder.status, 400);
      assert.match(emptyOrder.data.message, /đúng 4 kênh/);
    });

    const def = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.order': 'ai,zalo,messenger,telegram' } });
    check('default order saves (200)', () => assert.equal(def.status, 200));

    const moveAi = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.order': 'zalo,ai,messenger,telegram' } });
    check('Chatbot AI moved to 2nd position saves (200)', () => assert.equal(moveAi.status, 200));

    const moveZalo = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.order': 'ai,messenger,zalo,telegram' } });
    check('Zalo moved to 3rd position saves (200)', () => assert.equal(moveZalo.status, 200));

    const reversed = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.order': 'telegram,messenger,zalo,ai' } });
    check('fully reversed order saves (200)', () => assert.equal(reversed.status, 200));

    const missing = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.order': 'ai,zalo,messenger' } });
    check('missing id is rejected (400)', () => assert.equal(missing.status, 400));

    const duplicate = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.order': 'ai,ai,zalo,messenger' } });
    check('duplicate id is rejected (400)', () => assert.equal(duplicate.status, 400));

    const invalidId = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.order': 'ai,zalo,messenger,discord' } });
    check('unknown id is rejected (400)', () => assert.equal(invalidId.status, 400));

    const wrongType = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.order': 12345 } });
    check('non-string value is rejected (400)', () => assert.equal(wrongType.status, 400));

    const jsonString = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.order': JSON.stringify(['ai', 'zalo', 'messenger', 'telegram']) } });
    check('JSON-array string (not the comma contract) is rejected (400)', () => assert.equal(jsonString.status, 400));

    // Save the reversed order, then re-fetch — the exact "reload" scenario.
    await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.order': 'telegram,messenger,zalo,ai' } });
    const reread = await request('/admin/settings', { token: adminToken });
    check('order persists across reload (admin GET)', () => assert.equal(reread.data.data['widget.order'], 'telegram,messenger,zalo,ai'));

    const pub = await request('/content/store-info');
    check('order is reflected on the public Storefront endpoint', () => assert.equal(pub.data.data['widget.order'], 'telegram,messenger,zalo,ai'));
  }

  console.log('\n[Popup title/description]');
  {
    const ok = await request('/admin/settings', { method: 'PUT', token: adminToken, body: {
      'widget.popup.title': 'Hỗ trợ khách hàng', 'widget.popup.description': 'Luôn sẵn sàng phục vụ bạn 24/7',
    } });
    check('Vietnamese diacritics save without mangling (200)', () => assert.equal(ok.status, 200));

    const reread = await request('/content/store-info');
    check('title/description round-trip exactly, no truncation', () => {
      assert.equal(reread.data.data['widget.popup.title'], 'Hỗ trợ khách hàng');
      assert.equal(reread.data.data['widget.popup.description'], 'Luôn sẵn sàng phục vụ bạn 24/7');
    });

    const tooLong = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.popup.title': 'x'.repeat(61) } });
    check('title over 60 chars is rejected (400)', () => assert.equal(tooLong.status, 400));

    const xss = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.popup.description': '<img src=x onerror=alert(1)>' } });
    check('markup in description is rejected (400)', () => assert.equal(xss.status, 400));

    // A rejected field must not silently drop the other valid fields in the same payload.
    const mixed = await request('/admin/settings', { method: 'PUT', token: adminToken, body: {
      'widget.popup.title': 'Tiêu đề hợp lệ',
      'widget.order': 'bad',
    } });
    check('invalid order in a mixed payload rejects the whole request (no partial write)', () => assert.equal(mixed.status, 400));
    const afterMixed = await request('/content/store-info');
    check('the valid field from the rejected mixed payload was NOT written', () => assert.notEqual(afterMixed.data.data['widget.popup.title'], 'Tiêu đề hợp lệ'));
  }

  console.log('\n[Channel enable/disable — ai vs social.* key split]');
  {
    const off = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.ai.enabled': 'false' } });
    check('widget.ai.enabled=false saves (200)', () => assert.equal(off.status, 200));
    let pub = await request('/content/store-info');
    check('widget.ai.enabled reflected on public endpoint', () => assert.equal(pub.data.data['widget.ai.enabled'], 'false'));

    const badBool = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.ai.enabled': 'maybe' } });
    check("enabled rejects non 'true'/'false' values (400)", () => assert.equal(badBool.status, 400));

    const zaloOff = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'social.zalo.enabled': 'false' } });
    check('Zalo keeps using the pre-existing social.zalo.enabled key (200)', () => assert.equal(zaloOff.status, 200));

    const backOn = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.ai.enabled': 'true', 'social.zalo.enabled': 'true' } });
    check('re-enabling both channels saves (200)', () => assert.equal(backOn.status, 200));
  }

  console.log('\n[widget.ai.enabled — full Save-payload regression]');
  {
    // Mirrors exactly what the Dashboard's buildWidgetSavePayload() now sends:
    // every widget.*/social.*.enabled key always present and normalized to a
    // literal 'true'/'false', regardless of which field the admin actually
    // touched. This is the real end-to-end shape, not just the single key.
    const fullPayload = (overrides = {}) => ({
      'widget.popup.title': 'Liên hệ hỗ trợ', 'widget.popup.description': 'Chúng tôi luôn sẵn sàng 24/7',
      'widget.order': 'ai,zalo,messenger,telegram',
      'widget.ai.name': 'Chatbot AI', 'widget.ai.description': 'Hỏi đáp nhanh 24/7', 'widget.ai.enabled': 'true',
      'widget.zalo.name': 'Zalo', 'widget.zalo.description': 'Tư vấn trực tiếp', 'social.zalo.enabled': 'true', 'social.zalo.url': '',
      'widget.messenger.name': 'Messenger', 'widget.messenger.description': 'Chat với nhân viên', 'social.messenger.enabled': 'true', 'social.messenger.url': '',
      'widget.telegram.name': 'Telegram', 'widget.telegram.description': 'Nhận hỗ trợ nhanh', 'social.telegram.enabled': 'true', 'social.telegram.url': '',
      ...overrides,
    });

    // 1. First-ever Save, nothing touched — the exact scenario that used to fail.
    const firstSave = await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload() });
    check('1. first Save on a fully untouched form succeeds (200)', () => assert.equal(firstSave.status, 200));

    // 2/3. Chatbot currently on/off, re-saved untouched.
    const onSave = await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload({ 'widget.ai.enabled': 'true' }) });
    check('2. Chatbot AI currently ON, Save keeps it true (200)', () => assert.equal(onSave.status, 200));
    let pub = await request('/content/store-info');
    check('   → public endpoint reflects true', () => assert.equal(pub.data.data['widget.ai.enabled'], 'true'));

    const offSave = await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload({ 'widget.ai.enabled': 'false' }) });
    check('3. Chatbot AI currently OFF, Save keeps it false (200)', () => assert.equal(offSave.status, 200));
    pub = await request('/content/store-info');
    check('   → public endpoint reflects false (not resurrected)', () => assert.equal(pub.data.data['widget.ai.enabled'], 'false'));

    // 4/5. Explicit on→off and off→on transitions.
    const toOff = await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload({ 'widget.ai.enabled': 'false' }) });
    check('4. ON → OFF transition saves (200)', () => assert.equal(toOff.status, 200));
    const toOn = await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload({ 'widget.ai.enabled': 'true' }) });
    check('5. OFF → ON transition saves (200)', () => assert.equal(toOn.status, 200));

    // 6. widget.ai.enabled absent from StoreSetting entirely (simulated by deleting the row), then Save with the normalized default.
    await prisma.storeSetting.deleteMany({ where: { key: 'widget.ai.enabled' } });
    const beforeMissing = await request('/content/store-info');
    check('6a. missing key resolves to no value on the public endpoint (absent, not an error)', () => assert.equal(beforeMissing.data.data['widget.ai.enabled'], undefined));
    const saveAfterMissing = await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload({ 'widget.ai.enabled': 'true' }) });
    check('6b. Save after the key was missing restores it correctly (200)', () => assert.equal(saveAfterMissing.status, 200));

    // 7/8. Previously-saved 'true' / 'false' are both stable round trips.
    await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload({ 'widget.ai.enabled': 'true' }) });
    let reread = await request('/admin/settings', { token: adminToken });
    check("7. previous value 'true' round-trips on reload", () => assert.equal(reread.data.data['widget.ai.enabled'], 'true'));
    await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload({ 'widget.ai.enabled': 'false' }) });
    reread = await request('/admin/settings', { token: adminToken });
    check("8. previous value 'false' round-trips on reload", () => assert.equal(reread.data.data['widget.ai.enabled'], 'false'));

    // 9. Cancel-then-Save: re-saving the last-read value is a no-op (idempotent).
    const lastRead = reread.data.data['widget.ai.enabled'];
    const cancelThenSave = await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload({ 'widget.ai.enabled': lastRead }) });
    check('9. re-saving the value exactly as last read (Cancel → Save) succeeds and is unchanged (200)', () => assert.equal(cancelThenSave.status, 200));
    reread = await request('/admin/settings', { token: adminToken });
    check('   → value unchanged after the no-op save', () => assert.equal(reread.data.data['widget.ai.enabled'], lastRead));

    // 10. Reload Dashboard (fresh GET), then Save — same round trip, from a clean fetch.
    const freshGet = await request('/admin/settings', { token: adminToken });
    const reloadThenSave = await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload({ 'widget.ai.enabled': freshGet.data.data['widget.ai.enabled'] ?? 'true' }) });
    check('10. reload-then-Save round trip succeeds (200)', () => assert.equal(reloadThenSave.status, 200));

    // 11. Reordering channels and toggling Chatbot AI in the very same Save.
    const combined = await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload({ 'widget.order': 'telegram,ai,messenger,zalo', 'widget.ai.enabled': 'false' }) });
    check('11. simultaneous reorder + AI toggle both save correctly (200)', () => assert.equal(combined.status, 200));
    pub = await request('/content/store-info');
    check('   → order and enabled both reflect the combined change', () => {
      assert.equal(pub.data.data['widget.order'], 'telegram,ai,messenger,zalo');
      assert.equal(pub.data.data['widget.ai.enabled'], 'false');
    });

    // 12. An invalid field alongside a valid widget.ai.enabled rejects the whole request — no partial write.
    const invalidMixed = await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload({ 'widget.ai.enabled': 'true', 'widget.order': 'ai,zalo' }) });
    check('12a. invalid widget.order alongside a valid widget.ai.enabled is rejected (400)', () => assert.equal(invalidMixed.status, 400));
    pub = await request('/content/store-info');
    check('12b. the valid widget.ai.enabled from the rejected payload was NOT written', () => assert.notEqual(pub.data.data['widget.ai.enabled'], 'true'));

    // Restore a known-good full state so later blocks aren't affected by this one.
    await request('/admin/settings', { method: 'PUT', token: adminToken, body: fullPayload() });
  }

  console.log('\n[Social URL validation — unchanged allow-list]');
  {
    const valid = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'social.zalo.url': 'https://zalo.me/0386220065?ref=widget' } });
    check('valid Zalo URL with query params saves (200)', () => assert.equal(valid.status, 200));

    const wrongDomain = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'social.zalo.url': 'https://evil.example.com/zalo.me' } });
    check('fake-hostname URL is rejected (400)', () => assert.equal(wrongDomain.status, 400));

    const jsUrl = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'social.messenger.url': 'javascript:alert(1)' } });
    check('javascript: URL is rejected (400)', () => assert.equal(jsUrl.status, 400));

    const noProtocol = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'social.telegram.url': 't.me/ldmahz' } });
    check('URL without protocol is rejected (400) — no implicit normalization', () => assert.equal(noProtocol.status, 400));

    const empty = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'social.telegram.url': '' } });
    check('empty URL is accepted (clears the field) (200)', () => assert.equal(empty.status, 200));

    // Restore a real Telegram URL so later re-enable assertions have something valid.
    await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'social.telegram.url': 'https://t.me/ldmahz' } });
  }

  console.log('\n[widget.*Url — can only be written by the media endpoints]');
  {
    const directWrite = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.zalo.logoUrl': '/media/support-widget/zalo-fake.webp' } });
    check('direct write to a *Url key via update() is rejected (400)', () => assert.equal(directWrite.status, 400));
  }

  console.log('\n[Media upload/replace/restore — isolated per channel]');
  {
    const png = await makePngFile('zalo-logo.png');
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(png);

    const badChannel = await request('/admin/settings/widget-media/discord', { method: 'POST', token: adminToken, isForm: true, body: await uploadForm(buf, 'logo.png', 'image/png') });
    check('unknown channel is rejected (400)', () => assert.equal(badChannel.status, 400));

    const tooBig = Buffer.alloc(2 * 1024 * 1024 + 1024, 1);
    const oversized = await request('/admin/settings/widget-media/zalo', { method: 'POST', token: adminToken, isForm: true, body: await uploadForm(tooBig, 'big.png', 'image/png') });
    check('file over 2MB is rejected (400)', () => assert.equal(oversized.status, 400));

    const fakeMime = await request('/admin/settings/widget-media/zalo', { method: 'POST', token: adminToken, isForm: true, body: await uploadForm(Buffer.from('not actually a png'), 'fake.png', 'image/png') });
    check('content that does not match its declared MIME is rejected (400)', () => assert.equal(fakeMime.status, 400));

    const wrongExt = await request('/admin/settings/widget-media/zalo', { method: 'POST', token: adminToken, isForm: true, body: await uploadForm(buf, 'logo.exe', 'image/png') });
    check('disallowed extension is rejected (400)', () => assert.equal(wrongExt.status, 400));

    const zaloUpload = await request('/admin/settings/widget-media/zalo', { method: 'POST', token: adminToken, isForm: true, body: await uploadForm(buf, 'logo.png', 'image/png') });
    check('valid PNG upload for Zalo succeeds (200) and returns a URL', () => { assert.equal(zaloUpload.status, 200); assert.ok(zaloUpload.data.data.url); });
    const zaloFileKey1 = zaloUpload.data.data.url.split('/').pop();

    const afterZaloUpload = await request('/content/store-info');
    check('only widget.zalo.logoUrl changed — Messenger/Telegram/AI logos untouched', () => {
      assert.equal(afterZaloUpload.data.data['widget.zalo.logoUrl'], zaloUpload.data.data.url.replace(/^https?:\/\/[^/]+/, ''));
      assert.ok(!afterZaloUpload.data.data['widget.messenger.logoUrl']);
      assert.ok(!afterZaloUpload.data.data['widget.telegram.logoUrl']);
      assert.ok(!afterZaloUpload.data.data['widget.ai.avatarUrl']);
    });

    const jpg = await (async () => { const p = path.join(tmpDir, 'zalo2.jpg'); await sharp({ create: { width: 48, height: 48, channels: 3, background: { r: 10, g: 10, b: 200 } } }).jpeg().toFile(p); return fs.readFile(p); })();
    const replaceUpload = await request('/admin/settings/widget-media/zalo', { method: 'POST', token: adminToken, isForm: true, body: await uploadForm(jpg, 'logo2.jpg', 'image/jpeg') });
    check('replacing with a JPG succeeds (200)', () => assert.equal(replaceUpload.status, 200));
    const zaloFileKey2 = replaceUpload.data.data.url.split('/').pop();

    const dirFiles = await readdir(supportWidgetMediaDirectory).catch(() => []);
    check('old Zalo logo file was deleted from disk when replaced', () => assert.ok(!dirFiles.includes(zaloFileKey1)));
    check('new Zalo logo file exists on disk', () => assert.ok(dirFiles.includes(zaloFileKey2)));

    const webp = await (async () => { const p = path.join(tmpDir, 'zalo3.webp'); await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } } }).webp().toFile(p); return fs.readFile(p); })();
    const webpUpload = await request('/admin/settings/widget-media/zalo', { method: 'POST', token: adminToken, isForm: true, body: await uploadForm(webp, 'logo3.webp', 'image/webp') });
    check('WebP upload succeeds (200)', () => assert.equal(webpUpload.status, 200));
    const zaloFileKey3 = webpUpload.data.data.url.split('/').pop();

    const delUnauth = await request('/admin/settings/widget-media/zalo', { method: 'DELETE' });
    check('unauthenticated delete is rejected (401)', () => assert.equal(delUnauth.status, 401));

    const del = await request('/admin/settings/widget-media/zalo', { method: 'DELETE', token: adminToken });
    check('delete restores the default (200)', () => assert.equal(del.status, 200));
    const afterDelete = await request('/content/store-info');
    check('widget.zalo.logoUrl is cleared after delete — falls back to the built-in Zalo glyph', () => assert.ok(!afterDelete.data.data['widget.zalo.logoUrl']));

    const dirFilesAfterDelete = await readdir(supportWidgetMediaDirectory).catch(() => []);
    check('the deleted logo file was actually removed from disk', () => assert.ok(!dirFilesAfterDelete.includes(zaloFileKey3)));

    const delMissing = await request('/admin/settings/widget-media/zalo', { method: 'DELETE', token: adminToken });
    check('deleting again when nothing custom is set still returns 200 (idempotent restore)', () => assert.equal(delMissing.status, 200));
  }

  console.log('\n[Channel name/description text fields]');
  {
    const ok = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.telegram.name': 'Kênh Telegram', 'widget.telegram.description': 'Nhận hỗ trợ nhanh qua Telegram' } });
    check('channel name/description save (200)', () => assert.equal(ok.status, 200));
    const pub = await request('/content/store-info');
    check('channel name/description round-trip on the public endpoint', () => {
      assert.equal(pub.data.data['widget.telegram.name'], 'Kênh Telegram');
      assert.equal(pub.data.data['widget.telegram.description'], 'Nhận hỗ trợ nhanh qua Telegram');
    });
    const tooLongName = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.telegram.name': 'x'.repeat(41) } });
    check('channel name over 40 chars is rejected (400)', () => assert.equal(tooLongName.status, 400));
    const tooLongDesc = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.telegram.description': 'x'.repeat(81) } });
    check('channel description over 80 chars is rejected (400)', () => assert.equal(tooLongDesc.status, 400));
    const badChannel = await request('/admin/settings', { method: 'PUT', token: adminToken, body: { 'widget.discord.name': 'x' } });
    check('name for an unsupported channel id is rejected (400)', () => assert.equal(badChannel.status, 400));
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
} finally {
  // ── Teardown: restore the exact pre-test StoreSetting rows, delete temp users/files ──
  const touchedKeys = (await prisma.storeSetting.findMany({
    where: { OR: TOUCHED_PREFIXES.map(p => ({ key: { startsWith: p } })) },
    select: { key: true },
  })).map(r => r.key);
  const snapshotKeys = new Set(snapshot.map(r => r.key));
  const toDelete = touchedKeys.filter(k => !snapshotKeys.has(k));
  if (toDelete.length) await prisma.storeSetting.deleteMany({ where: { key: { in: toDelete } } });
  if (snapshot.length) {
    await prisma.$transaction(snapshot.map(row =>
      prisma.storeSetting.upsert({ where: { key: row.key }, update: { value: row.value }, create: { key: row.key, value: row.value } }),
    ));
  }
  if (adminId) await prisma.user.delete({ where: { id: adminId } }).catch(() => {});
  if (customerId) await prisma.user.delete({ where: { id: customerId } }).catch(() => {});
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  await prisma.$disconnect();
  if (failures > 0) process.exitCode = 1;
}
