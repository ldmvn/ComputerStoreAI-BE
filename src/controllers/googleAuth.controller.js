import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { getGoogleOAuthConfig, resolveFrontendOrigin, isAllowedFrontendOrigin } from '../config/googleOAuth.js';
import { GoogleAuthError, resolveGoogleUser, issueGoogleExchange, exchangeGoogleLogin, googleChallenge } from '../services/googleAuth.service.js';

const cookieName = 'ducmanh_google_state';
const cookieOptions = secure => ({ httpOnly: true, secure, sameSite: 'lax', path: '/api/auth/google' });
const random = () => randomBytes(32).toString('base64url');
const clientFor = config => new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.callbackUrl, transporterOptions: { timeout: 15000 } });

// Dependency injection is used by local integration tests; production uses Google.
export function createGoogleAuthHandlers({ makeClient = clientFor } = {}) {
  // `knownOrigin` is the frontend origin already resolved and validated
  // earlier in this same flow (e.g. from the signed state cookie in
  // callback()) — pass it whenever available instead of re-deriving from
  // `req`, since by the time Google redirects back to our /callback the
  // request's own Origin/Referer point at Google, not at our frontend.
  const redirectError = (req, res, code, knownOrigin) => {
    const target = new URL('/auth/google/callback', knownOrigin || resolveFrontendOrigin(req));
    target.hash = new URLSearchParams({ error: code }).toString();
    return res.redirect(303, target.href);
  };
  return {
    start(req, res) {
      res.set('Cache-Control', 'no-store');
      let config;
      try { config = getGoogleOAuthConfig(req); }
      catch { return redirectError(req, res, 'not_configured'); }
      const challenge = req.query.challenge;
      if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return redirectError(req, res, 'invalid_state', config.frontendOrigin);
      const state = random(), nonce = random(), verifier = random();
      // frontendOrigin travels inside the signed state so callback() — which
      // only ever sees a request coming FROM Google, never from our own
      // frontend — still knows exactly which origin started this login.
      const signed = jwt.sign({ state, nonce, verifier, challenge, frontendOrigin: config.frontendOrigin }, config.stateSecret, { algorithm: 'HS256', expiresIn: '10m', audience: 'google-oauth-state', issuer: 'ducmanh-pc' });
      res.cookie(cookieName, signed, { ...cookieOptions(config.secure), maxAge: 600000 });
      return res.redirect(makeClient(config).generateAuthUrl({
        scope: ['openid', 'email', 'profile'], state, nonce, prompt: 'select_account',
        code_challenge: googleChallenge(verifier), code_challenge_method: 'S256',
      }));
    },
    async callback(req, res) {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      let config;
      try { config = getGoogleOAuthConfig(req); }
      catch { return redirectError(req, res, 'not_configured'); }
      res.clearCookie(cookieName, cookieOptions(config.secure));
      let knownOrigin;
      try {
        const raw = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`));
        let saved;
        try {
          saved = jwt.verify(decodeURIComponent(raw?.slice(cookieName.length + 1) || ''), config.stateSecret, { algorithms: ['HS256'], audience: 'google-oauth-state', issuer: 'ducmanh-pc' });
        } catch { throw new GoogleAuthError('invalid_state'); }
        if (typeof saved !== 'object' || typeof req.query.state !== 'string' || saved.state !== req.query.state) throw new GoogleAuthError('invalid_state');
        // Re-validate against the live allowlist (not just "was it signed by
        // us") in case CORS_ORIGIN changed since this token was issued.
        if (isAllowedFrontendOrigin(saved.frontendOrigin)) knownOrigin = saved.frontendOrigin;
        if (req.query.error) throw new GoogleAuthError(req.query.error === 'access_denied' ? 'cancelled' : 'oauth_failed');
        if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) throw new GoogleAuthError('oauth_failed');
        const client = makeClient(config);
        let profile;
        try {
          const { tokens } = await client.getToken({ code: req.query.code, codeVerifier: saved.verifier });
          if (!tokens.id_token) throw new Error('Missing ID token');
          const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
          profile = ticket.getPayload();
          if (!profile || profile.nonce !== saved.nonce) throw new Error('Invalid nonce');
        } catch { throw new GoogleAuthError('invalid_token'); }
        const user = await resolveGoogleUser(profile);
        const code = await issueGoogleExchange(user.id, saved.challenge);
        const target = new URL('/auth/google/callback', knownOrigin || resolveFrontendOrigin(req));
        target.hash = new URLSearchParams({ code }).toString();
        return res.redirect(303, target.href);
      } catch (error) {
        const code = error instanceof GoogleAuthError ? error.code : error?.statusCode === 403 ? 'account_disabled' : 'oauth_failed';
        return redirectError(req, res, code, knownOrigin);
      }
    },
    async exchange(req, res, next) {
      res.set('Cache-Control', 'no-store');
      try {
        const config = getGoogleOAuthConfig(req);
        if (!isAllowedFrontendOrigin(req.headers.origin)) throw new GoogleAuthError('invalid_origin', 403);
        const rememberMe = req.body?.rememberMe === true;
        const isProduction = process.env.NODE_ENV === 'production';
        const result = await exchangeGoogleLogin(req.body?.code, req.body?.verifier);
        res.cookie('accessToken', result.token, {
          httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/',
          ...(rememberMe ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {}),
        });
        return res.json({ success: true, ...result });
      } catch (error) { return next(error); }
    },
  };
}

const handlers = createGoogleAuthHandlers();
export const startGoogleLogin = handlers.start;
export const googleCallback = handlers.callback;
export const completeGoogleLogin = handlers.exchange;
