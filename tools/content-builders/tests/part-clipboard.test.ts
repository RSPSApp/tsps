import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BuilderCache } from '../cache';
import { copyParts,pasteParts } from '../shared/part-clipboard.mjs';
import { makePart,newProject,validateProject } from '../shared/project.mjs';
import { worldPoint,assemble } from '../shared/mesh.mjs';
import { planBridge } from '../shared/sculpt.mjs';
import { compileProject } from '../export.mjs';
const mesh=()=>({vertices:[[0,0,0],[10,0,0],[0,10,0]],faces:[[0,1,2,200]],skins:[1,2,3],sourceVertices:[5,7,9]});
const project=(id='clipboard',kind='gear')=>newProject(id,kind,{name:'Fixture',kind:kind==='gear'?'item':'npc',id:1163,variant:kind==='gear'?'inventory':'body',fields:{combatLevel:5},mesh:mesh()},{definition:60000,modelBase:1100000},'fixture');
const part=(variant='male')=>makePart({name:'Sigil',kind:'item',id:1163,variant,mesh:mesh()},variant);
const close=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<1e-7));

for(const kind of ['npc','gear'])test(`${kind}: cross-project paste retains exact transforms, materials, children, identities and undo-safe snapshots`,()=>{
    const source=project('source',kind),variant=kind==='gear'?'inventory':'body',p=source.parts[0];p.position=[3,-8,11];p.rotation=[15,25,35];p.scale=[.2,1.7,2.4];p.pivot=[2,3,4];
    const child=part(variant);child.parentId=p.id;child.position=[4,-2,5];source.parts.push(child);const before=structuredClone(source);
    const payload=JSON.parse(JSON.stringify(copyParts(source,p.id))),target=project('target',kind),targetBefore=structuredClone(target),out=pasteParts(target,payload,kind==='gear'?'male':'body');
    const pasted=out.parts.find(r=>r.id===out.selected),pastedChild=out.parts.find(r=>r.parentId===pasted.id);
    assert.deepEqual(source,before);assert.deepEqual(target,targetBefore);assert.notEqual(pasted.id,p.id);assert.equal(pastedChild.name,child.name);
    for(const key of ['position','rotation','scale','pivot','mesh','motion','source'])assert.deepEqual(pasted[key],key==='motion'?payload.parts.find(row=>row.id===p.id).motion:p[key],key);
    child.mesh.vertices.forEach((v,i)=>close(worldPoint(v,child,source.parts),worldPoint(pastedChild.mesh.vertices[i],pastedChild,out.parts)));
    assert.equal(pasted.variant,kind==='gear'?'male':'body');validateProject({...target,parts:out.parts});
});

test('copying a nested piece keeps its world placement and editable transforms without bringing visible parent geometry',()=>{
    const source=project(),parent=part('inventory');parent.position=[2,-10,4];parent.rotation=[20,35,-10];parent.scale=[2,.8,1.3];source.parts.push(parent);
    const child=part('inventory');child.parentId=parent.id;child.rotation=[-12,5,9];child.scale=[.4,.6,.8];child.position=[3,-7,2];source.parts.push(child);
    const payload=copyParts(source,child.id),out=pasteParts(project('other'),payload,'female'),pasted=out.parts.find(p=>p.id===out.selected);
    assert.equal(payload.parts.length,1);assert.equal(payload.frames.length,1);assert.equal(out.parts.filter(p=>p.variant==='female'&&p.visible).length,1);
    assert.deepEqual(pasted.scale,child.scale);assert.deepEqual(pasted.rotation,child.rotation);assert.deepEqual(pasted.position,child.position);
    child.mesh.vertices.forEach((v,i)=>close(worldPoint(v,child,source.parts),worldPoint(pasted.mesh.vertices[i],pasted,out.parts)));
    assert.equal(assemble(out.parts,'female').faces.length,child.mesh.faces.length);
});

test('an affixed piece copied alone retains its parent rig in an invisible placement frame',()=>{
    const source=project(),parent=source.parts[0],child=part('inventory');parent.mesh.skins=[7,7,7];
    child.parentId=parent.id;child.rigMode='parent';child.bindLabel=49;source.parts.push(child);
    const payload=copyParts(source,child.id),out=pasteParts(project('destination'),payload,'male');
    assert.equal(payload.frames.length,1,'an identity parent still matters for its animation rig');
    const result=assemble(out.parts,'male');assert.deepEqual(result.skins,[7,7,7]);
    assert.equal(result.faces.length,child.mesh.faces.length,'the hidden parent never becomes exported geometry');
});

test('generated placement frames retain the exact displayed position when copied between item views',()=>{
    const source=project(),parent=source.parts[0];parent.source.region='generated';parent.position=[30,-70,12];parent.rotation=[25,10,35];parent.scale=[2,.8,1.4];
    const child=part('inventory');child.parentId=parent.id;child.position=[7,-90,4];source.parts.push(child);
    const expected=child.mesh.vertices.map(v=>worldPoint(v,child,source.parts));
    const payload=copyParts(source,child.id),out=pasteParts(project('target'),JSON.parse(JSON.stringify(payload)),'male'),pasted=out.parts.find(p=>p.id===out.selected);
    expected.forEach((p,i)=>close(p,worldPoint(pasted.mesh.vertices[i],pasted,out.parts)));
    const restored=validateProject({...project('target'),parts:out.parts});
    expected.forEach((p,i)=>close(p,worldPoint(pasted.mesh.vertices[i],restored.parts.find(p=>p.id===out.selected),restored.parts)));
});

test('same-project paste uses fresh identities and remaps both endpoints of copied connections',()=>{
    const p=project('clipboard','npc'),a=p.parts[0],b=part('body');b.position=[0,0,10];b.mesh.faces=[[2,1,0,300]];p.parts.push(b);
    const side=part=>({partId:part.id,twin:false,vertices:[0,1],edges:[[0,1]],faceIds:[0],closed:false});
    const join=planBridge(p.parts,side(a),{...side(b),vertices:[1,0],edges:[[1,0]]}).part;p.parts.push(join);b.parentId=a.id;
    const payload=copyParts(p,a.id),out=pasteParts(p,payload,'body'),ids=new Set(out.parts.slice(p.parts.length).map(p=>p.id));
    assert.equal(ids.size,3);const connection=out.parts.slice(p.parts.length).find(p=>p.mesh.vertexLinks);assert.ok(connection.mesh.vertexLinks.every(r=>ids.has(r.partId)));
    validateProject({...p,parts:out.parts});
});

test('clipboard rejects limits, invalid geometry and missing attachments before changing the destination',()=>{
    const source=project(),payload=copyParts(source,source.parts[0].id),target=project('target'),before=structuredClone(target);
    payload.parts[0].parentId='missing';assert.throws(()=>pasteParts(target,payload,'male'),/placement/);assert.deepEqual(target,before);
    payload.parts[0].parentId=null;payload.parts[0].mesh.vertices[0]=[Infinity,0,0];assert.throws(()=>pasteParts(target,payload,'male'),/bounds/);assert.deepEqual(target,before);
});

test('native pasted inventory components retain texture projections and export in both worn views',()=>{
    const cache=new BuilderCache(path.resolve(import.meta.dirname,'../../..'));
    try{
        const source=cache.describe('item',6570,'inventory'),p=newProject('paste-native','gear',source,{definition:60000,modelBase:1100000},cache.info.name);
        const piece=p.parts[0];piece.scale=[.7,.8,.9];piece.rotation=[12,8,-4];piece.position=[3,-100,4];
        const payload=copyParts(p,piece.id),male=pasteParts(p,payload,'male');p.parts=male.parts;const female=pasteParts(p,payload,'female');p.parts=female.parts;
        assert.deepEqual(p.parts.find(r=>r.id===female.selected).mesh.textureMappings,piece.mesh.textureMappings);assert.ok(compileProject(validateProject(p),cache).content.models.length);
    }finally{cache.close();}
});

test('native copy/paste events preserve text field editing and put an atomic paste in the host undo path',async()=>{
    const text=fs.readFileSync(new URL('../public/part-clipboard.mjs',import.meta.url),'utf8').replace("'/shared/part-clipboard.mjs'",JSON.stringify(new URL('../shared/part-clipboard.mjs',import.meta.url).href));
    const {createPartClipboard}=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
    const p=project(),state={project:p,selected:p.parts[0].id,variant:'male',isolate:false},history=[],messages=[],data=new Map();
    const tool=createPartClipboard({state,change:fn=>{history.push(structuredClone(state.project));fn();},status:t=>messages.push(t)});
    const event=(editing=false)=>({target:{closest:selector=>editing&&selector.includes('input')?{}:null},clipboardData:{setData:(k,v)=>data.set(k,v),getData:k=>data.get(k)??''},preventDefault(){this.prevented=true;},prevented:false});
    assert.equal(tool.copy(event(true)),false);assert.equal(data.size,0);assert.equal(tool.copy(event()),true);
    assert.equal(tool.paste(event(true)),false);assert.equal(history.length,0);assert.equal(tool.paste(event()),true);assert.equal(history.length,1);assert.equal(state.project.parts.length,2);assert.equal(state.project.parts[1].variant,'male');
});
