import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BuilderCache} from '../cache';
import {createBuilderServer} from '../server';
import {PREVIEW_SCENES,NEUTRAL_SKIN_HSL,clipBackdropTriangle} from '../shared/preview-scenes.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
let cache:BuilderCache;
before(()=>{cache=new BuilderCache(root);});
after(()=>cache.close());

test('background tiles crossing the camera are clipped with continuous UVs instead of leaving ground holes',()=>{
    const view={distance:0,project:point=>point},vertices=[[-10,0,5],[10,0,30],[0,20,30]],uv=[[0,0],[1,0],[0,1]],before=structuredClone(vertices);
    const clipped=clipBackdropTriangle(vertices,uv,view);
    assert.equal(clipped.length,2,'one corner behind the near plane produces two visible triangles');
    assert.ok(clipped.every(tri=>tri.vertices.every(v=>v[2]>=10)));
    assert.ok(clipped.every(tri=>tri.uv.every(v=>v.every(n=>Number.isFinite(n)&&n>=0&&n<=1))));
    assert.deepEqual(vertices,before);
    assert.deepEqual(clipBackdropTriangle(vertices.map(v=>[v[0],v[1],0]),uv,view),[]);
    assert.equal(clipBackdropTriangle(vertices.map(v=>[v[0],v[1],30]),uv,view).length,1);
});

for(const gender of ['male','female'])test(`${gender}: native character reference keeps skin and clothing, dummy stays plain, covered slots stay hidden`,()=>{
    const dummy=cache.mannequin(gender,'NONE'),character=cache.mannequin(gender,'NONE','character');
    assert.deepEqual(character.mesh.vertices,dummy.mesh.vertices,'same native body, no changes to fit');
    assert.deepEqual(character.mesh.faces.map(f=>f.slice(0,3)),dummy.mesh.faces.map(f=>f.slice(0,3)));
    assert.equal(new Set(dummy.mesh.faces.map(f=>f[3])).size,1);
    assert.ok(new Set(character.mesh.faces.map(f=>f[3])).size>3);
    assert.ok(character.mesh.faces.some(f=>f[3]===NEUTRAL_SKIN_HSL));
    const covered=cache.mannequin(gender,['PLATEBODY','LEGS','BOOTS','FULL_HELMET'],'character');
    assert.ok(covered.mesh.faces.length<character.mesh.faces.length/2);
    assert.deepEqual(cache.mannequin(gender,'NONE').mesh,dummy.mesh,'colour choices never contaminate the native model cache');
    assert.deepEqual(character.mesh.skins,dummy.mesh.skins,'animation rig remains native');
});

for(const preset of PREVIEW_SCENES)test(`${preset.name}: bounded, native scenery remains separate from editable geometry`,()=>{
    const scene=cache.previewScene(preset.id);
    assert.equal(scene.id,preset.id);
    if(preset.studio){assert.deepEqual(scene.items,[]);return;}
    assert.equal(scene.plane,preset.id==='varrock'?3:0);
    assert.ok(scene.items.length>5);
    const faces=scene.items.reduce((n,item)=>n+item.mesh.faces.length,0),vertices=scene.items.reduce((n,item)=>n+item.mesh.vertices.length,0);
    assert.ok(faces>100&&faces<=40000);assert.ok(vertices<=60000);
    assert.ok(scene.items.every(item=>item.reference&&item.opacity===1));
    assert.ok(scene.items.every(item=>item.mesh.vertices.every(v=>v.every(Number.isFinite))));
    assert.ok(scene.items.every(item=>item.mesh.faces.every(f=>f.slice(0,3).every(i=>Number.isInteger(i)&&i>=0&&i<item.mesh.vertices.length))));
    assert.equal(cache.previewScene(preset.id),scene,'repeat selections reuse decoded scenery');
    assert.ok(scene.items.some(item=>item.mesh.vertices.some(v=>Math.abs(v[1])<10)),'ground is placed at the model feet');
});

test('preview API validates the bounded preset list and keeps older mannequin requests compatible',async()=>{
    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'tsps-preview-api-'));
    const app=createBuilderServer({root,directory:temporary,cache});
    try{
        await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
        const origin=`http://127.0.0.1:${(app.server.address() as any).port}`;
        const old=await(await fetch(origin+'/api/mannequin?gender=male&slot=CAPE')).json();assert.equal(old.style,'dummy');
        const character=await(await fetch(origin+'/api/mannequin?gender=female&slots=PLATEBODY,LEGS&style=character')).json();assert.equal(character.style,'character');
        assert.ok(character.mesh.faces.some(f=>f[3]===NEUTRAL_SKIN_HSL));
        for(const preset of PREVIEW_SCENES){const response=await fetch(origin+'/api/preview-scene?id='+preset.id);assert.equal(response.status,200);assert.equal((await response.json()).id,preset.id);}
        for(const route of ['preview-scene?id=arbitrary-map','mannequin?style=invalid'])assert.equal((await fetch(origin+'/api/'+route)).status,400);
        assert.deepEqual(fs.readdirSync(temporary),[],'view settings never write project files');
    }finally{await new Promise<void>(resolve=>app.server.close(()=>resolve()));fs.rmSync(temporary,{recursive:true,force:true});}
});


test('female and male samples use distinct native appearance kits and the female sample has no beard',()=>{
    const male=cache.mannequin('male','NONE','character'),female=cache.mannequin('female','NONE','character');
    assert.equal(male.gender,'male');assert.equal(female.gender,'female');
    assert.ok(male.kits.some(k=>k.part===1));assert.ok(!female.kits.some(k=>k.part===1));
    const loader=cache.factory.getIdkTypeLoader();
    for(const kit of male.kits)assert.equal(loader.load(kit.id).bodyPartyId,kit.part);
    for(const kit of female.kits)assert.equal(loader.load(kit.id).bodyPartyId,kit.part+7);
    assert.notDeepEqual(male.kits,female.kits);
});

test('both studio backgrounds use neutral greys and no scenery meshes',()=>{
    const dark=cache.previewScene('studio'),light=cache.previewScene('studio-light');
    assert.equal(dark.name,'Studio dark');assert.equal(light.name,'Studio light');
    for(const scene of [dark,light]){assert.deepEqual(scene.items,[]);assert.equal(scene.sky.slice(1,3),scene.sky.slice(3,5));assert.equal(scene.sky.slice(3,5),scene.sky.slice(5,7));assert.ok(!['#ffffff','#000000'].includes(scene.sky));}
    assert.ok(parseInt(dark.sky.slice(1,3),16)<parseInt(light.sky.slice(1,3),16));
});
