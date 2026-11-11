import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../dist/server/index.js';
const base='https://nouri.example';
const get=(path,options)=>worker.fetch(new Request(base+path,options),{});
const authenticatedHeaders = (userId = 'worker-user') => ({ origin: base, 'oai-authenticated-user-id': userId });
test('dashboard and all local frontend references are served from the Worker',async()=>{
 const response=await get('/');assert.equal(response.status,200);
 const html=await response.text();assert.match(html,/<html lang="de">/);assert.match(html,/Beispieltag/);
 const urls=[...html.matchAll(/(?:src|href)="(\/[^\"]+)"/g)].map(m=>m[1]);
 for(const url of urls){const asset=await get(url);assert.equal(asset.status,200,url);assert.ok((await asset.arrayBuffer()).byteLength>0,url);}
 assert.equal((await get('/style.css')).headers.get('content-type'),'text/css; charset=utf-8');
 assert.equal((await get('/app.js')).headers.get('content-type'),'text/javascript; charset=utf-8');
});
test('the browser module graph includes every static and dynamically loaded frontend dependency',async()=>{
 const queue=['/app.js'],seen=new Set();
 while(queue.length){
  const path=queue.shift();if(seen.has(path))continue;seen.add(path);
  const response=await get(path);assert.equal(response.status,200,path);
  assert.equal(response.headers.get('content-type'),'text/javascript; charset=utf-8',path);
  const js=await response.text();
  for(const match of js.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g))queue.push(new URL(match[1],base+path).pathname);
 }
 for(const module of ['/feature-store.js','/features.js','/metabolism.js','/metabolism-ui.js','/nutrition.js','/recipes.js'])assert.equal(seen.has(module),true,module);
});
test('embedded images are JPEGs and SVG is served correctly',async()=>{
 for(const path of ['/assets/bowl.jpg','/assets/breakfast.jpg','/assets/salad.jpg']){const r=await get(path);assert.equal(r.status,200);const b=new Uint8Array(await r.arrayBuffer());assert.deepEqual([...b.slice(0,3)],[255,216,255]);assert.ok(b.length>5000);}
 assert.equal((await get('/assets/icon.svg')).headers.get('content-type'),'image/svg+xml');
});
test('privacy headers restrict microphone, geolocation, scripts and photo connections',async()=>{
 const r=await get('/');assert.match(r.headers.get('permissions-policy'),/camera=\(self\)/);assert.match(r.headers.get('permissions-policy'),/microphone=\(\)/);assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');
});
test('API availability is accurate and unconfigured AI never gives a simulated result',async()=>{
 const c=await get('/api/config');assert.deepEqual(await c.json(),{aiAvailable:false});
 const a=await get('/api/analyze',{method:'POST',headers:{...authenticatedHeaders(),'content-type':'application/json'},body:JSON.stringify({image:'test'})});assert.equal(a.status,503);const j=await a.json();assert.equal(j.code,'ai_not_configured');assert.equal(j.items,undefined);
});

test('meal and fridge analysis require authenticated identity before using the AI service',async()=>{
 for(const path of ['/api/analyze','/api/fridge/analyze']) {
  const r=await get(path,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({image:'test'})});
  assert.equal(r.status,401,path);assert.equal((await r.json()).code,'authentication_required');
 }
});

test('authenticated HTML identifies only its requesting user and cannot be cached across accounts',async()=>{
 const user='user-ä:<unsafe>"&';
 const r=await get('/',{headers:authenticatedHeaders(user)});
 assert.match(r.headers.get('cache-control'),/(?:^|,\s*)no-store(?:,|$)/);
 const html=await r.text();
 assert.match(html,/<meta name="nouri-user-id" content="user-ä:&lt;unsafe&gt;&quot;&amp;">/);
 assert.doesNotMatch(html,/<unsafe>/);
 const other=await(await get('/',{headers:authenticatedHeaders('other-user')})).text();
 assert.match(other,/<meta name="nouri-user-id" content="other-user">/);
 assert.doesNotMatch(other,/user-ä/);
 const anon=await(await get('/')).text();
 assert.doesNotMatch(anon,/<meta name="nouri-user-id" content="(?:user-ä|other-user)/);
});

test('session API uses platform identity and rejects browser request data as identity',async()=>{
 const a=await get('/api/session?userId=forged');assert.equal(a.status,401);
 const b=await get('/api/session?userId=forged',{headers:authenticatedHeaders('verified-user')});
 assert.equal(b.status,200);assert.deepEqual(await b.json(),{userId:'verified-user'});
 assert.equal(b.headers.get('cache-control'),'no-store');
});

test('cross-origin writes are rejected even for a signed-in visitor',async()=>{
 const r=await get('/api/analyze',{method:'POST',headers:{...authenticatedHeaders('cross-origin-user'),origin:'https://foreign.example','content-type':'application/json'},body:'{}'});
 assert.equal(r.status,403);assert.equal((await r.json()).code,'forbidden_origin');
});
test('HEAD is bodyless and missing paths/methods are rejected',async()=>{
 const head=await get('/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal((await get('/missing')).status,404);assert.equal((await get('/',{method:'POST'})).status,405);
});
test('deployed output contains source manifest identity and no client-side credentials',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../.openai/hosting.json',import.meta.url),'utf8'));
 const packaged=JSON.parse(await readFile(new URL('../dist/.openai/hosting.json',import.meta.url),'utf8'));assert.deepEqual(packaged,manifest);
 const js=await(await get('/app.js')).text();assert.doesNotMatch(js,/sk-[a-zA-Z0-9]{20,}/);assert.doesNotMatch(js,/Authorization.*Bearer/);assert.match(js,/createImageBitmap/);assert.match(js,/getUserMedia/);
});
