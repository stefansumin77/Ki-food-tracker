// Credential is read from hidden stdin, held only in memory, and passed to Git through environment.
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
process.stdout.write('Ready for repository credential JSON on stdin (input is hidden).\n');
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.includes('\n'))break;}
const credential=JSON.parse(raw.trim());raw='';
const env={...process.env};
if(credential.auth_mode==='http_extra_header'){
 env.GIT_CONFIG_COUNT='1';env.GIT_CONFIG_KEY_0='http.extraHeader';env.GIT_CONFIG_VALUE_0='Authorization: Bearer '+credential.token;
}else if(credential.auth_mode!=='work_proxy')throw Error('Unsupported Git credential mode');
function run(args,privateEnv=false){const result=spawnSync('git',args,{env:privateEnv?env:process.env,encoding:'utf8'});if(result.status!==0){const message=(result.stderr||result.stdout||'Git operation failed').split(credential.token||'\0').join('[redacted]');throw Error(message)}return result.stdout.trim()}
if(!existsSync('.git')){run(['init','-b',credential.branch]);}
run(['config','user.name','nouri']);run(['config','user.email','nouri@users.noreply.local']);
const remotes=run(['remote']);if(remotes.split('\n').includes('origin'))run(['remote','set-url','origin',credential.remote_url]);else run(['remote','add','origin',credential.remote_url]);
run(['add','.']);
const diff=spawnSync('git',['diff','--cached','--quiet']);if(diff.status!==0)run(['commit','-m','Build nouri nutrition diary with camera and AI analysis']);
run(['push','-u','origin','HEAD:'+credential.branch],true);
const sha=run(['rev-parse','HEAD']);
const manifest=JSON.parse(readFileSync('.openai/hosting.json','utf8'));
process.stdout.write(JSON.stringify({project_id:manifest.project_id,commit_sha:sha})+'\n');
