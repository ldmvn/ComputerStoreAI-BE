function parseOriginList(raw) {
  return (raw || '').split(',').map(o => o.trim()).filter(Boolean);
}

// Single source of truth for which frontend origins this backend will ever
// redirect a browser back to or accept an OAuth exchange from — the exact
// same allowlist CORS already trusts (server.js's CORS_ORIGIN), so nothing
// here is ever sent anywhere that wasn't already allowed to call the API
// with credentials.
function allowedFrontendOrigins() {
  const configured = parseOriginList(process.env.CORS_ORIGIN || 'http://localhost:3000');
  return configured.length ? configured : ['http://localhost:3000'];
}

function originOf(value) {
  if (typeof value !== 'string' || !value) return null;
  try { return new URL(value).origin; } catch { return null; }
}

export function isAllowedFrontendOrigin(origin) {
  if (!origin) return false;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return allowedFrontendOrigins().includes(origin);
}

// Which allowed origin to send the browser back to. An explicit FRONTEND_URL
// always wins (lets a single-frontend deployment pin it exactly). Otherwise
// it's inferred from the request that's actually hitting us — Origin on a
// fetch, Referer on a top-level navigation — as long as it's one of the
// already-trusted CORS_ORIGIN entries. This is what makes a visit through
// https://ducmanh.store come back to https://ducmanh.store and a visit
// through localhost come back to localhost, without needing FRONTEND_URL set
// by hand on every environment (the exact gap that sent production users to
// localhost after Google auth). Falls back to the first configured origin
// only when neither header is present or trusted (e.g. Google's own redirect
// to our callback carries no useful Origin/Referer of ours at all — the
// controller instead carries the origin resolved here, at the start of the
// flow, through the signed state cookie — see googleAuth.controller.js).
export function resolveFrontendOrigin(req) {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  const fromRequest = req && [originOf(req.get?.('origin')), originOf(req.get?.('referer'))].find(isAllowedFrontendOrigin);
  return fromRequest || allowedFrontendOrigins()[0];
}

export function getGoogleOAuthConfig(req) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL, JWT_SECRET } = process.env;
  const frontendUrl = new URL(resolveFrontendOrigin(req));
  if (!['http:', 'https:'].includes(frontendUrl.protocol) || frontendUrl.username || frontendUrl.password || frontendUrl.pathname !== '/' || frontendUrl.search || frontendUrl.hash) {
    throw new Error('FRONTEND_URL must be a frontend origin.');
  }
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL || !JWT_SECRET) {
    throw new Error('Google OAuth is not configured.');
  }
  const callback = new URL(GOOGLE_CALLBACK_URL);
  if (!['http:', 'https:'].includes(callback.protocol) || callback.pathname !== '/api/auth/google/callback' || callback.search || callback.hash || callback.username || callback.password) {
    throw new Error('GOOGLE_CALLBACK_URL must point to /api/auth/google/callback.');
  }
  if (process.env.NODE_ENV === 'production' && (callback.protocol !== 'https:' || frontendUrl.protocol !== 'https:')) {
    throw new Error('Google OAuth requires HTTPS in production.');
  }
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, callbackUrl: callback.href, frontendOrigin: frontendUrl.origin, stateSecret: JWT_SECRET, secure: callback.protocol === 'https:' };
}
