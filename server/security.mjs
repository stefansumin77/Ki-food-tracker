const LOCAL_WINDOW_MS = 60_000;
const MAX_LOCAL_IDENTITIES = 5000;
const localWindows = new Map();
const LIMITS = Object.freeze({ ai: 10, products: 60, session: 60, login: 5 });

export function apiJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'vary': 'Origin',
      ...extraHeaders,
    },
  });
}

export function apiFailure(message, status, code, extraHeaders = {}) {
  return apiJson({ error: message, code }, status, extraHeaders);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const validIdentity = id => typeof id === 'string' && id.length > 0 && id.length <= 256 && id === id.trim() && !/[\u0000-\u001f\u007f]/.test(id);

// Identity is decided by the server configuration (env.AUTH_MODE), never by the browser.
// - 'sites': ChatGPT Sites strips client identity headers and sets oai-authenticated-user-id.
//   Only safe behind Sites. On any other host a client could send this header itself.
// - 'local-dev': fixed development identity, accepted only for localhost requests.
// - anything else (including unset): no identity. Personal APIs answer 401 (fail closed).
// Never accept identity from a body, query string or client-supplied storage key.
export function authenticatedUser(request, env = {}) {
  const mode = env?.AUTH_MODE;
  if (mode === 'sites') {
    const id = request.headers.get('oai-authenticated-user-id');
    return validIdentity(id) ? id : null;
  }
  if (mode === 'local-dev') {
    if (!LOCAL_HOSTS.has(new URL(request.url).hostname)) return null;
    const id = env.DEV_USER_ID || 'local-dev-user';
    return validIdentity(id) ? id : null;
  }
  return null;
}

export function validateRequestOrigin(request) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) return false;
  if (origin && origin !== new URL(request.url).origin) return false;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !origin && site !== 'same-origin') return false;
  return true;
}

export async function enforceRateLimit(env, userId, bucket = 'products', now = Date.now()) {
  const key = `nutrition:${bucket}:${userId}`;
  const binding = env?.NUTRITION_RATE_LIMITER;
  if (binding !== undefined && (!binding || typeof binding.limit !== 'function')) return apiFailure('Der Anfrageschutz ist nicht korrekt eingerichtet.', 503, 'rate_limit_unavailable');
  if (binding && typeof binding.limit === 'function') {
    try {
      const result = await binding.limit({ key });
      if (!result || result.success !== true) return apiFailure('Zu viele Anfragen. Bitte warte eine Minute.', 429, 'rate_limited', { 'retry-after': '60' });
    } catch {
      return apiFailure('Der Anfrageschutz ist gerade nicht erreichbar. Bitte versuche es später erneut.', 503, 'rate_limit_unavailable');
    }
  }
  // Additional per-isolate safeguards are always active. Configure the binding
  // for durable cross-isolate enforcement; this bounded map alone is not global.
  for (const [storedKey, value] of localWindows) if (value.until <= now) localWindows.delete(storedKey);
  let entry = localWindows.get(key);
  if (!entry) {
    if (localWindows.size >= MAX_LOCAL_IDENTITIES) return apiFailure('Der Dienst ist gerade ausgelastet. Bitte versuche es später erneut.', 503, 'rate_limit_capacity');
    entry = { count: 0, until: now + LOCAL_WINDOW_MS };
    localWindows.set(key, entry);
  }
  entry.count++;
  if (entry.count > (LIMITS[bucket] || LIMITS.products)) {
    return apiFailure('Zu viele Anfragen. Bitte warte kurz und versuche es erneut.', 429, 'rate_limited', { 'retry-after': String(Math.max(1, Math.ceil((entry.until - now) / 1000))) });
  }
  return null;
}

export function resetLocalRateLimits() { localWindows.clear(); }
