import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BuilderCache } from '../cache';
import { makePart, newProject, validateProject } from '../shared/project.mjs';
import { assemble, extract, linkedPoint, localPoint, validateMesh, worldPoint } from '../shared/mesh.mjs';
import { connectionOpenings, planPlacedConnection, planGuidedConnection, faceNormal, deleteFaces } from '../shared/sculpt.mjs';
import { compileMotion } from '../shared/motion.mjs';
import { compileProject, pluginZip } from '../export.mjs';
import { encodeModel } from '../shared/model-codec.mjs';
import { ModelData } from '../../../client/rs/model/ModelData';

const root = path.resolve(import.meta.dirname, '../../..');
// The user's saved placement, rebuilt from the real cache instead of depending
// on their mutable local project. In particular this is the large, branched rear
// opening of the extracted head, not an arbitrary closed triangular face.
export function placedJadZulrah(cache) {
    const zulrah=cache.describe('npc',2042),jad=cache.describe('npc',7700),offer=jad.parts.find(p=>p.name==='Head');
    assert.ok(offer);
    const project=newProject('placed-jad-zulrah','npc',zulrah,{definition:58000,modelBase:1100000,sequenceBase:50000},cache.info.name);
    const body=project.parts[0];body.position=[27.427838745119463,-9.068555335543461,1.055560381250778];
    const head=makePart(jad,'body',offer.key);head.name='Head (JalTok-Jad)';head.mesh=extract(jad.mesh,offer.faces);
    head.mesh.vertices=head.mesh.vertices.map(v=>v.map((n,a)=>n-offer.pivot[a]));head.donorPivot=[...offer.pivot];
    head.parentId=body.id;head.position=[0,-425.4016783622228,-59.179469721412154];head.bindLabel=7;
    project.parts.push(head);return {project,head,body};
}

class Node {
    children:any[]=[];handlers:any={};textContent='';disabled=false;value:any;isConnected=true;tagName:string;
    constructor(tag,attrs={},...children){this.tagName=tag.toUpperCase();for(const[k,v]of Object.entries(attrs))k.startsWith('on')?this.handlers[k.slice(2).toLowerCase()]=v:k==='text'?this.textContent=String(v):this[k]=v;this.append(...children);}
    append(...children){this.children.push(...children);} replaceChildren(...children){this.children=children;}
    addEventListener(k,v){this.handlers[k]=v;} emit(k){this.handlers[k]?.({target:this});}
    find(fn){if(fn(this))return this;for(const c of this.children)if(c instanceof Node){const n=c.find(fn);if(n)return n;}}
}
export async function placedHarness(project,selected){
    const text=fs.readFileSync(path.join(root,'tools/content-builders/public/sculpt.mjs'),'utf8').replace("'/shared/mesh.mjs'",JSON.stringify(new URL('../shared/mesh.mjs',import.meta.url).href)).replace("'/shared/sculpt.mjs'",JSON.stringify(new URL('../shared/sculpt.mjs',import.meta.url).href));
    const create=(await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'))).createSculptTab;
    const state:any={project,selected,mode:'sculpt',variant:project.kind==='npc'?'body':'male'},tools=new Node('div'),properties=new Node('div'),history=[],messages=[];
    const ctx:any={state,element:(tag,attrs,...kids)=>new Node(tag,attrs,...kids),button:(text,fn,attrs)=>new Node('button',{text,onClick:fn,...attrs}),
        selected:()=>state.project.parts.find(p=>p.id===state.selected),activeParts:()=>state.project.parts.filter(p=>p.visible!==false&&(p.variant==='all'||p.variant===state.variant)),
        checkpoint:()=>history.push(structuredClone(state.project)),changed:()=>{},draft:()=>{},stop:()=>{},status:t=>messages.push(t),viewport:{width:800,height:800,polygons:[]}};
    const tab=create(ctx);ctx.render=()=>{tab.renderTools(tools);tab.renderProperties(properties);};ctx.render();
    return {state,tools,properties,ctx,tab,history,messages};
}
const button=(h,label)=>{const b=h.tools.find(n=>n.tagName==='BUTTON'&&n.textContent===label);assert.ok(b,`Missing ${label}`);return b;};

test('saving a separate copy retains guides and earlier undo while refusing to replace newer edits or another project',async()=>{
    const a=disk('Helmet',7,0),b=disk('Collar',7,-70,true),project=newProject('guide-copy','gear',{name:'Fixture',id:6570,kind:'item',fields:{},mesh:a.mesh},{definition:60000,modelBase:1100000},'fixture');
    b.mesh.vertices=b.mesh.vertices.map(p=>p.map((n,i)=>i<2?n*.3:n));
    project.parts=[a,b];const h=await placedHarness(project,a.id),guides=[0,2,4].map(vertex=>({source:{partId:a.id,vertex,faceId:vertex},target:{partId:b.id,vertex,faceId:vertex}}));
    let resolve,calls=0;
    h.ctx.api=(route,input)=>{assert.equal(route,'import');calls++;return new Promise(r=>{resolve=()=>r({project:{...structuredClone(input.project),id:'copied-project',ids:{definition:60001,modelBase:1100010}},revision:'copy-revision'});});};
    h.tab.beginConnection(a.id,b.id);button(h,'Add guide pair').emit('click');
    for(const pair of guides)for(const ref of [pair.source,pair.target])h.tab.edit({...ref,point:linkedPoint(ref,project.parts)},[],'start');
    button(h,'Fill connection').emit('click');assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));
    h.state.history=[JSON.stringify(project)];h.state.future=[];
    const pending=button(h,'Save a separate copy').handlers.click();
    assert.ok(button(h,'Save a separate copy').disabled);await button(h,'Save a separate copy').handlers.click();assert.equal(calls,1);
    resolve();await pending;
    assert.equal(h.state.project.id,'copied-project');assert.equal(h.state.revision,'copy-revision');assert.deepEqual(h.state.sculpt.placedGuides,guides.map(g=>({...g,source:{...g.source,twin:false},target:{...g.target,twin:false}})));
    assert.equal(JSON.parse(h.state.history[0]).id,'copied-project');assert.deepEqual(JSON.parse(h.state.history[0]).ids,h.state.project.ids,'earlier undo keeps the new saved identity');
    assert.equal(button(h,'Apply connection').disabled,false);assert.equal(h.history.length,0);
    const current=h.state.project,guideSnapshot=structuredClone(h.state.sculpt.placedGuides);
    const late=button(h,'Save a separate copy').handlers.click();current.name='Newer edits';resolve();await late;
    assert.equal(h.state.project,current);assert.equal(h.state.project.name,'Newer edits');assert.deepEqual(h.state.sculpt.placedGuides,guideSnapshot);
    assert.match(h.messages.at(-1),/newer edits/);
    const switched=button(h,'Save a separate copy').handlers.click();h.state.project={...current,id:'another-project'};resolve();await switched;
    assert.equal(h.state.project.id,'another-project');assert.match(h.messages.at(-1),/newer edits/);
});

for(const kind of ['npc','gear'])test(`${kind} cleanup reviews the actual removed faces and applies the combined fill in one undo`,async()=>{
    const variant=kind==='npc'?'body':'male',make=(name,mesh)=>makePart({name,kind:'npc',id:1,variant,mesh},variant);
    const body=make('Body',{vertices:[[-40,-40,-40],[40,-40,-40],[40,40,-40],[-40,40,-40],[-40,-40,40],[40,-40,40],[40,40,40],[-40,40,40]],
        faces:[[0,2,1,100],[0,3,2,100],[4,5,6,200],[4,6,7,200],[0,1,5,300],[0,5,4,300],[3,7,6,400],[3,6,2,400],[0,4,7,500],[0,7,3,500],[1,2,6,600],[1,6,5,600]]});
    const head=make('Head',{vertices:[[-80,-80,-80],[100,-80,-80],[-80,100,-80],[-5,-5,0],[5,-5,0],[0,5,0]],faces:[[0,2,1,1000],[3,4,5,2000]]});
    const project=newProject('cleanup-view-'+kind,kind,{name:'Cleanup',kind:'npc',id:1,fields:{combatLevel:1},mesh:head.mesh},{definition:60000,modelBase:1100000},'fixture');
    if(kind==='gear')project.parts[0].variant='inventory';else project.parts=[];
    project.parts.push(body,head);const before=structuredClone(project),h=await placedHarness(project,head.id);
    h.tab.beginConnection(head.id,body.id);button(h,'Add guide pair').emit('click');
    const guides=[[0,0,0],[1,1,0],[2,3,1]].map(([a,b,faceId])=>({source:{partId:head.id,vertex:a,faceId:0},target:{partId:body.id,vertex:b,faceId}}));
    for(const pair of guides)for(const ref of [pair.source,pair.target])h.tab.edit({...ref,point:linkedPoint(ref,project.parts)},[],'start');
    button(h,'Fill connection').emit('click');assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));
    const clean=h.tools.find(n=>n['aria-label']==='Remove enclosed faces');clean.checked=true;clean.emit('change');
    assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));assert.deepEqual(project,before);assert.equal(h.history.length,0);
    button(h,'Review removed faces').emit('click');
    const removed=h.ctx.viewport.previewItems();assert.ok(removed.length);assert.ok(removed.every(p=>p.id.startsWith('cleanup:')));
    assert.ok(removed.some(p=>p.name==='Head'&&p.mesh.faces.some(f=>f[3]===2000)),'inspection contains the original hidden face');
    assert.equal(button(h,'Apply connection').disabled,true,'isolated removal inspection cannot be mistaken for the final result');
    button(h,'Preview result').emit('click');assert.equal(button(h,'Apply connection').disabled,false);
    const result=h.ctx.viewport.previewItems().find(p=>p.id===head.id);assert.equal(result.mesh.faces.length,1);
    button(h,'Apply connection').emit('click');assert.equal(h.history.length,1);assert.deepEqual(h.history[0],before);
    assert.equal(project.parts.find(p=>p.id===head.id).mesh.faces.length,1);validateMesh(assemble(project.parts,variant));
    if(kind==='gear')assert.deepEqual(project.parts[0],before.parts[0],'another gear view is untouched');
});

export function backGuides(project,head,body) {
    const world=body.mesh.vertices.map(v=>worldPoint(v,body,project.parts));
    return [[30,257],[33,291],[0,248],[24,297]].map(([a,b])=>({
        source:{partId:head.id,vertex:a,faceId:head.mesh.faces.findIndex(f=>f.slice(0,3).includes(a)),twin:false},
        target:{partId:body.id,vertex:b,faceId:body.mesh.faces.map((f,faceId)=>({f,faceId,n:faceNormal(body.mesh,faceId,world)}))
            .filter(r=>r.f.slice(0,3).includes(b)).sort((a,b)=>b.n[2]/Math.hypot(...b.n)-a.n[2]/Math.hypot(...a.n))[0].faceId,twin:false}
    }));
}

for(const kind of ['npc','gear'])test(`${kind} native guided fill defaults to a sparse OSRS mesh`,async()=>{
    const cache=new BuilderCache(root);
    try{
        const {project,head,body}=placedJadZulrah(cache);project.kind=kind;if(kind==='gear')for(const p of project.parts)p.variant='male';
        const h=await placedHarness(project,head.id),before=structuredClone(project),guides=backGuides(project,head,body);
        button(h,'Connect placed pieces').emit('click');button(h,'Add guide pair').emit('click');
        for(const pair of guides.slice(0,3))for(const ref of [pair.source,pair.target])h.tab.edit({...ref,point:linkedPoint(ref,project.parts)},[],'start');
        button(h,'Fill connection').emit('click');assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));
        const join=h.ctx.viewport.previewItems().at(-1),rim=connectionOpenings(project.parts,head.id).find(s=>s.vertices.includes(guides[0].source.vertex));
        assert.ok(join.mesh.faces.length<=rim.vertices.length+12,`${join.mesh.faces.length} join faces for a ${rim.vertices.length}-corner native opening`);
        assert.deepEqual(project,before);assert.equal(h.history.length,0);
    }finally{cache.close();}
});

for(const kind of ['npc','gear'])test(`${kind} one complete guideline can steer and apply the real Jad rear connection`,async()=>{
    const cache=new BuilderCache(root);
    try{
        const {project,head,body}=placedJadZulrah(cache);project.kind=kind;if(kind==='gear')for(const p of project.parts)p.variant='male';
        const h=await placedHarness(project,head.id),before=structuredClone(project),pair=backGuides(project,head,body)[0];
        button(h,'Connect placed pieces').emit('click');button(h,'Add guide pair').emit('click');
        for(const ref of [pair.source,pair.target])h.tab.edit({...ref,point:linkedPoint(ref,project.parts)},[],'start');
        assert.equal(button(h,'Fill connection').disabled,false,'one completed pair is sufficient');
        button(h,'Fill connection').emit('click');assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));
        const join=h.ctx.viewport.previewItems().at(-1);assert.ok(join.mesh.faces.length<=37);
        for(const ref of [pair.source,pair.target])assert.ok(join.mesh.vertices.some(p=>p.every((n,i)=>n===Math.round(linkedPoint(ref,project.parts)[i]))),'the exact authored endpoint survives');
        assert.deepEqual(project,before);button(h,'Apply connection').emit('click');assert.equal(h.history.length,1);
        assert.deepEqual(h.history[0],before);validateMesh(assemble(project.parts,kind==='npc'?'body':'male'));
    }finally{cache.close();}
});

for(const kind of ['npc','gear'])test(`${kind} paired guides fill the real open head onto the chosen snake back without a belly landing`,async()=>{
    const cache=new BuilderCache(root);
    try{
        const {project,head,body}=placedJadZulrah(cache);project.kind=kind;if(kind==='gear')for(const p of project.parts)p.variant='male';
        const before=structuredClone(project),h=await placedHarness(project,head.id),guides=backGuides(project,head,body);
        button(h,'Connect placed pieces').emit('click');button(h,'Add guide pair').emit('click');
        assert.equal(h.ctx.viewport.previewItems(),null,'guide placement exposes the real original surfaces');
        assert.ok(button(h,'Fill connection').disabled);
        for(const [index,g] of guides.entries()){
            for(const ref of [g.source,g.target]){h.tab.edit({...ref,point:linkedPoint(ref,project.parts)},[],'start');h.tab.endEdit();}
            assert.equal(h.state.sculpt.placedGuides.length,index+1,h.messages.at(-1));
            if(index===1||index===3){
                button(h,'Fill connection').emit('click');
                assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));
                const items=h.ctx.viewport.previewItems(),join=items.at(-1);
                for(const pair of guides.slice(0,index+1))for(const ref of [pair.source,pair.target])assert.ok(join.mesh.vertices.some(p=>p.every((v,a)=>v===Math.round(linkedPoint(ref,project.parts)[a]))),'the actual native guide endpoint is included');
                assert.deepEqual(project,before);assert.equal(h.history.length,0);
                if(index===1)button(h,'Add guide pair').emit('click');
            }
        }
        button(h,'Apply connection').emit('click');assert.equal(h.history.length,1);assert.deepEqual(h.history[0],before);
        assert.deepEqual(project.parts[0].mesh.faces,before.parts[0].mesh.faces,'the snake skin stays intact beneath the guided fill');
        validateMesh(assemble(project.parts,kind==='npc'?'body':'male'));
    }finally{cache.close();}
});

for(const kind of ['npc','gear'])for(const cut of [false,true])test(`${kind} three upper-rim guides accept a landing farther down the real snake back${cut?' after deleting its original head':''}`,async()=>{
    const cache=new BuilderCache(root);
    try{
        const {project,head,body}=placedJadZulrah(cache);project.kind=kind;if(kind==='gear')for(const p of project.parts)p.variant='male';
        if(cut){const offer=cache.describe('npc',2042).parts.find(p=>p.name==='Head');assert.ok(offer);body.mesh=deleteFaces(body.mesh,offer.faces);}
        const before=structuredClone(project),h=await placedHarness(project,head.id),guides=backGuides(project,head,body);
        const world=body.mesh.vertices.map(v=>worldPoint(v,body,project.parts)),vertex=294;
        const faceId=body.mesh.faces.map((f,i)=>({f,i,n:faceNormal(body.mesh,i,world)})).filter(r=>r.f.slice(0,3).includes(vertex)).sort((a,b)=>b.n[2]/Math.hypot(...b.n)-a.n[2]/Math.hypot(...a.n))[0].i;
        const pairs=[{source:guides[0].source,target:{partId:body.id,vertex,faceId,twin:false}},guides[3],guides[2]];
        button(h,'Connect placed pieces').emit('click');button(h,'Add guide pair').emit('click');
        for(const pair of pairs)for(const ref of [pair.source,pair.target])h.tab.edit({...ref,point:linkedPoint(ref,project.parts)},[],'start');
        button(h,'Fill connection').emit('click');
        assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));
        const repair=h.tools.find(n=>n['aria-label']==='Fit around crossings');assert.ok(repair);
        repair.checked=false;repair.emit('change');
        assert.equal(button(h,'Apply connection').disabled,false,'a sparse cap does not introduce the former over-refinement crossing');
        assert.ok(h.ctx.viewport.previewItems()?.at(-1).mesh.faces.length<=37);
        const enabled=h.tools.find(n=>n['aria-label']==='Fit around crossings');enabled.checked=true;enabled.emit('change');
        assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));
        assert.deepEqual(project,before);assert.equal(h.history.length,0);
        button(h,'Apply connection').emit('click');assert.equal(h.history.length,1);
        assert.deepEqual(project.parts[0].mesh.faces,before.parts[0].mesh.faces,'intentional native snake cuts remain intact');
        validateMesh(assemble(project.parts,kind==='npc'?'body':'male'));
    }finally{cache.close();}
});

function segmentCrosses(a,b,c,d,e) {
    const sub=(a,b)=>a.map((n,i)=>n-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
    const direction=sub(b,a),ab=sub(d,c),ac=sub(e,c),h=cross(direction,ac),det=dot(ab,h);if(Math.abs(det)<1e-8)return false;
    const q=sub(a,c),u=dot(q,h)/det,v=dot(direction,cross(q,ab))/det,t=dot(ac,cross(q,ab))/det;
    return u>1e-6&&v>1e-6&&u+v<1-1e-6&&t>1e-6&&t<1-1e-6;
}

test('real paired back guides constrain mesh paths, exclude belly crossings and preserve native animated save/export',()=>{
    const cache=new BuilderCache(root);
    try{
        const {project,head,body}=placedJadZulrah(cache),before=structuredClone(project),guides=backGuides(project,head,body);
        const belly=body.mesh.faces.flatMap((f,i)=>{const n=faceNormal(body.mesh,i);return n[2]/Math.hypot(...n)<-.6?[f.slice(0,3).map(v=>linkedPoint({partId:body.id,vertex:v},project.parts))]:[];});
        for(const count of [1,2,3,4]){
            const plan=planGuidedConnection(project.parts,head.id,body.id,{guides:guides.slice(0,count),variant:'body'}),mesh=plan.part.mesh;
            for(const [i,path]of plan.guidePaths.entries()){
                assert.deepEqual(mesh.vertexLinks[path[0]],guides[i].source&&{partId:head.id,vertex:guides[i].source.vertex,twin:false});
                assert.deepEqual(mesh.vertexLinks[path.at(-1)],{partId:body.id,vertex:guides[i].target.vertex,twin:false});
                assert.ok(path.length>=2,'the route is an actual mesh constraint without mandatory subdivision');
                for(let j=1;j<path.length;j++){
                    assert.ok(mesh.faces.some(f=>f.slice(0,3).includes(path[j-1])&&f.slice(0,3).includes(path[j])));
                    assert.ok(!belly.some(t=>segmentCrosses(mesh.vertices[path[j-1]],mesh.vertices[path[j]],...t)),'a guided back route never cuts across the white belly');
                }
            }
            const edges=new Map();for(const f of mesh.faces)for(let j=0;j<3;j++){const k=[f[j],f[(j+1)%3]].sort((a,b)=>a-b).join(':');edges.set(k,(edges.get(k)??0)+1);}
            assert.equal([...edges.values()].filter(n=>n===1).length,25,'the continuous cap has only the native head rim as its boundary');
            assert.ok([...edges.values()].every(n=>n<=2));assert.deepEqual(project,before);
            if(count!==4)continue;
            for(const part of plan.prepared){const old=before.parts.find(p=>p.id===part.id);
                assert.deepEqual(part.mesh.faces,old.mesh.faces);assert.deepEqual(part.mesh.textureMappings,old.mesh.textureMappings);
                for(const k of ['vertices','sourceVertices','skins','bones','weights'])if(old.mesh[k])assert.deepEqual(part.mesh[k].slice(0,old.mesh.vertices.length),old.mesh[k]);
                for(const k of ['textures','textureCoords','alpha','priorities','faceLabels','renderTypes'])if(old.mesh[k])assert.deepEqual(part.mesh[k],old.mesh[k]);
            }
            project.parts=[...plan.prepared,plan.part];const saved=validateProject(JSON.parse(JSON.stringify(project))),assembled=assemble(saved.parts,'body');validateMesh(assembled);
            const clip=compileMotion(saved,cache,'attack');assert.ok(clip.frames.length>1);
            const offsets=new Map();let start=0;for(const p of saved.parts){offsets.set(p.id,start);start+=p.mesh.vertices.length;}
            for(const frame of clip.frames)for(const [i,ref]of mesh.vertexLinks.entries())assert.deepEqual(frame.vertices[offsets.get(plan.part.id)+i].map(n=>n||0),frame.vertices[offsets.get(ref.partId)+ref.vertex].map(n=>n||0),'every authored and native endpoint follows its donor after save');
            const exported=compileProject(saved,cache);assert.ok(pluginZip(exported).length>0);
        }
    }finally{cache.close();}
});

test('guided fills reject crossed hints, stale references and other gear views without altering the placed mesh',()=>{
    const cache=new BuilderCache(root);
    try{
        const {project,head,body}=placedJadZulrah(cache),before=structuredClone(project),guides=backGuides(project,head,body);
        const crossed=structuredClone(guides);[crossed[2].target,crossed[3].target]=[crossed[3].target,crossed[2].target];
        assert.throws(()=>planGuidedConnection(project.parts,head.id,body.id,{guides:crossed}),/guide|fold|cross|thin/i);
        const stale=structuredClone(guides);stale[0].target.vertex=99999;assert.throws(()=>planGuidedConnection(project.parts,head.id,body.id,{guides:stale}),/changed/);
        assert.deepEqual(project,before);body.variant='male';head.variant='female';
        assert.throws(()=>planGuidedConnection(project.parts,head.id,body.id,{guides,variant:'male'}),/same gear view/);
    }finally{cache.close();}
});

test('guide editing, partial pairs, cancel, Escape and stale geometry stay transient in creature and gear views',async()=>{
    const cache=new BuilderCache(root);
    try{for(const kind of ['npc','gear']){
        const {project,head,body}=placedJadZulrah(cache);project.kind=kind;if(kind==='gear')for(const p of project.parts)p.variant='male';
        const before=structuredClone(project),h=await placedHarness(project,head.id),guides=backGuides(project,head,body);
        const hit=ref=>({...ref,point:linkedPoint(ref,project.parts)});
        button(h,'Connect placed pieces').emit('click');button(h,'Add guide pair').emit('click');
        for(const pair of guides.slice(0,2))for(const ref of [pair.source,pair.target])h.tab.edit(hit(ref),[],'start');
        assert.equal(h.state.sculpt.placedGuides.length,2);
        const move=h.tools.find(n=>n['aria-label']==='Move guide A target');move.emit('click');assert.ok(button(h,'Fill connection').disabled);
        h.tab.edit(hit(guides[2].target),[],'start');assert.equal(h.state.sculpt.placedGuides[0].target.vertex,guides[2].target.vertex);
        button(h,'Undo last guide').emit('click');assert.equal(h.state.sculpt.placedGuides.length,1);
        h.tab.edit(hit(guides[2].source),[],'start');assert.ok(button(h,'Fill connection').disabled);
        button(h,'Undo last guide').emit('click');assert.equal(h.state.sculpt.placedGuides.length,1,'undo drops a partial pair before a completed one');
        button(h,'Cancel').emit('click');assert.deepEqual(project,before);assert.equal(h.history.length,0);
        button(h,'Connect placed pieces').emit('click');button(h,'Add guide pair').emit('click');h.tab.edit(hit(guides[0].source),[],'start');
        h.tab.onKeyDown({key:'Escape'});assert.equal(h.state.sculpt.placedGuides.length,0);assert.equal(h.state.sculpt.placedGuidePick,null);assert.equal(h.ctx.viewport.previewItems(),null);
        button(h,'Connect placed pieces').emit('click');button(h,'Add guide pair').emit('click');
        for(const ref of [guides[0].source,guides[0].target])h.tab.edit(hit(ref),[],'start');
        head.position[0]+=1;h.tab.syncValues();assert.equal(h.state.sculpt.placedGuides.length,0);assert.equal(h.state.sculpt.placedGuidePick,null);
        assert.equal(h.history.length,0);
    }}finally{cache.close();}
});

test('guided gear retains native textures, projections and weights through encoding and transforms',()=>{
    const a=disk('Helmet',7,0),b=disk('Collar',7,-70,true);b.mesh.vertices=b.mesh.vertices.map(p=>p.map((n,i)=>i<2?n*.3:n));
    const parts=[a,b];for(const p of parts){const mesh=p.mesh;mesh.textures=mesh.faces.map(()=>7);mesh.textureCoords=mesh.faces.map(()=>0);mesh.textureMappings=[[0,1,2]];mesh.skins=mesh.vertices.map(()=>2);mesh.bones=mesh.vertices.map(()=>[3]);mesh.weights=mesh.vertices.map(()=>[255]);mesh.sourceVertices=mesh.vertices.map((_,i)=>i);}
    const guides=[0,2,4].map(vertex=>({source:{partId:a.id,vertex,faceId:vertex},target:{partId:b.id,vertex,faceId:vertex}})),before=structuredClone(parts);
    const plan=planGuidedConnection(parts,a.id,b.id,{guides,variant:'male'}),assembled=assemble([...plan.prepared,plan.part],'male');validateMesh(assembled);
    assert.ok(plan.part.mesh.textures.every(id=>id===7));assert.equal(plan.part.mesh.textureMappings.length,2,'native projections are reused instead of flattening or multiplying them per face');
    const decoded=ModelData.decode(new Int8Array(encodeModel(assembled)));assert.deepEqual(Array.from(decoded.faceTextures),assembled.textures);
    assert.ok(assembled.bones.every(row=>row[0]===3));assert.ok(assembled.weights.every(row=>row[0]===255));assert.deepEqual(parts,before);
    a.parentId=b.id;b.rotation=[29,63,-37];b.scale=[1.4,1.4,1.4];
    const positioned=structuredClone(parts),transformed=planGuidedConnection(parts,a.id,b.id,{guides,variant:'male'});
    validateMesh(assemble([...transformed.prepared,transformed.part],'male'));assert.deepEqual(parts,positioned);
    assert.notDeepEqual(transformed.part.mesh.vertices,plan.part.mesh.vertices,'the fill follows transformed gear placement');
});

for(const kind of ['npc','gear'])test(`${kind} landing distance moves the real Jad rear join farther down the connected Zulrah neck`,async()=>{
    const cache=new BuilderCache(root);
    try{
        const {project,head,body}=placedJadZulrah(cache);project.kind=kind;
        if(kind==='gear')for(const p of project.parts)p.variant='male';
        const before=structuredClone(project),h=await placedHarness(project,head.id);
        button(h,'Connect placed pieces').emit('click');
        const slider=h.tools.find(n=>n['aria-label']==='Landing distance');assert.ok(slider,'a separate landing-distance control is available');
        const targetRim=()=>h.ctx.viewport.toolOverlay()[1].points;
        const nearest=targetRim(),source=h.ctx.viewport.toolOverlay()[0].points;
        slider.value='50';slider.emit('input');
        assert.equal(h.state.sculpt.placedLanding,50,h.messages.at(-1));
        assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));assert.notDeepEqual(targetRim(),nearest);
        const meanY=points=>points.reduce((sum,p)=>sum+p[1]/points.length,0);
        assert.ok(meanY(targetRim())>meanY(nearest)+40,'the landing moves down the neck, beyond the nearest surface');
        assert.deepEqual(h.ctx.viewport.toolOverlay()[0].points,source);
        assert.deepEqual(project,before,'landing preview never moves or cuts the placed pieces');
        if(kind==='npc'){
            slider.value='100';slider.emit('input');
            assert.equal(button(h,'Apply connection').disabled,false,'an unsafe far position retains a valid preview');
            assert.equal(h.state.sculpt.placedLanding%5,0,'the displayed slider and applied landing use the same step');
            assert.ok(h.state.sculpt.placedLanding>=50&&h.state.sculpt.placedLanding<=100);
            slider.value='50';slider.emit('input');assert.equal(h.state.sculpt.placedLanding,50);
        }
        button(h,'Apply connection').emit('click');assert.equal(h.history.length,1);assert.deepEqual(h.history[0],before);
        validateMesh(assemble(project.parts,kind==='npc'?'body':'male'));
    }finally{cache.close();}
});

test('landing follows a rotated and scaled gear neck rather than a world axis or disconnected nearby shell',()=>{
    const cache=new BuilderCache(root);
    try{
        const {project,head,body}=placedJadZulrah(cache);project.kind='gear';for(const p of project.parts)p.variant='female';
        body.rotation=[29,63,-37];body.scale=[1.4,1.4,1.4];
        const mesh=body.mesh,offset=mesh.vertices.length,triangle=mesh.faces[390].slice(0,3);
        // A tempting disconnected native shell close to the wanted landing.
        mesh.vertices.push(...triangle.map(i=>mesh.vertices[i].map((n,a)=>n+(a===2?-3:0))));
        for(const key of ['sourceVertices','skins','bones','weights'])if(mesh[key])mesh[key].push(...triangle.map(i=>structuredClone(mesh[key][i])));
        const extraFace=mesh.faces.length;mesh.faces.push([...triangle.map((_,i)=>offset+i),mesh.faces[390][3]]);
        for(const key of ['textures','textureCoords','alpha','priorities','renderTypes','faceLabels','sourceFaces'])if(mesh[key])mesh[key].push(mesh[key][390]);
        const before=structuredClone(project),nearest=planPlacedConnection(project.parts,head.id,body.id,{variant:'female',ramp:0}),farther=planPlacedConnection(project.parts,head.id,body.id,{variant:'female',landing:50,ramp:0});
        const center=side=>side.vertices.reduce((sum,vertex)=>{const p=localPoint(linkedPoint({partId:body.id,vertex,twin:false},project.parts),body,project.parts);return sum+p[1]/side.vertices.length;},0);
        assert.ok(center(farther.second)>center(nearest.second)+40,'travel rotates and scales with the placed target');
        assert.ok(!farther.second.removeFaces.includes(extraFace),'a nearby disconnected shell is never selected');
        assert.deepEqual(project,before);validateMesh(assemble([...farther.prepared,farther.part],'female'));
    }finally{cache.close();}
});

test('already aligned real Jad/Zulrah gets a whole rear join from named pieces without picking faces or moving them',async()=>{
    const cache=new BuilderCache(root);
    try{
        const {project,head,body}=placedJadZulrah(cache),before=structuredClone(project),h=await placedHarness(project,head.id);
        button(h,'Connect placed pieces').emit('click');
        const target=h.tools.find(n=>n['aria-label']==='Connect to');assert.ok(target);target.value=body.id;target.emit('change');
        assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));
        const items=h.ctx.viewport.previewItems();assert.equal(items.length,3);
        assert.deepEqual(project,before,'preview must leave the real assembly alone');
        button(h,'Apply connection').emit('click');assert.equal(h.history.length,1);assert.equal(project.parts.length,3);
        for(let i=0;i<2;i++)for(const key of ['position','rotation','scale','parentId','pivot'])assert.deepEqual(project.parts[i][key],before.parts[i][key],key+' stays fixed');
        assert.ok(project.parts[2].connectionEdges.filter(e=>e[0].partId===head.id).length>=24,'covers the large open back instead of a tiny face');
        assert.deepEqual(project.parts[1].mesh.vertices.slice(0,before.parts[1].mesh.vertices.length),before.parts[1].mesh.vertices,'original head shape stays fixed');
    }finally{cache.close();}
});

test('the farther real rear join preserves native materials, donor mappings and animated endpoints through save and export',()=>{
    const cache=new BuilderCache(root);
    try{
        const {project,head,body}=placedJadZulrah(cache),before=structuredClone(project);
        const openings=connectionOpenings(project.parts,head.id);
        assert.ok(openings.some(s=>s.vertices.length===25),'shared corners do not hide the main open back');
        const plan=planPlacedConnection(project.parts,head.id,body.id,{variant:'body',landing:50});
        assert.deepEqual(project,before);assert.equal(plan.first.removeFaces.length,0);
        for(const part of plan.prepared){
            const old=before.parts.find(p=>p.id===part.id),removed=new Set((part.id===head.id?plan.first:plan.second).removeFaces??[]);
            for(const k of ['vertices','sourceVertices','skins','bones','weights'])if(old.mesh[k])assert.deepEqual(part.mesh[k].slice(0,old.mesh.vertices.length),old.mesh[k],k);
            assert.deepEqual(part.mesh.textureMappings,old.mesh.textureMappings);
            for(const k of ['textures','textureCoords','alpha','priorities','faceLabels','renderTypes'])if(old.mesh[k])assert.deepEqual(part.mesh[k],old.mesh[k].filter((_,i)=>!removed.has(i)),k);
            for(let i=old.mesh.vertices.length;i<part.mesh.vertices.length;i++){
                const donor=(old.mesh.sourceVertices??old.mesh.vertices.map((_,i)=>i)).indexOf(part.mesh.sourceVertices[i]);assert.ok(donor>=0);
                for(const k of ['skins','bones','weights'])if(old.mesh[k])assert.deepEqual(part.mesh[k][i],old.mesh[k][donor]);
            }
        }
        project.parts=[...plan.prepared,plan.part];
        const saved=validateProject(JSON.parse(JSON.stringify(project))),assembled=assemble(saved.parts,'body');validateMesh(assembled);
        const edges=new Map();for(const f of plan.part.mesh.faces)for(let j=0;j<3;j++){const key=[f[j],f[(j+1)%3]].sort((a,b)=>a-b).join(':');edges.set(key,(edges.get(key)??0)+1);}
        assert.equal([...edges.values()].filter(n=>n===1).length,plan.part.connectionEdges.length,'only the two attached rims remain boundary edges');
        assert.ok([...edges.values()].every(n=>n<=2));
        const clip=compileMotion(saved,cache,'attack');assert.ok(clip?.frames.length>1);
        const offsets=new Map();let start=0;for(const p of saved.parts){offsets.set(p.id,start);start+=p.mesh.vertices.length;}
        for(const frame of clip.frames)for(const [i,ref]of plan.part.mesh.vertexLinks.entries())assert.deepEqual(frame.vertices[offsets.get(plan.part.id)+i].map(n=>n||0),frame.vertices[offsets.get(ref.partId)+ref.vertex].map(n=>n||0));
        const exported=compileProject(saved,cache);assert.ok(exported.content.models.length);assert.ok(pluginZip(exported).length>0);
    }finally{cache.close();}
});

const disk=(name,count,z,reverse=false)=>makePart({kind:'item',id:6570,name,variant:'male',mesh:{
    vertices:Array.from({length:count},(_,i)=>[Math.cos(i/count*Math.PI*2)*40,Math.sin(i/count*Math.PI*2)*40,z]).concat([[0,0,z]]),
    faces:Array.from({length:count},(_,i)=>reverse?[count,(i+1)%count,i,32000]:[count,i,(i+1)%count,32000])}},'male');

for(const kind of ['npc','gear'])test(`${kind} a center guideline preserves a symmetric concave connection at every Complexity`,async()=>{
    const half=[[0,-60,0],[20,-65,0],[65,-10,0],[85,0,0],[65,10,0],[95,50,0],[60,125,0],[65,158,0],[0,200,0]];
    const rim=[...half,...half.slice(1,-1).reverse().map(([x,y,z])=>[-x,y,z])],variant=kind==='npc'?'body':'male';
    const head=makePart({kind:'item',id:1,name:'Symmetric head',mesh:{vertices:[...rim,[0,50,20]],faces:rim.map((_,i)=>[rim.length,i,(i+1)%rim.length,32000])}},variant);
    const body=disk('Neck',8,-70,true);body.variant=variant;body.mesh.vertices=body.mesh.vertices.map(([x,y,z])=>[x*.4,y*.4+100,z]);
    const project=newProject('center-guide-'+kind,kind,{kind:'npc',id:1,name:'Symmetric pieces',fields:{},mesh:head.mesh},{definition:60000,modelBase:1100000},'fixture');project.parts=[head,body];
    const before=structuredClone(project),h=await placedHarness(project,head.id);
    h.tab.beginConnection(head.id,body.id);button(h,'Add guide pair').emit('click');
    for(const ref of [{partId:head.id,vertex:0,faceId:0},{partId:body.id,vertex:8,faceId:0}])h.tab.edit({...ref,point:linkedPoint(ref,project.parts)},[],'start');
    button(h,'Fill connection').emit('click');assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));
    const assertSymmetric=()=>{
        const mesh=h.ctx.viewport.previewItems().at(-1).mesh,key=points=>points.map(p=>p.map(n=>Math.round(n*1e4)/1e4).join(',')).sort().join('|');
        const triangles=new Set(mesh.faces.map(f=>key(f.slice(0,3).map(i=>mesh.vertices[i]))));
        for(const face of mesh.faces)assert.ok(triangles.has(key(face.slice(0,3).map(i=>mesh.vertices[i].map((n,a)=>a===0?-n:n)))),'every generated triangle has its reflected counterpart: '+JSON.stringify(face.slice(0,3).map(i=>mesh.vertices[i]))+' at level '+h.state.sculpt.placedComplexity);
        return mesh.faces.length;
    };
    const low=assertSymmetric(),complexity=h.tools.find(n=>n['aria-label']==='Complexity');assert.ok(complexity,'a visible Complexity slider controls real geometry');
    assert.equal(Number(complexity.value),0);assert.equal(Number(complexity.max),3);
    const counts=[low];for(const level of [1,2,3]){complexity.value=String(level);complexity.emit('input');assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));counts.push(assertSymmetric());}
    assert.ok(counts.every((n,i)=>!i||n>counts[i-1]),String(counts));assert.ok(counts.at(-1)<=low+24,'detail has a small fixed face budget');
    const lift=h.tools.find(n=>n['aria-label']==='Lift');lift.value='40';lift.emit('input');assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));assertSymmetric();
    assert.deepEqual(project,before);assert.equal(h.history.length,0);
    button(h,'Apply connection').emit('click');assert.equal(h.history.length,1);assert.deepEqual(h.history[0],before);validateMesh(assemble(project.parts,variant));
});

test('a single real Jad center guide keeps the fill on matching sides of the Zulrah neck',()=>{
    const cache=new BuilderCache(root);try{
        const {project,head,body}=placedJadZulrah(cache),guide={source:{partId:head.id,vertex:30,faceId:head.mesh.faces.findIndex(f=>f.slice(0,3).includes(30))},target:{partId:body.id,vertex:294,faceId:body.mesh.faces.findIndex(f=>f.slice(0,3).includes(294))}};
        const world=body.mesh.vertices.map(v=>worldPoint(v,body,project.parts));guide.target.faceId=body.mesh.faces.map((f,i)=>({f,i,n:faceNormal(body.mesh,i,world)})).filter(r=>r.f.slice(0,3).includes(guide.target.vertex)).sort((a,b)=>b.n[2]/Math.hypot(...b.n)-a.n[2]/Math.hypot(...a.n))[0].i;
        const plan=planGuidedConnection(project.parts,head.id,body.id,{guides:[guide]}),x=p=>localPoint(p,body,project.parts)[0];assert.equal(plan.symmetric,true);
        assert.ok(plan.part.mesh.faces.every(f=>{const side=f.slice(0,3).map(i=>x(plan.part.mesh.vertices[i]));return !side.some(n=>n<-.01)||!side.some(n=>n>.01);}), 'the center guide divides the native fill instead of a diagonal cutting across both sides');
        const counts=[];let last;for(const complexity of [0,1,2,3]){
            const detailed=planGuidedConnection(project.parts,head.id,body.id,{guides:[guide],complexity});last=detailed;counts.push(detailed.part.mesh.faces.length);
            validateMesh(assemble([...detailed.prepared,detailed.part],'body'));
            for(const p of detailed.prepared){const original=project.parts.find(o=>o.id===p.id);for(const key of ['vertices','skins','bones','weights','sourceVertices'])if(original.mesh[key])assert.deepEqual(p.mesh[key].slice(0,original.mesh.vertices.length),original.mesh[key]);}
        }
        assert.ok(counts.every((n,i)=>!i||n>counts[i-1]),String(counts));assert.ok(counts.at(-1)<=counts[0]+24);
        const saved=validateProject(JSON.parse(JSON.stringify({...project,parts:[...last.prepared,last.part]}))),clip=compileMotion(saved,cache,'attack');assert.ok(clip?.frames.length>1);
        const offsets=new Map();let start=0;for(const p of saved.parts){offsets.set(p.id,start);start+=p.mesh.vertices.length;}
        for(const frame of clip.frames)for(const [i,ref]of last.part.mesh.vertexLinks.entries())assert.deepEqual(frame.vertices[offsets.get(last.part.id)+i].map(n=>n||0),frame.vertices[offsets.get(ref.partId)+ref.vertex].map(n=>n||0),'complexity vertices retain their animated donor links after save');
        assert.ok(pluginZip(compileProject(saved,cache)).length>0,'the detailed native join exports through the real package compiler');
        body.rotation=[29,63,-37];body.scale=[1.4,1.4,1.4];
        const transformed=planGuidedConnection(project.parts,head.id,body.id,{guides:[guide],complexity:3,ramp:25});assert.equal(transformed.symmetric,true,'the shared plane follows parent rotation and scale');validateMesh(assemble([...transformed.prepared,transformed.part],'body'));
        const asymmetric=backGuides(project,head,body).slice(2,3);assert.equal(planGuidedConnection(project.parts,head.id,body.id,{guides:asymmetric}).symmetric,false,'an intentional off-center guide is respected');
    }finally{cache.close();}
});

for(const kind of ['npc','gear'])test(`${kind} automatic connection Complexity changes only the preview until Apply`,async()=>{
    const a=disk('Helmet',8,0),b=disk('Collar',6,-70,true),variant=kind==='npc'?'body':'male';a.variant=b.variant=variant;
    for(const p of [a,b]){p.mesh.textures=p.mesh.faces.map(()=>7);p.mesh.textureCoords=p.mesh.faces.map(()=>0);p.mesh.textureMappings=[[0,1,2]];p.mesh.bones=p.mesh.vertices.map(()=>[3]);p.mesh.weights=p.mesh.vertices.map(()=>[255]);}
    const project=newProject('detail-'+kind,kind,{kind:'npc',id:1,name:'Pieces',fields:{combatLevel:1},mesh:a.mesh},{definition:60000,modelBase:1100000},'fixture');project.parts=kind==='gear'?[project.parts[0],a,b]:[a,b];
    const h=await placedHarness(project,a.id),before=structuredClone(project);h.tab.beginConnection(a.id,b.id);
    const low=h.ctx.viewport.previewItems().at(-1).mesh.faces.length,slider=h.tools.find(n=>n['aria-label']==='Complexity');assert.ok(slider);
    slider.value='99';slider.emit('input');assert.equal(h.state.sculpt.placedComplexity,3);assert.equal(button(h,'Apply connection').disabled,false,h.messages.at(-1));
    const preview=h.ctx.viewport.previewItems().at(-1).mesh;assert.equal(preview.faces.length,low+24);assert.ok(preview.textures.every(n=>n===7));assert.deepEqual(project,before);assert.equal(h.history.length,0);
    button(h,'Apply connection').emit('click');assert.equal(h.history.length,1);assert.deepEqual(h.history[0],before);
    const saved=validateProject(JSON.parse(JSON.stringify(project))),assembled=assemble(saved.parts,variant);validateMesh(assembled);const decoded=ModelData.decode(new Int8Array(encodeModel(assembled)));assert.ok(Array.from(decoded.faceTextures).every(n=>n===7));assert.ok(assembled.bones.every(row=>row[0]===3));
});

test('Lift adds a single low-poly bend per guide and leaves every native vertex fixed',()=>{
    const a=disk('Helmet',7,0),b=disk('Collar',7,-70,true);b.mesh.vertices=b.mesh.vertices.map(p=>p.map((n,i)=>i<2?n*.3:n));
    const parts=[a,b],before=structuredClone(parts),guides=[0,2,4].map(vertex=>({source:{partId:a.id,vertex,faceId:vertex},target:{partId:b.id,vertex,faceId:vertex}}));
    const plain=planGuidedConnection(parts,a.id,b.id,{guides}),lifted=planGuidedConnection(parts,a.id,b.id,{guides,ramp:50});
    assert.equal(plain.part.mesh.faces.length,11);assert.ok(lifted.part.mesh.faces.length<=17);
    assert.notDeepEqual(lifted.part.mesh.vertices,plain.part.mesh.vertices);assert.ok(lifted.guidePaths.every(p=>p.length===3));
    for(const p of lifted.prepared){const old=parts.find(o=>o.id===p.id);assert.deepEqual(p.mesh.vertices.slice(0,old.mesh.vertices.length),old.mesh.vertices);}
    assert.deepEqual(parts,before);validateMesh(assemble([...lifted.prepared,lifted.part],'male'));
});

test('one guideline routes a concave gear opening without fanning across its notch or adding detail',()=>{
    const source=makePart({kind:'item',id:6570,name:'U-shaped helmet rim',variant:'male',mesh:{
        vertices:[[0,0,0],[40,0,0],[40,40,0],[28,40,0],[28,12,0],[12,12,0],[12,40,0],[0,40,0]],
        faces:[[0,1,4,100],[0,4,5,100],[1,2,4,100],[2,3,4,100],[0,5,7,100],[5,6,7,100]]}},'male');
    const target=disk('Landing',7,-5,true);target.mesh.vertices=target.mesh.vertices.map(p=>[p[0]*.05+6,p[1]*.05+30,p[2]]);
    const parts=[source,target],before=structuredClone(parts),guides=[{source:{partId:source.id,vertex:2,faceId:2},target:{partId:target.id,vertex:7,faceId:0}}];
    const plan=planGuidedConnection(parts,source.id,target.id,{guides});
    assert.equal(plan.part.mesh.faces.length,8);assert.ok(plan.guidePaths[0].length>=3,'the actual edge path turns around the concave notch');
    const path=plan.guidePaths[0];assert.equal(plan.part.mesh.vertexLinks[path[0]].vertex,2);assert.equal(plan.part.mesh.vertexLinks[path.at(-1)].vertex,7);
    assert.deepEqual(parts,before);validateMesh(assemble([...plan.prepared,plan.part],'male'));
    const lifted=planGuidedConnection(parts,source.id,target.id,{guides,ramp:25});
    const mesh=lifted.part.mesh;
    for(const edge of lifted.part.connectionEdges)assert.ok(mesh.faces.some(f=>f.slice(0,3).some((v,j)=>{
        const refs=[mesh.vertexLinks[v],mesh.vertexLinks[f[(j+1)%3]]];return edge.every(r=>refs.some(s=>s.partId===r.partId&&s.vertex===r.vertex));
    })),'Lift never splits a native boundary edge on the routed guide');
    validateMesh(assemble([...lifted.prepared,lifted.part],'male'));
});

test('sparse fills still block generated interiors that cross an opposite-facing native surface',()=>{
    const a=disk('Helmet',7,70),b=disk('Collar',7,0,true);b.mesh.vertices=b.mesh.vertices.map(p=>p.map((n,i)=>i<2?n*.3:n));
    const start=b.mesh.vertices.length;b.mesh.vertices.push([-5,-7,-20],[-5,7,20],[5,0,0]);b.mesh.faces.push([start,start+2,start+1,32000]);
    const parts=[a,b],before=structuredClone(parts),guides=[0,2,4].map(vertex=>({source:{partId:a.id,vertex,faceId:vertex},target:{partId:b.id,vertex,faceId:vertex}}));
    const preview=planGuidedConnection(parts,a.id,b.id,{guides,repairCrossings:false});assert.match(preview.blockedReason,/Crossing faces remain/);
    assert.throws(()=>planGuidedConnection(parts,a.id,b.id,{guides}),/cross|fold|Lift/i,'repair cannot silently accept the crossing after its small native-rim budget');
    assert.deepEqual(parts,before);
});

test('unequal gear openings get shaped, connected rows and all four shape controls change actual geometry',()=>{
    const a=disk('Helmet',7,0),b=disk('Collar',11,70,true),parts=[a,b];
    for(const part of parts){const mesh=part.mesh;mesh.textures=mesh.faces.map(()=>7);mesh.textureCoords=mesh.faces.map(()=>0);mesh.textureMappings=[[0,1,2]];mesh.skins=mesh.vertices.map(()=>2);mesh.bones=mesh.vertices.map(()=>[3]);mesh.weights=mesh.vertices.map(()=>[255]);mesh.sourceVertices=mesh.vertices.map((_,i)=>i);}
    const native=structuredClone(parts);
    const plain=planPlacedConnection(parts,a.id,b.id,{variant:'male',ramp:0});
    for(const options of [{ramp:50},{ramp:0,bend:40},{ramp:0,recess:40},{ramp:0,recess:-40},{ramp:0,coverage:120}]){
        const plan=planPlacedConnection(parts,a.id,b.id,{variant:'male',...options});
        assert.notDeepEqual(plan.part.mesh.vertices,plain.part.mesh.vertices,JSON.stringify(options));validateMesh(assemble([...plan.prepared,plan.part],'male'));
        for(const [i,ref]of plan.part.mesh.vertexLinks.entries())assert.deepEqual(plan.part.mesh.vertices[i],linkedPoint(ref,plan.prepared));
        assert.ok(plan.part.mesh.textures.every(id=>id===7));assert.ok(plan.part.mesh.textureMappings.length);
        const assembled=assemble([...plan.prepared,plan.part],'male');assert.ok(assembled.skins.every(id=>id===2));assert.ok(assembled.bones.every(row=>row[0]===3));
    }
    assert.deepEqual(parts,native);
});

for(const kind of ['npc','gear'])test(`${kind} placed controls preview live, stop safely, support optional faces, cancel and a single undo`,async()=>{
    const a=disk('Head',7,0),b=disk('Body',11,70,true),variant=kind==='npc'?'body':'male';a.variant=b.variant=variant;
    const project={id:'placed-controls',kind,parts:[b,a]},before=structuredClone(project),h=await placedHarness(project,a.id);
    button(h,'Connect placed pieces').emit('click');assert.equal(button(h,'Apply connection').disabled,false);
    assert.equal(h.properties.find(n=>n.textContent==='Face selection'),undefined,'unrelated modelling options are hidden');
    const preview=()=>h.ctx.viewport.previewItems().at(-1).mesh.vertices;
    const first=preview(),ramp=h.tools.find(n=>n['aria-label']==='Ramp');ramp.value='65';ramp.emit('input');assert.notDeepEqual(preview(),first);
    const bend=h.tools.find(n=>n['aria-label']==='Bend');bend.value='100';bend.emit('input');assert.equal(button(h,'Apply connection').disabled,false,'a slider never discards the last safe preview');
    assert.deepEqual(project,before);assert.equal(h.history.length,0);
    const faces=h.tools.find(n=>n['aria-label']==='Add connection faces');faces.checked=false;faces.emit('change');assert.equal(h.ctx.viewport.previewItems(),null);assert.equal(button(h,'Apply connection').disabled,true);
    button(h,'Keep pieces without faces').emit('click');assert.deepEqual(project,before);assert.equal(h.history.length,0);
    button(h,'Connect placed pieces').emit('click');const enabled=h.tools.find(n=>n['aria-label']==='Add connection faces');enabled.checked=true;enabled.emit('change');button(h,'Cancel').emit('click');assert.deepEqual(project,before);
    button(h,'Connect placed pieces').emit('click');button(h,'Apply connection').emit('click');assert.equal(h.history.length,1);assert.equal(project.parts.length,3);assert.deepEqual(h.history[0],before);
});

test('already aligned closed gear pieces prepare facing openings automatically without touching another view or moving either piece',async()=>{
    const mesh={vertices:[[0,0,0],[100,0,0],[0,100,0],[0,0,100]],faces:[[0,2,1,100],[0,1,3,200],[0,3,2,300],[1,2,3,400]],
        textures:[7,7,7,7],textureCoords:[0,0,0,0],textureMappings:[[0,1,2]],skins:[1,2,3,4],bones:[[1],[2],[3],[4]],weights:[[255],[255],[255],[255]],sourceVertices:[10,15,20,25]};
    const a=makePart({kind:'item',id:6570,name:'Pauldron',variant:'male',mesh},'male'),b=makePart({kind:'item',id:6570,name:'Torso',variant:'male',mesh},'male');b.position=[150,0,0];
    const hidden=structuredClone(a);hidden.id='female';hidden.variant='female';
    const parts=[a,b,hidden],before=structuredClone(parts),plan=planPlacedConnection(parts,a.id,b.id,{variant:'male',ramp:0});
    assert.ok(plan.first.removeFaces.length);assert.ok(plan.second.removeFaces.length);assert.deepEqual(parts,before);assert.deepEqual(plan.prepared[2],hidden);
    assert.ok(plan.part.mesh.textures.every(t=>t===7));assert.ok(plan.part.mesh.textureMappings.length);validateMesh(assemble([...plan.prepared,plan.part],'male'));
    for(let i=0;i<2;i++)for(const k of ['position','rotation','scale'])assert.deepEqual(plan.prepared[i][k],before[i][k]);
    const h=await placedHarness({id:'closed-gear',kind:'gear',parts},a.id);button(h,'Connect placed pieces').emit('click');
    assert.equal(button(h,'Apply connection').disabled,false,'a straight join is offered if a curved initial shape would fold');
    assert.deepEqual(parts,before);
    a.pair=true;assert.throws(()=>planPlacedConnection(parts,a.id,b.id),/Mirror to other side/);
});

test('switching gear views finds the pieces in that view and never cuts a hidden or different view',async()=>{
    const parts=[];
    for(const variant of ['inventory','male','female','maleHead','femaleHead']){
        const a=disk('Crest',7,0),b=disk('Helmet',11,70,true);a.variant=b.variant=variant;parts.push(a,b);
    }
    const project={id:'gear-views',kind:'gear',parts},before=structuredClone(project),h=await placedHarness(project,parts[3].id);
    button(h,'Connect placed pieces').emit('click');
    for(const variant of ['inventory','female','maleHead','femaleHead','male']){
        h.state.variant=variant;h.ctx.render();
        assert.equal(button(h,'Apply connection').disabled,false,variant);
        assert.equal(h.ctx.viewport.previewItems().length,3,variant+' previews only its two pieces and join');
        assert.deepEqual(project,before);
    }
    h.tab.onKeyDown({key:'Escape'});assert.equal(h.state.sculpt.tool,'select');assert.equal(h.ctx.viewport.previewItems(),null);
});
