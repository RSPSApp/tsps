import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {BuilderCache} from '../cache';
import {buildFace,startFace,addFace,fillOpening,mirroredVertexUpdates,mirrorMatches,faceNormal,planBridge,mirrorConnectionPlan,planSurfaceConnection} from '../shared/sculpt.mjs';
import {validateMesh,assemble} from '../shared/mesh.mjs';
import {makePart,newProject,validateProject} from '../shared/project.mjs';
import {compileProject} from '../export.mjs';
const reflect=p=>[-p[0],p[1],p[2]];
const bilateral=()=>({vertices:[[-20,0,0],[-10,0,0],[-15,10,0],[20,0,0],[10,0,0],[15,10,0]],faces:[[0,1,2,100],[5,4,3,200]],
    skins:[1,1,1,2,2,2],sourceVertices:[10,11,12,20,21,22],bones:[[1],[1],[1],[2],[2],[2]],weights:Array.from({length:6},()=>[255])});

for(const shape of ['triangle','quad'])test(`mirrored ${shape} reflects winding, materials and opposite donor rig without mutating the source`,()=>{
    const mesh=bilateral(),before=structuredClone(mesh),corners=startFace(mesh,0,[-15,0,0],{shape});
    const primary=buildFace(mesh,corners),both=buildFace(mesh,corners,{mirror:true});validateMesh(both);
    const added=primary.faces.length-mesh.faces.length;assert.equal(both.faces.length,mesh.faces.length+2*added);
    for(let i=0;i<added;i++){
        const a=both.faces[mesh.faces.length+i],b=both.faces[mesh.faces.length+added+i];
        assert.deepEqual(b.slice(0,3).map(v=>both.vertices[v]),a.slice(0,3).map(v=>reflect(both.vertices[v])).reverse());
        assert.equal(a[3],100);assert.equal(b[3],200);
        faceNormal(both,mesh.faces.length+added+i).forEach((n,a)=>assert.ok(Math.abs(n-reflect(faceNormal(both,mesh.faces.length+i))[a])<1e-7));
    }
    for(let i=primary.vertices.length;i<both.vertices.length;i++){assert.equal(both.skins[i],2);assert.deepEqual(both.bones[i],[2]);assert.ok(both.sourceVertices[i]>=20);}
    assert.deepEqual(mesh,before);
});

test('a centered fill is authored once and opposing missing faces fill together',()=>{
    const mesh=bilateral();mesh.vertices.push([-15,-8,0],[15,-8,0]);for(const key of ['skins','sourceVertices','bones','weights'])mesh[key].push(structuredClone(mesh[key][0]),structuredClone(mesh[key][3]));
    const added=addFace(mesh,[1,0,6],0,{mirror:true});assert.equal(added.faces.length,4);validateMesh(added);
    const fills=fillOpening(mesh,[6,0,1],0,{mirror:true});
    assert.equal(fills.faces.length,4);
    const cap={vertices:[[-10,0,0],[10,0,0],[0,10,0],[0,0,10]],faces:[[0,1,3,100],[1,2,3,100],[2,0,3,100]]};
    assert.equal(fillOpening(cap,[0,1,2],0,{mirror:true}).faces.length,4);
});

test('mirrored joins retain both endpoint sets, animate independently and do not duplicate a centered join',()=>{
    const a=makePart({name:'a',mesh:bilateral()},'body'),b=makePart({name:'b',mesh:bilateral()},'body');b.position=[0,0,10];b.mesh.faces=b.mesh.faces.map(f=>[f[2],f[1],f[0],f[3]]);
    const side=p=>({partId:p.id,twin:false,vertices:p===a?[0,1]:[1,0],edges:p===a?[[0,1]]:[[1,0]],faceIds:[0],closed:false});
    const before=structuredClone([a,b]),primary=planBridge([a,b],side(a),side(b)),both=mirrorConnectionPlan([a,b],primary);
    assert.equal(primary.part.mesh.faces.length,2);assert.equal(both.part.mesh.faces.length,4);assert.equal(both.part.connectionEdges.length,4);assert.deepEqual([a,b],before);
    const right=both.part.mesh.vertexLinks.findIndex(r=>r.partId===a.id&&r.vertex===3);assert.ok(right>=0);
    a.mesh.vertices[3][2]=7;const result=assemble([a,b,both.part],'body');assert.ok(result.vertices.some(v=>v[0]===20&&v[2]===7));validateMesh(result);
    assert.equal(mirrorConnectionPlan([a,b],both).part.mesh.faces.length,4);
});

test('a mirrored surface connection prepares both cuts in a pure preview',()=>{
    const tetra={vertices:[[-20,0,0],[-10,0,0],[-15,10,0],[-15,4,10]],faces:[[0,2,1,100],[0,1,3,100],[1,2,3,100],[2,0,3,100]]};
    const mesh={vertices:[...tetra.vertices,...tetra.vertices.map(reflect)],faces:[...tetra.faces,...tetra.faces.map(([a,b,c,col])=>[c+4,b+4,a+4,col])]};
    const a=makePart({name:'a',mesh},'body'),b=makePart({name:'b',mesh},'body');b.position=[0,0,30];
    const side=p=>({partId:p.id,twin:false,vertices:[0,1,2],edges:[[0,1],[1,2],[2,0]],faceIds:[0,0,0],removeFaces:[0],closed:true});
    const before=structuredClone([a,b]),plan=mirrorConnectionPlan([a,b],planSurfaceConnection([a,b],side(a),side(b),{placement:'keep'}));
    assert.equal(plan.replacements.get(a.id).mesh.faces.length,6);assert.equal(plan.replacements.get(b.id).mesh.faces.length,6);
    assert.deepEqual([a,b],before);validateMesh(assemble([...plan.prepared,plan.part],'body'));
});

test('a mirrored join on linked parts changes the instance reference rather than duplicating cuts',()=>{
    const a=makePart({name:'a',mesh:bilateral()},'body'),b=makePart({name:'b',mesh:bilateral()},'body');a.pair=b.pair=true;b.position=[0,0,12];b.mesh.faces=b.mesh.faces.map(f=>[f[2],f[1],f[0],f[3]]);
    const side=p=>({partId:p.id,twin:false,vertices:p===a?[0,1]:[1,0],edges:p===a?[[0,1]]:[[1,0]],faceIds:[0],closed:false});
    const plan=mirrorConnectionPlan([a,b],planBridge([a,b],side(a),side(b)));
    assert.equal(plan.part.mesh.faces.length,4);assert.ok(plan.part.mesh.vertexLinks.some(r=>r.twin));assert.equal(plan.replacements.size,0);
});

test('mirrored corner moves preserve centerline and move coordinate seam aliases together',()=>{
    const mesh=bilateral();mesh.vertices.push([...mesh.vertices[0]],[...mesh.vertices[3]],[0,0,0]);
    const updates=mirroredVertexUpdates(mesh,new Map([[0,[-21,1,2]],[6,[-21,1,2]],[8,[3,4,5]]]));
    for(const i of [3,7])assert.deepEqual(updates.get(i),[21,1,2]);assert.deepEqual(updates.get(8),[0,4,5]);
    assert.throws(()=>mirroredVertexUpdates(bilateral(),new Map([[0,[-22,0,0]],[3,[21,0,0]]])),/different mirror/);
});

test('mirror refuses missing anchors rather than attaching a face to the wrong limb',()=>{
    const mesh=bilateral();mesh.vertices[3][0]+=3;
    assert.throws(()=>buildFace(mesh,startFace(mesh,0,[-15,0,0]),{mirror:true}),/matching opposite/);
});

test('native female and male sleeve patches keep each opposite hand donor and native material',()=>{
    const cache=new BuilderCache(path.resolve(import.meta.dirname,'../../..'));
    try{for(const variant of ['male','female']){
        const mesh=cache.describe('item',22327,variant).mesh,match=mirrorMatches(mesh),seed=mesh.faces.findIndex((f,i)=>f.slice(0,3).every(v=>mesh.skins[v]===19)&&match.face(i)>=0);
        assert.ok(seed>=0);const corners=startFace(mesh,seed,mesh.vertices[mesh.faces[seed][0]]),both=buildFace(mesh,corners,{materialFace:seed,mirror:true});validateMesh(both);
        const patch=both.faces.at(-1);assert.ok(patch.slice(0,3).every(v=>both.skins[v]===22),'opposite cuff follows the opposite hand');
        assert.ok(patch.slice(0,3).every(v=>Number.isInteger(both.sourceVertices[v])));
        const source=cache.describe('item',22327,'inventory'),project=newProject('mirror-export-'+variant,'gear',source,{definition:60000,modelBase:1100000},cache.info.name);
        for(const view of ['male','female']){const part=makePart(cache.describe('item',22327,view),view);if(view===variant)part.mesh=both;project.parts.push(part);}
        const restored=validateProject(JSON.parse(JSON.stringify(project))),compiled=compileProject(restored,cache);
        assert.ok(compiled.content.models.length>=3,'all item views remain exportable after mirrored face editing');
    }}finally{cache.close();}
});
