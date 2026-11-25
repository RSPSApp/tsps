import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { BuilderCache } from '../cache';
import { makePart, newProject, validateProject } from '../shared/project.mjs';
import { assemble, extract, linkedPoint, validateMesh, worldPoint } from '../shared/mesh.mjs';
import { pickBoundary, pickConnectionSurface, planSurfaceConnection, planPlacedConnection, faceNormal } from '../shared/sculpt.mjs';
import { compileMotion } from '../shared/motion.mjs';
import { compileProject, pluginZip } from '../export.mjs';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createBuilderServer } from '../server';
import { encodeModel } from '../shared/model-codec.mjs';
import { ModelData } from '../../../client/rs/model/ModelData';

const root = path.resolve(import.meta.dirname, '../../..');

// Real cache parts used by the reported assembly. Choose anatomical positions,
// never topology IDs from a hand-made lookalike or a generated JSON fixture.
export function jadZulrah(cache) {
    const zulrah = cache.describe('npc',2042), jad = cache.describe('npc',7700), offer = jad.parts.find(p => p.name === 'Head');
    assert.ok(offer, 'the cache offers the recognizable Jad head');
    const project = newProject('jad-zulrah-join','npc',zulrah,{definition:58000,modelBase:1100000,sequenceBase:50000},cache.info.name);
    const head = makePart(jad,'body',offer.key); head.name = 'Head (JalTok-Jad)'; head.mesh = extract(jad.mesh,offer.faces);
    head.mesh.vertices = head.mesh.vertices.map(v => v.map((n,a) => n-offer.pivot[a])); head.donorPivot = [...offer.pivot];
    head.parentId = project.parts[0].id; head.position = [-500,-470,-100]; head.motion.mode = 'own';
    head.motion.sequences = newProject('jad-donor','npc',jad,project.ids,cache.info.name).animations;
    project.parts.push(head);
    const body = project.parts[0];
    const rayHit = (part, coords, axis, fromNegative) => {
        const axes=[0,1,2].filter(a=>a!==axis),[x,z]=coords;
        const candidates = part.mesh.faces.flatMap((face,faceId) => {
            const vertices=face.slice(0,3).map(i=>part.mesh.vertices[i]),[a,b,c]=vertices.map(p=>axes.map(i=>p[i]));
            const edge=vertices[1].map((n,i)=>n-vertices[0][i]),other=vertices[2].map((n,i)=>n-vertices[0][i]),normal=[edge[1]*other[2]-edge[2]*other[1],edge[2]*other[0]-edge[0]*other[2],edge[0]*other[1]-edge[1]*other[0]];
            if(fromNegative?normal[axis]>=0:normal[axis]<=0)return [];
            const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]); if(!den || part.mesh.renderTypes?.[faceId]===2 || part.mesh.alpha?.[faceId]===255)return [];
            const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(z-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(z-c[1]))/den;
            return Math.min(u,v,1-u-v)>1e-5?[{faceId,point:[0,1,2].map(a=>u*vertices[0][a]+v*vertices[1][a]+(1-u-v)*vertices[2][a])}]:[];
        });
        const chosen=candidates.sort((a,b)=>fromNegative?a.point[axis]-b.point[axis]:b.point[axis]-a.point[axis])[0],faceId=chosen?.faceId;
        assert.ok(Number.isInteger(faceId),'the pointer ray hits the exposed shell');
        return { partId:part.id,faceId,sourceFaceId:faceId,twin:false,point:worldPoint(chosen.point,part,project.parts) };
    };
    const sourceHit = rayHit(head,[5,60],1,false), targetHit = rayHit(body,[5,-350],2,true);
    return { project, head, body, sourceHit, targetHit };
}

test('real Jad head to Zulrah body prepares closed surfaces and preserves saved rig, materials and animated export endpoints', () => {
    const cache = new BuilderCache(root);
    try {
        const {project,head,body,sourceHit,targetHit} = jadZulrah(cache), before = structuredClone(project);
        assert.equal(head.mesh.faces.length,341);
        assert.equal(pickBoundary(project.parts,sourceHit),null,'the old open-edge-only workflow cannot use the source');
        assert.equal(pickBoundary(project.parts,targetHit),null,'the body target is closed too');
        const first = pickConnectionSurface(project.parts,sourceHit), second = pickConnectionSurface(project.parts,targetHit);
        assert.deepEqual(first.removeFaces,[sourceHit.faceId]); assert.deepEqual(second.removeFaces,[targetHit.faceId]);
        const plan = planSurfaceConnection(project.parts,first,second,{variant:'body'});
        assert.deepEqual(project,before,'preview neither cuts nor moves original parts');
        for(const [id,replacement] of plan.replacements)Object.assign(project.parts.find(p=>p.id===id),replacement);
        project.parts.push(plan.part);
        for(const [part,old,cut] of [[head,before.parts[1],sourceHit.faceId],[body,before.parts[0],targetHit.faceId]]){
            assert.deepEqual(part.mesh.vertices.slice(0,old.mesh.vertices.length),old.mesh.vertices);
            for(const key of ['sourceVertices','skins','bones','weights'])if(old.mesh[key])assert.deepEqual(part.mesh[key].slice(0,old.mesh.vertices.length),old.mesh[key],key);
            assert.deepEqual(part.mesh.textureMappings,old.mesh.textureMappings);
            for(const key of ['textures','textureCoords','alpha','priorities','faceLabels','renderTypes'])if(old.mesh[key])assert.deepEqual(part.mesh[key],old.mesh[key].filter((_,i)=>i!==cut),key);
        }
        assert.notDeepEqual(head.position,before.parts[1].position,'fit closes the large placement gap');
        assert.ok(plan.part.connectionEdges.length===6); validateMesh(assemble(project.parts,'body'));
        const normalized = validateProject(JSON.parse(JSON.stringify(project))), clip = compileMotion(normalized,cache,'attack');
        assert.ok(clip?.frames.length>1,'the real donor and body movements compile');
        const start = body.mesh.vertices.length + head.mesh.vertices.length;
        for(const frame of clip.frames)for(const [i,ref] of plan.part.mesh.vertexLinks.entries()){
            const endpoint = (ref.partId===body.id?0:body.mesh.vertices.length)+ref.vertex;
            assert.deepEqual(frame.vertices[start+i],frame.vertices[endpoint],'every bridge endpoint follows the animated donor exactly');
        }
        assert.notDeepEqual(clip.frames[0].vertices.slice(start),clip.frames.at(-1).vertices.slice(start));
        const exported = compileProject(normalized,cache); assert.ok(exported.content.models.length); assert.ok(pluginZip(exported).length>0);
    } finally { cache.close(); }
});

const polygonPart=(id,count,z)=>makePart({name:id,kind:'npc',id:1,variant:'body',mesh:{
    vertices:Array.from({length:count},(_,i)=>[Math.cos(i/count*Math.PI*2)*20,Math.sin(i/count*Math.PI*2)*20,z]).concat([[0,0,z]]),
    faces:Array.from({length:count},(_,i)=>[count,i,(i+1)%count,32000])}},'body');

test('surface planner joins unequal complete loops and retains explicit placement and endpoint identities',()=>{
    const a=polygonPart('triangle',3,0),b=polygonPart('pentagon',5,20),parts=[a,b];
    const first=pickConnectionSurface(parts,{partId:a.id,faceId:0,point:[10,0,0]});
    // Opposite donor orientation is required for two facing disks.
    b.mesh.faces=b.mesh.faces.map(([x,y,z,c])=>[x,z,y,c]);
    const target=pickConnectionSurface(parts,{partId:b.id,faceId:0,point:[10,0,20]});
    const plan=planSurfaceConnection(parts,first,target,{placement:'keep'});
    assert.equal(plan.part.mesh.faces.length,8); assert.equal(plan.part.connectionEdges.length,8); assert.equal(plan.removed,0);
    validateMesh(assemble([...parts,plan.part],'body'));
    plan.part.mesh.vertexLinks.forEach((ref,i)=>assert.deepEqual(plan.part.mesh.vertices[i],linkedPoint(ref,parts)));
    b.mesh.faces=b.mesh.faces.map(([x,y,z,c])=>[x,z,y,c]);
    const wrongFacing=pickConnectionSurface(parts,{partId:b.id,faceId:0,point:[10,0,20]});
    assert.throws(()=>planSurfaceConnection(parts,first,wrongFacing,{placement:'keep'}),/fold|inside out|overlap|small/,'a self-crossing strip cannot be applied');
});

test('textured gear surface collars retain source projections and native weights through native model encoding',()=>{
    const mesh={vertices:[[0,0,0],[12,0,0],[0,12,0],[0,0,12]],faces:[[0,2,1,100],[0,1,3,200],[0,3,2,300],[1,2,3,400]],
        textures:[7,7,7,7],textureCoords:[0,0,0,0],textureMappings:[[0,1,2]],skins:[1,2,3,4],bones:[[1],[2],[3],[4]],weights:[[255],[255],[255],[255]],sourceVertices:[10,15,20,25]};
    const a=makePart({kind:'item',id:6570,name:'Cape piece',variant:'male',mesh},'male'),b=makePart({kind:'item',id:6570,name:'Armour piece',variant:'male',mesh},'male');b.position=[40,0,0];
    const parts=[a,b],first=pickConnectionSurface(parts,{partId:a.id,faceId:3,point:[4,4,4]}),second=pickConnectionSurface(parts,{partId:b.id,faceId:2,point:[40,4,4]});
    const before=structuredClone(parts),plan=planSurfaceConnection(parts,first,second,{variant:'male'});
    assert.deepEqual(parts,before);const prepared=[...plan.prepared,plan.part],assembled=assemble(prepared,'male');validateMesh(assembled);
    for(const part of plan.prepared){
        assert.deepEqual(part.mesh.textureMappings,mesh.textureMappings);assert.deepEqual(part.mesh.vertices.slice(0,4),mesh.vertices);
        for(let i=4;i<part.mesh.vertices.length;i++){const original=mesh.sourceVertices.indexOf(part.mesh.sourceVertices[i]);assert.ok(original>=0);assert.deepEqual(part.mesh.bones[i],mesh.bones[original]);assert.deepEqual(part.mesh.weights[i],mesh.weights[original]);assert.equal(part.mesh.skins[i],mesh.skins[original]);}
    }
    assert.ok(plan.part.mesh.textures.every(id=>id===7));const decoded=ModelData.decode(new Int8Array(encodeModel(assembled)));
    assert.deepEqual(Array.from(decoded.faceTextures),assembled.textures);
    const paired=structuredClone(parts);paired[0].pair=true;assert.throws(()=>planSurfaceConnection(paired,first,second),/both copies|Pair/);assert.deepEqual(parts,before);
});

test('Chrome renders dual-tone depth-occluded faces and performs the real Jad/Zulrah connection through pointer events',
    {skip:!fs.existsSync(process.env.BUILDER_CHROME??'/usr/bin/google-chrome'),timeout:90000},async()=>{
    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'tsps-sculpt-interaction-'));
    const app=createBuilderServer({root,directory:path.join(temporary,'projects')});
    let chrome:ReturnType<typeof spawn>,socket:WebSocket;
    try{
        const fixture=jadZulrah(app.cache);app.store.save(fixture.project,null);
        const placed=structuredClone(fixture.project);placed.id='placed-jad-zulrah-browser';placed.name='Placed Jad on Zulrah';
        placed.parts[0].position=[27.427838745119463,-9.068555335543461,1.055560381250778];
        placed.parts[1].position=[0,-425.4016783622228,-59.179469721412154];placed.parts[1].bindLabel=7;placed.parts[1].motion.mode='follow';
        app.store.save(placed,null);
        const gear=newProject('placed-gear-browser','gear',app.cache.describe('item',3751,'inventory'),{definition:60000,modelBase:1100100},app.cache.info.name);
        gear.name='Placed pieces in gear';gear.parts.push(...structuredClone(placed.parts).map(p=>({...p,variant:'male'})));app.store.save(gear,null);
        const mirrorMesh={vertices:[[-30,-10,0],[-30,10,0],[-10,10,0],[-10,-10,0],[30,-10,0],[30,10,0],[10,10,0],[10,-10,0]],faces:[[0,1,2,32000],[0,2,3,22000],[4,6,5,32000],[4,7,6,22000]]};
        const mirrorGear=newProject('mirror-gear-browser','gear',{...app.cache.describe('item',6570,'inventory'),name:'Mirror brush fixture',mesh:mirrorMesh},{definition:60001,modelBase:1100200},app.cache.info.name);app.store.save(mirrorGear,null);
        await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
        const origin=`http://127.0.0.1:${(app.server.address() as any).port}`;
        chrome=spawn(process.env.BUILDER_CHROME??'/usr/bin/google-chrome',['--headless=new','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${path.join(temporary,'chrome')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
        const debuggerUrl=await new Promise<string>((resolve,reject)=>{
            let log='';const timer=setTimeout(()=>reject(new Error('Chrome debugger unavailable: '+log.slice(-1000))),10000);
            chrome.once('error',reject);chrome.stderr.on('data',chunk=>{log=(log+chunk).slice(-4000);const match=log.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
        });
        const url=new URL(debuggerUrl);url.protocol='http:';url.pathname='/json/list';
        const targets=await(await fetch(url)).json();socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
        await new Promise<void>((resolve,reject)=>{socket.addEventListener('open',()=>resolve(),{once:true});socket.addEventListener('error',reject,{once:true});});
        let serial=0;const pending=new Map(),errors=[];
        socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.id){const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p?.timer);if(message.error)p?.reject(new Error(JSON.stringify(message.error)));else p?.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);else if(message.method==='Page.javascriptDialogOpening')socket.send(JSON.stringify({id:++serial,method:'Page.handleJavaScriptDialog',params:{accept:true}}));});
        const call=(method,params={})=>new Promise<any>((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
        const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
        const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw new Error(expression+' failed. '+await evaluate('document.getElementById("status")?.textContent'));};
        const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
        const clickText=text=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);
        const screenshot=async name=>{if(!process.env.SCULPT_SCREENSHOTS)return;fs.mkdirSync(process.env.SCULPT_SCREENSHOTS,{recursive:true});const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.SCULPT_SCREENSHOTS,name+'.png'),Buffer.from(r.data,'base64'));};
        const guidedWorkflow=async(model,variant)=>{
            const pieces=model.parts.filter(p=>p.variant===variant),head=pieces.at(-1),body=pieces[0],world=body.mesh.vertices.map(v=>worldPoint(v,body,model.parts));
            let savedId=model.id;
            const pairs=[[30,294],[24,297],[0,248]].map(([a,b])=>({
                source:{partId:head.id,vertex:a,faceId:head.mesh.faces.findIndex(f=>f.slice(0,3).includes(a))},
                target:{partId:body.id,vertex:b,faceId:body.mesh.faces.map((f,i)=>({f,i,n:faceNormal(body.mesh,i,world)})).filter(r=>r.f.slice(0,3).includes(b)).sort((a,b)=>b.n[2]/Math.hypot(...b.n)-a.n[2]/Math.hypot(...a.n))[0].i}
            }));
            const guidePointer=async(ref,opening)=>evaluate(`(async()=>{
                const{Viewport}=await import('/viewport.mjs'),{assemble,worldPoint}=await import('/shared/mesh.mjs'),{pickConnectionGuide}=await import('/shared/sculpt.mjs');
                const p=${JSON.stringify(model)},ref=${JSON.stringify(ref)},part=p.parts.find(x=>x.id===ref.partId),canvas=document.createElement('canvas'),r=document.querySelector('#view').getBoundingClientRect();canvas.width=r.width;canvas.height=r.height;
                const v=new Viewport(canvas,{passive:true});v.setItems(p.parts.filter(x=>x.variant===${JSON.stringify(variant)}).map(part=>({id:part.id,mesh:assemble(p.parts,${JSON.stringify(variant)},new Set([part.id]))})));v.fit();
                const corner=worldPoint(part.mesh.vertices[ref.vertex],part,p.parts),face=part.mesh.faces[ref.faceId].slice(0,3).map(i=>worldPoint(part.mesh.vertices[i],part,p.parts)),center=face.reduce((s,x)=>s.map((n,i)=>n+x[i]/3),[0,0,0]);
                for(const yaw of [Math.PI,2.4,-2.4,1.8,-1.8,0,1,-1])for(const pitch of [0,-.35,.35,-.7,.7]){
                    v.yaw=yaw;v.pitch=pitch;v.draw(0);
                    for(const amount of [.15,.3,.05]){const p=corner.map((n,i)=>n+(center[i]-n)*amount),[x,y]=v.project(p),hit=v.pick(x,y);if(hit?.partId!==ref.partId)continue;
                        const snapped=pickConnectionGuide(${JSON.stringify(model.parts)},hit,{opening:${opening}});if(snapped?.vertex===ref.vertex)return{x:r.x+x,y:r.y+y,pitch,yaw,vertex:snapped.vertex};}
                }
                throw new Error('Cannot expose guide corner '+ref.vertex);
            })()`);
            await click('[data-sculpt-tool=connect]');await clickText('Add guide pair');
            for(const [index,pair]of pairs.entries())for(const [side,ref]of Object.entries(pair)){
                const p=await guidePointer(ref,side==='source');await camera(p.pitch,p.yaw);await pointerClick(p);
                if(side==='target')assert.equal(await evaluate('document.querySelectorAll(".sculpt-guide-row").length'),index+1,'the actual pointer places a complete native guide pair');
                if(side==='target'&&index===0){
                    await clickText('Fill connection');await wait('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Apply connection"&&!b.disabled)');
                    assert.equal(await evaluate('document.querySelectorAll(".sculpt-guide-row").length'),1,'one pointer-authored guideline is enough');
                    assert.ok(await evaluate('Number(document.querySelector(".sculpt-connection-state").textContent.match(/^(\\d+) connection faces/)[1])<=37'),'the single-guide preview stays low-poly');
                    const lowCount=await evaluate('Number(document.querySelector(".sculpt-connection-state").textContent.match(/^(\\d+) connection faces/)[1])');
                    assert.equal(await evaluate('Number(document.querySelector("[aria-label=Complexity]").value)'),0);
                    let previous=lowCount;
                    for(const level of [1,2,3]){
                        await evaluate(`(()=>{const input=document.querySelector('[aria-label="Complexity"]');input.value=${JSON.stringify(String(level))};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
                        assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Apply connection").disabled'),false,'each complexity level is a real applicable preview');
                        const count=await evaluate('Number(document.querySelector(".sculpt-connection-state").textContent.match(/^(\\d+) connection faces/)[1])');assert.ok(count>previous&&count<=lowCount+24,`${previous} -> ${count}`);previous=count;
                    }
                    await camera(-.8,Math.PI);await screenshot(variant+'-center-guide-complexity-max');
                    await evaluate(`(()=>{const input=document.querySelector('[aria-label="Complexity"]');input.value='0';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
                    assert.equal(await evaluate('Number(document.querySelector(".sculpt-connection-state").textContent.match(/^(\\d+) connection faces/)[1])'),lowCount,'lowering complexity returns to the sparse fill');
                    await camera(-.8,Math.PI);await screenshot(variant+'-center-guide-symmetric-low');
                    await camera(-.15,2.15);await screenshot(variant+'-single-guide-preview');await clickText('Add guide pair');
                }
            }
            await screenshot(variant+'-paired-guide-picking');await clickText('Fill connection');
            await wait('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Apply connection"&&!b.disabled)');
            assert.equal(await evaluate(`!!document.querySelector('[aria-label="Landing distance"]')`),false,'automatic landing does not override explicit hints');
            assert.equal(await evaluate(`!!document.querySelector('[aria-label="Bend"]')`),false,'guided mode hides unsupported automatic shape controls');
            await camera(-.15,2.15);await screenshot(variant+'-guided-fill-back-preview');
            await camera(0,Math.PI/2);await screenshot(variant+'-guided-fill-side-preview');
            if(variant==='body'){
                await evaluate('Array.from(document.querySelectorAll("summary")).find(s=>s.textContent==="Cleanup").click()');
                await click('[aria-label="Remove enclosed faces"]');await click('[aria-label="Remove loose join scraps"]');
                assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Apply connection").disabled'),false,'optional cleanup keeps a valid real native guide preview');
                await screenshot('body-guided-cleanup-options');
                await click('[aria-label="Remove enclosed faces"]');await click('[aria-label="Remove loose join scraps"]');
                await evaluate('Array.from(document.querySelectorAll("summary")).find(s=>s.textContent==="Cleanup").click()');
                const other=app.store.read(model.id);other.project.name='Other saved version';app.store.save(other.project,other.revision);
                await click('#save');await wait('!!document.querySelector(".creator-conflict-dialog[open]")');
                assert.equal(await evaluate('document.querySelectorAll(".sculpt-guide-row").length'),3,'the conflict leaves every guide in the open session');
                await clickText('Keep editing');
                assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Save a separate copy")'),true,'a revision conflict can be recovered without reopening or losing guides');
                await clickText('Save a separate copy');await wait('document.querySelector("#save-state").textContent==="Saved"');
                savedId=app.store.list().find(p=>p.id!==model.id&&p.name===model.name).id;
                assert.notEqual(savedId,model.id);assert.equal(app.store.read(model.id).project.name,'Other saved version','recovery never overwrites the newer saved project');
                assert.equal(await evaluate('document.querySelectorAll(".sculpt-guide-row").length'),3,'the recovered copy keeps the pending guide session');
                assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Apply connection").disabled'),false,'the recovered preview remains applicable');
            }
            await clickText('Apply connection');await click('#save');await wait('document.querySelector("#save-state").textContent==="Saved"');
            const saved=app.store.read(savedId).project;assert.equal(saved.parts.length,model.parts.length+1);assert.equal(saved.parts.at(-1).connectionEdges.length,25);
            assert.ok(saved.parts.at(-1).mesh.faces.length<=43,'saved native geometry stays sparse, including the chosen Lift');
            assert.deepEqual(saved.parts.find(p=>p.id===body.id).mesh.faces,body.mesh.faces,'guides leave the original target skin intact');
            await camera(-.15,2.15);await screenshot(variant+'-guided-fill-applied');
            await click('#undo');await wait(`document.querySelectorAll('#parts .part').length===2`);await click('#save');await wait('document.querySelector("#save-state").textContent==="Saved"');
        };
        await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
        await call('Page.navigate',{url:origin+'/?view=npc'});await wait('!!document.querySelector("#open")&&!document.querySelector("#open").disabled');
        await wait('!!document.querySelector("#results canvas")');await click('#open');await wait('document.querySelector("#projects button")');await clickText(fixture.project.name+' (Creature)');
        await wait('document.querySelectorAll("#parts .part").length===2');await click('[data-mode=sculpt]');await click('[data-sculpt-tool=bridge]');
        const camera=async(pitch,yaw=0)=>{
            await click('[data-camera=front]');
            const r=await evaluate('(()=>{const r=document.querySelector("#view").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
            await call('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'right',clickCount:1});
            await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+yaw/.009,y:r.y-pitch/.008,button:'right',buttons:2});
            await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+yaw/.009,y:r.y-pitch/.008,button:'right',clickCount:1});
        };
        const point=async(hit,pitch,project=fixture.project,variant='body')=>evaluate(`(async()=>{const{Viewport}=await import('/viewport.mjs'),{assemble}=await import('/shared/mesh.mjs');const p=${JSON.stringify(project)},canvas=document.createElement('canvas'),r=document.querySelector('#view').getBoundingClientRect();canvas.width=r.width;canvas.height=r.height;const v=new Viewport(canvas,{passive:true});v.setItems(p.parts.map(part=>({id:part.id,mesh:assemble(p.parts,${JSON.stringify(variant)},new Set([part.id]))})));v.fit();v.yaw=0;v.pitch=${pitch};v.draw(0);const [x,y]=v.project(${JSON.stringify(hit.point)}),picked=v.pick(x,y);return{x:r.x+x,y:r.y+y,picked};})()`);
        const pointerClick=async p=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await call('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});};
        await camera(1.3);const source=await point(fixture.sourceHit,1.3);
        assert.equal(source.picked?.partId,fixture.head.id,'source pointer is on the real head');
        assert.equal(source.picked?.sourceFaceId,fixture.sourceHit.faceId,'source ray reaches the exposed chosen face');
        await pointerClick(source);await wait('document.querySelector(".sculpt-connection-state").textContent.includes("Source:")');
        await camera(0);const target=await point(fixture.targetHit,0);
        assert.equal(target.picked?.partId,fixture.body.id);assert.equal(target.picked?.sourceFaceId,fixture.targetHit.faceId);
        await pointerClick(target);await wait('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Apply connection"&&!b.disabled)');
        await click('[data-camera=side]');await screenshot('jad-zulrah-connection-preview');await clickText('Cancel');assert.equal(await evaluate('document.querySelectorAll("#parts .part").length'),2);
        await camera(1.3);await pointerClick(source);await camera(0);await pointerClick(target);await clickText('Apply connection');
        await wait('document.querySelectorAll("#parts .part").length===3');await click('#save');await wait('document.querySelector("#save-state").textContent==="Saved"');
        const saved=app.store.read(fixture.project.id).project;assert.equal(saved.parts[2].connectionEdges.length,6);assert.equal(saved.parts[1].mesh.faces.length,340);
        await click('#fit');await click('[data-camera=side]');await screenshot('jad-zulrah-connected');
        await click('#undo');await wait('document.querySelectorAll("#parts .part").length===2');
        await clickText('Head (JalTok-Jad)');await click('[data-sculpt-tool=select]');await click('[data-sculpt-selection=all]');await clickText('Show only this part');await click('#fit');await screenshot('jad-selected-faces');
        const overlays=await evaluate(`(async()=>{
            const{Viewport}=await import('/viewport.mjs'),{texturesReady}=await import('/materials.mjs'),source=await(await fetch('/api/source?kind=item&id=6570&variant=male')).json(),texture=source.mesh.textures.find(id=>id>=0);await texturesReady(source.mesh);const canvas=document.createElement('canvas');canvas.width=360;canvas.height=360;
            let selected=null;const view=new Viewport(canvas,{passive:true,faceOverlay:p=>p.partId===selected?{fill:'#00c8ff65',stroke:'#ffffff',underStroke:'#101010',underWidth:4.5,lineWidth:1.5}:null});view.grid=false;view.outline=false;view.gizmo=false;view.yaw=0;view.pitch=0;view.target=[0,0,0];view.distance=400;
            const mesh=(z,colour)=>({textures:[colour===22000?texture:-1],vertices:[[-100,-100,z],[0,100,z],[100,-100,z]],faces:[[0,1,2,colour]]});
            const data=()=>Array.from(canvas.getContext('2d').getImageData(0,0,360,360).data),results=[];const native=view.materialRenderer;
            for(const fallback of [false,true]){view.materialRenderer=fallback?{draw:()=>false,drawFallbackFace:()=>false}:native;for(const colour of [127,0,950,22000]){
                view.setItems([{id:'rear',mesh:mesh(40,colour)},{id:'front',mesh:mesh(0,colour)}]);selected=null;view.draw(0);const before=data();selected='rear';view.draw(0);const hidden=data();selected='front';view.draw(0);const visible=data();let dark=0,white=0,changed=0;for(let i=0;i<visible.length;i+=4){if(visible[i]<=45&&visible[i+1]<=45&&visible[i+2]<=45)dark++;if(visible[i]>245&&visible[i+1]>245&&visible[i+2]>245)white++;if(visible[i]!==before[i]||visible[i+1]!==before[i+1]||visible[i+2]!==before[i+2])changed++;}results.push({fallback,colour,hiddenEqual:JSON.stringify(before)===JSON.stringify(hidden),dark,white,changed});
            }}return {native:!!native.gl,textures:native.textures.size,results};})()`);
        assert.equal(overlays.native,true);assert.ok(overlays.textures>0,'dual-tone bands retain the native texture and cutout rendering');for(const r of overlays.results){assert.equal(r.hiddenEqual,true,JSON.stringify(r));assert.ok(r.dark>100&&r.white>100&&r.changed>1000,JSON.stringify(r));}
        await click('#save');await wait('document.querySelector("#save-state").textContent==="Saved"');
        await click('#open');await wait('document.querySelector("#projects button")');await clickText(placed.name+' (Creature)');
        await wait(`document.querySelector('#name').value===${JSON.stringify(placed.name)}`);await click('[data-mode=sculpt]');
        await camera(-.15,2.15);await screenshot('placed-jad-open-back-before');
        await click('[data-sculpt-tool=connect]');await wait('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Apply connection"&&!b.disabled)');
        assert.equal(await evaluate('document.querySelector("[aria-label=Attach]").value'),placed.parts[1].id,'the attached head is found by name, with no face choices');
        await screenshot('placed-jad-whole-back-preview');
        await evaluate(`(()=>{const input=document.querySelector('[aria-label="Landing distance"]');input.value="50";input.dispatchEvent(new Event("input",{bubbles:true}));})()`);
        assert.equal(await evaluate(`Number(document.querySelector('[aria-label="Landing distance"]').value)`),50);
        await screenshot('placed-jad-farther-landing-preview');
        await camera(0,Math.PI/2);await screenshot('placed-jad-farther-landing-side');
        await evaluate('(()=>{const input=document.querySelector("[aria-label=Ramp]");input.value="40";input.dispatchEvent(new Event("input",{bubbles:true}));})()');
        await clickText('Cancel');assert.equal(await evaluate('document.querySelectorAll("#parts .part").length'),2);
        await click('[data-sculpt-tool=connect]');await clickText('Apply connection');await click('#save');await wait('document.querySelector("#save-state").textContent==="Saved"');
        const joined=app.store.read(placed.id).project;
        const nearest=planPlacedConnection(placed.parts,placed.parts[1].id,placed.parts[0].id,{variant:'body'});
        assert.notDeepEqual(joined.parts[2].connectionEdges.filter(e=>e[0].partId===placed.parts[0].id),nearest.part.connectionEdges.filter(e=>e[0].partId===placed.parts[0].id),'the farther landing is saved through the actual UI');
        assert.equal(joined.parts[2].connectionEdges.filter(e=>e[0].partId===placed.parts[1].id).length,25);
        for(let i=0;i<2;i++)for(const key of ['position','rotation','scale'])assert.deepEqual(joined.parts[i][key],placed.parts[i][key],key+' unchanged through the actual UI');
        await screenshot('placed-jad-whole-back-applied');
        await camera(-.15,.4);await screenshot('placed-jad-front-applied');
        await click('#undo');await wait('document.querySelectorAll("#parts .part").length===2');
        await click('#save');await wait('document.querySelector("#save-state").textContent==="Saved"');
        await guidedWorkflow(placed,'body');
        await call('Page.navigate',{url:origin+'/?view=gear'});await wait('!!document.querySelector("#results canvas")');
        await click('#open');await wait('document.querySelector("#projects button")');await clickText(gear.name+' (Gear)');
        await wait(`document.querySelector('#name').value===${JSON.stringify(gear.name)}`);
        await evaluate('(()=>{const input=document.querySelector("#variant");input.value="male";input.dispatchEvent(new Event("change",{bubbles:true}));})()');
        await wait('document.querySelectorAll("#parts .part").length===2');await click('[data-mode=sculpt]');await click('[data-sculpt-tool=connect]');
        await wait('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Apply connection"&&!b.disabled)');
        await evaluate(`(()=>{const input=document.querySelector('[aria-label="Landing distance"]');input.value="50";input.dispatchEvent(new Event("input",{bubbles:true}));})()`);
        assert.equal(await evaluate(`Number(document.querySelector('[aria-label="Landing distance"]').value)`),50);
        await camera(-.15,2.15);await screenshot('gear-placed-join-preview');await clickText('Apply connection');await click('#save');await wait('document.querySelector("#save-state").textContent==="Saved"');
        const gearJoined=app.store.read(gear.id).project;assert.equal(gearJoined.parts.length,4);assert.deepEqual(gearJoined.parts[0],validateProject(gear).parts[0],'inventory view stays unchanged');
        assert.equal(gearJoined.parts[3].variant,'male');assert.equal(gearJoined.parts[3].connectionEdges.filter(e=>e[0].partId===placed.parts[1].id).length,25);
        await click('#undo');await wait('document.querySelectorAll("#parts .part").length===2');await guidedWorkflow(gear,'male');
        await click('#open');await wait('document.querySelector("#projects button")');await clickText(mirrorGear.name+' (Gear)');
        await wait(`document.querySelector('#name').value===${JSON.stringify(mirrorGear.name)}`);await click('[data-mode=sculpt]');await click('[data-sculpt-tool=delete-face]');
        await click('[aria-label="Mirror across part X"]');await camera(0);
        const mirrorPoint=await point({point:[-23.333,3.333,0]},0,mirrorGear,'inventory');assert.equal(mirrorPoint.picked?.sourceFaceId,0);
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:mirrorPoint.x,y:mirrorPoint.y});await screenshot('gear-mirrored-delete-hover');
        await pointerClick(mirrorPoint);await click('#save');await wait('document.querySelector("#save-state").textContent==="Saved"');
        assert.deepEqual(app.store.read(mirrorGear.id).project.parts[0].mesh.faces,[mirrorMesh.faces[1],mirrorMesh.faces[3]],'one actual pointer stroke deletes both exact reflected faces');
        await click('#undo');await click('#save');await wait('document.querySelector("#save-state").textContent==="Saved"');
        assert.deepEqual(app.store.read(mirrorGear.id).project.parts[0].mesh.faces,mirrorMesh.faces,'one undo restores the whole mirrored stroke');
        assert.deepEqual(errors,[],'no browser runtime errors');
    }finally{
        socket?.close();if(chrome&&chrome.exitCode===null){const done=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill('SIGTERM');await done;}
        await new Promise<void>(resolve=>app.server.close(()=>resolve()));app.cache.close();fs.rmSync(temporary,{recursive:true,force:true,maxRetries:3});
    }
});
