// The workbench's editable mesh format. Coordinates use OSRS's Y-down model space.
export const MAX_VERTICES = 24000;
export const MAX_FACES = 40000;
export const FACE_CHANNELS = { alpha: 0, priorities: 0, textures: -1, textureCoords: -1, faceLabels: -1, renderTypes: 0 };
export function validateMesh(m) {
    if (!m || !Array.isArray(m.vertices) || !Array.isArray(m.faces) || !m.vertices.length || !m.faces.length || m.vertices.length > MAX_VERTICES || m.faces.length > MAX_FACES) throw new Error('Mesh is empty or exceeds 24,000 vertices / 40,000 faces.');
    for (const v of m.vertices) if (!Array.isArray(v) || v.length !== 3 || v.some(n => !Number.isFinite(n) || Math.abs(n) > 16000)) throw new Error('A vertex is outside the supported model bounds.');
    for (const f of m.faces) if (!Array.isArray(f) || f.length !== 4 || f.slice(0, 3).some(n => !Number.isInteger(n) || n < 0 || n >= m.vertices.length) || !Number.isInteger(f[3]) || f[3] < 0 || f[3] > 65535) throw new Error('A face has invalid indices or colour.');
    for (const key of ['skins', 'bones', 'weights']) if (m[key] && (!Array.isArray(m[key]) || m[key].length !== m.vertices.length)) throw new Error(`Mesh ${key} do not match vertices.`);
    if (!!m.bones !== !!m.weights) throw new Error('Bones and weights must be provided together.');
    if (m.skins?.some(n => !Number.isInteger(n) || n < -1 || n > 255)) throw new Error('Vertex labels must be -1 to 255.');
    for (let i = 0; i < (m.bones?.length ?? 0); i++) {
        const bones = m.bones[i], weights = m.weights?.[i];
        if (!Array.isArray(bones) || !Array.isArray(weights) || bones.length !== weights.length || bones.length > 8 || [...bones, ...weights].some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('Invalid skeletal weights.');
    }
    for (const key of ['alpha', 'priorities']) if (m[key] && (m[key].length !== m.faces.length || m[key].some(n => !Number.isInteger(n) || n < 0 || n > 255))) throw new Error(`Invalid face ${key}.`);
    for (const [key,min,max] of [['textures',-1,32767],['textureCoords',-1,(m.textureMappings?.length??0)-1],['faceLabels',-1,255],['renderTypes',0,3]]) if(m[key]&&(!Array.isArray(m[key])||m[key].length!==m.faces.length||m[key].some(n=>!Number.isInteger(n)||n<min||n>max)))throw new Error(`Invalid face ${key}.`);
    if(m.textureMappings&&(!Array.isArray(m.textureMappings)||m.textureMappings.length>40000||m.textureMappings.some(t=>!Array.isArray(t)||t.length!==3||t.some(n=>!Number.isInteger(n)||n<0||n>=m.vertices.length))))throw new Error('Invalid texture mapping.');
    if (m.vertexLinks && (!Array.isArray(m.vertexLinks) || m.vertexLinks.length !== m.vertices.length || m.vertexLinks.some(r => !r || typeof r.partId !== 'string' || !Number.isInteger(r.vertex) || r.vertex < 0 || typeof r.twin !== 'boolean'))) throw new Error('Invalid connection endpoints.');
    if (m.authoredFaces) {
        if (!Array.isArray(m.authoredFaces) || m.authoredFaces.length > m.faces.length || m.authoredFaces.some(i => !Number.isInteger(i) || !m.faces[i])) throw new Error('Invalid authored faces.');
        const added = new Set(m.authoredFaces), edges = new Map(), seen = new Set();
        for (let i=0;i<m.faces.length;i++) {
            const f=m.faces[i], key=f.slice(0,3).sort((a,b)=>a-b).join(':');
            if (added.has(i)) {
                const [a,b,c]=f.slice(0,3).map(v=>m.vertices[v].map(Math.round)),u=b.map((n,j)=>n-a[j]),v=c.map((n,j)=>n-a[j]);
                if (new Set(f.slice(0,3)).size!==3 || Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-5 || seen.has(key)) throw new Error('An added face is collapsed or duplicated.');
            }
            seen.add(key);
            for(let j=0;j<3;j++){const a=f[j],b=f[(j+1)%3],k=a<b?`${a}:${b}`:`${b}:${a}`,rows=edges.get(k)??[];rows.push({a,b,added:added.has(i)});edges.set(k,rows);}
        }
        for(const rows of edges.values()) if(rows.some(e=>e.added) && (rows.length>2 || rows.length===2 && rows[0].a===rows[1].a)) throw new Error('An added face has overlapping or reversed edges.');
    }
    return m;
}
// Linked connection vertices share the exact position and skinning of their endpoints.
export function linkedPoint(ref, parts) {
    const part = parts.find(p => p.id === ref.partId);
    if (!part?.mesh.vertices[ref.vertex] || part.mesh.vertexLinks) throw new Error('A connection endpoint is missing. Undo the part removal or delete its connection.');
    const point = worldPoint(part.mesh.vertices[ref.vertex], part, parts);
    return ref.twin ? reflectPoint(point, parts.find(p => p.id === part.parentId), parts) : point;
}
export const isConnection = part => !!part?.mesh?.vertexLinks;
// Build can expand its existing removal scope before one undoable mutation.
export function connectionDependents(parts, ids) {
    const removed=new Set(ids);
    for(let count=-1;count!==removed.size;){count=removed.size;for(const part of parts)if(removed.has(part.parentId)||part.mesh.vertexLinks?.some(ref=>removed.has(ref.partId)))removed.add(part.id);}
    return removed;
}
export const copyMesh = mesh => structuredClone(mesh);
export function components(mesh) {
    const byVertex = Array.from({ length: mesh.vertices.length }, () => []);
    mesh.faces.forEach((f, i) => f.slice(0, 3).forEach(v => byVertex[v].push(i)));
    const seen = new Set(), groups = [];
    for (let i = 0; i < mesh.faces.length; i++) {
        if (seen.has(i)) continue;
        const faces = [], queue = [i]; seen.add(i);
        for (let p = 0; p < queue.length; p++) {
            const id = queue[p]; faces.push(id);
            for (const v of mesh.faces[id].slice(0, 3)) for (const f of byVertex[v]) if (!seen.has(f)) { seen.add(f); queue.push(f); }
        }
        groups.push(faces);
    }
    return groups.sort((a, b) => b.length - a.length);
}
export function bounds(mesh) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const v of mesh.vertices) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
    return { min, max, center: min.map((n, i) => (n + max[i]) / 2) };
}
export function extract(mesh, faceIds) {
    const out = { vertices: [], faces: [], skins: [], bones: [], weights: [], alpha: [], priorities: [], textures:[],textureCoords:[],textureMappings:[],faceLabels:[],renderTypes:[],sourceFaces:[] }, used = new Map(),maps=new Map();
    const vertex=index=>{if(!used.has(index)){used.set(index,out.vertices.length);out.vertices.push([...mesh.vertices[index]]);out.skins.push(mesh.skins?.[index]??-1);out.bones.push([...(mesh.bones?.[index]??[])]);out.weights.push([...(mesh.weights?.[index]??[])]);}return used.get(index);};
    for (const id of [...new Set(faceIds)]) {
        const f = mesh.faces[id]; if (!f) continue;
        out.sourceFaces.push(mesh.sourceFaces?.[id] ?? id);
        const indices = f.slice(0, 3).map(vertex);
        out.faces.push([...indices, f[3]]); out.alpha.push(mesh.alpha?.[id] ?? 0); out.priorities.push(mesh.priorities?.[id] ?? 0);
        out.textures.push(mesh.textures?.[id]??-1);out.faceLabels.push(mesh.faceLabels?.[id]??-1);out.renderTypes.push(mesh.renderTypes?.[id]??0);
        const coord=mesh.textureCoords?.[id]??-1;
        if(coord>=0&&!maps.has(coord)){maps.set(coord,out.textureMappings.length);out.textureMappings.push(mesh.textureMappings[coord].map(vertex));}
        out.textureCoords.push(coord>=0?maps.get(coord):-1);
    }
    // Donor animation evaluates the full original source, then selects these vertices.
    out.sourceVertices=[...used.keys()].map(i=>mesh.sourceVertices?.[i]??i);
    return out;
}
export function regionFaces(mesh, region) {
    const b = bounds(mesh), h = Math.max(1, b.max[1] - b.min[1]);
    return mesh.faces.flatMap((f, id) => {
        const v = f.slice(0, 3).map(i => mesh.vertices[i]);
        const y = (v.reduce((sum, p) => sum + p[1], 0) / 3 - b.min[1]) / h;
        const x = v.reduce((sum, p) => sum + p[0], 0) / 3;
        const match = region === 'whole' || region === 'upper' && y < .38 || region === 'middle' && y >= .28 && y <= .72 || region === 'lower' && y > .62 || region === 'left' && x < b.center[0] || region === 'right' && x >= b.center[0] || region.startsWith('label:') && f.slice(0, 3).some(i => mesh.skins?.[i] === Number(region.slice(6)));
        return match ? [id] : [];
    });
}
export function transformVertex(v, part) {
    const pivot = part.pivot ?? [0, 0, 0];
    let [x, y, z] = v.map((n, i) => (n - pivot[i]) * (part.scale?.[i] ?? 1));
    if (part.mirror) x = -x;
    const r = (part.rotation ?? [0, 0, 0]).map(n => n * Math.PI / 180);
    [y, z] = [y * Math.cos(r[0]) - z * Math.sin(r[0]), y * Math.sin(r[0]) + z * Math.cos(r[0])];
    [x, z] = [x * Math.cos(r[1]) + z * Math.sin(r[1]), -x * Math.sin(r[1]) + z * Math.cos(r[1])];
    [x, y] = [x * Math.cos(r[2]) - y * Math.sin(r[2]), x * Math.sin(r[2]) + y * Math.cos(r[2])];
    return [x, y, z].map((n, i) => n + pivot[i] + (part.position?.[i] ?? 0));
}
export function inverseTransformVertex(v, part) {
    const pivot = part.pivot ?? [0, 0, 0], r = (part.rotation ?? [0, 0, 0]).map(n => -n * Math.PI / 180);
    let [x, y, z] = v.map((n, i) => n - pivot[i] - (part.position?.[i] ?? 0));
    [x, y] = [x * Math.cos(r[2]) - y * Math.sin(r[2]), x * Math.sin(r[2]) + y * Math.cos(r[2])];
    [x, z] = [x * Math.cos(r[1]) + z * Math.sin(r[1]), -x * Math.sin(r[1]) + z * Math.cos(r[1])];
    [y, z] = [y * Math.cos(r[0]) - z * Math.sin(r[0]), y * Math.sin(r[0]) + z * Math.cos(r[0])];
    if (part.mirror) x = -x;
    return [x, y, z].map((n, i) => n / (part.scale?.[i] ?? 1) + pivot[i]);
}
export function worldPoint(point, part, parts, byId = new Map(parts.map(p => [p.id, p]))) {
    let p = part, out = point, seen = new Set();
    while (p && !seen.has(p.id)) { seen.add(p.id); out = transformVertex(out, p); p = byId.get(p.parentId); }
    return out;
}
/** Local size handles, described by their orientation in the assembled scene. */
export function partScaleAxes(part, parts) {
    const pivot = part.pivot ?? [0, 0, 0], byId = new Map(parts.map(p => [p.id, p]));
    const origin = worldPoint(pivot, part, parts, byId);
    const directions = [0, 1, 2].map(axis => {
        const delta = worldPoint(pivot.map((n, i) => n + (i === axis ? 1 : 0)), part, parts, byId).map((n, i) => n - origin[i]);
        const length = Math.hypot(...delta) || 1;
        return delta.map(n => n / length);
    });
    // Assign each dimension once, even for diagonal or skewed attachments.
    const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const score = permutation => permutation.reduce((sum, dimension, axis) => sum + Math.abs(directions[axis][dimension]), 0);
    const mapping = permutations.reduce((best, next) => score(next) > score(best) + 1e-8 ? next : best);
    return directions.map((direction, axis) => ({ axis, direction, dimension: mapping[axis],
        label: ['Width', 'Height', 'Depth'][mapping[axis]], angled: Math.abs(direction[mapping[axis]]) < .98 }));
}
export function localPoint(point, parent, parts) {
    const chain = [], byId = new Map(parts.map(p => [p.id, p])); let p = parent;
    while (p && !chain.includes(p)) { chain.push(p); p = byId.get(p.parentId); }
    return chain.reverse().reduce((v, p) => inverseTransformVertex(v, p), point);
}
export function reparentPart(parts, partId, parentId) {
    const before = structuredClone(parts), root = before.find(p => p.id === partId);
    const parent = before.find(p => p.id === parentId), affected = new Set([partId]);
    if (!root || parentId && !parent) throw new Error('Choose an existing attachment.');
    for (let count = -1; count !== affected.size;) {
        count = affected.size;
        for (const part of before) if (affected.has(part.parentId)) affected.add(part.id);
    }
    if (affected.has(parentId)) throw new Error('A part cannot attach to its own children.');
    // Bake the subtree into the new parent's coordinates before changing any node.
    // Children keep their positions, donor deformation and source vertex identities.
    for (const old of before.filter(p => affected.has(p.id))) {
        const convert = point => localPoint(worldPoint(point, old, before), parent, before);
        const origin = convert([0, 0, 0]);
        const basis = [0, 1, 2].map(axis => convert([0, 1, 2].map(i => i === axis ? 1 : 0)).map((n, i) => n - origin[i]));
        const previous = old.donorBasis ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        const donorBasis = previous.map(column => [0, 1, 2].map(a => column.reduce((n, v, i) => n + v * basis[i][a], 0)));
        const mesh = copyMesh(old.mesh);
        mesh.vertices = mesh.vertices.map(convert);
        const [a, b, c] = basis;
        const determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
        if (determinant < 0) for (let i = 0; i < mesh.faces.length; i++) {
            const f = mesh.faces[i];
            if ((mesh.textures?.[i] ?? -1) >= 0 && (mesh.textureCoords?.[i] ?? -1) < 0) {
                mesh.textureMappings ??= [];
                mesh.textureCoords ??= mesh.faces.map(() => -1);
                mesh.textureCoords[i] = mesh.textureMappings.length;
                mesh.textureMappings.push(f.slice(0, 3));
            }
            mesh.faces[i] = [f[2], f[1], f[0], f[3]];
        }
        Object.assign(parts.find(p => p.id === old.id), {
            mesh, donorBasis, pivot: convert(old.pivot),
            parentId: old.id === partId ? parentId || null : old.parentId,
            ...(old.id===partId&&!parentId?{rigMode:'source'}:{}),
            position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], mirror: false,
        });
    }
}
// Reflect around the body's local left/right plane so paired children follow
// that body's movement, rotation and scale instead of reflecting around the world.
export function reflectPoint(point, parent, parts, byId = new Map(parts.map(p=>[p.id,p]))) {
    let root=parent;const seen=new Set();
    while(root?.parentId&&!seen.has(root.id)){seen.add(root.id);root=byId.get(root.parentId)??root;if(seen.has(root.id))break;}
    if(!root)return [-point[0],point[1],point[2]];
    const local=inverseTransformVertex(point,root);local[0]=2*(root.pivot?.[0]??0)-local[0];
    return transformVertex(local,root);
}
// An affixed piece borrows one native joint/weight blend at its final placement.
// Transform parenting alone cannot express this in the game's flat model format.
export const followsParentAnimation = part => part.rigMode==='parent'||part.rigMode===undefined&&!!part.parentId&&(part.motion?.mode??'follow')==='follow';
export function rigResolver(parts) {
    const byId=new Map(parts.map(p=>[p.id,p])),anchors=new Map(),worlds=new Map(),visiting=new Set();
    const paired=part=>{const seen=new Set();while(part&&!seen.has(part.id)){seen.add(part.id);if(part.pair)return true;part=byId.get(part.parentId);}return false;};
    const resolve=(part,vertex,twin=false)=>{
        const parent=byId.get(part.parentId);
        if(followsParentAnimation(part)&&parent){
            const key=`${part.id}/${twin}`;if(anchors.has(key))return anchors.get(key);
            if(visiting.has(key))throw new Error('Animation attachments form a loop.');visiting.add(key);
            let anchor=worldPoint(part.pivot??[0,0,0],part,parts,byId);
            if(twin)anchor=reflectPoint(anchor,parent,parts,byId);
            const parentTwin=twin&&paired(parent),worldKey=`${parent.id}/${parentTwin}`;
            if(!worlds.has(worldKey))worlds.set(worldKey,parent.mesh.vertices.map(v=>{
                const point=worldPoint(v,parent,parts,byId);return parentTwin?reflectPoint(point,byId.get(parent.parentId),parts,byId):point;
            }));
            const points=worlds.get(worldKey),used=new Set(parent.mesh.faces.flatMap(f=>f.slice(0,3)));
            let nearest=-1,distance=Infinity;
            for(const i of used){const rig=resolve(parent,i,parentTwin);if(rig.label<0&&!rig.bones.length)continue;
                const d=points[i].reduce((sum,n,a)=>sum+(n-anchor[a])**2,0);if(d<distance){distance=d;nearest=i;}}
            const rig=nearest>=0?resolve(parent,nearest,parentTwin):{label:-1,bones:[],weights:[]};
            visiting.delete(key);anchors.set(key,rig);return rig;
        }
        const label=twin&&part.twinBindLabel>=0?part.twinBindLabel:part.bindLabel;
        const bone=twin&&part.twinBindBone>=0?part.twinBindBone:part.bindBone;
        return {label:label>=0?label:part.mesh.skins?.[vertex]??-1,
            bones:bone>=0?[bone]:part.mesh.bones?.[vertex]??[],weights:bone>=0?[255]:part.mesh.weights?.[vertex]??[]};
    };
    return resolve;
}
export function assemble(parts, variant = 'all', only = null) {
    const out = { vertices: [], faces: [], skins: [], bones: [], weights: [], alpha: [], priorities: [], faceSources: [], faceTwins: [],textures:[],textureCoords:[],textureMappings:[],faceLabels:[],renderTypes:[],authoredFaces:[] };
    const byId = new Map(parts.map(p => [p.id, p]));
    const resolveRig=rigResolver(parts);
    const active = parts.filter(p => (!only || only.has(p.id)) && p.visible !== false && (variant === 'all' || p.variant === 'all' || !p.variant || p.variant === variant));
    for (const original of active) {
        let ancestor=original, paired=false, mirrored=false; const seen=new Set();
        while(ancestor&&!seen.has(ancestor.id)){seen.add(ancestor.id);paired ||= !!ancestor.pair;mirrored = mirrored !== !!ancestor.mirror;ancestor=byId.get(ancestor.parentId);}
        for (const twin of paired ? [false, true] : [false]) {
        const part = original;
        const start = out.vertices.length, mesh = part.mesh, authored = new Set(mesh.authoredFaces??[]);
        const mappingStart=out.textureMappings.length;
        for(const mapping of mesh.textureMappings??[])out.textureMappings.push(mapping.map(n=>n+start));
        for (let i = 0; i < mesh.vertices.length; i++) {
            const ref = mesh.vertexLinks?.[i], endpoint = ref && byId.get(ref.partId);
            let point = ref ? linkedPoint(ref, parts) : worldPoint(mesh.vertices[i], part, parts, byId); if (twin) point = reflectPoint(point, byId.get(part.parentId), parts, byId);
            out.vertices.push(point.map(Math.round));
            const rig=resolveRig(endpoint??part,ref?.vertex??i,ref?.twin??twin);
            out.skins.push(rig.label);out.bones.push([...rig.bones]);out.weights.push([...rig.weights]);
        }
        for (let i = 0; i < mesh.faces.length; i++) {
            const f = mesh.faces[i], indices = mirrored !== twin ? [f[2], f[1], f[0]] : f.slice(0, 3);
            if(authored.has(i))out.authoredFaces.push(out.faces.length);
            out.faces.push([...indices.map(n => n + start), f[3]]); out.alpha.push(mesh.alpha?.[i] ?? 0); out.priorities.push(mesh.priorities?.[i] ?? 0);
            out.faceSources.push(i); out.faceTwins.push(twin);
            const texture=mesh.textures?.[i]??-1;out.textures.push(texture);out.faceLabels.push(mesh.faceLabels?.[i]??-1);out.renderTypes.push(mesh.renderTypes?.[i]??0);
            const coord=mesh.textureCoords?.[i]??-1;
            if(texture>=0&&coord<0&&mirrored!==twin){out.textureCoords.push(out.textureMappings.length);out.textureMappings.push(f.slice(0,3).map(n=>n+start));}else out.textureCoords.push(coord>=0?coord+mappingStart:-1);
        }
    }
    }
    if (out.vertices.length > MAX_VERTICES || out.faces.length > MAX_FACES) throw new Error('Combined model exceeds the vertex or face budget.');
    return out;
}
// Native type-0 projection, evaluated after sculpting and transforms.
export function textureUV(mesh,faceId){
    const f=mesh.faces[faceId],coord=mesh.textureCoords?.[faceId]??-1,indices=coord>=0?mesh.textureMappings[coord]:f;
    const [p,m,n]=indices.slice(0,3).map(i=>mesh.vertices[i]),a=m.map((v,i)=>v-p[i]),b=n.map((v,i)=>v-p[i]);
    const dot=(u,v)=>u.reduce((sum,x,i)=>sum+x*v[i],0),aa=dot(a,a),ab=dot(a,b),bb=dot(b,b),den=aa*bb-ab*ab;
    if(Math.abs(den)<1e-8)return [[0,0],[1,0],[0,1]];
    return f.slice(0,3).map(i=>{const v=mesh.vertices[i].map((x,j)=>x-p[j]),av=dot(a,v),bv=dot(b,v);return [(av*bb-bv*ab)/den,(bv*aa-av*ab)/den];});
}
export function nearestRig(mesh, target) {
    // Attach donor geometry to the closest target vertex, including modern skeletal weights.
    // A bounded representative set keeps large imports responsive.
    const step = Math.max(1, Math.ceil(target.vertices.length / 1800));
    mesh.skins = []; mesh.bones = []; mesh.weights = [];
    for (const v of mesh.vertices) {
        let best = 0, distance = Infinity;
        for (let i = 0; i < target.vertices.length; i += step) {
            const d = target.vertices[i].reduce((sum, n, axis) => sum + (n - v[axis]) ** 2, 0);
            if (d < distance) { distance = d; best = i; }
        }
        mesh.skins.push(target.skins?.[best] ?? -1); mesh.bones.push([...(target.bones?.[best] ?? [])]); mesh.weights.push([...(target.weights?.[best] ?? [])]);
    }
    return mesh;
}
export function sculpt(mesh, center, radius, amount, smooth = false, normal = null) {
    const original = mesh.vertices.map(v => [...v]);
    const adjacency = smooth ? Array.from({ length: mesh.vertices.length }, () => new Set()) : null;
    if (adjacency) for (const f of mesh.faces) for (const i of f.slice(0, 3)) for (const j of f.slice(0, 3)) adjacency[i].add(j);
    for (let i = 0; i < mesh.vertices.length; i++) {
        const v = original[i], d = Math.hypot(...v.map((n, axis) => n - center[axis]));
        if (d >= radius) continue;
        const strength = (1 - d / radius) ** 2;
        if (smooth) {
            const neighbours = adjacency[i];
            if (!neighbours.size) continue;
            for (let axis = 0; axis < 3; axis++) mesh.vertices[i][axis] += ([...neighbours].reduce((sum, j) => sum + original[j][axis], 0) / neighbours.size - v[axis]) * strength * Math.min(1, Math.abs(amount) / 10);
        } else {
            const direction = normal ?? v.map((n, axis) => n - center[axis]);
            const length = Math.hypot(...direction) || 1;
            for (let axis = 0; axis < 3; axis++) mesh.vertices[i][axis] += (direction[axis] / length || (axis === 1 ? -1 : 0)) * amount * strength;
        }
    }
}
export function hslRgb(packed) {
    const h = ((packed >> 10) & 63) / 64, s = ((packed >> 7) & 7) / 8, l = (packed & 127) / 128;
    const hue = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return (s ? [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)] : [l, l, l]).map(n => Math.round(255 * n));
}
export function rgbHsl(hex) {
    const rgb = hex.match(/[0-9a-f]{2}/gi).map(n => parseInt(n, 16) / 255), max = Math.max(...rgb), min = Math.min(...rgb), d = max - min, l = (min + max) / 2;
    let h = 0, s = 0;
    if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = max === rgb[0] ? ((rgb[1] - rgb[2]) / d + 6) % 6 : max === rgb[1] ? (rgb[2] - rgb[0]) / d + 2 : (rgb[0] - rgb[1]) / d + 4; h /= 6; }
    return (Math.min(63, Math.round(h * 63)) << 10) | (Math.min(7, Math.round(s * 7)) << 7) | Math.min(127, Math.round(l * 127));
}
