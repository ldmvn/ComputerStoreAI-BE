import 'dotenv/config';
import assert from 'node:assert/strict';
import net from 'node:net';
import express from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import authRoutes from '../src/routes/v1/auth.route.js';
import { validatePasswordReset } from '../src/validators/passwordReset.validator.js';
import { getResetMailTransport } from '../src/services/passwordResetMail.service.js';

// Real SMTP protocol + real database/API; no external mailbox or production account.
const messages = [];
const sockets = new Set();
const smtp = net.createServer(socket => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.setEncoding('utf8');
  socket.write('220 localhost ESMTP\r\n');
  let buffer = '', data = false, body = '';
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const boundary = buffer.indexOf('\r\n');
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
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
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(smtp.address().port);
process.env.SMTP_SECURE = 'false';
process.env.SMTP_FROM = 'DUCMANH PC <test@example.com>';
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const origin = `http://127.0.0.1:${server.address().port}/api/auth`;
const suffix = randomBytes(8).toString('hex');
const email = `reset-${suffix}@example.com`;
const unknownEmail = `missing-${suffix}@example.com`;
const newPassword = 'NewSecurePassword123!';
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
async function post(path, payload) {
  const response = await fetch(`${origin}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: response.status, data: await response.json() };
}
async function allowResend() {
  await prisma.passwordReset.update({ where: { email }, data: { sentAt: new Date(Date.now() - 61000) } });
}
function lastOtp() {
  // SMTP uses quoted-printable for Vietnamese text; the six digits remain ASCII.
  const matches = messages.at(-1).match(/\b\d{6}\b/g);
  assert.ok(matches?.length, 'Email includes a 6-digit OTP');
  return matches[0];
}
try {
  await prisma.user.create({ data: { email, phone: `test-${suffix}`, fullName: 'Reset integration test', passwordHash: await bcrypt.hash('OldPassword123!', 12) } });
  const bad = await post('forgot-password', { email: 'invalid' });
  check(bad.status === 400, 'Invalid email rejected');
  const first = await post('forgot-password', { email });
  check(first.status === 200 && messages.length === 1, 'Known address receives SMTP email');
  check(first.data.expiresIn === 300 && !('otp' in first.data), 'Response uses five-minute expiry and never exposes OTP');
  const firstOtp = lastOtp();
  const stored = await prisma.passwordReset.findUnique({ where: { email } });
  check(stored.expiresAt - stored.sentAt === 300000, 'Stored OTP expires in exactly five minutes');
  check(stored.otpHash.length === 64 && !JSON.stringify(stored).includes(firstOtp), 'OTP stored as hash');
  const unknown = await post('forgot-password', { email: unknownEmail });
  check(unknown.status === first.status && unknown.data.message === first.data.message && messages.length === 1, 'Unknown email has same public response without mail');
  check(first.data.resendAfter === 60, 'UI resend cooldown is advertised');
  check((await post('verify-reset-otp', { email, challengeId: 'invalid-challenge', otp: firstOtp })).status === 400, 'Malformed compatibility challenge rejected');
  const wrong = firstOtp === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) check((await post('verify-reset-otp', { email, challengeId: first.data.challengeId, otp: wrong })).status === 400, 'Wrong OTP rejected');
  check((await post('verify-reset-otp', { email, challengeId: first.data.challengeId, otp: firstOtp })).status === 400, 'Correct OTP rejected after five failed attempts');
  await allowResend();
  const second = await post('forgot-password', { email });
  const secondOtp = lastOtp();
  check((await post('verify-reset-otp', { email, challengeId: first.data.challengeId, otp: firstOtp })).status === 400, 'Resend invalidates old challenge');
  await prisma.passwordReset.update({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
  check((await post('verify-reset-otp', { email, challengeId: second.data.challengeId, otp: secondOtp })).status === 400, 'Expired OTP rejected');
  await allowResend();
  const third = await post('forgot-password', { email });
  const thirdOtp = lastOtp();
  const verifies = await Promise.all([1, 2].map(() => post('verify-reset-otp', { email, challengeId: third.data.challengeId, otp: thirdOtp })));
  check(verifies.filter(r => r.status === 200).length === 1, 'Concurrent OTP verification succeeds once');
  const resetToken = verifies.find(r => r.status === 200).data.resetToken;
  const verified = await prisma.passwordReset.findUnique({ where: { email } });
  check(Boolean(verified.verifiedAt) && Boolean(verified.otpHash) && verified.tokenHash !== resetToken, 'OTP marked verified and reset token hashed');
  check((await post('reset-password', { email, resetToken, password: newPassword, confirmPassword: 'mismatch' })).status === 400, 'Confirmation mismatch rejected');
  await prisma.passwordReset.update({ where: { email }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
  check((await post('reset-password', { email, resetToken, password: newPassword, confirmPassword: newPassword })).status === 400, 'Expired reset token rejected');
  await prisma.passwordReset.update({ where: { email }, data: { tokenExpiresAt: new Date(Date.now() + 600000) } });
  const resets = await Promise.all([1, 2].map(() => post('reset-password', { email, resetToken, password: newPassword, confirmPassword: newPassword })));
  check(resets.filter(r => r.status === 200).length === 1, 'Concurrent reset succeeds once');
  const user = await prisma.user.findUnique({ where: { email } });
  check(user.passwordHash !== newPassword && await bcrypt.compare(newPassword, user.passwordHash), 'New password uses bcrypt');
  check(!(await bcrypt.compare('OldPassword123!', user.passwordHash)), 'Old password no longer works');
  check((await post('reset-password', { email, resetToken, password: newPassword, confirmPassword: newPassword })).status === 400, 'Consumed reset token rejected');
  check((await post('login', { identifier: email, password: newPassword })).status === 200, 'New password logs in');
  check(Boolean(validatePasswordReset({ email, resetToken, password: '😀'.repeat(20), confirmPassword: '😀'.repeat(20) }, 'reset').errors.password), 'Bcrypt UTF-8 byte limit enforced');
  await prisma.passwordReset.update({ where: { email }, data: { sentAt: new Date(Date.now() - 61000), requestCount: 5 } });
  check((await post('forgot-password', { email })).status === 429, 'Hourly email request limit enforced');
  process.env.SMTP_HOST = 'smtp.gmail.com';
  const missingKnown = await post('forgot-password', { email });
  const missingUnknown = await post('forgot-password', { email: unknownEmail });
  check(missingKnown.status === 503 && missingKnown.data.message.includes('SMTP_USER') && missingKnown.data.message.includes('SMTP_PASS'), 'Missing Gmail configuration names the missing environment keys');
  check(missingUnknown.status === missingKnown.status && missingUnknown.data.message === missingKnown.data.message, 'SMTP configuration failures do not reveal registered emails');
  process.env.SMTP_USER = 'smtp-test@gmail.com';
  process.env.SMTP_PASS = 'test-only-placeholder';
  process.env.SMTP_PORT = '465';
  check(assert.throws(() => getResetMailTransport(), /SMTP_PORT=587/) === undefined, 'Invalid Gmail port rejected');
  console.log(`Passed ${checks} password reset integration checks.`);
} finally {
  await prisma.passwordReset.deleteMany({ where: { email: { in: [email, unknownEmail] } } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => smtp.close(resolve));
}
