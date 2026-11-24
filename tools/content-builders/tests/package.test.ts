import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {authoringZip} from '../package.mjs';
const root=path.resolve(import.meta.dirname,'../../..'),require=createRequire(path.join(root,'server/package.json'));
const {readPluginZip}=require(path.join(root,'server/plugins/tools/worldadmin/PluginZip.WorldAdmin.js'));
test('portable authoring plugin validates and starts its embedded tool without source-tree assets', {timeout:30000},async()=>{
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tsps-creator-package-'));
    let child;
    const probe=http.createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
    try{
        const parsed=readPluginZip(authoringZip());assert.equal(parsed.manifest.name,'ContentBuilders');assert.equal(parsed.manifest.category,'@ Ghost Plugins @');
        const payload=parsed.source.match(/const PAYLOAD = '([^']+)'/);assert.ok(payload);const files=JSON.parse(gunzipSync(Buffer.from(payload[1],'base64')).toString());assert.match(files['shared/gear-visuals.mjs'],/export function renderTexture/);assert.ok(!files['shared/gear-visuals.mjs'].includes('../../../client/'),'portable visual sampling must not depend on the source checkout');
        const directory=path.join(temp,'imported/content-builders');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,parsed.file),parsed.source);
        const hooks:any={},endpoints:any={},module={exports:{} as any};let log='';
        const pluginRequire=name=>name==='node:child_process'?{spawn:(exe,args,options)=>{assert.ok(args[0].startsWith(temp),'launcher comes from the installed bundle');assert.ok(!args[0].includes('tools/content-builders'),'no source-tree launcher');child=spawn(exe,args,{...options,stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>log=(log+d).slice(-3000));child.stderr.on('data',d=>log=(log+d).slice(-3000));return child;}}:require(name);
        vm.runInNewContext(parsed.source,{module,Buffer,require:pluginRequire,__dirname:directory,process:{execPath:process.execPath,env:{...process.env,TSPS_ROOT:root,CACHE_EDITOR_ENABLED:'1',WT_SLOT:String(port-3890)}} ,console,setTimeout,clearTimeout});
        module.exports.register({registerContentEndpoint:(key,fn)=>endpoints[key]=fn,onServerStartup:fn=>hooks.start=fn,onServerShutdown:fn=>hooks.stop=fn,onCustomEvent:()=>{},log:()=>{}});
        assert.equal(child,undefined,'registration only attaches hooks');hooks.start();
        const url=`http://127.0.0.1:${port}`;let ready=false;
        for(let n=0;n<100;n++){try{if((await fetch(url+'/api/info')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}
        assert.ok(ready,log);assert.deepEqual(Array.from(endpoints['cache-editor-tools']().tools,tool=>tool.label),['NPC Creator','Gear Creator']);
        assert.ok((await (await fetch(url+'/app.mjs')).text()).includes('addPart'));
        assert.ok((await (await fetch(url+'/library.mjs')).text()).includes('thumbnail'));
        for(const name of ['build','paint','sculpt','animate','data','gear-effects','creature-attacks','gear-set','gear-visuals'])for(const extension of ['mjs','css']) {
            const asset=await fetch(`${url}/${name}.${extension}`);assert.equal(asset.status,200,`${name} ${extension} is embedded and served`);
            assert.ok((await asset.text()).length>30);
        }
        for(const route of ['/shared/paint.mjs','/shared/sculpt.mjs','/shared/data.mjs','/api/game-data?kind=npc&id=655','/api/drop-table?id=655','/api/special-donors?q=dragon'])assert.equal((await fetch(url+route)).status,200,`portable route ${route}`);
        const source=await(await fetch(url+'/api/source?kind=npc&id=655')).json();assert.ok(source.parts.some(p=>p.name==='Head'));
        const created=await(await fetch(url+'/api/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'npc',baseId:655,partKey:'body'})})).json();assert.ok(created.revision,JSON.stringify(created));assert.ok(fs.existsSync(path.join(directory,'data/projects',created.project.id+'.json')),'projects are kept with the installed plugin');
        const exported=await fetch(url+'/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:created.project})});assert.equal(exported.status,200);readPluginZip(Buffer.from(await exported.arrayBuffer()));
        const post=async(route,input)=>{const response=await fetch(url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(response.ok,true,await response.clone().text());return response.json();};
        const gear=await post('create',{kind:'gear',baseId:1163});let set=await post('gear-set',{project:gear.project,name:'Portable rune set'});set=await post('gear-set/item',{...set,baseId:1127});
        const loaded=await(await fetch(url+'/api/projects/'+set.project.id)).json();assert.deepEqual(loaded,set);
        const setZip=await fetch(url+'/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:loaded.project})});assert.equal(setZip.status,200);assert.match(readPluginZip(Buffer.from(await setZip.arrayBuffer())).source,/gear-set/);
        const original = child;
        const exited = new Promise(resolve => original.once('exit', resolve)); original.kill('SIGTERM'); await exited;
        let recovered = false;
        for(let n=0;n<100;n++) { if(child!==original)try { if((await fetch(url+'/api/info')).ok) {recovered=true;break;} } catch {} await new Promise(r=>setTimeout(r,100)); }
        assert.ok(recovered, 'portable Creator recovers its service after the tool process exits');
        hooks.stop();
    }finally{
        if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}
        fs.rmSync(temp,{recursive:true,force:true,maxRetries:3});
    }
});
