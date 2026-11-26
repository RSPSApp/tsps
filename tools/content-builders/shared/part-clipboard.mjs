import { validateProject } from './project.mjs';
import { isConnection } from './mesh.mjs';

export const PART_CLIPBOARD_FORMAT = 'tsps-part-clipboard/1';
const identity = p => !p.pair && !p.mirror && p.position.every(n=>n===0) && p.rotation.every(n=>n===0) && p.scale.every(n=>n===1);
const frameMesh = () => ({vertices:[[0,0,0],[1,0,0],[0,1,0]],faces:[[0,1,2,0]]});

export function copyParts(project, selectedId) {
    const source=validateProject(project),root=source.parts.find(p=>p.id===selectedId);
    if(!root)throw new Error('Select a piece to copy.');
    const ids=new Set([root.id]);
    for(let count=-1;count!==ids.size;){
        count=ids.size;
        for(const p of source.parts)if(ids.has(p.parentId))ids.add(p.id);
        for(const p of source.parts)if(ids.has(p.id)&&isConnection(p))for(const ref of p.mesh.vertexLinks)ids.add(ref.partId);
        for(const p of source.parts)if(isConnection(p)&&p.mesh.vertexLinks.every(ref=>ids.has(ref.partId)))ids.add(p.id);
    }
    const byId=new Map(source.parts.map(p=>[p.id,p])),frames=new Map();
    const parentFor=p=>{
        let parent=byId.get(p.parentId);
        while(parent&&!ids.has(parent.id)&&identity(parent)&&p.rigMode!=='parent')parent=byId.get(parent.parentId);
        if(parent&&!ids.has(parent.id)&&!frames.has(parent.id)){
            const frame=structuredClone(parent);frames.set(parent.id,frame);
            frame.name=`Placement: ${parent.name}`.slice(0,100);frame.visible=false;frame.mesh=p.rigMode==='parent'?structuredClone(parent.mesh):frameMesh();
            frame.parentId=parentFor(parent);frame.motion.mode='still';frame.motion.keys={};
        }
        if(parent&&frames.has(parent.id)&&p.rigMode==='parent')frames.get(parent.id).mesh=structuredClone(parent.mesh);
        return parent?.id??null;
    };
    const parts=source.parts.filter(p=>ids.has(p.id)).map(p=>({...structuredClone(p),parentId:parentFor(p)}));
    return {format:PART_CLIPBOARD_FORMAT,kind:source.kind,cache:source.cache,root:root.id,parts,frames:[...frames.values()],
        attacks:source.attacks.map(a=>({id:a.id,parts:Object.fromEntries(Object.entries(a.parts).filter(([id])=>ids.has(id)))}))};
}

export function pasteParts(project, input, variant) {
    if(input?.format!==PART_CLIPBOARD_FORMAT||input.kind!==project.kind)throw new Error('Paste a piece copied from the same Creator type.');
    if(!Array.isArray(input.parts)||!input.parts.length||!Array.isArray(input.frames)||input.parts.length+input.frames.length>128)throw new Error('The copied pieces are invalid or exceed the part limit.');
    const rows=[...input.frames,...input.parts];
    if(project.parts.length+rows.length>128)throw new Error('A project supports at most 128 parts.');
    const ids=new Map(rows.map(p=>[p.id,crypto.randomUUID()]));
    if(ids.size!==rows.length||!ids.has(input.root))throw new Error('The copied piece identities are invalid.');
    const remap=ref=>{if(!ids.has(ref.partId))throw new Error('Copy both ends of a connection together.');return {...ref,partId:ids.get(ref.partId)};};
    const clones=rows.map(p=>{
        const out=structuredClone(p);out.id=ids.get(p.id);out.parentId=p.parentId?ids.get(p.parentId):null;
        if(p.parentId&&!out.parentId)throw new Error('The copied placement is incomplete.');
        out.variant=variant;
        if(isConnection(out)){out.mesh.vertexLinks=out.mesh.vertexLinks.map(remap);out.connectionEdges=out.connectionEdges.map(edge=>edge.map(remap));}
        return out;
    });
    const result=validateProject(project);result.parts.push(...clones);
    for(const attack of result.attacks){const copied=input.attacks?.find(a=>a.id===attack.id);for(const [id,override]of Object.entries(copied?.parts??{}))if(ids.has(id))attack.parts[ids.get(id)]=structuredClone(override);}
    const validated=validateProject(result);
    return {parts:validated.parts,attacks:validated.attacks,selected:ids.get(input.root),count:input.parts.length};
}
