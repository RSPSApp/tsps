import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {BuilderCache} from '../cache';
import {makePart,newProject,validateProject} from '../shared/project.mjs';
import {extract} from '../shared/mesh.mjs';
import {compileMotion} from '../shared/motion.mjs';
import {modelVertexOrder} from '../shared/model-codec.mjs';
import {compileProject,pluginZip} from '../export.mjs';
import {planBridge,pickBoundary} from '../shared/sculpt.mjs';
import {assemble,validateMesh} from '../shared/mesh.mjs';
import {SampledAnimationRegistry} from '../../../client/custom/animations/SampledAnimationRegistry';
import {CustomModelRegistry} from '../../../client/custom/items/CustomModelRegistry';
import {NpcType} from '../../../client/rs/config/npctype/NpcType';
import {NpcModelLoader} from '../../../client/rs/config/npctype/NpcModelLoader';
import {registerSampledAnimations,customAnimationRows} from '../../../server/src/main/typescript/elvarg/game/cache/CustomAnimations';
import {getSequenceStall,getSequencePriority} from '../../../server/src/main/typescript/elvarg/game/cache/NpcAnimationScanner';
test('cow + goblin arm retains independent attack motion in exported native game models',()=>{
    const cache=new BuilderCache(path.resolve(import.meta.dirname,'../../..'));
    try{
        const nativeSeqCount=cache.counts().seq;const cow=cache.describe('npc',2790),goblin=cache.describe('npc',655),offer=goblin.parts.find(p=>p.name==='Right arm')!;
        const project=newProject('axe-cow','npc',cow,{definition:58000,modelBase:1100000,sequenceBase:50000},cache.info.name);
        const arm=makePart(goblin,'body',offer.key);arm.mesh=extract(goblin.mesh,offer.faces);arm.mesh.vertices=arm.mesh.vertices.map(v=>v.map((n,a)=>n-offer.pivot[a]));arm.donorPivot=[...offer.pivot];arm.parentId=project.parts[0].id;arm.position=[45,-85,0];arm.motion.mode='own';arm.motion.sequences=newProject('donor','npc',goblin,project.ids,cache.info.name).animations;project.parts.push(arm);
        const normalized=validateProject(project),clip=compileMotion(normalized,cache,'attack');assert.ok(clip);assert.notDeepEqual(clip.frames[0].vertices.slice(cow.mesh.vertices.length),clip.frames.at(-1).vertices.slice(cow.mesh.vertices.length),'arm deforms during its own attack');
        const still=structuredClone(normalized);still.parts[1].motion.mode='still';const host=compileMotion(still,cache,'attack');assert.ok(clip.frames.some((frame,i)=>frame.vertices.slice(cow.mesh.vertices.length).some((v,j)=>Math.hypot(...v.map((n,a)=>n-host.frames[Math.min(i,host.frames.length-1)].vertices[cow.mesh.vertices.length+j][a]))>8)),'own attack differs from following the cow');
        const compiled=compileProject(normalized,cache);assert.ok(pluginZip(compiled).length>0);assert.equal(compiled.content.animations.attack,50003);assert.equal(compiled.content.definition.fields.idleSeqId,50000);
        registerSampledAnimations(compiled.content.animationRows,'test:axe-cow',cache.counts().seq,() => false);assert.equal(getSequencePriority(50003),0);assert.ok(getSequenceStall(50003).ticks>0);assert.ok(customAnimationRows().length);
        for(const row of compiled.content.models)CustomModelRegistry.register(row);
        const rows=compiled.content.animationRows.filter(row=>row.id===50003);for(const row of [...rows].reverse())SampledAnimationRegistry.accept(row);
        const factory=(cache as any).factory,loader=new NpcModelLoader(factory.getNpcTypeLoader(),factory.getModelLoader(),factory.getTextureLoader(),factory.getSeqTypeLoader(),factory.getSeqFrameLoader(),factory.getSkeletalSeqLoader(),{} as any),type=new NpcType(58000,cache.info);type.modelIds=[1100000];
        const order=modelVertexOrder(clip.mesh),first=loader.getModel(type,50003,0)!,last=loader.getModel(type,50003,clip.frames.length-1)!;
        assert.equal(first.verticesCount,order.length,'single custom model keeps coincident donor vertices');
        for(let i=0;i<order.length;i++){assert.deepEqual([first.verticesX[i],first.verticesY[i],first.verticesZ[i]],clip.frames[0].vertices[order[i]]);assert.deepEqual([last.verticesX[i],last.verticesY[i],last.verticesZ[i]],clip.frames.at(-1).vertices[order[i]]);}
        assert.throws(()=>registerSampledAnimations(compiled.content.animationRows,'different-owner',nativeSeqCount,() => false),/another package/);
        SampledAnimationRegistry.clear();assert.equal(SampledAnimationRegistry.get(50003),undefined,'disconnect clears sampled animation assets');
        const authored=structuredClone(normalized);authored.parts[0].motion.mode='still';authored.parts[1].motion.mode='still';authored.parts[1].motion.keys.attack=[{time:0,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},{time:400,position:[0,0,0],rotation:[70,0,0],scale:[1,1,1]},{time:800,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}];
        const custom=compileProject(authored,cache);assert.ok(custom.content.animationRows.some(row=>row.id===50003),'a wholly authored movement exports without a native sequence');
    }finally{SampledAnimationRegistry.clear();CustomModelRegistry.clear();cache.close();}
});

test('bridges stay on independent animated endpoints through validation, save JSON and compiled game transport',()=>{
    const cache=new BuilderCache(path.resolve(import.meta.dirname,'../../..'));
    try{
        const source={kind:'npc',id:655,variant:'body',name:'Joined pieces',fields:{combatLevel:1},mesh:{vertices:[[0,0,0],[0,10,0],[-10,0,0]],faces:[[0,1,2,32000]],skins:[0,0,0]}};
        const project=newProject('moving-connection','npc',source,{definition:58000,modelBase:1100000,sequenceBase:50000},cache.info.name);
        project.animations={idle:-1,walk:-1,run:-1,attack:-1,block:-1,death:-1};
        const body=project.parts[0],head=makePart({...source,mesh:{...source.mesh,vertices:[[10,0,0],[10,10,0],[20,0,0]],faces:[[0,2,1,32000]]}},'body');
        body.motion.mode='still';head.motion.mode='still';head.motion.keys.attack=[{time:0,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},{time:400,position:[0,0,20],rotation:[0,0,0],scale:[1,1,1]}];project.parts.push(head);
        const a=pickBoundary(project.parts,{partId:body.id,faceId:0,point:[0,5,0]},{opening:false}),b=pickBoundary(project.parts,{partId:head.id,faceId:0,point:[10,5,0]},{opening:false});
        project.parts.push(planBridge(project.parts,a,b).part);
        const normalized=validateProject(JSON.parse(JSON.stringify(project))),clip=compileMotion(normalized,cache,'attack'),start=body.mesh.vertices.length+head.mesh.vertices.length;
        validateMesh(assemble(normalized.parts,'body'));
        for(const frame of clip.frames)normalized.parts[2].mesh.vertexLinks.forEach((ref,i)=>{const index=ref.partId===body.id?ref.vertex:body.mesh.vertices.length+ref.vertex;assert.deepEqual(frame.vertices[start+i],frame.vertices[index]);});
        assert.notDeepEqual(clip.frames[0].vertices.slice(start),clip.frames.at(-1).vertices.slice(start),'moving endpoint actually moves');
        const exported=compileProject(normalized,cache);assert.ok(exported.content.animationRows.some(row=>row.id===50003));assert.ok(pluginZip(exported).length);
        const missing=structuredClone(normalized);missing.parts.splice(1,1);assert.throws(()=>validateProject(missing),/endpoint/);
        const collapsed=structuredClone(normalized);collapsed.parts[1].position=[-10,0,0];assert.throws(()=>validateProject(collapsed),/collapsed/);
    }finally{cache.close();}
});
