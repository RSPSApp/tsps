import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {BuilderCache} from '../cache';
import {assemble,extract,worldPoint,bounds} from '../shared/mesh.mjs';
import {makePart,newProject,validateProject} from '../shared/project.mjs';
import {compileProject} from '../export.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
const mesh=()=>({vertices:[[0,0,0],[10,0,0],[0,10,0]],faces:[[0,1,2,100]],skins:[7,7,7],bones:[[3,4],[3,4],[3,4]],weights:[[200,55],[200,55],[200,55]]});
const part=(id,body=mesh())=>({...makePart({name:id,kind:'npc',id:655,variant:'body',mesh:body},'body'),id});

test('an affixed piece exports its current parent joints and full weights instead of a stale placement joint',()=>{
    const parent=part('body'),child=part('plume');child.parentId=parent.id;child.rigMode='parent';child.bindLabel=49;child.bindBone=12;child.position=[1,1,0];
    const before=structuredClone([parent,child]),out=assemble([parent,child],'body');
    assert.deepEqual(out.skins.slice(3),[7,7,7]);assert.deepEqual(out.bones.slice(3),[[3,4],[3,4],[3,4]]);assert.deepEqual(out.weights.slice(3),[[200,55],[200,55],[200,55]]);
    assert.deepEqual([parent,child],before,'binding is derived without changing the source mesh or edit placement');
    child.rigMode='source';assert.deepEqual(assemble([parent,child],'body').skins.slice(3),[49,49,49],'source/manual joints remain an explicit alternative');
});

test('moving an affixed piece updates its attachment and mirrored copies use the corresponding side',()=>{
    const body=mesh();body.vertices.push(...body.vertices.map(([x,y,z])=>[x-40,y,z]));body.faces.push([3,4,5,200]);body.skins.push(9,9,9);body.bones.push([8],[8],[8]);body.weights.push([255],[255],[255]);
    const parent=part('body',body),child=part('horn');child.parentId=parent.id;child.rigMode='parent';child.position=[-35,0,0];
    assert.deepEqual(assemble([parent,child],'body').skins.slice(6),[9,9,9]);child.position=[1,0,0];
    assert.deepEqual(assemble([parent,child],'body').skins.slice(6),[7,7,7]);
    parent.pivot=[-15,0,0];child.pair=true;
    const mirrored=assemble([parent,child],'body');assert.deepEqual(mirrored.skins.slice(6),[7,7,7,9,9,9]);
    assert.deepEqual(mirrored.bones.slice(6),[[3,4],[3,4],[3,4],[8],[8],[8]]);
});

test('nested attachments and inherited mirrored instances resolve their own parent weights',()=>{
    const parent=part('body');parent.pair=true;parent.twinBindLabel=9;parent.twinBindBone=8;
    const child=part('neck');child.parentId=parent.id;child.rigMode='parent';
    const tip=part('horn');tip.parentId=child.id;tip.rigMode='parent';
    const out=assemble([parent,child,tip],'body',new Set([tip.id]));
    assert.deepEqual(out.skins,[7,7,7,9,9,9]);assert.deepEqual(out.weights,[[200,55],[200,55],[200,55],[255],[255],[255]]);
});

test('older follow-parent projects migrate stale bindings while explicit source and independent motion remain intact',()=>{
    const source={name:'Legacy',kind:'npc',id:655,variant:'body',fields:{combatLevel:1},mesh:mesh()},p=newProject('legacy-attachment','npc',source,{definition:58000,modelBase:1100000},'fixture');
    const child=part('legacy-plume');child.parentId=p.parts[0].id;child.bindLabel=49;delete child.rigMode;p.parts.push(child);
    const loaded=validateProject(JSON.parse(JSON.stringify(p)));assert.equal(loaded.parts[1].rigMode,'parent');assert.deepEqual(assemble(loaded.parts,'body').skins.slice(3),[7,7,7]);
    child.motion.mode='own';assert.equal(validateProject(p).parts[1].rigMode,'source');
    child.motion.mode='follow';child.rigMode='source';assert.deepEqual(assemble(validateProject(p).parts,'body').skins.slice(3),[49,49,49]);
});

for(const id of [2790,7221])test(`native creature ${id}: attached inventory geometry follows classic or skeletal idle after export`,()=>{
    const cache=new BuilderCache(root);
    try{
        const source=cache.describe('npc',id),parent=makePart(source,'body'),donor=cache.describe('item',1163,'inventory'),child=makePart(donor,'body');
        child.parentId=parent.id;child.rigMode='parent';child.position=[0,bounds(parent.mesh).min[1],0];
        const parts=[parent,child],anchor=worldPoint(child.pivot,child,parts),nearest=parent.mesh.vertices.reduce((best,v,i)=>Math.hypot(...v.map((n,a)=>n-anchor[a]))<Math.hypot(...parent.mesh.vertices[best].map((n,a)=>n-anchor[a]))?i:best,0);
        const expected=structuredClone(parts);expected[1].rigMode='source';expected[1].mesh.skins=child.mesh.vertices.map(()=>parent.mesh.skins[nearest]);expected[1].mesh.bones=child.mesh.vertices.map(()=>[...parent.mesh.bones[nearest]]);expected[1].mesh.weights=child.mesh.vertices.map(()=>[...parent.mesh.weights[nearest]]);
        const actual=cache.animate(assemble(parts,'body'),source.fields.idleSeqId,4),native=cache.animate(assemble(expected,'body'),source.fields.idleSeqId,4);
        assert.ok(JSON.stringify(actual.frames)===JSON.stringify(native.frames),'native player/NPC animation uses the full inherited binding');
    }finally{cache.close();}
});

test('a native inventory plume affixed to a worn helmet follows the native idle through save and export',()=>{
    const cache=new BuilderCache(root);
    try{
        const source=cache.describe('item',22326,'male'),project=newProject('affixed-helm','gear',source,{definition:60000,modelBase:1100000},cache.info.name),parent=project.parts[0];parent.variant='male';
        const donor=cache.describe('item',12486,'inventory'),child=makePart(donor,'male');child.mesh=extract(donor.mesh,donor.parts.find(p=>p.name.includes('Back piece'))?.faces??donor.mesh.faces.map((_,i)=>i));
        const center=bounds(child.mesh).center;child.mesh.vertices=child.mesh.vertices.map(v=>v.map((n,i)=>(n-center[i])*.3));child.parentId=parent.id;child.position=[0,-200,3];child.bindLabel=49;child.rigMode='parent';project.parts.push(child);
        const out=assemble(project.parts,'male'),expected=structuredClone(project.parts);expected[1].rigMode='source';
        const anchor=worldPoint(child.pivot,child,project.parts),closest=parent.mesh.vertices.reduce((best,v,i)=>Math.hypot(...v.map((n,a)=>n-anchor[a]))<Math.hypot(...parent.mesh.vertices[best].map((n,a)=>n-anchor[a]))?i:best,0);
        expected[1].bindLabel=parent.mesh.skins[closest];expected[1].bindBone=-1;
        const actualClip=cache.animate(out,808,8),expectedClip=cache.animate(assemble(expected,'male'),808,8);
        assert.deepEqual(actualClip.frames,expectedClip.frames,'the exported plume follows the head for every sampled native idle frame');
        for(const view of ['female','inventory'])project.parts.push(makePart(cache.describe('item',22326,view),view));
        const saved=validateProject(JSON.parse(JSON.stringify(project)));assert.equal(saved.parts[1].rigMode,'parent');
        assert.ok(compileProject(saved,cache).content.models.length>=3);
    }finally{cache.close();}
});
