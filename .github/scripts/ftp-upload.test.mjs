import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
const source=fs.readFileSync(new URL('./ftp-upload.mjs',import.meta.url),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const mode of [undefined,'--release-marker']) for(const failure of [null,'short','upload','invalid']) {
    test(`${mode ?? 'assets'}: ${failure ?? 'success'}`,async()=>{
        const calls=[];
        const process={argv:['node','ftp-upload.mjs','dist/host','/host',...(mode?[mode]:[])],env:{FTP_HOST:'example.com',FTP_USER:'user',FTP_PASSWORD:'secret'}};
        const marker=JSON.stringify({id:failure==='invalid'?'../bad':'11111111-1111-1111-1111-111111111111'});
        class Client {
            async access() {calls.push('connect')}
            async ensureDir() {}
            async cd() {}
            async uploadFrom(file,name) {calls.push(['upload',file,name]);if(failure==='upload')throw Error('timeout')}
            async size() {return failure==='short'?0:mode?Buffer.byteLength(marker):100}
            async rename(from,to) {calls.push(['rename',from,to])}
            close() {}
        }
        const readdir=async()=>[{name:'asset.js',isDirectory:()=>false,isFile:()=>true},{name:'index.html',isDirectory:()=>false,isFile:()=>true}];
        await new AsyncFunction('readdir','readFile','stat','path','Client','process','console',source.replace(/^import .*;\n/gm,''))(
            readdir,async()=>marker,async()=>({size:100}),path,Client,process,{log(){},error(){}});
        const renamed=calls.filter(c=>c[0]==='rename');
        if(failure==='short'||failure==='upload'||(failure==='invalid'&&mode)) {assert.equal(renamed.length,0);assert.equal(process.exitCode,1)}
        else if(mode) assert.deepEqual(renamed,[['rename','release.json.uploading','release.json']]);
        else {assert.deepEqual(renamed.map(c=>c[2]),['asset.js','index.html']);assert.ok(calls.findIndex(c=>c[0]==='rename')>calls.findLastIndex(c=>c[0]==='upload'))}
    });
}
