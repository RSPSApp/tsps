import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const source=fs.readFileSync(new URL('./deploy-world1.sh',import.meta.url),'utf8');
const parse=source.slice(source.indexOf('command='),source.indexOf('\nexec 9>'));
test('command parsing leaves glob expansion enabled for backup retention',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deploy-backup-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'players-test.sqlite'),'save');
 const result=spawnSync('sh',['-efu','-c',parse+'\nprintf "%s\\n" "$CHECK_BACKUPS"/players-*.sqlite'],{encoding:'utf8',env:{...process.env,SSH_ORIGINAL_COMMAND:'a'.repeat(40)+' 123-1',CHECK_BACKUPS:dir}});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),path.join(dir,'players-test.sqlite'));
});
test('malformed deployment identities are rejected before server operations',()=>{
 for(const command of ['nope','a'.repeat(40)+' ../../escape','a'.repeat(40)+' 123-1 extra']){
 const result=spawnSync('sh',['-efu','-c',parse],{encoding:'utf8',env:{...process.env,SSH_ORIGINAL_COMMAND:command}});assert.equal(result.status,2);
 }
});
