import {readFile,writeFile,readdir,mkdir,rm} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('.openai/hosting.json',root),'utf8'));
if(!manifest.project_id||manifest.static)throw Error('Worker manifest requires project_id and no static directory.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'};
const assets={};
async function collect(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.isDirectory())await collect(join(dir,entry.name),prefix+'/'+entry.name);else{const bytes=await readFile(join(dir,entry.name));assets[prefix+'/'+entry.name]={data:bytes.toString('base64'),type:types[extname(entry.name)]||'application/octet-stream'};}}}
await collect(new URL('web/',root).pathname);
if(!assets['/index.html']||!assets['/assets/bowl.jpg'])throw Error('Missing essential frontend assets');
await rm(new URL('dist/',root),{recursive:true,force:true});
await mkdir(new URL('dist/server/',root),{recursive:true});
await mkdir(new URL('dist/.openai/',root),{recursive:true});
await build({absWorkingDir:root.pathname,entryPoints:['server/worker.mjs'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',legalComments:'none',plugins:[{name:'embed-assets',setup(b){b.onResolve({filter:/^nouri:assets$/},()=>({path:'assets',namespace:'nouri'}));b.onLoad({filter:/.*/,namespace:'nouri'},()=>({contents:'export default '+JSON.stringify(assets),loader:'js'}));}}]});
await writeFile(new URL('dist/.openai/hosting.json',root),JSON.stringify(manifest,null,2));
console.log(`Built Worker with ${Object.keys(assets).length} embedded assets.`);
