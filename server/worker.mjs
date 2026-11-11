import { handleApi } from './api.mjs';
import { authenticatedUser } from './security.mjs';
import assets from 'nouri:assets';

const escapeAttribute=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export default {
 async fetch(request,env={},ctx) {
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/'))return handleApi(request,env,ctx);
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const asset=assets[url.pathname==='/'?'/index.html':url.pathname];
  if(!asset)return new Response('Seite nicht gefunden.',{status:404,headers:{'content-type':'text/plain; charset=utf-8'}});
  let bytes=Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));
  const document=asset.type.startsWith('text/html');
  if(document){
   const identity=authenticatedUser(request);
   const meta=`<meta name="nouri-user-id" content="${escapeAttribute(identity||'')}">`;
   bytes=new TextEncoder().encode(new TextDecoder().decode(bytes).replace('</head>',meta+'</head>'));
  }
  return new Response(request.method==='HEAD'?null:bytes,{headers:{
   'content-type':asset.type,
   'cache-control':document?'private, no-store':url.pathname.startsWith('/assets/')?'public, max-age=86400':'no-cache',
   'vary':document?'Cookie, oai-authenticated-user-id':'Accept-Encoding',
   'x-content-type-options':'nosniff',
   'referrer-policy':'same-origin',
   'permissions-policy':'camera=(self), microphone=(), geolocation=()',
   'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"
  }});
 }
};
