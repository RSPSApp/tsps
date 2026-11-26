import { assemble, bounds, validateMesh } from './mesh.mjs';
import { makePart, validateProject } from './project.mjs';
import { uprightIconSettings } from './item-preview.mjs';

const sub = (a, b) => a.map((n, i) => n - b[i]);
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const size = mesh => { const b = bounds(mesh); return b.max.map((n, i) => n - b.min[i]); };
const sameTopology = (a, b) => a.vertices.length === b.vertices.length && a.faces.length === b.faces.length
    && a.faces.every((f, i) => f.slice(0, 3).every((v, j) => v === b.faces[i][j]));

// An exact affine donor relationship handles weapons whose inventory model is
// rotated/translated, including edits protruding beyond the original surface.
function affine(source, target) {
    if (!sameTopology(source, target)) return null;
    const a = source.vertices[0], ta = target.vertices[0];
    let bi = 0, ci = 0, di = 0, best = 0;
    source.vertices.forEach((v, i) => { const d = dot(sub(v,a),sub(v,a)); if (d > best) { best=d;bi=i; } });
    const u = sub(source.vertices[bi], a), tu = sub(target.vertices[bi], ta);
    best = 0;
    source.vertices.forEach((v,i) => { const n=cross(u,sub(v,a)),d=dot(n,n);if(d>best){best=d;ci=i;} });
    const v=sub(source.vertices[ci],a),tv=sub(target.vertices[ci],ta),normal=cross(u,v),tn=cross(tu,tv);
    if (dot(normal,normal)<1e-8 || dot(tn,tn)<1e-8) return null;
    best=0;
    source.vertices.forEach((p,i)=>{const d=Math.abs(dot(sub(p,a),normal));if(d>best){best=d;di=i;}});
    const length=Math.hypot(...normal), targetLength=Math.hypot(...tn);
    const w=best>length*.001?sub(source.vertices[di],a):normal.map(n=>n/Math.sqrt(length));
    const tw=best>length*.001?sub(target.vertices[di],ta):tn.map(n=>n/Math.sqrt(targetLength));
    const determinant=dot(u,cross(v,w)); if(Math.abs(determinant)<1e-8)return null;
    const transform=p=>{const d=sub(p,a),coeff=[dot(d,cross(v,w)),dot(u,cross(d,w)),dot(u,cross(v,d))].map(n=>n/determinant);
        return ta.map((n,i)=>n+tu[i]*coeff[0]+tv[i]*coeff[1]+tw[i]*coeff[2]);};
    const tolerance=Math.max(.1,Math.max(...size(target))*.01);
    if(source.vertices.some((p,i)=>Math.hypot(...sub(transform(p),target.vertices[i]))>tolerance))return null;
    return transform;
}

// Small kd trees keep full cache models practical without quadratic vertex scans.
function tree(rows, depth=0) {
    if(!rows.length)return null;
    const axis=depth%3; rows.sort((a,b)=>a.p[axis]-b.p[axis]);const mid=rows.length>>1;
    return {row:rows[mid],axis,left:tree(rows.slice(0,mid),depth+1),right:tree(rows.slice(mid+1),depth+1)};
}
function nearest(root,p,count=4) {
    const found=[];
    const visit=node=>{if(!node)return;const d=dot(sub(p,node.row.p),sub(p,node.row.p));
        found.push({row:node.row,d});found.sort((a,b)=>a.d-b.d);if(found.length>count)found.pop();
        const delta=p[node.axis]-node.row.p[node.axis];visit(delta<0?node.left:node.right);
        if(found.length<count||delta*delta<=found.at(-1).d)visit(delta<0?node.right:node.left);};
    visit(root);return found;
}
const joint = (mesh,i) => mesh.bones?.[i]?.length ? `b${mesh.bones[i][0]}` : `s${mesh.skins?.[i]??-1}`;
function index(mesh) {
    const groups=new Map(),rows=mesh.vertices.map((p,i)=>({p,i}));
    for(const row of rows){const key=joint(mesh,row.i),group=groups.get(key)??[];group.push(row);groups.set(key,group);}
    return {all:tree([...rows]),groups:new Map([...groups].map(([key,group])=>[key,tree(group)]))};
}

// Match a native joint as a whole. Independent nearest-neighbour choices can
// collapse several sleeve vertices onto one target and shorten the wrist seam.
function jointCorrespondence(source,target) {
    const groups=mesh=>{
        const rows=new Map();mesh.vertices.forEach((p,i)=>{const key=joint(mesh,i);if(!rows.has(key))rows.set(key,[]);rows.get(key).push({p,i});});return rows;
    };
    const from=groups(source),to=groups(target),matches=new Map();
    for(const [key,rows]of from){
        const targets=to.get(key);if(!targets?.length)continue;
        const sb=bounds({vertices:rows.map(r=>r.p)}),tb=bounds({vertices:targets.map(r=>r.p)});
        const estimate=p=>p.map((n,a)=>tb.center[a]+(n-sb.center[a])*(sb.max[a]-sb.min[a]>1e-6?(tb.max[a]-tb.min[a])/(sb.max[a]-sb.min[a]):1));
        if(rows.length!==targets.length||rows.length>256){
            const lookup=tree([...targets]);for(const row of rows)matches.set(row.i,nearest(lookup,estimate(row.p),1)[0].row.i);continue;
        }
        // Hungarian assignment gives every target corner exactly one source.
        // Bounds are per joint, so a narrower torso cannot steal a wrist corner.
        const n=rows.length,u=Array(n+1).fill(0),v=Array(n+1).fill(0),assigned=Array(n+1).fill(0),way=Array(n+1).fill(0);
        const cost=rows.map(row=>{const p=estimate(row.p);return targets.map(t=>dot(sub(p,t.p),sub(p,t.p)));});
        for(let i=1;i<=n;i++){
            assigned[0]=i;let j0=0;const best=Array(n+1).fill(Infinity),used=Array(n+1).fill(false);
            do{
                used[j0]=true;const i0=assigned[j0];let delta=Infinity,j1=0;
                for(let j=1;j<=n;j++)if(!used[j]){const current=cost[i0-1][j-1]-u[i0]-v[j];if(current<best[j]){best[j]=current;way[j]=j0;}if(best[j]<delta){delta=best[j];j1=j;}}
                for(let j=0;j<=n;j++)if(used[j]){u[assigned[j]]+=delta;v[j]-=delta;}else best[j]-=delta;j0=j1;
            }while(assigned[j0]);
            do{const j1=way[j0];assigned[j0]=assigned[j1];j0=j1;}while(j0);
        }
        for(let j=1;j<=n;j++)matches.set(rows[assigned[j]-1].i,targets[j-1].i);
    }
    return matches;
}

export function viewFitter(source,target,variant) {
    validateMesh(source);validateMesh(target);
    const exact=affine(source,target);if(exact)return {point:exact,method:'matching native geometry'};
    const sb=bounds(source),tb=bounds(target),ss=size(source),ts=size(target);
    const scale=variant==='inventory'?Array(3).fill(Math.max(...ts)/Math.max(1,...ss))
        :ss.map((n,i)=>n>1e-6?Math.max(.25,Math.min(4,ts[i]/n)):1);
    const estimate=p=>p.map((n,i)=>tb.center[i]+(n-sb.center[i])*scale[i]);
    if(variant==='inventory')return {point:estimate,upright:true,method:'upright fit with a new inventory camera'};
    const si=index(source),ti=index(target),matched=sameTopology(source,target),correspondence=matched?null:jointCorrespondence(source,target);
    const anchors=source.vertices.map((p,i)=>{
        const targetId=matched?i:correspondence.get(i)??nearest(ti.groups.get(joint(source,i))??ti.all,estimate(p),1)[0].row.i;
        return sub(target.vertices[targetId],estimate(p));
    });
    return {method:matched?'native female surface':'nearest native female joints',point:(p,key)=>{
        const near=nearest(si.groups.get(key)??si.all,p);
        if(near[0].d<1e-12)return estimate(p).map((n,a)=>n+anchors[near[0].row.i][a]);
        const total=near.reduce((n,r)=>n+1/Math.max(.001,r.d),0),out=estimate(p);
        for(const {row,d} of near)for(let axis=0;axis<3;axis++)out[axis]+=anchors[row.i][axis]/Math.max(.001,d)/total;
        return out;
    }};
}

/** Pure draft generation. Bakes placement/pairs/connections, keeps editable pieces and native materials/rigs. */
export function generateGearViews(project, targets, references) {
    if(project.kind!=='gear')throw new Error('Generate views is for gear.');
    targets=[...new Set(targets)];
    if(!targets.length||targets.some(v=>!['female','inventory'].includes(v)))throw new Error('Choose Female worn or Inventory.');
    const sourceParts=project.parts.filter(p=>p.variant==='male'&&p.visible!==false);
    if(!sourceParts.length)throw new Error('Add visible parts in Male worn first.');
    const source=references.male??assemble(project.parts,'male'), generated=[],notes=[];
    let uprightInventory=false,iconSettings;
    for(const variant of targets){
        const target=references[variant];
        const fitter=target?viewFitter(source,target,variant):{point:p=>[...p],upright:variant==='inventory',method:'male shape copied; fit this view manually'};
        if(variant==='inventory')uprightInventory=!!fitter.upright;
        notes.push(`${variant==='female'?'Female worn':'Inventory'}: ${fitter.method}.`);
        for(const original of sourceParts){
            const mesh=assemble(project.parts,'male',new Set([original.id]));
            mesh.vertices=mesh.vertices.map((p,i)=>fitter.point(p,joint(mesh,i)));
            // Baked geometry follows the native player rig, not an old donor frame.
            delete mesh.faceSources;delete mesh.faceTwins;
            validateMesh(mesh);
            const part=makePart({kind:original.source?.kind??'item',id:original.source?.id??project.baseId,
                variant:original.source?.variant??'male',name:original.name,mesh},variant,'generated');
            part.pivot=bounds(mesh).center;
            generated.push(part);
        }
    }
    if(uprightInventory){
        const inventory=generated.filter(p=>p.variant==='inventory');
        const box=bounds({vertices:inventory.flatMap(p=>p.mesh.vertices)});
        const shift=[-box.center[0],-box.max[1],-box.center[2]];
        for(const part of inventory){
            part.mesh.vertices=part.mesh.vertices.map(v=>v.map((n,i)=>n+shift[i]));
            part.pivot=bounds(part.mesh).center;
        }
        iconSettings=uprightIconSettings(assemble(inventory,'inventory'));
    }
    const result=structuredClone(project);
    if(iconSettings)Object.assign(result.settings,iconSettings);
    result.parts=[...result.parts.filter(p=>!targets.includes(p.variant)),...generated];
    // Validation happens before the host creates its one undo checkpoint.
    validateProject(result);
    if(project.parts.some(p=>p.variant==='all'))notes.push('Shared All views parts are kept as they are.');
    return {parts:result.parts,generated,targets,notes,iconSettings};
}
