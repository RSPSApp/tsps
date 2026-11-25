import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {BuilderCache} from '../cache';
import {generateGearViews,viewFitter} from '../shared/gear-views.mjs';
import {inventoryPreviewMesh} from '../shared/item-preview.mjs';
import {assemble,bounds,extract,validateMesh,worldPoint} from '../shared/mesh.mjs';
import {makePart,newProject,validateProject} from '../shared/project.mjs';
import {encodeModel} from '../shared/model-codec.mjs';
import {ModelData} from '../../../client/rs/model/ModelData';
let cache:BuilderCache;
before(()=>{cache=new BuilderCache(path.resolve(import.meta.dirname,'../../..'));});
after(()=>cache?.close());
const model=(vertices,faces=[[0,1,2,4550],[0,3,1,500],[0,2,3,500],[1,3,2,500]])=>({vertices,faces,skins:vertices.map(()=>3)});

test('affine donor fitting carries out-of-surface edits through native inventory rotations',()=>{
    const male=model([[0,0,0],[10,0,0],[0,10,0],[0,0,10]]);
    const turn=([x,y,z])=>[z+20,y-50,-x+8];
    const inventory={...male,vertices:male.vertices.map(turn)};
    const fitter=viewFitter(male,inventory,'inventory');
    assert.match(fitter.method,/matching native/);
    assert.deepEqual(fitter.point([25,30,-8]),turn([25,30,-8]));
});

test('female nearest-surface fitting handles different topology and retains rig group locality',()=>{
    const male=model([[-10,0,0],[10,0,0],[0,-40,0],[0,-20,10]]);
    const female=model([[-8,2,0],[8,2,0],[0,-38,0],[0,-18,8],[0,-30,4]],[[0,1,4,500],[0,4,2,500],[1,3,4,500]]);
    const before=structuredClone(male),fitter=viewFitter(male,female,'female');
    const out=fitter.point([0,-25,5],'s3');
    assert.ok(out.every(Number.isFinite));assert.ok(out[1]<-10&&out[1]>-40);assert.deepEqual(male,before);
});

for(const id of [1127,1163,4587,6570])test(`native item ${id}: generated views preserve edits, painted materials, pairs, rigging and export`,()=>{
    const native=cache.describe('item',id,'male'),p=newProject('view-test','gear',cache.describe('item',id,'inventory'),{definition:58000,modelBase:1100000},cache.info.name);
    const male=makePart(native,'male');male.mesh.vertices[0][0]+=5;male.mesh.faces[0][3]=4550;
    male.position=[3,-4,2];male.scale=[1.05,1,1];p.parts.push(male);
    const accessory=makePart({...native,mesh:extract(native.mesh,[0,1,2])},'male');accessory.parentId=male.id;accessory.position=[4,-3,5];accessory.pair=true;p.parts.push(accessory);
    const before=structuredClone(p),references=Object.fromEntries(['male','female','inventory'].map(v=>[v,cache.describe('item',id,v).mesh]));
    const draft=generateGearViews(p,['female','inventory'],references);
    assert.deepEqual(p,before,'draft never overwrites source or existing views');
    assert.equal(draft.generated.length,4);
    const output=validateProject({...p,parts:draft.parts});
    assert.deepEqual(output.parts.find(part=>part.id===male.id),validateProject(p).parts.find(part=>part.id===male.id));
    for(const variant of ['female','inventory']){
        const mesh=assemble(output.parts,variant);validateMesh(mesh);
        assert.equal(mesh.faces.length,assemble(p.parts,'male').faces.length);
        assert.deepEqual(mesh.faces.map(f=>f[3]),assemble(p.parts,'male').faces.map(f=>f[3]));
        assert.deepEqual(mesh.textures,assemble(p.parts,'male').textures);
        assert.deepEqual(mesh.skins,assemble(p.parts,'male').skins);
        const decoded=ModelData.decode(new Int8Array(encodeModel(mesh)));
        assert.ok(Array.from(decoded.faceColors).includes(4550),'native wearable skin survives model encoding');
        assert.equal(decoded.faceCount,mesh.faces.length);
    }
});

test('generation refuses empty male view or limits without overwriting the inventory',()=>{
    const p=newProject('view-test','gear',cache.describe('item',1163,'inventory'),{definition:58000,modelBase:1100000},cache.info.name),before=structuredClone(p);
    assert.throws(()=>generateGearViews(p,['female'],{}),/Male worn/);assert.deepEqual(p,before);
    const native=cache.describe('item',1163,'male');p.parts.push(makePart(native,'male'));
    while(p.parts.length<128)p.parts.push({...structuredClone(p.parts[1]),id:crypto.randomUUID(),variant:'male'});
    assert.throws(()=>generateGearViews(p,['inventory','female'],{}),/128 parts/);
});

test('inventory thumbnails apply native angles without changing mesh, materials or rigging',()=>{
    const source=model([[0,0,0],[10,0,0],[0,10,0],[0,0,10]]),before=structuredClone(source);
    const preview=inventoryPreviewMesh(source,{xan2d:512,yan2d:0,zan2d:0});
    assert.ok(Math.abs(preview.vertices[2][2]-10)<1e-8);assert.ok(Math.abs(preview.vertices[2][1])<1e-8);
    assert.equal(preview.faces,source.faces);assert.equal(preview.skins,source.skins);assert.deepEqual(source,before);
});


test('converted chest sigils keep their gizmo on the part and scale around the chest',()=>{
    const base=cache.describe('item',22327,'male'),p=newProject('sigil-pivot','gear',cache.describe('item',22327,'inventory'),{definition:58000,modelBase:1100000},cache.info.name);
    const body=makePart(base,'male');p.parts.push(body);
    const staff=cache.describe('item',4675,'inventory'),mesh=extract(staff.mesh,Array.from({length:16},(_,i)=>i));
    const center=bounds(mesh).center;mesh.vertices=mesh.vertices.map(v=>v.map((n,i)=>n-center[i]));
    const sigil=makePart({...staff,mesh,name:'Chest sigil'},'male');sigil.parentId=body.id;sigil.position=[0,-90,-18];sigil.scale=[.2,.2,.2];p.parts.push(sigil);
    const references=Object.fromEntries(['male','female','inventory'].map(v=>[v,cache.describe('item',22327,v).mesh]));
    const draft=generateGearViews(p,['female','inventory'],references);
    for(const part of draft.generated.filter(p=>p.name==='Chest sigil')){
        const visibleCenter=bounds(assemble(draft.parts,part.variant,new Set([part.id]))).center;
        const origin=worldPoint(part.pivot,part,draft.parts);
        assert.ok(Math.hypot(...origin.map((n,i)=>n-visibleCenter[i]))<1,'converted sigil gizmo must be on its geometry, not the floor');
        part.scale=[1.7,1.3,.8];
        const scaledCenter=bounds(assemble(draft.parts,part.variant,new Set([part.id]))).center;
        assert.ok(Math.hypot(...scaledCenter.map((n,i)=>n-visibleCenter[i]))<1,'scaling must leave the sigil centre on the chest');
    }
});

test('fallback inventory drafts use an upright icon camera rather than a folded template camera',()=>{
    const base=cache.describe('item',30781,'male'),p=newProject('legs-camera','gear',cache.describe('item',30781,'inventory'),{definition:58000,modelBase:1100000},cache.info.name);
    p.parts.push(makePart(base,'male'));
    const references=Object.fromEntries(['male','female','inventory'].map(v=>[v,cache.describe('item',30781,v).mesh]));
    const before=structuredClone(p),draft=generateGearViews(p,['inventory'],references);
    assert.deepEqual(p,before);
    assert.equal(draft.iconSettings?.zan2d,0,'newly generated upright geometry needs its own icon camera');
    assert.equal(draft.iconSettings?.xan2d,128);
    assert.equal(draft.iconSettings?.yan2d,128);
});


test('earlier generated parts load with repaired pivots without shifting their current geometry',()=>{
    const p=newProject('legacy-pivot','gear',cache.describe('item',22327,'inventory'),{definition:58000,modelBase:1100000},cache.info.name);
    const part=makePart(cache.describe('item',4675,'inventory'),'female','generated');
    part.mesh.vertices=part.mesh.vertices.map(v=>[v[0]*.1,v[1]*.1-90,v[2]*.1-18]);
    part.scale=[1.31,.9,1.15];part.rotation=[5,12,-3];part.position=[3,-2,1];p.parts.push(part);
    const before=structuredClone(p),points=part.mesh.vertices.map(v=>worldPoint(v,part,p.parts));
    const repaired=validateProject(p),out=repaired.parts.find(r=>r.id===part.id);
    assert.deepEqual(p,before,'loading normalizes a copy');
    assert.deepEqual(out.pivot,bounds(out.mesh).center);
    out.mesh.vertices.forEach((v,i)=>assert.ok(Math.hypot(...worldPoint(v,out,repaired.parts).map((n,axis)=>n-points[i][axis]))<1e-8));
    assert.deepEqual(validateProject(repaired),repaired,'repair is idempotent across save/load');
    assert.deepEqual(out.mesh,part.mesh,'native materials and rig data remain intact');
});

test('native female sleeve conversion retains every wrist anchor without collapsing or shortening the cuffs',()=>{
    const male=cache.describe('item',22327,'male').mesh,female=cache.describe('item',22327,'female').mesh,fitter=viewFitter(male,female,'female');
    for(const label of [19,22]){
        const from=male.vertices.flatMap((p,i)=>male.skins[i]===label?[{p,i}]:[]),to=female.vertices.filter((_,i)=>female.skins[i]===label);
        const converted=from.map(({p})=>fitter.point(p,'s'+label));
        assert.equal(new Set(converted.map(p=>p.map(Math.round).join(','))).size,new Set(to.map(p=>p.join(','))).size,'every wrist corner keeps a distinct target');
        assert.equal(Math.max(...converted.map(p=>Math.round(p[1]))),Math.max(...to.map(p=>p[1])),'the cuff reaches the native forearm seam');
        for(const face of male.faces.filter(f=>f.slice(0,3).every(i=>male.skins[i]===label))){
            const points=face.slice(0,3).map(i=>fitter.point(male.vertices[i],'s'+label).map(Math.round)),u=points[1].map((n,a)=>n-points[0][a]),v=points[2].map((n,a)=>n-points[0][a]);
            assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>0,'conversion cannot collapse a sleeve face');
        }
    }
});
