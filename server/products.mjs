import {catalog} from '../web/nutrition.js';
const OFF_ORIGIN='https://world.openfoodfacts.org';
const ATTRIBUTION={name:'Open Food Facts',url:OFF_ORIGIN,license:'ODbL (database) / DbCL (contents)',termsUrl:OFF_ORIGIN+'/terms-of-use',notice:'Community-Daten: Nährwerte bitte anhand der Verpackung prüfen.'};
const PRODUCT_TTL=86400,SEARCH_TTL=600,MAX_CACHE=150;
const productCache=new Map(),searchCache=new Map(),buckets=new Map();let upstreamBlockedUntil=0;
const nutrientNames={kcal:'energy-kcal_100g',protein:'proteins_100g',carbs:'carbohydrates_100g',fat:'fat_100g',fiber:'fiber_100g',sugar:'sugars_100g'};
const fields='code,product_name,product_name_de,generic_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,product_quantity,product_quantity_unit,quantity,nutrition_data_per,categories_tags';
function response(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff',...headers}})}
function error(message,status,code,headers){return response({error:message,code},status,headers)}
function cleanText(value,max=160){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max):'';}
function finiteNutrient(value,max){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?value:null;}
export function isValidBarcode(value){
 if(typeof value!=='string'||!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value))return false;
 const digits=[...value].map(Number),check=digits.pop();let total=0;for(let i=digits.length-1,weight=3;i>=0;i--,weight=weight===3?1:3)total+=digits[i]*weight;return(10-total%10)%10===check;
}
export function normalizeProduct(raw,barcode,fetchedAt=new Date().toISOString()){
 if(!raw||typeof raw!=='object'||!isValidBarcode(barcode))return null;if(raw.code!==undefined&&String(raw.code)!==barcode)return null;
 const name=cleanText(raw.product_name_de)||cleanText(raw.product_name)||cleanText(raw.generic_name);if(!name)return null;
 const n=raw.nutriments&&typeof raw.nutriments==='object'?raw.nutriments:{};const per100={};for(const[key,off]of Object.entries(nutrientNames))per100[key]=finiteNutrient(n[off],key==='kcal'?1500:100);
 if(per100.kcal===null){const kj=finiteNutrient(n.energy_100g,8370);if(kj!==null&&(n.energy_unit==='kJ'||n.energy_unit==='kj'))per100.kcal=Math.round(kj/4.184*100)/100;}
 const servingLabel=cleanText(raw.serving_size,100)||null;
 const declaredUnit=cleanText(raw.serving_quantity_unit,10).toLowerCase(),packageUnit=cleanText(raw.product_quantity_unit,10).toLowerCase();
 const basisText=cleanText(raw.nutrition_data_per,30).toLowerCase(),quantityLabel=cleanText(raw.quantity,100).toLowerCase();
 const explicitVolumeBasis=/^100\s*ml$/.test(basisText),explicitMassBasis=/^100\s*g$/.test(basisText);
 const servingVolume=declaredUnit==='ml'||(!declaredUnit&&/^\s*[\d.,]+\s*ml\s*$/i.test(servingLabel||''));
 const servingMass=declaredUnit==='g'||(!declaredUnit&&/^\s*[\d.,]+\s*g\s*$/i.test(servingLabel||''));
 const packageVolume=['ml','cl','dl','l'].includes(packageUnit)||/^(?:\d+\s*[x×]\s*)?\d+(?:[.,]\d+)?\s*(?:ml|cl|dl|l)$/.test(quantityLabel);
 const packageMass=['g','kg'].includes(packageUnit)||/^(?:\d+\s*[x×]\s*)?\d+(?:[.,]\d+)?\s*(?:g|kg)$/.test(quantityLabel);
 const volume=explicitVolumeBasis||servingVolume||packageVolume,mass=explicitMassBasis||servingMass||packageMass;
 const unit=volume&&mass?'unknown':volume?'ml':'g',nutritionBasis=unit==='unknown'?'unknown':unit==='ml'?'100ml':'100g';let servingGrams=null,servingMl=null;
 const servingQuantity=finiteNutrient(raw.serving_quantity,100000);const exactMetric=(servingLabel||'').match(/^\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\s*$/i);
 if(servingQuantity!==null&&servingQuantity>0){if(declaredUnit==='g')servingGrams=servingQuantity;else if(declaredUnit==='ml')servingMl=servingQuantity;}
 if(exactMetric){const amount=Number(exactMetric[1].replace(',','.'));if(amount>0&&amount<=100000){if(exactMetric[2].toLowerCase()==='g')servingGrams=amount;else servingMl=amount;}}
 const categoryTags=Array.isArray(raw.categories_tags)?raw.categories_tags.filter(tag=>typeof tag==='string'&&/^en:[a-z0-9-]{1,100}$/.test(tag)).slice(0,20):[];
 return {id:'off:'+barcode,barcode,name,brand:cleanText(raw.brands,100)||null,per100,unit,nutritionBasis,per100Basis:nutritionBasis,servingGrams,servingMl,servingLabel,categoryTags,complete:nutritionBasis!=='unknown'&&['kcal','protein','carbs','fat'].every(k=>per100[k]!==null),source:{name:'Open Food Facts',url:OFF_ORIGIN+'/product/'+barcode,recordId:barcode,license:ATTRIBUTION.license,fetchedAt},fetchedAt};
}
function limit(kind){const now=Date.now(),window=Math.floor(now/60000);const bucket=buckets.get(kind);const count=bucket?.window===window?bucket.count:0;const max=kind==='search'?8:90;if(count>=max)return false;buckets.set(kind,{window,count:count+1});return true;}
function memoryGet(map,key){const item=map.get(key);if(!item)return null;if(item.expires<=Date.now()){map.delete(key);return null;}return item.body;}
function memoryPut(map,key,body,ttl){if(map.size>=MAX_CACHE)map.delete(map.keys().next().value);map.set(key,{body,expires:Date.now()+ttl*1000});}
async function cachedRead(key,map){const memory=memoryGet(map,key);if(memory)return memory;try{const hit=await globalThis.caches?.default?.match(new Request(key));if(hit){const body=await hit.json();memoryPut(map,key,body,60);return body}}catch{}return null;}
function cachedWrite(key,map,body,ttl,ctx){memoryPut(map,key,body,ttl);try{const promise=globalThis.caches?.default?.put(new Request(key),new Response(JSON.stringify(body),{headers:{'content-type':'application/json','cache-control':'public, max-age='+ttl}}));if(promise){if(ctx?.waitUntil)ctx.waitUntil(promise.catch(()=>{}));else promise.catch(()=>{});}}catch{}}
async function offFetch(url,env,kind){
 if(Date.now()<upstreamBlockedUntil){const e=new Error('rate');e.status=429;e.retry=Math.ceil((upstreamBlockedUntil-Date.now())/1000);throw e;}
 if(!limit(kind)){const e=new Error('rate');e.status=429;e.retry=60;throw e;}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{
  const contact=typeof env.OFF_CONTACT_EMAIL==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OFF_CONTACT_EMAIL)?'; contact: '+env.OFF_CONTACT_EMAIL:'';
  let appURL='';try{const parsed=new URL(env.OFF_APP_URL);if(parsed.protocol==='https:')appURL='; '+parsed.origin;}catch{}
  const reply=await fetch(url,{headers:{'User-Agent':'nouri/1.1 (Cloudflare Worker'+appURL+contact+')','Accept':'application/json'},signal:controller.signal});
  if(reply.status===429){const retryHeader=reply.headers.get('retry-after');let retry=Number(retryHeader);if(!Number.isFinite(retry)||retry<1)retry=retryHeader?Math.ceil((Date.parse(retryHeader)-Date.now())/1000):60;retry=Math.min(3600,Math.max(1,Number.isFinite(retry)?retry:60));upstreamBlockedUntil=Date.now()+retry*1000;const e=new Error('rate');e.status=429;e.retry=retry;throw e;}
  if(reply.status===404){const e=new Error('unknown');e.status=404;throw e;}
  if(!reply.ok)throw new Error('upstream');
  const declaredLength=Number(reply.headers.get('content-length'));if(Number.isFinite(declaredLength)&&declaredLength>2_000_000)throw new Error('upstream');
  const text=await reply.text();if(text.length>2_000_000)throw new Error('upstream');return JSON.parse(text);
 }finally{clearTimeout(timer)}
}
export async function handleProductRequest(request,env={},ctx){
 const url=new URL(request.url);if(request.method!=='GET')return error('Diese Anfrage wird nicht unterstützt.',405,'method_not_allowed',{'allow':'GET'});
 if(url.pathname==='/api/foods'){const query=cleanText(url.searchParams.get('query')||'',100).toLocaleLowerCase('de');return response({foods:catalog.filter(food=>!query||[food.name,...food.aliases].some(v=>v.toLocaleLowerCase('de').includes(query))).slice(0,30)});}
 const barcodeMatch=/^\/api\/products\/([^/]+)$/.exec(url.pathname);let barcode=barcodeMatch?.[1]||url.searchParams.get('barcode');
 if(barcode){if(!isValidBarcode(barcode))return error('Bitte gib einen gültigen EAN- oder UPC-Barcode ein.',400,'invalid_barcode');const key=OFF_ORIGIN+'/api/v2/product/'+barcode+'.json?fields='+fields;
  const cached=await cachedRead(key,productCache);if(cached)return response({...cached,cached:true});
  try{const data=await offFetch(key,{...env,OFF_APP_URL:url.origin},'product');const product=data.status===0?null:normalizeProduct(data.product,barcode);if(!product)return error('Dieses Produkt wurde nicht gefunden. Du kannst es manuell erfassen.',404,'product_not_found');const body={product,attribution:ATTRIBUTION,cached:false};cachedWrite(key,productCache,body,PRODUCT_TTL,ctx);return response(body);}catch(e){if(e.status===404)return error('Dieses Produkt wurde nicht gefunden. Du kannst es manuell erfassen.',404,'product_not_found');if(e.status===429)return error('Die Produktdatenbank ist gerade ausgelastet. Bitte versuche es später erneut.',429,'product_rate_limited',{'retry-after':String(e.retry||60)});return error('Die Produktdatenbank ist momentan nicht erreichbar. Bitte versuche es erneut oder erfasse das Produkt manuell.',502,'product_service_unavailable');}
 }
 if(url.pathname!=='/api/products')return error('Diese Funktion wurde nicht gefunden.',404,'not_found');
 const category=url.searchParams.get('category');if(!category||!/^en:[a-z0-9-]{1,100}$/.test(category))return error('Bitte wähle eine gültige Produktkategorie.',400,'invalid_category');
 const key=OFF_ORIGIN+'/api/v2/search?categories_tags='+encodeURIComponent(category)+'&countries_tags=en%3Agermany&fields='+fields+'&page_size=10&page=1';const cached=await cachedRead(key,searchCache);if(cached)return response({...cached,cached:true});
 try{const data=await offFetch(key,{...env,OFF_APP_URL:url.origin},'search');if(!Array.isArray(data.products))throw new Error('upstream');const products=data.products.map(raw=>normalizeProduct(raw,String(raw.code||''))).filter(Boolean);const body={products,attribution:ATTRIBUTION,cached:false};cachedWrite(key,searchCache,body,SEARCH_TTL,ctx);return response(body);}catch(e){if(e.status===429)return error('Die Produktsuche ist gerade ausgelastet. Bitte versuche es später erneut.',429,'product_rate_limited',{'retry-after':String(e.retry||60)});return error('Alternativen konnten gerade nicht geladen werden.',502,'product_service_unavailable');}
}
export function resetProductCachesForTests(){productCache.clear();searchCache.clear();buckets.clear();upstreamBlockedUntil=0;}
