import 'dotenv/config';
import assert from 'node:assert/strict';
import express from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import authRoutes from '../src/routes/v1/auth.route.js';
import { getResetMailTransport, verifyResetMailConnection } from '../src/services/passwordResetMail.service.js';

// Explicit opt-in: sends ONE real email to the configured Gmail mailbox's plus alias.
// Credentials are read only from .env. Do not log/store the OTP or password.
if (process.env.RUN_GMAIL_SMTP_TEST !== '1') throw new Error('Set RUN_GMAIL_SMTP_TEST=1 to explicitly send a real Gmail OTP test.');
const mailbox = process.env.SMTP_USER?.trim().toLowerCase();
assert.ok(mailbox?.endsWith('@gmail.com'), 'This smoke test requires a Gmail SMTP_USER.');
const suffix = randomBytes(8).toString('hex');
const localPart = mailbox.split('@')[0].split('+')[0];
const email = `${localPart}+otp-test-${suffix}@gmail.com`;
let otp, deliveryAccepted = false, server, createdUser = false;
const transport = getResetMailTransport();
const originalSendMail = transport.sendMail.bind(transport);

try {
  await verifyResetMailConnection();
  // Test-only observation of the outgoing message to exercise the real verify API;
  // production never returns or logs the OTP. Gmail delivery still happens for real.
  transport.sendMail = async message => {
    assert.equal(message.to, email);
    assert.ok(message.text.includes('5 phút'));
    assert.ok(message.subject.includes('DUCMANHPC'));
    otp = message.text.match(/\b\d{6}\b/)?.[0];
    assert.ok(otp);
    const info = await originalSendMail(message);
    deliveryAccepted = info.accepted?.includes(email);
    return info;
  };
  await prisma.user.create({ data: {
    email, phone: `gmail-test-${suffix}`, fullName: 'Gmail SMTP integration test',
    passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 12),
  } });
  createdUser = true;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}/api/auth`;
  async function post(path, payload) {
    const response = await fetch(`${origin}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    assert.equal(response.status, 200, data.message || 'API request failed');
    return data;
  }
  const requested = await post('forgot-password', { email });
  assert.ok(deliveryAccepted, 'Gmail must accept the real message');
  assert.equal(requested.expiresIn, 300);
  assert.ok(!('otp' in requested));
  const stored = await prisma.passwordReset.findUnique({ where: { email } });
  assert.equal(stored.expiresAt - stored.sentAt, 300000);
  const verified = await post('verify-reset-otp', { email, challengeId: requested.challengeId, otp });
  const password = randomBytes(24).toString('hex');
  await post('reset-password', { email, resetToken: verified.resetToken, password, confirmPassword: password });
  await post('login', { identifier: email, password });
  const consumed = await prisma.passwordReset.findUnique({ where: { email } });
  assert.equal(consumed.otpHash, null);
  assert.equal(consumed.tokenHash, null);
  console.log('Real Gmail SMTP message accepted; OTP verification, password reset and login passed.');
  console.log(`Recipient: ${email}`);
  console.log('Mailbox arrival is not asserted: this test only observes SMTP acceptance.');
} finally {
  transport.sendMail = originalSendMail;
  if (createdUser) {
    await prisma.passwordReset.deleteMany({ where: { email } });
    await prisma.user.deleteMany({ where: { email } });
  }
  await prisma.$disconnect();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
