import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makePart, newProject, validateProject} from '../shared/project.mjs';
import {assemble, linkedPoint, validateMesh} from '../shared/mesh.mjs';
import {planConnectionCleanup} from '../shared/sculpt.mjs';
import {encodeModel} from '../shared/model-codec.mjs';
import {ModelData} from '../../../client/rs/model/ModelData';

function fixture(){
    const part=(name,mesh)=>makePart({name,kind:'npc',id:1,variant:'body',mesh},'body');
    const body=part('Body',{vertices:[[-40,-40,-40],[40,-40,-40],[40,40,-40],[-40,40,-40],[-40,-40,40],[40,-40,40],[40,40,40],[-40,40,40]],
        faces:[[0,2,1,100],[0,3,2,100],[4,5,6,200],[4,6,7,200],[0,1,5,300],[0,5,4,300],[3,7,6,400],[3,6,2,400],[0,4,7,500],[0,7,3,500],[1,2,6,600],[1,6,5,600]]});
    const source=part('Head',{vertices:[[-10,-10,-80],[10,-10,-80],[0,10,-80],[-10,-10,0],[10,-10,0],[0,10,0],[100,-10,0],[120,-10,0],[110,10,0]],
        faces:[[0,1,2,1000],[3,4,5,2000]],textures:[7,8],textureCoords:[0,1],textureMappings:[[0,1,2],[3,4,5]],alpha:[0,0],priorities:[2,3],faceLabels:[4,5],renderTypes:[0,1],
        sourceVertices:[10,11,12,20,21,22,30,31,32],skins:[1,1,1,2,2,2,3,3,3],bones:[[1],[1],[1],[2],[2],[2],[3],[3],[3]],weights:Array.from({length:9},()=>[255])});
    const parts=[body,source],refs=source.mesh.vertices.map((_,vertex)=>({partId:source.id,vertex,twin:false}));
    const join=part('Join',{vertices:refs.map(r=>linkedPoint(r,parts)),faces:[[2,1,0,1100],[5,4,3,2200],[8,7,6,3300]],
        vertexLinks:refs,authoredFaces:[0,1,2],textures:[7,8,-1],textureCoords:[0,1,-1],textureMappings:[[0,1,2],[3,4,5]],alpha:[0,0,0],priorities:[2,3,4]});
    join.role='connection';join.connectionEdges=[[0,1],[1,2],[2,0]].map(e=>e.map(v=>refs[v]));
    const plan={part:join,prepared:parts.map(p=>({...p})),replacements:new Map(),triangles:join.mesh.faces.map(f=>f.slice(0,3).map(i=>join.mesh.vertices[i])),
        first:{partId:source.id,vertices:[0,1,2],edges:[[0,1],[1,2],[2,0]],faceIds:[0],removeFaces:[],twin:false},
        second:{partId:body.id,vertices:[0,1,2],edges:[],faceIds:[0],removeFaces:[],twin:false}};
    return {parts,body,source,join,plan};
}

test('cleanup preview removes only proven enclosed faces and loose join scraps while retaining native channels and endpoints',()=>{
    const {parts,source,join,plan}=fixture(),before=structuredClone(parts),original=structuredClone(plan.part);
    const cleaned=planConnectionCleanup(parts,plan,{removeEnclosed:true,removeLoose:true});
    assert.deepEqual(parts,before,'preview never mutates project geometry');assert.deepEqual(join,original,'preview never mutates the input join');
    assert.equal(cleaned.cleanup.enclosed,2);assert.equal(cleaned.cleanup.loose,1);
    assert.equal(cleaned.cleanup.removedItems.reduce((n,p)=>n+p.mesh.faces.length,0),3,'review shows the actual removed triangles');
    const head=cleaned.prepared.find(p=>p.id===source.id);
    assert.deepEqual(head.mesh.faces,[source.mesh.faces[0]]);assert.deepEqual(cleaned.first.removeFaces,[1]);
    for(const key of ['vertices','sourceVertices','skins','bones','weights','textureMappings'])assert.deepEqual(head.mesh[key],source.mesh[key],key);
    for(const key of ['textures','textureCoords','alpha','priorities','faceLabels','renderTypes'])assert.deepEqual(head.mesh[key],[source.mesh[key][0]],key);
    assert.deepEqual(cleaned.part.mesh.faces,[join.mesh.faces[0]]);assert.deepEqual(cleaned.part.mesh.vertexLinks,join.mesh.vertexLinks);
    assert.deepEqual(cleaned.part.connectionEdges,join.connectionEdges);
    assert.deepEqual(cleaned.part.mesh.textureMappings,join.mesh.textureMappings);
    const project=newProject('cleanup-save','npc',{name:'Fixture',kind:'npc',id:1,fields:{combatLevel:1},mesh:source.mesh},{definition:58000,modelBase:1100000,sequenceBase:50000},'fixture');
    project.parts=[...cleaned.prepared,cleaned.part];
    const saved=validateProject(JSON.parse(JSON.stringify(project))),mesh=assemble(saved.parts,'body');validateMesh(mesh);
    const decoded=ModelData.decode(new Int8Array(encodeModel(mesh)));
    assert.equal(decoded.faceCount,mesh.faces.length);assert.deepEqual(Array.from(decoded.faceTextures),mesh.textures);
});

for(const kind of ['open','textured','transparent','inconsistent winding'])test(`cleanup does not remove faces using an ${kind} shell as an unproven solid`,()=>{
    const {parts,body,plan}=fixture();
    if(kind==='open')body.mesh.faces.pop();
    if(kind==='textured')body.mesh.textures=body.mesh.faces.map(()=>7);
    if(kind==='transparent')body.mesh.alpha=body.mesh.faces.map(()=>128);
    if(kind==='inconsistent winding')[body.mesh.faces[0][0],body.mesh.faces[0][1]]=[body.mesh.faces[0][1],body.mesh.faces[0][0]];
    const cleaned=planConnectionCleanup(parts,plan,{removeEnclosed:true});
    assert.equal(cleaned.cleanup.enclosed,0);assert.deepEqual(cleaned.part.mesh.faces,plan.part.mesh.faces);assert.deepEqual(cleaned.replacements.size,0);
});

test('cleanup protects guides, existing connection supports and whole native parts',()=>{
    const {parts,source,join,plan}=fixture();
    plan.guides=[{source:{partId:source.id,vertex:3},target:{partId:parts[0].id,vertex:0}}];
    plan.guidePaths=[[3,4]];
    const protectedGuides=planConnectionCleanup(parts,plan,{removeEnclosed:true,removeLoose:true});
    assert.equal(protectedGuides.cleanup.enclosed,0);assert.equal(protectedGuides.cleanup.loose,1);assert.ok(protectedGuides.cleanup.protected>=2);
    assert.equal(protectedGuides.part.mesh.faces.length,2,'the guide path keeps its actual face');
    delete plan.guides;delete plan.guidePaths;
    parts.push({...join,id:'existing-connection',connectionEdges:[[3,4].map(vertex=>({partId:source.id,vertex,twin:false}))]});
    assert.deepEqual(planConnectionCleanup(parts,plan,{removeEnclosed:true}).prepared.find(p=>p.id===source.id).mesh.faces,source.mesh.faces);
    parts.pop();source.mesh.faces=[source.mesh.faces[1]];plan.first.faceIds=[];
    assert.equal(planConnectionCleanup(parts,plan,{removeEnclosed:true}).prepared.find(p=>p.id===source.id).mesh.faces.length,1,'whole parts are left for Build to remove');
});

test('cleanup is optional and does not delete original detached details',()=>{
    const {parts,source,plan}=fixture();
    const off=planConnectionCleanup(parts,plan);assert.equal(off.cleanup.enclosed,0);assert.equal(off.cleanup.loose,0);assert.deepEqual(off.part,plan.part);
    const loose=planConnectionCleanup(parts,plan,{removeLoose:true});
    assert.equal(loose.cleanup.loose,2);assert.deepEqual(loose.prepared.find(p=>p.id===source.id).mesh,source.mesh);
});
