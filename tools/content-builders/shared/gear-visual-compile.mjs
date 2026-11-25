import {assemble,worldPoint,reflectPoint,validateMesh,bounds} from './mesh.mjs';
import {modelVertexOrder} from './model-codec.mjs';
import {validateGearVisuals,visualLayers,PARTICLE_CORNERS,PARTICLE_FACES,basisPoint,sampleVisualGeometry} from './gear-visuals.mjs';
import {gearPreviewMesh} from './gear-preview.mjs';

/** Compose the full fitting rig and keep each item's visual bindings in scene order. */
export function compileGearVisualScene(projects,variant,body,reference={}){
    const parts=[],compiled={models:[],particles:[],textures:[]};let vertices=0,faces=0;
    for(const project of projects){
        const result=compileGearVisualMesh(project,variant,{remap:false});if(!result.mesh.faces.length)continue;
        parts.push({id:`visual-scene:${project.id}`,variant,visible:true,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],pivot:[0,0,0],rigMode:'source',bindLabel:-1,bindBone:-1,mesh:result.mesh});
        for(const type of ['models','particles','textures'])for(const row of result.compiled[type]){
            compiled[type].push({...row,previewId:`${project.id}/${row.id}`,...(row.vertexIndices?{vertexIndices:row.vertexIndices.map(i=>i+vertices)}:{}),...(row.faceIndices?{faceIndices:row.faceIndices.map(i=>i+faces)}:{}),...(row.anchorVertex!==undefined?{anchorVertex:row.anchorVertex+vertices}:{})});
        }
        vertices+=result.mesh.vertices.length;faces+=result.mesh.faces.length;
    }
    return {mesh:gearPreviewMesh(projects[0],variant,body,{parts,...reference}),compiled};
}

export function compileGearVisualMesh(project,variant,{remap=true,only=null}={}){
    const visuals=validateGearVisuals(project.visuals),mesh=assemble(project.parts,variant,only),compiled={models:[],particles:[],textures:[]};
    let vertexOffset=0,faceOffset=0;
    for(const part of project.parts){
        if(part.visible===false||only&&!only.has(part.id)||part.variant!==variant&&part.variant!=='all')continue;
        const piece=assemble(project.parts,variant,new Set([part.id])),vertexCount=part.mesh.vertices.length,faceCount=part.mesh.faces.length;
        const layers=visualLayers(visuals).filter(({layer})=>layer.enabled&&layer.partId===part.id);
        for(let twin=0;twin<piece.vertices.length/vertexCount;twin++){
            const point=p=>{const v=worldPoint(p,part,project.parts);return twin?reflectPoint(v,project.parts.find(p=>p.id===part.parentId),project.parts):v;};
            const origin=point([0,0,0]),basis=[0,1,2].map(i=>point([0,1,2].map(j=>i===j?1:0)).map((n,j)=>n-origin[j])),projectionBindings=[];
            const nearestVertex=position=>{let nearest=vertexOffset+twin*vertexCount,distance=Infinity;for(let i=0;i<vertexCount;i++){const at=vertexOffset+twin*vertexCount+i,d=mesh.vertices[at].reduce((sum,n,j)=>sum+(n-position[j])**2,0);if(d<distance){nearest=at;distance=d;}}return nearest;};
            for(const {type,layer} of layers){
                const row=structuredClone(layer);delete row.partId;delete row.enabled;
                const selected=(selection,count,offset)=>Array.from({length:count},(_,i)=>i).filter(i=>!selection.length||selection.includes(i)).map(i=>i+offset);
                if(type==='models'){
                    if(row.vertices.some(i=>i>=vertexCount))throw new Error(`${row.name}: motion selection no longer matches the part. Clear its selection.`);
                    row.vertexIndices=selected(row.vertices,vertexCount,vertexOffset+twin*vertexCount);delete row.vertices;
                    const chosen=new Set(row.vertexIndices);for(const binding of projectionBindings)if(chosen.has(binding.anchor))row.vertexIndices.push(binding.vertex);
                    compiled.models.push({...row,origin,basis});
                }else if(type==='textures'){
                    if(row.faces.some(i=>i>=faceCount))throw new Error(`${row.name}: surface selection no longer matches the part. Clear its selection.`);
                    row.faceIndices=selected(row.faces,faceCount,faceOffset+twin*faceCount);delete row.faces;
                    if(row.projection!=='existing'){
                        const b=bounds(part.mesh),axes=row.projection.split('').map(c=>'xyz'.indexOf(c)),triple=[b.min.slice(),b.min.slice(),b.min.slice()];
                        triple[1][axes[0]]=b.max[axes[0]]>b.min[axes[0]]?b.max[axes[0]]:b.min[axes[0]]+1;triple[2][axes[1]]=b.max[axes[1]]>b.min[axes[1]]?b.max[axes[1]]:b.min[axes[1]]+1;
                        const start=mesh.vertices.length;for(const p of triple){const position=point(p),anchor=nearestVertex(position);projectionBindings.push({vertex:mesh.vertices.length,anchor});mesh.vertices.push(position);mesh.skins.push(mesh.skins[anchor]);mesh.bones.push([...mesh.bones[anchor]]);mesh.weights.push([...mesh.weights[anchor]]);}
                        const mapping=mesh.textureMappings.length;mesh.textureMappings.push([start,start+1,start+2]);for(const f of row.faceIndices)mesh.textureCoords[f]=mapping;
                    }
                    // A virtual texture is assigned by the client's registry. The cache texture
                    // keeps this model valid in older hosts, where the new visuals are ignored.
                    for(const f of row.faceIndices)mesh.textures[f]=row.sourceId>=0?row.sourceId:0;
                    compiled.textures.push(row);
                }else{
                    row.vertexIndices=[];row.faceIndices=[];row.partOrigin=origin;row.basis=basis;
                    const anchor=basisPoint(row.origin,origin,basis);let nearest=vertexOffset+twin*vertexCount,distance=Infinity;
                    for(let i=0;i<vertexCount;i++){const at=vertexOffset+twin*vertexCount+i,d=mesh.vertices[at].reduce((sum,n,j)=>sum+(n-anchor[j])**2,0);if(d<distance){nearest=at;distance=d;}}
                    row.anchorVertex=nearest;
                    for(let slot=0;slot<row.capacity;slot++){
                        const start=mesh.vertices.length;
                        for(const corner of PARTICLE_CORNERS){row.vertexIndices.push(mesh.vertices.length);mesh.vertices.push(anchor.map((n,i)=>n+corner[i]*row.startSize));mesh.skins.push(mesh.skins[nearest]);mesh.bones.push([...mesh.bones[nearest]]);mesh.weights.push([...mesh.weights[nearest]]);}
                        for(const face of PARTICLE_FACES){row.faceIndices.push(mesh.faces.length);mesh.faces.push([...face.map(i=>i+start),0]);mesh.alpha.push(255);mesh.priorities.push(10);mesh.textures.push(-1);mesh.textureCoords.push(-1);mesh.faceLabels.push(-1);mesh.renderTypes.push(0);}
                    }
                    compiled.particles.push(row);
                }
            }
        }
        vertexOffset+=piece.vertices.length;faceOffset+=piece.faces.length;
    }
    for(const {layer} of visualLayers(visuals))if(layer.enabled&&!project.parts.some(p=>p.id===layer.partId))throw new Error(`${layer.name} needs a target part. Choose one in Visuals.`);
    if(compiled.particles.reduce((sum,row)=>sum+row.capacity,0)>256)throw new Error('Mirrored emitters exceed the 256-particle model budget. Reduce their live particle counts.');
    if(mesh.faces.length)validateMesh(mesh);
    if(remap){const order=modelVertexOrder(mesh),indices=new Map(order.map((v,i)=>[v,i]));for(const row of [...compiled.models,...compiled.particles]){row.vertexIndices=row.vertexIndices.map(i=>indices.get(i));if(row.anchorVertex!==undefined)row.anchorVertex=indices.get(row.anchorVertex);}}
    return {mesh,compiled};
}
export function previewGearVisuals(project,variant,time,only=null){
    const {mesh,compiled}=compileGearVisualMesh(project,variant,{remap:false,only});
    const colours=mesh.faces.map(f=>f[3]);sampleVisualGeometry(mesh.vertices,mesh.alpha,colours,compiled,time);mesh.faces=mesh.faces.map((f,i)=>[...f.slice(0,3),colours[i]]);
    mesh.visualTextures=compiled.textures;
    return mesh;
}
