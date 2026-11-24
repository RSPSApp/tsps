import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {BuilderCache} from '../cache';
import {newProject,makePart,validateProject} from '../shared/project.mjs';
import {newGearVisuals,newTexture,newParticles,newModelTrack,validateGearVisuals,sampleParticles,renderTexture,sampleModelTrack,moveVertex} from '../shared/gear-visuals.mjs';
import {previewGearVisuals,compileGearVisualMesh} from '../shared/gear-visual-compile.mjs';
import {compileProject,pluginZip} from '../export.mjs';
import {loadFromPayload} from '../../../client/common/gamemode/GamemodeContentStore';
import {CustomItemRegistry} from '../../../client/custom/items/CustomItemRegistry';
import {CustomModelRegistry} from '../../../client/custom/items/CustomModelRegistry';
import {GearVisualRegistry,GEAR_TEXTURE_START,GEAR_TEXTURE_COUNT} from '../../../client/custom/items/GearVisualRegistry';
import {GearTextureLoader} from '../../../client/custom/items/GearTextureLoader';
import {updateGearVisuals} from '../../../client/custom/items/GearVisualRuntime';
import {IndexModelLoader} from '../../../client/rs/model/ModelLoader';
import {PlayerAppearance} from '../../../client/rs/config/player/PlayerAppearance';
import {CustomObjTypeLoader} from '../../../client/custom/items/CustomObjTypeLoader';
import {PlayerModelLoader} from '../../../client/rs/config/player/PlayerModelLoader';
import {withSeqHandItems} from '../../../client/rs/config/player/Equipment';
const root=path.resolve(import.meta.dirname,'../../..');

test('visual schemas preserve valid layers and reject invalid frame data, selections and budgets',()=>{
    const visuals=newGearVisuals(),texture=newTexture('part'),particles=newParticles('part'),model=newModelTrack('part');
    visuals.textures.push(texture);visuals.particles.push(particles);visuals.models.push(model);
    assert.deepEqual(validateGearVisuals(visuals),visuals);
    const invalid=(fn:any,pattern:RegExp)=>{const v=structuredClone(visuals);fn(v);assert.throws(()=>validateGearVisuals(v),pattern);};
    invalid(v=>v.particles[0].lifetime=Infinity,/Lifetime/);
    invalid(v=>v.textures[0].scale[0]=0,/scale/);
    invalid(v=>v.textures[0].source='frames',/Import at least/);
    invalid(v=>v.textures[0].frames=[{size:64,pixels:'AAAA'}],/pixels/);
    invalid(v=>v.models[0].keys[1].time=0,/share a time/);
    invalid(v=>v.models[0].vertices=[1,1],/selection/);
    invalid(v=>{v.particles=[0,1,2].map(i=>({...particles,id:`emitter-${i}`,capacity:128}));},/256/);
    invalid(v=>v.models[0].axis[0]=2,/Wave direction/);
});

test('deterministic particles loop without changing seed, and texture and model controls change their output',()=>{
    const particles=newParticles('part');particles.gravity=[0,0,0];particles.turbulence=2;particles.orbit=1;
    assert.deepEqual(sampleParticles(particles,.625),sampleParticles(particles,8.625));
    assert.notDeepEqual(sampleParticles(particles,.625),sampleParticles({...particles,seed:55},.625));
    assert.ok(sampleParticles(particles,1).every(p=>p.opacity>=0&&p.opacity<=1&&p.size>=0));
    const texture=newTexture('part'),frame=renderTexture(texture,16,0);
    assert.equal(frame.length,16*16*4);assert.notDeepEqual(frame,renderTexture(texture,16,.5));
    assert.notDeepEqual(frame,renderTexture({...texture,hue:90},16,0));
    assert.ok(renderTexture({...texture,opacity:.5},8,0).filter((_,i)=>i%4===3).every(n=>n===127));
    const model=newModelTrack('part');assert.deepEqual(sampleModelTrack(model,0).position,[0,0,0]);assert.deepEqual(sampleModelTrack(model,1).position,[0,-4,0]);
    assert.deepEqual(sampleModelTrack({...model,loop:'once'},50).position,[0,0,0]);
    assert.deepEqual(sampleModelTrack({...model,loop:'pingpong'},3).position,[0,-4,0]);
    assert.deepEqual(moveVertex([0,3,0],{...model,type:'wave',loop:'once'},50),moveVertex([0,3,0],{...model,type:'wave',loop:'once'},2),'wave tracks must respect the same loop modes as keyframes');
});

test('real exported gear carries all visual layers through native models and the live item loaders',()=>{
    const cache=new BuilderCache(root);
    try{
        const project=newProject('visual-gear','gear',cache.describe('item',24424,'inventory'),{definition:60870,modelBase:1186000},cache.info.name);
        for(const variant of ['male','female'])project.parts.push(makePart(cache.describe('item',24424,variant),variant));
        project.settings.equipmentType='WEAPON';project.visuals=newGearVisuals();
        for(const part of project.parts){
            const surface=newTexture(part.id);surface.faces=[0,1];surface.projection='xy';
            const emitter=newParticles(part.id);emitter.capacity=4;emitter.rate=4;emitter.origin=[0,-60,0];
            const track=newModelTrack(part.id);track.vertices=[0,1,2];
            project.visuals.textures.push(surface);project.visuals.particles.push(emitter);project.visuals.models.push(track);
        }
        const normal=validateProject(project);assert.equal(normal.visuals.textures.length,3);
        const compiled=compileProject(project,cache);assert.equal(compiled.content.item.visuals.models.length,3);assert.ok(pluginZip(compiled).length);
        const model=compiled.content.item.visuals.models.find(m=>m.modelId===project.ids.modelBase+1),baseline=compileGearVisualMesh(project,'male');
        assert.equal(model.vertexCount,baseline.mesh.vertices.length);assert.equal(model.faceCount,baseline.mesh.faces.length);
        const projectionStart=project.parts[1].mesh.vertices.length;
        for(let i=projectionStart;i<projectionStart+3;i++)assert.ok(baseline.mesh.skins[i]>=0||baseline.mesh.bones[i].length,'planar mapping anchors must inherit the item rig');
        const fitting=cache.animateGear([normal],'male',808,cache.mannequin('male','WEAPON','dummy').mesh,{visible:true,style:'dummy'});
        assert.deepEqual(fitting.visualLayers,{textures:1,particles:1,models:1},'native player movement previews must retain every authored visual type');
        assert.equal(fitting.mesh.visualTextures.length,1);assert.ok(fitting.frames.length>1);assert.ok(fitting.frames.every(f=>f.vertices.length===fitting.mesh.vertices.length&&f.colours.length===fitting.mesh.faces.length&&f.alpha.length===fitting.mesh.faces.length));
        loadFromPayload({gamemodeId:'test-visuals',datasets:[{key:'customModels',rows:compiled.content.models},{key:'customItems',rows:[compiled.content.item]}]});
        const loader=new IndexModelLoader({getFile(){throw new Error('Custom models must not read the cache');}} as any);
        GearVisualRegistry.setTime(0);const first=loader.getModel(model.modelId)!;
        GearVisualRegistry.setTime(1000);const next=loader.getModel(model.modelId)!;
        assert.notDeepEqual(first.verticesY,next.verticesY,'independent motion and particles run in the native model loader');
        assert.ok(next.faceTextures!.includes(GEAR_TEXTURE_START+1));
        assert.ok(model.particles[0].faceIndices.some(i=>(next.faceAlphas![i]&255)<255),'some particles are visible');
        const unchanged=first.verticesX[10];next.verticesX[10]=99999;assert.equal(loader.getModel(model.modelId)!.verticesX[10],unchanged,'sampling and edits must never mutate registered model bytes');
        const preview=previewGearVisuals(project,'male',1);assert.equal(preview.faces.length,model.faceCount);
        const native=cache as any,objects=new CustomObjTypeLoader(native.factory.getObjTypeLoader(),cache.info),textures=new GearTextureLoader(native.factory.getTextureLoader());
        const playerModels=new PlayerModelLoader(native.factory.getIdkTypeLoader(),objects,native.factory.getModelLoader(),textures);
        for(const gender of [0,1]){
            const equipment=Array(14).fill(-1);equipment[3]=project.ids.definition;
            const appearance=new PlayerAppearance(gender,[0,0,0,0,0],Array(7).fill(-1),equipment);
            const mesh=playerModels.buildStaticModelFromEquipment(appearance,equipment);assert.ok(mesh?.faceCount>=model.faceCount,'both worn views compose through the real player model loader');
            GearVisualRegistry.setTime(0);const key=appearance.getCacheKey();GearVisualRegistry.setTime(50);assert.notEqual(appearance.getCacheKey(),key);
        }
        const ids=textures.getTextureIds();assert.equal(ids.length,native.factory.getTextureLoader().getTextureIds().length+GEAR_TEXTURE_COUNT);
        assert.deepEqual(textures.getMaterial(GEAR_TEXTURE_START),{animU:0,animV:0,frameCount:1,animSpeed:0,alphaCutOff:.01});
        const pixels=GearVisualRegistry.texturePixels(textures.base,16).get(GEAR_TEXTURE_START)!.slice(),rgba=renderTexture(compiled.content.item.visuals.models[0].textures[0],16,GearVisualRegistry.time),argb=pixels[0]>>>0;
        assert.deepEqual([(argb>>>16)&255,(argb>>>8)&255,argb&255,argb>>>24],Array.from(rgba.slice(0,4)),'the atlas expects ARGB words, whose BGRA bytes are swizzled by both shaders');
        GearVisualRegistry.setTime(1300);assert.notDeepEqual(GearVisualRegistry.texturePixels(textures.base,16).get(GEAR_TEXTURE_START),pixels);
        const old=GearVisualRegistry.model(model.modelId);const invalid=structuredClone(compiled.content.item);invalid.visuals.models[1].particles[0].vertexIndices[0]=999999;
        assert.throws(()=>CustomItemRegistry.register(invalid),/selection/);assert.equal(GearVisualRegistry.model(model.modelId),old,'failed replacement leaves the active visuals intact');
        const registered=CustomItemRegistry.get(project.ids.definition);assert.throws(()=>CustomItemRegistry.replaceAll([invalid]),/selection/);assert.equal(CustomItemRegistry.get(project.ids.definition),registered,'invalid datasets cannot partially clear valid gear');
        CustomItemRegistry.register(compiled.content.item);assert.ok(GearVisualRegistry.model(model.modelId),'hot replacement reuses its atlas allocation');
        const once=structuredClone(compiled.content.item);for(const m of once.visuals.models)for(const track of m.models)track.loop='once';CustomItemRegistry.register(once);
        const equipment=Array(14).fill(-1);equipment[3]=project.ids.definition;equipment[5]=1201;
        GearVisualRegistry.setTime(120000);const firstWearer=new PlayerAppearance(0,[0,0,0,0,0],Array(7).fill(-1),equipment);firstWearer.getCacheKey();playerModels.buildStaticModelFromEquipment(firstWearer,equipment);
        GearVisualRegistry.setTime(121000);const actionAppearance=withSeqHandItems(firstWearer,{leftHandItem:0,rightHandItem:-1});assert.equal(actionAppearance.visualClockKey,firstWearer.visualClockKey,'sequence hand substitutions must not restart one-shot motion');
        const firstPose=playerModels.buildStaticModelFromEquipment(actionAppearance,actionAppearance.equip),secondWearer=new PlayerAppearance(0,[0,0,0,0,0],Array(7).fill(-1),actionAppearance.equip.slice());secondWearer.getCacheKey();const secondPose=playerModels.buildStaticModelFromEquipment(secondWearer,secondWearer.equip);
        assert.notDeepEqual(firstPose!.verticesY,secondPose!.verticesY,'one-shot motion starts separately for each worn appearance, even long after page load');assert.notEqual(actionAppearance.getCacheKey(),secondWearer.getCacheKey(),'different one-shot ages cannot share posed geometry');
        CustomItemRegistry.register(compiled.content.item);
        for(const backend of ['webgl','webgpu']){
            let uploads=0;const target:any={loadedTextureIds:new Set(),uploadMapTextures:()=>uploads++};
            const renderer:any={osrsClient:{textureLoader:textures},...(backend==='webgpu'?{world:target}:{loadedTextureIds:target.loadedTextureIds,textureArray:{},updateTextureArray:target.uploadMapTextures})};
            updateGearVisuals(renderer,1500);updateGearVisuals(renderer,1501);assert.equal(uploads,1,`${backend} uploads each visual frame once`);updateGearVisuals(renderer,1550);assert.equal(uploads,2);
        }
        CustomItemRegistry.clear();assert.equal(GearVisualRegistry.model(model.modelId),undefined);assert.equal(GearVisualRegistry.texturePixels(textures.base).size,0,'world changes clear material and emitter state');
    }finally{CustomItemRegistry.clear();CustomModelRegistry.clear();cache.close();}
});
