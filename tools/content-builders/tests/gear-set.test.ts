import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BuilderCache } from '../cache';
import { createBuilderServer } from '../server';
import { ProjectStore } from '../store.mjs';
import { compileProject, pluginZip } from '../export.mjs';
import { newProject, makePart, validateProject, SLOTS } from '../shared/project.mjs';
import { newPassive } from '../shared/effects.mjs';
import { SET_FORMAT, validateGearSet, fullSetRequirement, itemReference, equippedItems, equippedParts, setPreviewItems, removeSetItem } from '../shared/gear-set.mjs';
import { ModelData } from '../../../client/rs/model/ModelData';
import { assemble, validateMesh } from '../shared/mesh.mjs';

const root=path.resolve(import.meta.dirname,'../../..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'builder-gear-set-test-')),cache=new BuilderCache(root);
after(()=>{cache.close();fs.rmSync(temporary,{recursive:true,force:true});});
function item(id,baseId,index){
    const p=newProject(id,'gear',cache.describe('item',baseId,'inventory'),{definition:62000+index,modelBase:1250000+index*5},cache.info.name);
    for(const variant of ['male','female','maleHead','femaleHead'])try{p.parts.push(makePart(cache.describe('item',baseId,variant),variant));}catch{}
    return p;
}
export function runeSet(){return validateGearSet({format:SET_FORMAT,id:'custom-rune-set',kind:'gear',name:'Custom rune set',items:[item('rune-helm',1163,0),item('rune-body',1127,1),item('rune-legs',1079,2)]});}

test('a grouped armor set needs no bonus, keeps independent items and previews their real worn geometry',()=>{
    const set=runeSet(),before=structuredClone(set);assert.equal(set.items.length,3);assert.ok(set.items.every(item=>item.effects.passives.length===0));
    const equipped=equippedItems(set);assert.equal(equipped.length,3);const parts=equippedParts(set);assert.equal(new Set(parts.map(p=>p.id)).size,parts.length);
    for(const variant of ['male','female']){const mesh=assemble(parts,variant);validateMesh(mesh);assert.equal(mesh.faces.length,set.items.reduce((n,item)=>n+assemble(item.parts,variant).faces.length,0));assert.equal(setPreviewItems(set,variant,{},set.items[0].id).length,2);}
    assert.deepEqual(set,before);const compiled=compileProject(set,cache);assert.equal(compiled.content.items.length,3);assert.ok(compiled.content.items.every(item=>item.effects===null));
});

test('set effects resolve custom item references after reassignment and reject dangling or wrong-slot pieces',()=>{
    const set=runeSet(),owner=set.items[0];owner.effects.passives=[{...newPassive(),chance:100,set:fullSetRequirement(set,owner.id)}];
    const before=structuredClone(set);set.items.forEach((item,i)=>{item.ids.definition=62500+i;item.ids.modelBase=1260000+i*5;});
    const compiled=compileProject(set,cache),effect=compiled.content.items[0].effects.config.passives[0];assert.deepEqual(effect.set.pieces.map(p=>p.itemIds[0]),[62500,62501,62502]);assert.ok(!compiled.code.includes('item:rune-'));
    assert.throws(()=>compileProject(owner,cache),/gear set/);assert.throws(()=>removeSetItem(set,set.items[1].id),/uses .* effect|uses .* in/i);
    const missing=structuredClone(before);missing.items.pop();assert.throws(()=>validateGearSet(missing),/missing item/);
    const wrong=structuredClone(before);wrong.items[0].effects.passives[0].set.pieces[0].itemIds=[itemReference(wrong.items[1].id)];assert.throws(()=>validateGearSet(wrong),/does not fit/);
});

test('preview selects slot alternatives and prevents a shield and two-handed weapon appearing together',()=>{
    const set=runeSet(),other=item('other-helm',3751,3),weapon=item('spear',4726,4),shield=item('shield',1187,5);set.items.push(other,weapon,shield);
    assert.equal(equippedItems(set,{},other.id).filter(item=>SLOTS[item.settings.equipmentType]===0)[0].id,other.id);
    weapon.settings.doubleHanded=true;assert.ok(!equippedItems(set,{},weapon.id).some(item=>item===shield));assert.ok(!equippedItems(set,{},shield.id).some(item=>item===weapon));
});

test('gear set HTTP save/reload/import and shared-ID export preserve every item without replacing standalone projects',async()=>{
    const app=createBuilderServer({root,directory:path.join(temporary,'projects'),cache});await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${(app.server.address() as any).port}`,post=async(route,input)=>{const r=await fetch(origin+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
    try{
        const single=await post('create',{kind:'gear',baseId:1163}),original=structuredClone(single.body);
        let set=(await post('gear-set',{project:single.body.project,name:'My armor set'})).body;
        assert.notEqual(set.project.items[0].ids.definition,original.project.ids.definition);
        for(const baseId of [1127,1079]){set.project.items[0].name='Edited helmet';const added=await post('gear-set/item',{...set,baseId});assert.equal(added.status,201,JSON.stringify(added.body));set=added.body;}
        const owner=set.project.items[0];owner.effects.passives=[{...newPassive(),set:fullSetRequirement(set.project,owner.id)}];
        const saved=await post('save',set);assert.equal(saved.status,200,JSON.stringify(saved.body));set=saved.body;
        const loaded=await(await fetch(origin+'/api/projects/'+set.project.id)).json();assert.deepEqual(loaded,set);
        const stale=await post('save',{project:{...set.project,name:'Stale overwrite'},revision:original.revision});assert.equal(stale.status,409);
        const standalone=await(await fetch(origin+'/api/projects/'+original.project.id)).json();assert.deepEqual(standalone,original,'creating a set copies, never overwrites the standalone item');
        const direct=await post('gear-set',{baseId:1187,name:'Direct gear set'});assert.equal(direct.status,201);assert.equal(direct.body.project.items.length,1);assert.equal(direct.body.project.items[0].effects.passives.length,0);
        const next=await post('create',{kind:'gear',baseId:1187});assert.ok(set.project.items.every(item=>item.ids.definition!==next.body.project.ids.definition&&item.ids.modelBase!==next.body.project.ids.modelBase));
        const verify=await post('verify',{project:set.project});assert.equal(verify.status,200,JSON.stringify(verify.body));assert.equal(verify.body.items.length,3);
        const reassigned=await post('reassign',{project:set.project});assert.equal(reassigned.status,200);assert.deepEqual(reassigned.body.project.items[0].effects.passives[0].set,owner.effects.passives[0].set);for(let i=0;i<3;i++)assert.notEqual(reassigned.body.project.items[i].ids.definition,set.project.items[i].ids.definition);
        const imported=await post('import',{project:set.project});assert.equal(imported.status,201,JSON.stringify(imported.body));assert.notEqual(imported.body.project.id,set.project.id);for(let i=0;i<3;i++)assert.notEqual(imported.body.project.items[i].ids.definition,set.project.items[i].ids.definition);
        assert.deepEqual(imported.body.project.items[0].effects.passives[0].set,owner.effects.passives[0].set,'local references survive fresh ID allocation');
        const exported=await fetch(origin+'/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:set.project})});assert.equal(exported.status,200);const zip=Buffer.from(await exported.arrayBuffer());
        const require=createRequire(path.join(root,'server/package.json')),{readPluginZip}=require(path.join(root,'server/plugins/tools/worldadmin/PluginZip.WorldAdmin.js')),parsed=readPluginZip(zip);assert.equal(parsed.manifest.category,'@ Ghost Plugins @');assert.match(parsed.source,/gear-set/);
        const mannequin=await(await fetch(origin+'/api/mannequin?gender=male&slots=FULL_HELMET,PLATEBODY,LEGS')).json();assert.ok(mannequin.mesh.faces.length);assert.ok(mannequin.mesh.faces.length<cache.mannequin('male','FULL_HELMET').mesh.faces.length);
    }finally{await new Promise<void>(resolve=>app.server.close(()=>resolve()));}
});

test('the allocator reserves every identity in an installed set package',()=>{
    const set=runeSet(),compiled=compileProject(set,cache),fakeRoot=path.join(temporary,'installed'),folder=path.join(fakeRoot,'server/plugins/imported/rune');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'Rune.plugin.js'),compiled.code);
    const store=new ProjectStore(path.join(fakeRoot,'projects'),fakeRoot);// allocator starts at the normal gear range
    const reserved=Array.from({length:2000},(_,i)=>({definition:60000+i})),ids=store.allocate('gear',reserved);assert.equal(ids.definition,62003);
    assert.ok(!set.items.some(item=>item.ids.modelBase===ids.modelBase));assert.ok(pluginZip(compiled).length>0);
});

test('a textured set member keeps native texture mapping and rig channels through validation and export',()=>{
    const set=runeSet(),cape=item('textured-cape',6570,3);set.items.push(cape);const roundTrip=validateGearSet(JSON.parse(JSON.stringify(set)));
    assert.deepEqual(roundTrip.items[3].parts,validateProject(cape).parts);
    const compiled=compileProject(roundTrip,cache),mesh=assemble(cape.parts,'male'),row=compiled.content.items[3].models.find(row=>row.id===cape.ids.modelBase+1),decoded=ModelData.decode(new Int8Array(Buffer.from(row.data,'base64')));
    assert.ok(mesh.textures.some(id=>id>=0));assert.deepEqual(Array.from(decoded.faceTextures!),mesh.textures);assert.equal(decoded.verticesCount,mesh.vertices.length);assert.ok(decoded.vertexSkins?.length||decoded.animMayaGroups?.length,'native player rig data is still encoded');
});
