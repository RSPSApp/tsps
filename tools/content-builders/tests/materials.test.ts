import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {BuilderCache} from '../cache';
import {extract,assemble,textureUV,validateMesh,sculpt} from '../shared/mesh.mjs';
import {makePart,newProject,validateProject} from '../shared/project.mjs';
import {encodeModel} from '../shared/model-codec.mjs';
import {ModelData} from '../../../client/rs/model/ModelData';
import {pickGizmo,gizmoDelta} from '../public/gizmo.mjs';
test('source texture patterns, projection vertices and alpha survive edits and native export',()=>{
    const cache=new BuilderCache(path.resolve(import.meta.dirname,'../../..'));
    try{
        const source=cache.describe('item',6570,'male'),mesh=source.mesh;
        assert.ok(mesh.textures.some(id=>id>=0),'fire cape has native textures');
        assert.ok(!source.warnings.some(w=>w.includes('flat colours')));
        const faceIds=mesh.faces.flatMap((_,i)=>mesh.textures[i]>=0?[i]:[]).slice(0,15),subset=extract(mesh,faceIds);
        validateMesh(subset);assert.equal(subset.sourceVertices.length,subset.vertices.length);
        const part=makePart({...source,mesh:subset},'male');part.pair=true;part.rotation=[10,20,30];part.position=[40,-30,12];
        const result=assemble([part],'male');sculpt(result,result.vertices[0],8,1,true);
        const data=ModelData.decode(new Int8Array(encodeModel(result)));
        assert.deepEqual(Array.from(data.faceTextures!),result.textures);
        const decoded={vertices:Array.from({length:data.verticesCount},(_,i)=>[data.verticesX[i],data.verticesY[i],data.verticesZ[i]]),faces:Array.from({length:data.faceCount},(_,i)=>[data.indices1[i],data.indices2[i],data.indices3[i],data.faceColors[i]]),textureCoords:Array.from(data.textureCoords??[],n=>n===-1?-1:n&255),textureMappings:Array.from({length:data.textureFaceCount},(_,i)=>[data.textureMappingP[i],data.textureMappingM[i],data.textureMappingN[i]])};
        for(let i=0;i<result.faces.length;i++){const a=textureUV({...result,vertices:result.vertices.map(v=>v.map(Math.round))},i).flat(),b=textureUV(decoded,i).flat();assert.ok(a.every((v,j)=>Math.abs(v-b[j])<.0001),'native mapping remains equivalent after reordering');}
        const texture=cache.texture(mesh.textures.find(id=>id>=0));assert.equal(Buffer.from(texture.frames[0],'base64').length,texture.size**2*4);assert.ok(texture.material.animU||texture.material.animV||texture.frames.length>1,'native texture retains its movement');
        const p=newProject('textured','gear',cache.describe('item',6570,'inventory'),{definition:60000,modelBase:1100000},cache.info.name);assert.deepEqual(validateProject(p).parts[0].mesh.textures,p.parts[0].mesh.textures);
    }finally{cache.close();}
});
test('axis handles constrain movement and use total drag displacement',()=>{
    const handle={mode:'move',axis:0,direction:[1,0,0],size:100,points:[[0,0],[80,0]]};
    const picked=pickGizmo([handle],50,3);assert.ok(picked);assert.deepEqual(gizmoDelta(picked,24,100).movement,[30,0,0]);assert.equal(pickGizmo([handle],40,20),null);
    assert.ok(gizmoDelta({...picked,mode:'scale'},45,0).factor>1);
});
