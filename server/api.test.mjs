import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from './api.mjs';
import { resetLocalRateLimits } from './security.mjs';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYyQAAAAASUVORK5CYII=';
const env={OPENAI_API_KEY:'test-secret-do-not-expose'};
const recognized={name:'Gemüse mit Reis',note:'Bitte Lebensmittel und Menge prüfen.',items:[{name:'unbekanntes Gemüse',grams:150,cookingMethod:'gekocht',recognitionConfidence:'medium',quantityConfidence:'low'}],questions:[{text:'Wie viel Öl wurde verwendet?',kind:'oil'}]};
function request(body={image},options={}){return new Request('https://nouri.example'+(options.path||'/api/analyze'),{method:'POST',headers:{'content-type':'application/json',origin:'https://nouri.example','oai-authenticated-user-id':'test-owner',...options.headers},body:JSON.stringify(body)});}
function provider(result=recognized){return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});}
test.beforeEach(resetLocalRateLimits);

test('configuration reveals only availability; session returns the signed-in identity',async()=>{
 assert.deepEqual(await(await handleApi(new Request('https://nouri.example/api/config'),{})).json(),{aiAvailable:false});
 assert.deepEqual(await(await handleApi(new Request('https://nouri.example/api/config'),env)).json(),{aiAvailable:true});
 assert.equal((await handleApi(new Request('https://nouri.example/api/session'),env)).status,401);
 const session=await handleApi(new Request('https://nouri.example/api/session',{headers:{'oai-authenticated-user-id':'user-123'}}),env);assert.deepEqual(await session.json(),{userId:'user-123'});
});
test('protected endpoints reject missing identity and cross-origin mutation before providers run',async()=>{
 const anonymous=request();anonymous.headers.delete('oai-authenticated-user-id');assert.equal((await handleApi(anonymous,env)).status,401);
 assert.equal((await handleApi(request({image},{headers:{origin:'https://attacker.example'}}),env)).status,403);
 const noOrigin=request();noOrigin.headers.delete('origin');assert.equal((await handleApi(noOrigin,env)).status,403);
 assert.equal((await handleApi(new Request('https://nouri.example/api/products/4000000000000'),env)).status,401);
});
test('unconfigured AI never simulates a food result for meals or fridge scans',async()=>{
 for(const path of ['/api/analyze','/api/fridge/analyze']){const response=await handleApi(request({image},{path}),{});assert.equal(response.status,503);const body=await response.json();assert.equal(body.code,'ai_not_configured');assert.equal(body.items,undefined);}
});
test('unsupported routes and methods return bounded structured errors',async()=>{
 assert.equal((await handleApi(new Request('https://nouri.example/api/missing'),env)).status,404);
 const response=await handleApi(new Request('https://nouri.example/api/analyze'),env);assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'POST');
});
test('invalid image structures, body fields and content types never reach the model',async t=>{
 let called=false;t.mock.method(globalThis,'fetch',async()=>{called=true;return provider()});
 for(const body of [{image:'https://external.example/image.jpg'},{image:'data:image/svg+xml;base64,PHN2Zz4='},{image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'},{image,notes:'x'.repeat(1001)},{image,userId:'other-user'}])assert.equal((await handleApi(request(body),env)).status,400);
 assert.equal((await handleApi(request({image},{headers:{'content-type':'text/plain'}}),env)).status,415);assert.equal(called,false);
});
test('oversized requests are rejected without parsing or model calls',async()=>{
 const response=await handleApi(request({image},{headers:{'content-length':String(8*1024*1024)}}),env);assert.equal(response.status,413);assert.equal((await response.json()).code,'too_large');
});
test('recognition is server-authenticated, strict-schema and separates recognition from quantity',async t=>{
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.authorization,`Bearer ${env.OPENAI_API_KEY}`);
  const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.input[0].content[1].image_url,image);
  const properties=body.text.format.schema.properties.items.items.properties;assert.equal(properties.kcal,undefined);assert.equal(properties.protein,undefined);assert.ok(properties.recognitionConfidence);assert.ok(properties.quantityConfidence);
  return provider();
 });
 const response=await handleApi(request(),env);assert.equal(response.status,200);const result=await response.json();assert.equal(result.schemaVersion,2);assert.equal(result.items[0].confirmed,false);assert.equal(result.items[0].quantityEstimated,true);assert.equal(result.items[0].quantityConfidence,'low');assert.equal(result.items[0].kcal,null);assert.equal(result.questions[0].kind,'oil');
});
test('fridge scanning recognizes multiple pending ingredients without invented recipes or quantities',async t=>{
 t.mock.method(globalThis,'fetch',async()=>provider({...recognized,items:[...recognized.items,{...recognized.items[0],name:'unbekannter Joghurt',grams:null,quantityConfidence:'needs_confirmation'}]}));
 const response=await handleApi(request({image},{path:'/api/fridge/analyze'}),env);assert.equal(response.status,200);const result=await response.json();assert.equal(result.items.length,2);assert.equal(result.items[1].grams,null);assert.deepEqual(result.questions,[]);assert.equal(result.recipes,undefined);
});
test('no-food photos and invalid model output are rejected instead of logged',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async()=>provider({...recognized,items:[]}));assert.equal((await handleApi(request(),env)).status,422);
 mock.mock.mockImplementation(async()=>provider({...recognized,items:[{...recognized.items[0],kcal:123}]}));const malformed=await handleApi(request(),env);assert.equal(malformed.status,502);assert.equal((await malformed.json()).code,'invalid_analysis');
});
test('upstream failures, partial output and secrets are safely handled',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async()=>new Response(env.OPENAI_API_KEY,{status:401}));let response=await handleApi(request(),env);assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/test-secret/);
 mock.mock.mockImplementation(async()=>{throw Error(env.OPENAI_API_KEY)});response=await handleApi(request(),env);assert.equal(response.status,502);assert.doesNotMatch(await response.text(),/test-secret/);
 mock.mock.mockImplementation(async()=>new Response('',{status:429}));response=await handleApi(request(),env);assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');
 mock.mock.mockImplementation(async()=>Response.json({status:'incomplete',output:[]}));response=await handleApi(request(),env);assert.equal((await response.json()).code,'incomplete_analysis');
});
test('AI rate limits apply per signed-in user and do not reveal scan contents',async t=>{
 t.mock.method(globalThis,'fetch',async()=>provider());for(let i=0;i<10;i++)assert.equal((await handleApi(request(),env)).status,200);
 const blocked=await handleApi(request(),env);assert.equal(blocked.status,429);assert.equal((await blocked.json()).code,'rate_limited');
 assert.equal((await handleApi(request({image},{headers:{'oai-authenticated-user-id':'another-user'}}),env)).status,200);
});

test('canceling the photo request aborts the upstream model request',async t=>{
 const controller=new AbortController();let reached;
 const called=new Promise(resolve=>{reached=resolve});
 t.mock.method(globalThis,'fetch',async(_url,options)=>{reached();return new Promise((_resolve,reject)=>{const fail=()=>{const error=new Error('Aborted');error.name='AbortError';reject(error)};if(options.signal.aborted)fail();else options.signal.addEventListener('abort',fail,{once:true})});});
 const base=request();const cancelable=new Request(base,{signal:controller.signal});const pending=handleApi(cancelable,env);await called;controller.abort();const response=await pending;assert.equal(response.status,504);assert.equal((await response.json()).code,'analysis_timeout');
});
