import { apiJson, apiFailure, authenticatedUser, enforceRateLimit } from './security.mjs';

// Magic-Link-Anmeldung mit Sitzungen in Cloudflare D1 (Binding env.DB).
// Sicherheitsprinzipien:
// - Login- und Sitzungstokens: 256 Bit Zufall, in der Datenbank nur als SHA-256-Hash.
// - Ein Login-Link gilt 15 Minuten und genau einmal. Der Link selbst meldet nicht an:
//   Erst ein Klick auf "Anmelden" (POST) verbraucht ihn. So können E-Mail-Scanner,
//   die Links vorab öffnen, den Link nicht entwerten oder jemanden anmelden.
// - Die Antwort auf eine Link-Anfrage verrät nicht, ob ein Konto existiert.
// - Der Link zeigt immer auf APP_ORIGIN (nie auf einen vom Client gesendeten Host),
//   außer bei lokaler Entwicklung auf localhost.
// - Sitzungscookie: __Host-Präfix, HttpOnly, Secure, SameSite=Lax, 30 Tage.

export const SESSION_COOKIE = '__Host-nouri_session';
export const LOGIN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const isLocal = url => LOCAL_HOSTS.has(new URL(url).hostname);

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (/[\s\u0000-\u001f\u007f<>"'(),;:\\[\]]/.test(email)) return null;
  return /^[^@]+@[^@]+\.[a-z]{2,}$/.test(email) ? email : null;
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/** Basis-URL für Links in E-Mails. Null bedeutet: Anmeldung ist nicht eingerichtet. */
export function appOrigin(request, env) {
  if (typeof env.APP_ORIGIN === 'string' && env.APP_ORIGIN) {
    try {
      const url = new URL(env.APP_ORIGIN);
      if (url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) return url.origin;
    } catch {}
    return null;
  }
  return isLocal(request.url) ? new URL(request.url).origin : null;
}

/** E-Mail-Versand. Bisher nur die Konsole für lokale Entwicklung (Stufe 7: echter Anbieter). */
function mailer(request, env) {
  if (env.EMAIL_MODE === 'console' && isLocal(request.url)) {
    return async (email, link) => { console.log(`[nouri] Anmeldelink für ${email}: ${link}`); };
  }
  return null;
}

export function loginAvailable(request, env) {
  return env?.AUTH_MODE === 'magic-link' && Boolean(env.DB) && Boolean(appOrigin(request, env)) && Boolean(mailer(request, env));
}

/** Angemeldetes Konto aus dem Sitzungscookie, oder null. */
export async function sessionAccount(request, env, now = Date.now()) {
  if (!env?.DB) return null;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const row = await env.DB.prepare(
    'SELECT users.id AS id, users.email AS email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?'
  ).bind(await sha256(token), now).first();
  return row ? { id: row.id, email: row.email } : null;
}

/** Identität für alle Anmeldemodi. Gibt { id, email? } oder null zurück. */
export async function resolveAccount(request, env = {}) {
  if (env?.AUTH_MODE === 'magic-link') {
    try { return await sessionAccount(request, env); } catch { return null; }
  }
  const id = authenticatedUser(request, env);
  return id ? { id } : null;
}

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (/^application\/json(?:\s*;|$)/i.test(type)) {
    const text = await request.text();
    if (text.length > 4096) return null;
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  }
  if (/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(type)) {
    const text = await request.text();
    if (text.length > 4096) return null;
    return Object.fromEntries(new URLSearchParams(text));
  }
  return null;
}

const redirect = (location, headers = {}) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store', ...headers } });

async function requestLink(request, env, now) {
  if (!loginAvailable(request, env)) return apiFailure('Die Anmeldung ist noch nicht eingerichtet.', 503, 'login_unavailable');
  let body;
  try { body = await readBody(request); } catch { body = null; }
  const email = normalizeEmail(body?.email);
  if (!email) return apiFailure('Bitte gib eine gültige E-Mail-Adresse ein.', 400, 'invalid_email');
  const client = request.headers.get('cf-connecting-ip') || 'unknown';
  const limited = await enforceRateLimit(env, 'ip:' + client, 'login', now) || await enforceRateLimit(env, 'mail:' + await sha256(email), 'login', now);
  if (limited) return limited;
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now - LOGIN_TTL_MS),
    env.DB.prepare('INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), email, now, now + LOGIN_TTL_MS),
  ]);
  await mailer(request, env)(email, `${appOrigin(request, env)}/anmelden?token=${token}`);
  return apiJson({ ok: true, message: 'Wir haben dir einen Anmeldelink geschickt. Er ist 15 Minuten gültig.' });
}

async function verifyLink(request, env, now) {
  if (env?.AUTH_MODE !== 'magic-link' || !env.DB) return redirect('/anmelden?fehler=nicht-eingerichtet');
  let body;
  try { body = await readBody(request); } catch { body = null; }
  const token = body?.token;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return redirect('/anmelden?fehler=ungueltig');
  // Atomar: nur ein einziger Request kann diesen Token verbrauchen.
  const used = await env.DB.prepare(
    'UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email'
  ).bind(now, await sha256(token), now).first();
  if (!used) return redirect('/anmelden?fehler=ungueltig');
  const user = await env.DB.prepare(
    'INSERT INTO users (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET last_login_at = excluded.last_login_at RETURNING id'
  ).bind(crypto.randomUUID(), used.email, now, now).first();
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(session), user.id, now, now + SESSION_TTL_MS),
  ]);
  return redirect('/', { 'set-cookie': sessionCookie(session, SESSION_TTL_MS / 1000) });
}

async function logout(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (env?.DB && token && TOKEN_PATTERN.test(token)) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  return apiJson({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

async function deleteAccount(request, env) {
  const account = await sessionAccount(request, env);
  if (!account) return apiFailure('Bitte melde dich an, um diese Funktion zu verwenden.', 401, 'authentication_required');
  let body;
  try { body = await readBody(request); } catch { body = null; }
  if (body?.confirm !== true) return apiFailure('Bitte bestätige das Löschen deines Kontos.', 400, 'confirmation_required');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(account.id),
    env.DB.prepare('DELETE FROM login_tokens WHERE email = ?').bind(account.email),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(account.id),
  ]);
  return apiJson({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

export const AUTH_ROUTES = ['/api/auth/request', '/api/auth/verify', '/api/auth/logout', '/api/account/delete'];

/** Wird von handleApi nach der Herkunftsprüfung aufgerufen. */
export async function handleAuth(request, env, path, now = Date.now()) {
  if (request.method !== 'POST') return apiFailure('Diese Anfrage wird nicht unterstützt.', 405, 'method_not_allowed', { allow: 'POST' });
  if (path === '/api/auth/request') return requestLink(request, env, now);
  if (path === '/api/auth/verify') return verifyLink(request, env, now);
  if (path === '/api/auth/logout') return logout(request, env);
  return deleteAccount(request, env);
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Bestätigungsseite für den Link aus der E-Mail. Sie verbraucht den Token nicht. */
export function loginPage(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const error = url.searchParams.get('fehler');
  const valid = TOKEN_PATTERN.test(token);
  const message = error === 'nicht-eingerichtet' ? 'Die Anmeldung ist noch nicht eingerichtet.'
    : error || !valid ? 'Dieser Anmeldelink ist ungültig oder abgelaufen. Fordere in der App einfach einen neuen an.' : '';
  const content = message
    ? `<p class="inline-error" role="alert">${escapeHtml(message)}</p><div class="form-actions"><a class="button primary" href="/">Zur App</a></div>`
    : `<p>Tippe auf „Anmelden“, um dich bei nouri anzumelden. Der Link funktioniert nur einmal.</p><form method="post" action="/api/auth/verify"><input type="hidden" name="token" value="${escapeHtml(token)}"><div class="form-actions"><button class="button primary" type="submit">Anmelden</button></div></form>`;
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#31343e"><meta name="robots" content="noindex"><title>Anmelden · nouri</title><link rel="icon" href="/assets/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/theme.css"></head><body><div class="app-shell"><header class="app-header"><span class="header-spacer" aria-hidden="true"></span><a class="brand" href="/" aria-label="nouri Startseite">nouri.</a><span class="header-spacer" aria-hidden="true"></span></header><main><h1 class="view-title">Fast geschafft.</h1>${content}</main></div></body></html>`;
  return new Response(request.method === 'HEAD' ? null : html, { headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; script-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  } });
}
