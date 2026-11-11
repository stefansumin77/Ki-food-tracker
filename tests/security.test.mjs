import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedUser, validateRequestOrigin, enforceRateLimit, resetLocalRateLimits } from '../server/security.mjs';

function request(headers = {}, method = 'POST') { return new Request('https://nouri.example/api/analyze', { method, headers }); }

test('identity must come from Sites headers, never request data or fabricated defaults', () => {
  assert.equal(authenticatedUser(request()), null);
  assert.equal(authenticatedUser(request({'x-user-id':'other'})), null);
  assert.equal(authenticatedUser(request({'oai-authenticated-user-id':'owner-123'})), 'owner-123');
  assert.equal(authenticatedUser(request({'oai-authenticated-user-id':'x'.repeat(257)})), null);
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
