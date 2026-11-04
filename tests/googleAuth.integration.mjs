import '../src/config/env.js';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../src/config/prisma.js';
import authRoutes from '../src/routes/v1/auth.route.js';
import { createGoogleAuthHandlers } from '../src/controllers/googleAuth.controller.js';
import { googleChallenge, hashGoogleCode, resolveGoogleUser } from '../src/services/googleAuth.service.js';

// Real Express, database, JWT and Google's signature verifier. Only Google's
// authorization-code exchange/certificate download are replaced with fixtures.
process.env.GOOGLE_CLIENT_ID = 'local-test.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'local-test-only';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:5000/api/auth/google/callback';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const suffix = randomBytes(8).toString('hex');
const prefix = `google-test-${suffix}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const cert = publicKey.export({ type: 'spki', format: 'pem' });
const fixtures = new Map();
const verifierClient = new OAuth2Client();
const handlers = createGoogleAuthHandlers({ makeClient(config) {
  const client = new OAuth2Client(config.clientId, config.clientSecret, config.callbackUrl);
  client.getToken = async ({ code, codeVerifier }) => {
    const fixture = fixtures.get(code);
    assert.ok(fixture && googleChallenge(codeVerifier) === fixture.pkce, 'Google PKCE challenge matches');
    if (fixture.reject) throw new Error('Google token endpoint rejected code');
    const token = jwt.sign({ nonce: fixture.nonce, ...fixture.profile }, privateKey, {
      algorithm: 'RS256', keyid: 'local', issuer: 'https://accounts.google.com',
      audience: fixture.audience || config.clientId, expiresIn: fixture.expiresIn || '5m',
    });
    return { tokens: { id_token: fixture.tamper ? token.slice(0, -12) + 'invalid' : token } };
  };
  client.verifyIdToken = async ({ idToken, audience }) => verifierClient.verifySignedJwtWithCertsAsync(idToken, { local: cert }, audience, ['https://accounts.google.com']);
  return client;
} });
const app = express();
app.use(express.json());
app.get('/api/auth/google', handlers.start);
app.get('/api/auth/google/callback', handlers.callback);
app.post('/api/auth/google/exchange', handlers.exchange);
app.use('/api/auth', authRoutes);
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/auth`;
const trackedUsers = [];
let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions++; };
const profile = (name, extra = {}) => ({ sub: `${prefix}-${name}`, email: `${prefix}-${name}@gmail.com`, email_verified: true, name: 'Google Test User', picture: 'https://example.com/avatar.png', ...extra });
async function begin() {
  const verifier = randomBytes(32).toString('base64url');
  const response = await fetch(`${base}/google?challenge=${googleChallenge(verifier)}`, { redirect: 'manual' });
  check(response.status === 302, 'Start redirects to Google');
  const cookie = response.headers.get('set-cookie');
  check(/HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie), 'State cookie is HttpOnly and SameSite=Lax');
  const authorization = new URL(response.headers.get('location'));
  check(authorization.origin === 'https://accounts.google.com' && authorization.searchParams.get('redirect_uri') === process.env.GOOGLE_CALLBACK_URL, 'Exact Google origin and callback');
  check(authorization.searchParams.get('scope').includes('openid') && authorization.searchParams.get('code_challenge_method') === 'S256', 'OIDC scopes and PKCE');
  return { verifier, authorization, cookie: cookie.split(';')[0], state: authorization.searchParams.get('state') };
}
async function callback(start, parameters) {
  const response = await fetch(`${base}/google/callback?${new URLSearchParams({ state: start.state, ...parameters })}`, { headers: { Cookie: start.cookie }, redirect: 'manual' });
  check(response.status === 303 && /Expires=/i.test(response.headers.get('set-cookie')), 'Callback clears state cookie and redirects');
  const target = new URL(response.headers.get('location'));
  check(target.origin === process.env.FRONTEND_URL && target.pathname === '/auth/google/callback', 'Callback returns only to configured frontend');
  check(!target.search && !target.href.includes('eyJ'), 'JWT never included in URL');
  return new URLSearchParams(target.hash.slice(1));
}
async function authorize(value, extra = {}) {
  const start = await begin();
  const code = randomBytes(16).toString('hex');
  fixtures.set(code, { profile: value, nonce: start.authorization.searchParams.get('nonce'), pkce: start.authorization.searchParams.get('code_challenge'), ...extra });
  return { start, params: await callback(start, { code }) };
}
async function exchange(code, verifier, origin = process.env.FRONTEND_URL) {
  const response = await fetch(`${base}/google/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ code, verifier }) });
  return { status: response.status, data: await response.json() };
}
try {
  const first = await authorize(profile('new'));
  const code = first.params.get('code');
  check(Boolean(code), 'New Google user receives exchange code');
  const created = await prisma.user.findUnique({ where: { email: profile('new').email } });
  trackedUsers.push(created.id);
  check(created.googleId === profile('new').sub && created.phone === null && created.avatarUrl === profile('new').picture && created.role === 'USER', 'New user stores Google identity/avatar without fake phone');
  check((await exchange(code, first.start.verifier, 'http://attacker.example')).status === 403, 'Wrong origin rejected');
  check((await exchange(code, randomBytes(32).toString('base64url'))).status === 400, 'Wrong verifier rejected without consuming ticket');
  const results = await Promise.all([exchange(code, first.start.verifier), exchange(code, first.start.verifier)]);
  check(results.filter(r => r.status === 200).length === 1 && results.filter(r => r.status === 400).length === 1, 'Exactly one concurrent exchange succeeds');
  const success = results.find(r => r.status === 200).data;
  check(success.user.id === created.id && !('passwordHash' in success.user) && jwt.verify(success.token, process.env.JWT_SECRET).userId === created.id, 'Existing JWT service and safe user shape');
  check((await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${success.token}` } })).status === 200, 'Google JWT works with existing /me');
  check((await exchange(code, first.start.verifier)).status === 400, 'Exchange replay rejected');
  const repeated = await authorize(profile('new'));
  const repeatedLogin = await exchange(repeated.params.get('code'), repeated.start.verifier);
  check(repeatedLogin.data.user.id === created.id && await prisma.user.count({ where: { email: created.email } }) === 1, 'Returning Google account reuses same user');

  const passwordHash = await bcrypt.hash('ExistingPassword123!', 4);
  const existing = await prisma.user.create({ data: { fullName: 'Existing Local User', email: profile('existing').email, phone: prefix, passwordHash, role: 'ADMIN' } });
  trackedUsers.push(existing.id);
  const linked = await authorize(profile('existing'));
  const linkedLogin = await exchange(linked.params.get('code'), linked.start.verifier);
  const stored = await prisma.user.findUnique({ where: { id: existing.id } });
  check(linkedLogin.data.user.id === existing.id && stored.passwordHash === passwordHash && stored.fullName === existing.fullName && stored.role === 'ADMIN' && stored.phone === prefix, 'Email linking preserves ID/password/profile/role/phone');
  const passwordLogin = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: existing.email, password: 'ExistingPassword123!' }) });
  check(passwordLogin.status === 200, 'Existing password login remains functional after linking');
  const conflict = await authorize(profile('other', { email: existing.email }));
  check(conflict.params.get('error') === 'account_conflict', 'Different Google identity cannot replace a linked account');
  await prisma.user.update({ where: { id: existing.id }, data: { isActive: false } });
  check((await authorize(profile('existing'))).params.get('error') === 'account_disabled', 'Disabled user rejected');

  for (const [extra, expected] of [
    [{ email: undefined }, 'missing_email'], [{ email_verified: false }, 'unverified_email'],
  ]) check((await authorize(profile('invalid', extra))).params.get('error') === expected, expected);
  for (const fixture of [{ audience: 'wrong-client' }, { tamper: true }, { expiresIn: '-1h' }, { nonce: 'wrong-nonce' }, { reject: true }]) {
    check((await authorize(profile('invalid'), fixture)).params.get('error') === 'invalid_token', 'Invalid signature/audience/expiry/nonce/token exchange rejected');
  }
  const start = await begin();
  check((await callback(start, { error: 'access_denied' })).get('error') === 'cancelled', 'User cancellation handled');
  check((await callback(start, {})).get('error') === 'oauth_failed', 'Missing authorization code handled');
  check((await callback({ ...start, state: 'wrong-state' }, { code: 'fake' })).get('error') === 'invalid_state', 'State mismatch rejected');
  check((await callback({ ...start, cookie: '' }, { code: 'fake' })).get('error') === 'invalid_state', 'Missing cookie rejected');
  const expired = jwt.sign({ state: start.state }, process.env.JWT_SECRET, { audience: 'google-oauth-state', issuer: 'ducmanh-pc', expiresIn: '-1m' });
  check((await callback({ ...start, cookie: `ducmanh_google_state=${expired}` }, { code: 'fake' })).get('error') === 'invalid_state', 'Expired state rejected');
  const expiredTicket = await authorize(profile('new'));
  await prisma.googleLoginExchange.update({ where: { codeHash: hashGoogleCode(expiredTicket.params.get('code')) }, data: { expiresAt: new Date(0) } });
  check((await exchange(expiredTicket.params.get('code'), expiredTicket.start.verifier)).status === 400, 'Expired handoff rejected');
  const concurrentProfile = profile('concurrent');
  const concurrent = await Promise.all([resolveGoogleUser(concurrentProfile), resolveGoogleUser(concurrentProfile)]);
  trackedUsers.push(concurrent[0].id);
  check(concurrent[0].id === concurrent[1].id && await prisma.user.count({ where: { email: concurrentProfile.email } }) === 1, 'Concurrent creation resolves to one user');
  delete process.env.GOOGLE_CLIENT_SECRET;
  const unconfigured = await fetch(`${base}/google?challenge=${googleChallenge(start.verifier)}`, { redirect: 'manual' });
  check(unconfigured.headers.get('location').endsWith('error=not_configured'), 'Missing configuration produces friendly error');
  console.log(`Google OAuth integration passed: ${assertions} checks (real DB/JWT/signature verification, simulated Google provider).`);
} finally {
  await prisma.googleLoginExchange.deleteMany({ where: { userId: { in: trackedUsers } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
}
