import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedUser, validateRequestOrigin, enforceRateLimit, resetLocalRateLimits } from '../server/security.mjs';

function request(headers = {}, method = 'POST') { return new Request('https://nouri.example/api/analyze', { method, headers }); }

test('identity must come from Sites headers, never request data or fabricated defaults', () => {
  const sites = { AUTH_MODE: 'sites' };
  assert.equal(authenticatedUser(request(), sites), null);
  assert.equal(authenticatedUser(request({'x-user-id':'other'}), sites), null);
  assert.equal(authenticatedUser(request({'oai-authenticated-user-id':'owner-123'}), sites), 'owner-123');
  assert.equal(authenticatedUser(request({'oai-authenticated-user-id':'x'.repeat(257)}), sites), null);
});

test('without an explicit auth mode the Sites header is never trusted', () => {
  for (const env of [undefined, {}, { AUTH_MODE: '' }, { AUTH_MODE: 'SITES' }, { AUTH_MODE: 'unknown' }]) {
    assert.equal(authenticatedUser(request({'oai-authenticated-user-id':'attacker'}), env), null);
  }
});

test('local development identity only works on localhost', () => {
  const dev = { AUTH_MODE: 'local-dev' };
  const at = (host, headers = {}) => new Request(`http://${host}/api/session`, { headers });
  assert.equal(authenticatedUser(at('localhost:8787'), dev), 'local-dev-user');
  assert.equal(authenticatedUser(at('127.0.0.1:8787'), { ...dev, DEV_USER_ID: 'tester' }), 'tester');
  assert.equal(authenticatedUser(at('nouri.example'), dev), null);
  assert.equal(authenticatedUser(at('localhost.attacker.example'), dev), null);
  assert.equal(authenticatedUser(at('nouri.example', {'oai-authenticated-user-id':'x'}), dev), null);
});
test('mutations require same-origin evidence and cross-site requests are rejected', () => {
  assert.equal(validateRequestOrigin(request()), false);
  assert.equal(validateRequestOrigin(request({origin:'https://attacker.example'})), false);
  assert.equal(validateRequestOrigin(request({origin:'https://nouri.example'})), true);
  assert.equal(validateRequestOrigin(request({'sec-fetch-site':'same-origin'})), true);
  assert.equal(validateRequestOrigin(request({'sec-fetch-site':'cross-site',origin:'https://nouri.example'})), false);
  assert.equal(validateRequestOrigin(request({},'GET')), true);
});
test('rate limiting separates user IDs, expires windows and supplies Retry-After', async () => {
  resetLocalRateLimits();
  for (let i=0;i<10;i++) assert.equal(await enforceRateLimit({},'user-a','ai',0), null);
  const blocked=await enforceRateLimit({},'user-a','ai',1000);
  assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'59');
  assert.equal(await enforceRateLimit({},'user-b','ai',1000),null);
  assert.equal(await enforceRateLimit({},'user-a','ai',60000),null);
  resetLocalRateLimits();
});
test('configured cross-isolate limiter is called with bucket and identity and fails closed', async () => {
  resetLocalRateLimits();let key;
  const env={NUTRITION_RATE_LIMITER:{limit:async options=>{key=options.key;return {success:false}}}};
  assert.equal((await enforceRateLimit(env,'owner','ai')).status,429);assert.equal(key,'nutrition:ai:owner');
  env.NUTRITION_RATE_LIMITER.limit=async()=>{throw Error('sensitive')};
  const result=await enforceRateLimit(env,'owner','ai');assert.equal(result.status,503);assert.doesNotMatch(await result.text(),/sensitive/);
});
