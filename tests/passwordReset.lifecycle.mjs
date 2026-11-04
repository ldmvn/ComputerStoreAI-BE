import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import net from 'node:net';
import express from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import authRoutes from '../src/routes/v1/auth.route.js';
import { cleanupExpiredPasswordResets, resetHash } from '../src/services/passwordReset.service.js';
import { getResetMailTransport } from '../src/services/passwordResetMail.service.js';

// Exercise real API + MySQL + SMTP locally. No production emails or accounts.
const messages = [];
const sockets = new Set();
const smtp = net.createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket));
  socket.setEncoding('utf8'); socket.write('220 localhost ESMTP\r\n');
  let buffer = '', data = false, body = '';
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const boundary = buffer.indexOf('\r\n');
      const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      if (data) {
        if (line === '.') { messages.push(body); body = ''; data = false; socket.write('250 queued\r\n'); }
        else body += line + '\n';
      } else if (/^EHLO|^HELO/.test(line)) socket.write('250 localhost\r\n');
      else if (/^DATA/.test(line)) { data = true; socket.write('354 End with dot\r\n'); }
      else if (/^QUIT/.test(line)) socket.end('221 bye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
});
await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(smtp.address().port);
process.env.SMTP_SECURE = 'false'; process.env.SMTP_FROM = 'DUCMANHPC <test@example.com>';
delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
const app = express();
app.use(express.json());
// Distinct test clients for scenarios; production's trust proxy remains unchanged.
app.set('trust proxy', true);
app.use('/api/auth', authRoutes);
app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message, code: error.code }));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const origin = `http://127.0.0.1:${server.address().port}/api/auth`;
const emails = [];
let scenario = 0;
async function fixture() {
  const email = `otp-life-${randomBytes(8).toString('hex')}@example.com`;
  const client = `198.51.100.${++scenario}`;
  await prisma.user.create({ data: { email, phone: email, fullName: 'OTP lifecycle test', passwordHash: await bcrypt.hash('OldPassword123!', 12) } });
  emails.push(email);
  async function post(path, payload) {
    const response = await fetch(`${origin}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': client }, body: JSON.stringify(payload) });
    return { status: response.status, data: await response.json() };
  }
  async function issue(requestEmail = email) {
    const response = await post('forgot-password', { email: requestEmail });
    assert.equal(response.status, 200, response.data.message);
    assert.equal(response.data.expiresIn, 300);
    assert.equal('otp' in response.data, false);
    const message = messages.findLast(body => body.includes(`To: ${email}`));
    const otp = message?.match(/\b\d{6}\b/)?.[0];
    assert.ok(otp, 'SMTP message contains the OTP');
    return { ...response.data, otp };
  }
  return { email, post, issue };
}
await test('OTP lifecycle (API + MySQL)', async context => {
context.after(async () => {
  await prisma.passwordReset.deleteMany({ where: { email: { in: emails } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => smtp.close(resolve));
});

await context.test('TEST 1: newest correct OTP verifies immediately, with trimmed OTP/email and stale client challenge', async () => {
  const f = await fixture();
  const issued = await f.issue(` ${f.email.toUpperCase()} `);
  const result = await f.post('verify-reset-otp', { email: ` ${f.email.toUpperCase()} `, otp: ` ${issued.otp} `, challengeId: '0'.repeat(64) });
  assert.equal(result.status, 200);
  const row = await prisma.passwordReset.findUnique({ where: { email: f.email } });
  assert.ok(row.verifiedAt); assert.equal(row.usedAt, null); assert.equal(row.attempts, 0);
  assert.ok(row.otpHash); assert.notEqual(row.tokenHash, result.data.resetToken);
  assert.equal(row.expiresAt - row.sentAt, 300000);
});

await context.test('TEST 2: inactive OTP expires after five minutes by server time, without frontend/cleanup', async t => {
  const f = await fixture();
  const clockStart = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now: clockStart });
  try {
    const issued = await f.issue();
    const before = await prisma.passwordReset.findUnique({ where: { email: f.email } });
    assert.equal(before.expiresAt.getTime(), clockStart + 300000);
    t.mock.timers.setTime(clockStart + 300001);
    const result = await f.post('verify-reset-otp', { email: f.email, otp: issued.otp });
    assert.equal(result.status, 400); assert.equal(result.data.code, 'OTP_EXPIRED');
    const after = await prisma.passwordReset.findUnique({ where: { email: f.email } });
    assert.equal(after.attempts, 0); assert.ok(after.otpHash, 'Expiry works even while row/hash still exists');
  } finally { t.mock.timers.reset(); }
});

await context.test('TEST 3: resend replaces A with B, resets attempts/expiry and only B verifies', async () => {
  const f = await fixture(); const a = await f.issue();
  const wrong = a.otp === '000000' ? '000001' : '000000';
  await f.post('verify-reset-otp', { email: f.email, otp: wrong });
  const b = await f.issue();
  assert.notEqual(a.otp, b.otp); assert.notEqual(a.challengeId, b.challengeId);
  assert.equal(await prisma.passwordReset.count({ where: { email: f.email } }), 1);
  const row = await prisma.passwordReset.findUnique({ where: { email: f.email } });
  assert.equal(row.attempts, 0); assert.equal(row.verifiedAt, null); assert.equal(row.usedAt, null);
  assert.equal(row.expiresAt - row.sentAt, 300000);
  assert.equal((await f.post('verify-reset-otp', { email: f.email, otp: a.otp, challengeId: a.challengeId })).status, 400);
  assert.equal((await f.post('verify-reset-otp', { email: f.email, otp: b.otp, challengeId: a.challengeId })).status, 200);
});

await context.test('TEST 4: leaving/reloading form and requesting again immediately creates a fresh OTP without duplicate error', async () => {
  const f = await fixture(); const abandoned = await f.issue();
  // Client discards the old challenge on leaving; no cancellation API is needed.
  const reopened = await f.issue(` ${f.email.toUpperCase()} `);
  assert.notEqual(reopened.challengeId, abandoned.challengeId);
  assert.equal(await prisma.passwordReset.count({ where: { email: f.email } }), 1);
  assert.equal((await f.post('verify-reset-otp', { email: f.email, otp: reopened.otp })).status, 200);
});

await context.test('TEST 5: four wrong attempts followed by a correct code succeeds without increasing attempts', async () => {
  const f = await fixture(); const issued = await f.issue();
  const wrong = issued.otp === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i++) {
    const result = await f.post('verify-reset-otp', { email: f.email, otp: wrong });
    assert.equal(result.data.code, 'OTP_INVALID');
  }
  assert.equal((await f.post('verify-reset-otp', { email: f.email, otp: issued.otp })).status, 200);
  const row = await prisma.passwordReset.findUnique({ where: { email: f.email } });
  assert.equal(row.attempts, 4); assert.ok(row.verifiedAt);
});

await context.test('TEST 6: successful password reset consumes both OTP and reset token permanently', async () => {
  const f = await fixture(); const issued = await f.issue();
  const verified = await f.post('verify-reset-otp', { email: f.email, otp: issued.otp });
  assert.equal(verified.status, 200);
  const payload = { email: f.email, resetToken: verified.data.resetToken, password: 'NewPassword123!', confirmPassword: 'NewPassword123!' };
  assert.equal((await f.post('reset-password', payload)).status, 200);
  const row = await prisma.passwordReset.findUnique({ where: { email: f.email } });
  assert.ok(row.usedAt); assert.equal(row.otpHash, null); assert.equal(row.tokenHash, null);
  assert.equal((await f.post('verify-reset-otp', { email: f.email, otp: issued.otp })).status, 400);
  assert.equal((await f.post('reset-password', payload)).status, 400);
});

await context.test('Cleanup removes expired material, preserves an active reset session, then deletes old metadata', async () => {
  const f = await fixture(); const issued = await f.issue();
  const verified = await f.post('verify-reset-otp', { email: f.email, otp: issued.otp });
  const row = await prisma.passwordReset.findUnique({ where: { email: f.email } });
  await cleanupExpiredPasswordResets(new Date(row.expiresAt.getTime() + 1));
  const cleaned = await prisma.passwordReset.findUnique({ where: { email: f.email } });
  assert.equal(cleaned.otpHash, null); assert.ok(cleaned.tokenHash);
  assert.equal((await f.post('reset-password', { email: f.email, resetToken: verified.data.resetToken, password: 'NewPassword123!', confirmPassword: 'NewPassword123!' })).status, 200);
  await cleanupExpiredPasswordResets(new Date(row.windowStart.getTime() + 3600001));
  assert.equal(await prisma.passwordReset.count({ where: { email: f.email } }), 0);
});

await context.test('Concurrent new OTP requests never return a unique constraint error and latest code remains valid', async () => {
  const f = await fixture();
  const results = await Promise.all([1, 2].map(() => f.post('forgot-password', { email: f.email })));
  assert.ok(results.every(r => r.status === 200 || r.status === 409));
  assert.ok(results.some(r => r.status === 200));
  assert.equal(await prisma.passwordReset.count({ where: { email: f.email } }), 1);
  const row = await prisma.passwordReset.findUnique({ where: { email: f.email } });
  const codes = messages.filter(body => body.includes(`To: ${f.email}`)).map(body => body.match(/\b\d{6}\b/)?.[0]);
  const latest = codes.find(otp => resetHash(`${row.challengeId}:${otp}`) === row.otpHash);
  assert.ok(latest);
  assert.equal((await f.post('verify-reset-otp', { email: f.email, otp: latest })).status, 200);
});

await context.test('SMTP rejection returns failure and leaves no usable OTP instead of false success', async () => {
  const f = await fixture(); const transport = getResetMailTransport();
  const original = transport.sendMail;
  transport.sendMail = async () => { const error = new Error('Local SMTP rejection for test'); error.code = 'ESMTP'; throw error; };
  try {
    assert.equal((await f.post('forgot-password', { email: f.email })).status, 503);
    const row = await prisma.passwordReset.findUnique({ where: { email: f.email } });
    assert.equal(row.otpHash, null); assert.ok(row.usedAt);
  } finally { transport.sendMail = original; }
});
});
