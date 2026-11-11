import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../server/api.mjs';
import { resetLocalRateLimits } from '../server/security.mjs';
import { SESSION_COOKIE, SESSION_TTL_MS, normalizeEmail, sha256 } from '../server/auth.mjs';
import worker from '../dist/server/index.js';
import { createD1 } from './d1.mjs';

const local = 'http://localhost:8787';

function setup(extra = {}) {
  resetLocalRateLimits();
  return { AUTH_MODE: 'magic-link', EMAIL_MODE: 'console', DB: createD1(), ...extra };
}

function post(path, body, { base = local, headers = {}, form = false } = {}) {
  return new Request(base + path, {
    method: 'POST',
    headers: { origin: base, 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...headers },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
}

/** Fordert einen Link an und fängt den Konsolen-Versand ab. */
async function requestLink(env, email, options) {
  const original = console.log; const lines = [];
  console.log = line => lines.push(String(line));
  try {
    const response = await handleApi(post('/api/auth/request', { email }, options), env);
    const link = lines.map(line => line.match(/https?:\/\/\S+/)?.[0]).find(Boolean) || null;
    return { response, link, body: await response.json() };
  } finally { console.log = original; }
}

async function verify(env, token, base = local) {
  return handleApi(post('/api/auth/verify', { token }, { base, form: true }), env);
}

const cookieFrom = response => response.headers.get('set-cookie')?.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1] ?? null;
const withCookie = (path, cookie, init = {}) => new Request(local + path, { ...init, headers: { origin: local, cookie: `${SESSION_COOKIE}=${cookie}`, ...(init.headers || {}) } });

async function login(env, email = 'anna@example.com') {
  const { link } = await requestLink(env, email);
  const token = new URL(link).searchParams.get('token');
  const response = await verify(env, token);
  return { token, cookie: cookieFrom(response), response };
}

test('e-mail addresses are normalized and validated', () => {
  assert.equal(normalizeEmail('  Anna@Example.COM '), 'anna@example.com');
  for (const bad of ['', 'anna', 'anna@', '@example.com', 'a b@example.com', 'anna@example', '<a>@example.com', 'x'.repeat(250) + '@ex.de', 42, null]) assert.equal(normalizeEmail(bad), null, String(bad));
});

test('config reports login availability only when database, mailer and origin are set up', async () => {
  const cfg = async (env, base = local) => (await handleApi(new Request(base + '/api/config'), env)).json();
  assert.equal((await cfg(setup())).login, 'magic-link');
  assert.equal((await cfg(setup({ DB: undefined }))).login, 'unavailable');
  assert.equal((await cfg(setup({ EMAIL_MODE: undefined }))).login, 'unavailable');
  // Console e-mails are never used on a real domain, and without APP_ORIGIN no links are built there.
  assert.equal((await cfg(setup(), 'https://nouri.example')).login, 'unavailable');
  assert.equal((await cfg({})).login, undefined);
});

test('full magic-link flow: request, confirm page, sign in, session, logout', async () => {
  const env = setup();
  const { response, link, body } = await requestLink(env, 'Anna@Example.com');
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(link, /^http:\/\/localhost:8787\/anmelden\?token=[A-Za-z0-9_-]{43}$/);
  const token = new URL(link).searchParams.get('token');

  // Tokens are stored only as hashes.
  const stored = env.DB.raw.prepare('SELECT token_hash, email FROM login_tokens').all();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].token_hash, await sha256(token));
  assert.equal(stored[0].email, 'anna@example.com');
  assert.ok(!JSON.stringify(stored).includes(token));

  // Opening the link (e.g. by a mail scanner) does not consume it.
  const page = await worker.fetch(new Request(link), env);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<form method="post" action="\/api\/auth\/verify">/);
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  assert.equal(env.DB.raw.prepare('SELECT used_at FROM login_tokens').get().used_at, null);

  const signedIn = await verify(env, token);
  assert.equal(signedIn.status, 303);
  assert.equal(signedIn.headers.get('location'), '/');
  const cookieHeader = signedIn.headers.get('set-cookie');
  for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${SESSION_TTL_MS / 1000}`]) assert.ok(cookieHeader.includes(part), part);
  const cookie = cookieFrom(signedIn);
  assert.match(cookie, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(await sha256(cookie)).n, 1);

  const session = await (await handleApi(withCookie('/api/session', cookie), env)).json();
  assert.equal(session.email, 'anna@example.com');
  assert.match(session.userId, /^[0-9a-f-]{36}$/);

  // The app shell receives the account id for its local storage namespace.
  const shell = await (await worker.fetch(withCookie('/', cookie), env)).text();
  assert.ok(shell.includes(`<meta name="nouri-user-id" content="${session.userId}">`));

  // Links work exactly once.
  assert.equal((await verify(env, token)).headers.get('location'), '/anmelden?fehler=ungueltig');

  const out = await handleApi(withCookie('/api/auth/logout', cookie, { method: 'POST' }), env);
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await handleApi(withCookie('/api/session', cookie), env)).status, 401);
});

test('signing in again reuses the same account', async () => {
  const env = setup();
  const first = await login(env, 'ben@example.com');
  const second = await login(env, 'BEN@example.com');
  const id = async cookie => (await (await handleApi(withCookie('/api/session', cookie), env)).json()).userId;
  assert.equal(await id(first.cookie), await id(second.cookie));
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('expired, unknown and malformed tokens are rejected', async () => {
  const env = setup();
  const { link } = await requestLink(env, 'carla@example.com');
  const token = new URL(link).searchParams.get('token');
  env.DB.raw.prepare('UPDATE login_tokens SET expires_at = ?').run(Date.now() - 1);
  for (const value of [token, 'A'.repeat(43), 'kurz', '../../etc', '']) {
    const response = await verify(env, value);
    assert.equal(response.headers.get('location'), '/anmelden?fehler=ungueltig', value);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const page = await (await worker.fetch(new Request(local + '/anmelden?token=kaputt'), env)).text();
  assert.match(page, /ungültig oder abgelaufen/);
  assert.ok(!page.includes('<form'));
});

test('expired sessions and forged cookies do not authenticate', async () => {
  const env = setup();
  const { cookie } = await login(env, 'dora@example.com');
  for (const forged of ['A'.repeat(43), 'abc', cookie + 'x', '']) assert.equal((await handleApi(withCookie('/api/session', forged), env)).status, 401, forged);
  env.DB.raw.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  assert.equal((await handleApi(withCookie('/api/session', cookie), env)).status, 401);
});

test('the response does not reveal whether an account exists', async () => {
  const env = setup();
  await login(env, 'emil@example.com');
  const known = await requestLink(env, 'emil@example.com');
  const unknown = await requestLink(env, 'fremd@example.com');
  assert.equal(known.response.status, unknown.response.status);
  assert.deepEqual(known.body, unknown.body);
});

test('links point to APP_ORIGIN, never to a host supplied by the client', async () => {
  const env = setup({ APP_ORIGIN: 'http://localhost:9999' });
  const { link } = await requestLink(env, 'finn@example.com', { base: 'http://127.0.0.1:8787' });
  assert.ok(link.startsWith('http://localhost:9999/anmelden?token='));

  // On a real domain without APP_ORIGIN and without a mail provider, login stays off.
  const remote = await requestLink(setup(), 'finn@example.com', { base: 'https://evil.example' });
  assert.equal(remote.response.status, 503);
  assert.equal(remote.link, null);

  assert.equal((await requestLink(setup({ APP_ORIGIN: 'javascript:alert(1)' }), 'finn@example.com')).response.status, 503);
  assert.equal((await requestLink(setup({ APP_ORIGIN: 'http://nouri.example' }), 'finn@example.com')).response.status, 503);
});

test('login requests are validated and rate limited', async () => {
  const env = setup();
  assert.equal((await requestLink(env, 'keine-adresse')).response.status, 400);
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await requestLink(env, 'gina@example.com')).response.status);
  assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
  assert.equal(statuses[5], 429);
});

test('cross-origin and non-POST auth requests are refused', async () => {
  const env = setup();
  const cross = post('/api/auth/request', { email: 'hana@example.com' }, { headers: { origin: 'https://evil.example' } });
  assert.equal((await handleApi(cross, env)).status, 403);
  assert.equal((await handleApi(new Request(local + '/api/auth/request', { headers: { origin: local } }), env)).status, 405);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM login_tokens').get().n, 0);
});

test('in magic-link mode the ChatGPT Sites header is ignored', async () => {
  const env = setup();
  const spoofed = new Request(local + '/api/session', { headers: { 'oai-authenticated-user-id': 'attacker' } });
  assert.equal((await handleApi(spoofed, env)).status, 401);
  const shell = await (await worker.fetch(new Request(local + '/', { headers: { 'oai-authenticated-user-id': 'attacker' } }), env)).text();
  assert.ok(shell.includes('<meta name="nouri-user-id" content="">'));
});

test('deleting the account requires confirmation and removes all account data', async () => {
  const env = setup();
  const { cookie } = await login(env, 'ida@example.com');
  await login(env, 'ida@example.com'); // second device
  await login(env, 'jan@example.com');
  const del = body => handleApi(withCookie('/api/account/delete', cookie, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
  assert.equal((await del({})).status, 400);
  assert.equal((await del({ confirm: 'yes' })).status, 400);
  const done = await del({ confirm: true });
  assert.equal(done.status, 200);
  assert.match(done.headers.get('set-cookie'), /Max-Age=0/);
  const count = (table, where = '') => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get().n;
  assert.equal(count('users', "WHERE email = 'ida@example.com'"), 0);
  assert.equal(count('login_tokens', "WHERE email = 'ida@example.com'"), 0);
  assert.equal(count('sessions'), 1); // only jan's session remains
  assert.equal(count('users'), 1);
  assert.equal((await handleApi(withCookie('/api/session', cookie), env)).status, 401);
  assert.equal((await handleApi(new Request(local + '/api/account/delete', { method: 'POST', headers: { origin: local } }), env)).status, 401);
});
