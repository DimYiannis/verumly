import { useEnv } from '../utils/env.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_API_BODY_BYTES = 256 * 1024;

// Nuxt writes an inline bootstrap + payload script and Tailwind/Vue use inline styles, so script/style need
// 'unsafe-inline' until nonces are wired in (recorded in docs/decisions/merchant-web.md). Everything else is locked down.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * 1. security headers on every response (the CSP is production-only: Vite's dev server needs eval + websockets);
 * 2. CSRF for state-changing /api requests: the session cookie is SameSite=Lax, and in addition a request that
 *    carries an `Origin` must match this host; a request with neither `Origin` nor `Sec-Fetch-Site: same-origin`
 *    is refused. Plus a body-size cap.
 */
export default defineEventHandler((event) => {
  const secure = useEnv().cookieSecure;
  setResponseHeaders(event, {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    ...(import.meta.dev ? {} : { 'content-security-policy': CSP }),
    ...(secure ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  });

  const path = event.path.split('?')[0] ?? '';
  if (!path.startsWith('/api/') || SAFE_METHODS.has(event.method)) return;

  const origin = getRequestHeader(event, 'origin');
  const host = getRequestHeader(event, 'host');
  if (origin) {
    const originHost = URL.canParse(origin) ? new URL(origin).host : null;
    if (originHost !== host) throw createError({ statusCode: 403, statusMessage: 'cross-origin request refused' });
  } else if (getRequestHeader(event, 'sec-fetch-site') !== 'same-origin') {
    throw createError({ statusCode: 403, statusMessage: 'cross-origin request refused' });
  }
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > MAX_API_BODY_BYTES) throw createError({ statusCode: 413, statusMessage: 'body too large' });
});
