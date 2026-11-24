import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { BuilderCache } from '../cache';
import { makePart, newProject, validateProject } from '../shared/project.mjs';
import { addFace, buildFace, fillOpening, meshTopology, pickBoundary, startFace } from '../shared/sculpt.mjs';
import { assemble, validateMesh, worldPoint } from '../shared/mesh.mjs';
import { compileMotion } from '../shared/motion.mjs';
import { compileProject, pluginZip } from '../export.mjs';
import { encodeModel } from '../shared/model-codec.mjs';
const root=path.resolve(import.meta.dirname,'../../..');

test('native Justiciar neckline supports partial faces and an explicit fill, preserving all original rig identities',()=>{
    const cache=new BuilderCache(root);
    try{
        const source=cache.describe('item',22327,'male'),mesh=source.mesh,before=structuredClone(mesh),topology=meshTopology(mesh);
        // The collar rim used by the Ancient Chestplate, chosen geometrically so
        // this regression survives native vertex reordering.
        const p=makePart(source,'male');
        const seed=topology.boundaryEdges.find(e=>mesh.vertices[e.a][1]<-110&&Math.abs(mesh.vertices[e.a][0])<17&&
            pickBoundary([p],{partId:p.id,sourceFaceId:e.faceId,point:worldPoint(mesh.vertices[e.a],p,[p])})?.vertices.length>8);
        assert.ok(seed);
        const side=pickBoundary([p],{partId:p.id,sourceFaceId:seed.faceId,point:worldPoint(mesh.vertices[seed.a],p,[p])});
        assert.ok(side?.closed);assert.ok(side.vertices.length>8);
        const [a,b]=side.vertices,third=side.vertices[Math.floor(side.vertices.length/2)];
        const partial=addFace(mesh,[b,a,third],seed.faceId);validateMesh(partial);assert.equal(partial.faces.length,mesh.faces.length+1);
        const filled=fillOpening(mesh,side.vertices,seed.faceId);assert.equal(filled.faces.length,mesh.faces.length+side.vertices.length-2);validateMesh(filled);
        for(const next of [partial,filled])for(const key of ['vertices','sourceVertices','bones','weights','skins','textureMappings'])if(mesh[key])assert.deepEqual(next[key],mesh[key],key);
        for(const variant of ['male','female','inventory']){
            const project=newProject('native-face-'+variant,'gear',source,{definition:60000,modelBase:1100000},cache.info.name),part=project.parts[0];
            for(const other of ['inventory','male','female'])if(other!==variant){const copy=structuredClone(part);copy.id+='-'+other;copy.variant=other;project.parts.push(copy);}part.variant=variant;const corners=startFace(mesh,seed.faceId,mesh.vertices[seed.a],{shape:'quad'});
            part.mesh=buildFace(mesh,corners,{materialFace:seed.faceId});validateMesh(assemble(project.parts,variant));
            const imported=validateProject(JSON.parse(JSON.stringify(project)));assert.ok(compileProject(imported,cache).content.models.length);
            assert.ok(encodeModel(assemble(imported.parts,variant)).length>0);
        }
        assert.deepEqual(mesh,before,'neither preview nor export edits the cache donor');
    }finally{cache.close();}
});

test('new creature corners retain donor motion through save, native animation and plugin export',()=>{
    const cache=new BuilderCache(root);
    try{
        const source=cache.describe('npc',655),project=newProject('animated-new-faces','npc',source,{definition:58000,modelBase:1100000,sequenceBase:50000},cache.info.name),part=project.parts[0],before=structuredClone(part.mesh);
        const corners=startFace(part.mesh,0,part.mesh.vertices[part.mesh.faces[0][0]],{mode:'free',shape:'quad'});
        part.mesh=buildFace(part.mesh,corners);const imported=validateProject(JSON.parse(JSON.stringify(project)));
        const clip=compileMotion(imported,cache,'walk');assert.ok(clip?.frames.length>1);
        for(const frame of clip.frames)for(let i=before.vertices.length;i<part.mesh.vertices.length;i++){
            const donor=corners[i-before.vertices.length].donor;
            const actual=frame.vertices[i].map((n,a)=>n-frame.vertices[donor][a]);
            const expected=part.mesh.vertices[i].map((n,a)=>n-before.vertices[donor][a]);
            for(let a=0;a<3;a++)assert.ok(Math.abs(actual[a]-expected[a])<=1,'the new corner follows its donor joint with its sculpted offset');
        }
        assert.ok(pluginZip(compileProject(imported,cache)).length>0);
    }finally{cache.close();}
});

test('closed native sleeve edges can grow a face with coincident, identically rigged anchors',()=>{
    const cache=new BuilderCache(root);
    try{
        for(const variant of ['male','female']){
            const mesh=cache.describe('item',22327,variant).mesh,before=structuredClone(mesh),open=new Set(meshTopology(mesh).boundaryEdges.map(e=>[e.a,e.b].sort((a,b)=>a-b).join(':')));
            const candidates=mesh.faces.flatMap((f,i)=>f.slice(0,3).every(v=>[19,22].includes(mesh.skins[v]))&&f.slice(0,3).every((a,j)=>!open.has([a,f[(j+1)%3]].sort((a,b)=>a-b).join(':')))?[i]:[]);
            assert.ok(candidates.length>3);
            for(const id of candidates.slice(0,4)){
                const face=mesh.faces[id],point=[0,1,2].map(a=>face.slice(0,3).reduce((n,i)=>n+mesh.vertices[i][a]/3,0)),corners=startFace(mesh,id,point);
                assert.equal(corners.filter(c=>c.joined!==undefined).length,2);
                const out=buildFace(mesh,corners,{materialFace:id});validateMesh(out);
                for(let i=0;i<2;i++){
                    assert.deepEqual(out.vertices[mesh.vertices.length+i],mesh.vertices[corners[i].joined]);
                    assert.deepEqual(out.skins[mesh.vertices.length+i],mesh.skins[corners[i].joined]);
                }
                assert.deepEqual(out.faces.slice(0,mesh.faces.length),mesh.faces,'existing surface edges keep their original winding and topology');
            }
            assert.deepEqual(mesh,before);
        }
    }finally{cache.close();}
});
