import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
const tests=[...readdirSync('server').filter(f=>f.endsWith('.test.mjs')).map(f=>'server/'+f),...readdirSync('tests').filter(f=>f.endsWith('.test.mjs')).map(f=>'tests/'+f)];
for(const file of tests){const r=spawnSync(process.execPath,[file],{stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status||1)}
