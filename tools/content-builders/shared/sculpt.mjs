import { localPoint, reflectPoint, worldPoint, linkedPoint, validateMesh, assemble, extract, FACE_CHANNELS, MAX_FACES } from './mesh.mjs';
const boundaryCache = new WeakMap(), edgeCache = new WeakMap();
export function faceEdges(mesh){
    if(!edgeCache.has(mesh)){const open=new Set(boundaries(mesh).map(e=>edgeKey(e.a,e.b)));edgeCache.set(mesh,mesh.faces.flatMap((f,faceId)=>f.slice(0,3).map((a,i)=>({a,b:f[(i+1)%3],faceId,open:open.has(edgeKey(a,f[(i+1)%3]))}))));}
    return edgeCache.get(mesh);
}
function boundaries(mesh){
    const cached=boundaryCache.get(mesh);if(cached?.faces===mesh.faces&&cached.count===mesh.faces.length)return cached.edges;
    const edges=meshTopology(mesh).boundaryEdges;boundaryCache.set(mesh,{faces:mesh.faces,count:mesh.faces.length,edges});return edges;
}

// Face edits retain vertex indices, donor identities and native material channels.
export function deleteFaces(mesh, ids) {
    if (mesh.vertexLinks) throw new Error('Delete a connection as a whole part in Build.');
    return removeFaces(mesh, ids);
}

function removeFaces(mesh, ids) {
    const removed = validFaces(mesh, ids), keep = mesh.faces.flatMap((_, i) => removed.has(i) ? [] : [i]);
    if (!removed.size) throw new Error('Select the faces to delete.');
    if (!keep.length) throw new Error('Keep one face, or remove the whole part in Build.');
    const out = structuredClone(mesh);
    out.faces = keep.map(i => out.faces[i]);
    for (const key of Object.keys(FACE_CHANNELS)) if (out[key]) out[key] = keep.map(i => out[key][i]);
    for (const key of ['sourceFaces','faceSources','faceTwins']) if (out[key]) out[key] = keep.map(i => out[key][i]);
    if (out.authoredFaces) out.authoredFaces = out.authoredFaces.flatMap(i => keep.includes(i) ? [keep.indexOf(i)] : []);
    validateMesh(out); return out;
}

function validateTriangles(mesh, triangles) {
    if (mesh.faces.length + triangles.length > MAX_FACES) throw new Error('The connection exceeds the face limit.');
    const faces = new Set(mesh.faces.map(f => f.slice(0, 3).sort((a,b)=>a-b).join(':'))), edges = new Map();
    const addEdge = (a,b,existing=false) => {
        const key = edgeKey(a,b), rows = edges.get(key) ?? [];
        if (!existing && (rows.length >= 2 || rows.some(e => e[0] === a && e[1] === b))) throw new Error('That face would overlap an edge or turn the surface inside out. Choose another opening.');
        rows.push([a,b]); edges.set(key,rows);
    };
    for(const f of mesh.faces) for(let i=0;i<3;i++) addEdge(f[i],f[(i+1)%3],true);
    // A patch may reach another corner on the same open rim before the next
    // triangle joins its second edge. Closed vertices and unrelated rims still
    // cannot acquire a point-only attachment.
    const rims = new Map(), adjacency = new Map();
    for (const rows of edges.values()) if (rows.length === 1) {
        const [a,b] = rows[0];
        for (const [u,v] of [[a,b],[b,a]]) { if (!adjacency.has(u)) adjacency.set(u, []); adjacency.get(u).push(v); }
    }
    for (const seed of adjacency.keys()) if (!rims.has(seed)) {
        const queue = [seed]; rims.set(seed, seed);
        for (const v of queue) for (const next of adjacency.get(v)) if (!rims.has(next)) { rims.set(next, seed); queue.push(next); }
    }
    for(const f of triangles) {
        if(f.length!==3 || new Set(f).size!==3 || f.some(i=>!Number.isInteger(i)||!mesh.vertices[i])) throw new Error('Choose three different corners.');
        const [a,b,c] = f.map(i=>mesh.vertices[i].map(Math.round));
        if(length(cross(subtract(b,a),subtract(c,a))) < 1e-5) throw new Error('That face would be flat or too small in game. Choose another corner.');
        const key = [...f].sort((a,b)=>a-b).join(':');
        if(faces.has(key)) throw new Error('A face already covers those corners.');
        const attachedRims = new Set(f.flatMap((a,i) => {
            const b=f[(i+1)%3],rows=edges.get(edgeKey(a,b));
            return rows?.length===1 && rims.has(a) ? [rims.get(a)] : [];
        }));
        for(const vertex of f) if(mesh.faces.some(old=>old.slice(0,3).includes(vertex)) &&
            !f.some(other=>other!==vertex&&edges.has(edgeKey(vertex,other))) &&
            !(rims.has(vertex)&&attachedRims.has(rims.get(vertex))))
            throw new Error('Join an open edge first. Use New shape to place a separate face.');
        faces.add(key); for(let i=0;i<3;i++) addEdge(f[i],f[(i+1)%3]);
    }
}

function appendFaceTriangles(mesh, triangles, materialFace = 0) {
    validateTriangles(mesh, triangles);
    const out = structuredClone(mesh), count = out.faces.length;
    for (const indices of triangles) {
        out.faces.push([...indices,mesh.faces[materialFace]?.[3] ?? 32000]);
        for(const [key,fallback] of Object.entries(FACE_CHANNELS)) {
            out[key] ??= Array(count).fill(fallback); out[key].push(mesh[key]?.[materialFace] ?? fallback);
        }
        for(const key of ['sourceFaces','faceSources'])if(out[key])out[key].push(-1);
        if(out.faceTwins)out.faceTwins.push(false);
    }
    out.authoredFaces = [...(out.authoredFaces??[]),...triangles.map((_,i)=>count+i)];
    validateMesh(out); return out;
}

// Match the original opposite topology, rather than copying a left-hand joint
// or welding an unrelated shell at a coordinate seam.
export function mirrorMatches(mesh, pivot = 0) {
    const reflect=p=>[2*pivot-p[0],p[1],p[2]],near=(a,b)=>distance(a,b)<.002;
    const face=id=>{
        const points=mesh.faces[id]?.slice(0,3).map(i=>reflect(mesh.vertices[i]));if(!points)return -1;
        const matches=mesh.faces.flatMap((f,j)=>f.slice(0,3).every(v=>points.some(p=>near(p,mesh.vertices[v])))?[j]:[]);
        return matches.length===1?matches[0]:-1;
    };
    const vertex=(id,context=-1)=>{
        const p=mesh.vertices[id];if(!p)throw new Error('The mirror corner is missing.');if(Math.abs(p[0]-pivot)<.001)return id;
        let matches=mesh.vertices.flatMap((v,j)=>near(reflect(p),v)?[j]:[]);
        if(context>=0){const onFace=matches.filter(v=>mesh.faces[context].slice(0,3).includes(v));if(onFace.length===1)return onFace[0];}
        if(matches.length>1){
            const scores=new Map(matches.map(i=>[i,0]));
            mesh.faces.forEach((f,i)=>{if(!f.slice(0,3).includes(id))return;const other=face(i);if(other>=0)for(const v of matches)if(mesh.faces[other].slice(0,3).includes(v))scores.set(v,scores.get(v)+1);});
            matches.sort((a,b)=>scores.get(b)-scores.get(a));if(scores.get(matches[0])>scores.get(matches[1]))return matches[0];
        }
        if(matches.length!==1)throw new Error(matches.length?'The opposite corner is ambiguous. Choose another edge or turn Mirror off.':'No matching opposite corner. Turn Mirror off for this area.');
        return matches[0];
    };
    return {reflect,face,vertex};
}

export function mirroredVertexUpdates(mesh, updates, pivot = 0) {
    const match=mirrorMatches(mesh,pivot),out=new Map();
    for(const [i,p]of updates)out.set(i,Math.abs(mesh.vertices[i][0]-pivot)<.001?[pivot,p[1],p[2]]:[...p]);
    for(const [i,p]of [...out]){
        // Moving a corner also moves its coordinate seam aliases. These keep
        // their separate rig identities, even when the opposite side has more
        // than one native vertex at the same position.
        const opposite=match.reflect(mesh.vertices[i]),ids=mesh.vertices.flatMap((v,j)=>distance(v,opposite)<.002?[j]:[]),next=match.reflect(p);
        if(!ids.length)throw new Error('No matching opposite corner. Turn Mirror off for this area.');
        for(const j of ids){if(out.has(j)&&distance(out.get(j),next)>.002)throw new Error('The two sides request different mirror positions. Move one side at a time.');out.set(j,next);}
    }
    return out;
}

// Mirror the final planned join, including any opening cuts and new landing
// corners. Endpoint links remain native links, so both halves animate with
// their own limbs. Linked pairs switch instance instead of editing twice.
export function mirrorConnectionPlan(parts, plan) {
    if(plan.symmetric)return plan;
    const prepared=structuredClone(plan.prepared??parts),replacements=new Map(),maps=new Map();
    const paired=part=>{while(part){if(part.pair)return true;part=prepared.find(p=>p.id===part.parentId);}return false;};
    const faceKey=f=>f.slice(0,3).sort((a,b)=>a-b).join(':');
    for(const [id,replacement]of plan.replacements??[]){
        const original=parts.find(p=>p.id===id),target=prepared.find(p=>p.id===id);
        if(['position','rotation','scale','pivot','mirror','parentId'].some(k=>JSON.stringify(original[k])!==JSON.stringify(replacement[k])))throw new Error('Mirrored joins keep both pieces in place. Choose Keep placement, or position the pieces in Build first.');
        if(paired(target)){replacements.set(id,target);continue;}
        const before=original.mesh,mesh=target.mesh,pivot=original.pivot?.[0]??0,match=mirrorMatches(before,pivot),ids=new Map();
        const counterpart=i=>{if(!ids.has(i))ids.set(i,match.vertex(i));return ids.get(i);};
        // Mirror changes to existing corners before appending new corners.
        const moved=new Map(before.vertices.flatMap((v,i)=>distance(v,mesh.vertices[i])>.002?[[i,mesh.vertices[i]]]:[]));
        if(moved.size)applyVertexUpdates(mesh,mirroredVertexUpdates(before,moved,pivot));
        for(let i=before.vertices.length;i<replacement.mesh.vertices.length;i++){
            const point=match.reflect(replacement.mesh.vertices[i]),existing=mesh.vertices.findIndex(v=>distance(v,point)<.002);
            if(existing>=0){ids.set(i,existing);continue;}
            const donor=before.vertices.reduce((best,v,j)=>distance(v,point)<distance(before.vertices[best],point)?j:best,0),next=mesh.vertices.length;
            ids.set(i,next);mesh.vertices.push(point);
            for(const channel of ['sourceVertices','skins','bones','weights'])if(mesh[channel])mesh[channel].push(structuredClone(before[channel][donor]));
        }
        const beforeKeys=new Set(before.faces.map(faceKey)),afterKeys=new Set(replacement.mesh.faces.map(faceKey)),removed=new Set();
        before.faces.forEach((f,i)=>{if(!afterKeys.has(faceKey(f))){const opposite=match.face(i);if(opposite<0)throw new Error('The opposite opening has no matching faces. Turn Mirror off for this join.');removed.add(faceKey(before.faces[opposite]));}});
        if(removed.size){const remove=mesh.faces.flatMap((f,i)=>removed.has(faceKey(f))?[i]:[]);if(remove.length)target.mesh=removeFaces(mesh,remove);}
        let out=target.mesh;
        for(const f of replacement.mesh.faces)if(!beforeKeys.has(faceKey(f))){
            const reflected=f.slice(0,3).map(counterpart).reverse();if(out.faces.some(g=>faceKey(g)===faceKey(reflected)))continue;
            const center=reflected.reduce((s,v)=>s.map((n,a)=>n+out.vertices[v][a]/3),[0,0,0]);
            const donor=before.faces.reduce((best,g,j)=>{const d=face=>distance(center,face.slice(0,3).reduce((s,v)=>s.map((n,a)=>n+before.vertices[v][a]/3),[0,0,0]));return d(g)<d(before.faces[best])?j:best;},0);
            const material=out.faces.findIndex(g=>faceKey(g)===faceKey(before.faces[donor]));
            out=appendFaceTriangles(out,[reflected],material>=0?material:0);
        }
        target.mesh=out;replacements.set(id,target);maps.set(id,counterpart);
    }
    const reflectRef=ref=>{
        const part=prepared.find(p=>p.id===ref.partId);if(paired(part))return {...ref,twin:!ref.twin};
        const vertex=maps.get(part.id)?.(ref.vertex)??mirrorMatches(part.mesh,part.pivot?.[0]??0).vertex(ref.vertex);
        return {...ref,vertex};
    };
    const part=structuredClone(plan.part),mesh=part.mesh,key=r=>`${r.partId}/${!!r.twin}/${r.vertex}`;
    const refs=mesh.vertexLinks.slice(),faces=mesh.faces.slice(),faceCount=faces.length;
    const include=ref=>{const found=mesh.vertexLinks.findIndex(r=>key(r)===key(ref));if(found>=0)return found;
        const id=mesh.vertices.length;mesh.vertexLinks.push(ref);mesh.vertices.push(linkedPoint(ref,prepared));return id;};
    const indices=refs.map(r=>include(reflectRef(r))),existing=new Set(faces.map(f=>f.slice(0,3).map(i=>key(refs[i])).sort().join('|'))),textures=new Map();
    for(let i=0;i<faceCount;i++){
        const face=faces[i],triangle=face.slice(0,3).map(v=>indices[v]).reverse(),k=triangle.map(v=>key(mesh.vertexLinks[v])).sort().join('|');
        if(existing.has(k))continue;existing.add(k);mesh.faces.push([...triangle,face[3]]);
        for(const channel of [...Object.keys(FACE_CHANNELS),'sourceFaces','faceSources','faceTwins'])if(mesh[channel])mesh[channel].push(structuredClone(mesh[channel][i]));
        const coord=mesh.textureCoords?.[i]??-1;
        if(coord>=0){if(!textures.has(coord)){textures.set(coord,mesh.textureMappings.length);mesh.textureMappings.push(mesh.textureMappings[coord].map(v=>indices[v]));}mesh.textureCoords[mesh.faces.length-1]=textures.get(coord);}
    }
    const occupied=new Set(part.connectionEdges.map(e=>e.map(key).sort().join('|')));
    const existingEdges=new Set(parts.flatMap(p=>(p.connectionEdges??[]).map(e=>e.map(key).sort().join('|'))));
    for(const edge of plan.part.connectionEdges){const next=edge.map(reflectRef),k=next.map(key).sort().join('|');if(existingEdges.has(k))throw new Error('The opposite edge already has a connection. Remove that connection or turn Mirror off.');if(!occupied.has(k)){occupied.add(k);part.connectionEdges.push(next);}}
    mesh.authoredFaces=mesh.faces.map((_,i)=>i);validateMesh(mesh);assemble([...prepared,part],part.variant);
    return {...plan,part,prepared,replacements,symmetric:true,triangles:mesh.faces.map(f=>f.slice(0,3).map(i=>mesh.vertices[i]))};
}

function reflectedCorners(mesh,corners,pivot,materialFace) {
    const match=mirrorMatches(mesh,pivot),opposite=match.face(materialFace);let next=mesh.vertices.length;
    const nearest=p=>mesh.vertices.reduce((best,v,i)=>distance(v,p)<distance(mesh.vertices[best],p)?i:best,0);
    return corners.map(c=>{
        const original=c.snap??c.vertex,created=original===undefined?next++:original;
        if(original!==undefined)return {vertex:match.vertex(original,opposite)};
        const point=match.reflect(c.point),donor=c.donor??nearest(c.point);
        if(Math.abs(point[0]-pivot)<.001&&c.joined===undefined)return {vertex:created};
        let mirrorDonor;try{mirrorDonor=match.vertex(donor,opposite);}catch{mirrorDonor=nearest(point);}
        const out={point,donor:mirrorDonor};if(c.joined!==undefined)out.joined=mirrorDonor;
        if(c.edge)out.edge=c.edge.map(i=>match.vertex(i));return out;
    });
}
const sameCornerSet=(mesh,a,b)=>{
    const key=c=>(c.point??mesh.vertices[c.snap??c.vertex]).map(n=>Math.round(n*1000)).join(',');
    return a.map(key).sort().join('|')===b.map(key).sort().join('|');
};

export function addFace(mesh, vertices, materialFace = 0, {mirror = false,pivot = 0} = {}) {
    if(mesh.vertexLinks) throw new Error('Choose corners on an original part.');
    let out;
    try { out=appendFaceTriangles(mesh, [[...vertices]], materialFace); }
    catch(first) { try { out=appendFaceTriangles(mesh, [[...vertices].reverse()], materialFace); } catch { throw first; } }
    if(!mirror)return out;
    const match=mirrorMatches(mesh,pivot),other=vertices.map(i=>match.vertex(i,match.face(materialFace)));
    if([...vertices].sort((a,b)=>a-b).join(':')===[...other].sort((a,b)=>a-b).join(':'))return out;
    return addFace(out,other.reverse(),match.face(materialFace)>=0?match.face(materialFace):materialFace);

}

// Draft corners never change the donor mesh. New corners borrow the nearest
// donor's native joints and animation mapping, including on converted gear.
export function buildFace(mesh, corners, { materialFace = 0, flip = false, mirror = false, pivot = 0 } = {}) {
    if (mesh.vertexLinks) throw new Error('Add faces to an original part.');
    if (![3,4].includes(corners.length)) throw new Error('Choose a triangle or a four-corner face.');
    const out = structuredClone(mesh), indices = corners.map(corner => {
        const existing = corner.snap ?? corner.vertex;
        if (existing !== undefined) {
            if (!Number.isInteger(existing) || !mesh.vertices[existing]) throw new Error('This corner is missing. Choose the edge again.');
            return existing;
        }
        const point = corner.point;
        if (!point || point.length !== 3 || !point.every(Number.isFinite)) throw new Error('Move each corner into the model.');
        const donor = Number.isInteger(corner.donor) && mesh.vertices[corner.donor] ? corner.donor : mesh.vertices.reduce((best,v,i) => distance(v,point)<distance(mesh.vertices[best],point)?i:best,0);
        const id = out.vertices.length;
        out.sourceVertices ??= mesh.vertices.map((_,i)=>i);
        out.vertices.push([...point]); out.sourceVertices.push(mesh.sourceVertices?.[donor] ?? donor);
        for (const channel of ['skins','bones','weights']) if (out[channel]) out[channel].push(structuredClone(mesh[channel][donor]));
        return id;
    });
    // Snapping into an existing edge inserts a real shared corner rather than
    // leaving a T-junction. Indices and all donor texture projections stay put.
    for (const [i,corner] of corners.entries()) if (corner.edge && corner.snap === undefined) {
        const [a,b]=corner.edge,mid=indices[i],faces=out.faces.slice();
        if (!mesh.vertices[a] || !mesh.vertices[b]) throw new Error('The snap edge changed. Choose it again.');
        const ab=subtract(mesh.vertices[b],mesh.vertices[a]),offset=subtract(out.vertices[mid],mesh.vertices[a]),t=dot(offset,ab)/dot(ab,ab);
        if(!Number.isFinite(t)||t<=0||t>=1||distance(out.vertices[mid],mesh.vertices[a].map((n,i)=>n+ab[i]*t))>1e-4)throw new Error('Snap inside the edge, or choose its end corner.');
        let found=false;
        faces.forEach((face,id)=>{
            for(let j=0;j<3;j++)if(face[j]===a&&face[(j+1)%3]===b||face[j]===b&&face[(j+1)%3]===a){
                const u=face[j],v=face[(j+1)%3],w=face[(j+2)%3],last=out.faces.length;
                out.faces[id]=[u,mid,w,face[3]];out.faces.push([mid,v,w,face[3]]);
                for(const key of [...Object.keys(FACE_CHANNELS),'sourceFaces','faceSources','faceTwins'])if(out[key])out[key].push(structuredClone(out[key][id]));
                out.authoredFaces=[...new Set([...(out.authoredFaces??[]),id,last])];found=true;break;
            }
        });
        if(!found)throw new Error('Two corners snapped to the same edge. Move one to a different edge or corner.');
    }
    let triangles = indices.length === 3 ? [indices] : [[indices[0],indices[1],indices[2]],[indices[0],indices[2],indices[3]]];
    if (flip) triangles = triangles.map(f=>[...f].reverse());
    // Reject folded/bow-tie quads. Splitting them should not silently make two
    // opposing triangles or turn a simple panel into an overlapping surface.
    if (triangles.length === 2) {
        const normal = f => cross(subtract(out.vertices[f[1]],out.vertices[f[0]]),subtract(out.vertices[f[2]],out.vertices[f[0]]));
        if (dot(normal(triangles[0]),normal(triangles[1])) <= 0) throw new Error('The corners cross. Drag them around the outside of the face.');
    }
    const result=appendFaceTriangles(out, triangles, materialFace);
    if(!mirror)return result;
    const reflected=reflectedCorners(mesh,corners,pivot,materialFace);
    if(sameCornerSet(result,corners,reflected))return result;
    const opposite=mirrorMatches(mesh,pivot).face(materialFace);
    return buildFace(result,reflected,{materialFace:opposite>=0?opposite:materialFace,flip:!flip});
}

export function startFace(mesh, faceId, point, { mode = 'edge', shape = 'triangle', edge: chosenEdge } = {}) {
    const face = mesh.faces[faceId];
    if (!face || mesh.vertexLinks) throw new Error('Choose an original surface.');
    const normal = unit(faceNormal(mesh,faceId));
    if (mode === 'free') {
        const center = face.slice(0,3).reduce((sum,i)=>sum.map((n,a)=>n+mesh.vertices[i][a]/3),[0,0,0]);
        const seed = face.slice(0,3).map(vertex=>({point:mesh.vertices[vertex].map((n,a)=>point[a]+(n-center[a])*.65+normal[a]*2),donor:vertex}));
        if (shape === 'quad') {
            const [a,b,c]=seed.map(c=>c.point),v=subtract(c,a);
            return [{point:a,donor:face[0]},{point:b,donor:face[1]},{point:b.map((n,i)=>n+v[i]),donor:face[2]},{point:c,donor:face[2]}];
        }
        return seed;
    }
    const edges = faceEdges(mesh).filter(e=>e.faceId===faceId&&(!chosenEdge||chosenEdge.includes(e.a)&&chosenEdge.includes(e.b)));
    const segmentDistance = e => {
        const a=mesh.vertices[e.a],b=mesh.vertices[e.b],ab=subtract(b,a),t=Math.max(0,Math.min(1,dot(subtract(point,a),ab)/(dot(ab,ab)||1)));
        return distance(point,a.map((n,i)=>n+ab[i]*t));
    };
    const edge = edges.sort((a,b)=>segmentDistance(a)-segmentDistance(b))[0];
    if (!edge) throw new Error('Click an edge on the piece to start a face.');
    const a=mesh.vertices[edge.b],b=mesh.vertices[edge.a],third=mesh.vertices[face.slice(0,3).find(i=>i!==edge.a&&i!==edge.b)];
    const middle=a.map((n,i)=>(n+b[i])/2),along=unit(subtract(b,a)),inward=subtract(third,middle);
    const away=unit(inward.map((n,i)=>-n+along[i]*dot(inward,along))),size=Math.max(3,distance(a,b)*.65);
    const anchor=vertex=>edge.open?{vertex}:{point:[...mesh.vertices[vertex]],donor:vertex,joined:vertex};
    return shape === 'quad' ? [anchor(edge.b),anchor(edge.a),{point:b.map((n,i)=>n+away[i]*size),donor:edge.a},{point:a.map((n,i)=>n+away[i]*size),donor:edge.b}] :
        [anchor(edge.b),anchor(edge.a),{point:middle.map((n,i)=>n+away[i]*size),donor:edge.a}];
}

export function fillOpening(mesh, vertices, materialFace = 0, {mirror = false,pivot = 0} = {}) {
    if (mesh.vertexLinks || vertices.length < 3 || vertices.length > 256) throw new Error('Choose a simple opening with 3 to 256 corners.');
    const ring = [...vertices].reverse(),normal=unit(ring.reduce((sum,v,i)=>sum.map((n,a)=>n+cross(mesh.vertices[v],mesh.vertices[ring[(i+1)%ring.length]])[a]),[0,0,0]));
    if (!length(normal)) throw new Error('This opening folds onto itself. Extend its edges a face at a time.');
    let triangles;
    try { triangles=triangulateGuidePolygon(ring,mesh.vertices,normal); }
    catch { throw new Error('This opening folds onto itself. Extend its edges a face at a time.'); }
    const result=appendFaceTriangles(mesh,triangles,materialFace);if(!mirror)return result;
    const match=mirrorMatches(mesh,pivot),other=vertices.map(i=>match.vertex(i));
    if(sameCornerSet(mesh,vertices.map(vertex=>({vertex})),other.map(vertex=>({vertex}))))return result;
    return fillOpening(result,other.reverse(),match.face(materialFace)>=0?match.face(materialFace):materialFace);
}

export function pickFaceEdge(parts,hit){
    const part=parts.find(p=>p.id===hit?.partId);if(!part||part.mesh.vertexLinks)return null;
    const faceId=hit.sourceFaceId??hit.faceId%part.mesh.faces.length;
    const point=i=>linkedPoint({partId:part.id,vertex:i,twin:!!hit.twin},parts);
    const rank=e=>{const a=point(e.a),b=point(e.b),ab=subtract(b,a),t=Math.max(0,Math.min(1,dot(subtract(hit.point,a),ab)/(dot(ab,ab)||1)));return distance(hit.point,a.map((n,i)=>n+ab[i]*t));};
    const edge=faceEdges(part.mesh).filter(e=>e.faceId===faceId&&(!hit.edge||hit.edge.includes(e.a)&&hit.edge.includes(e.b))).sort((a,b)=>rank(a)-rank(b))[0];
    return edge?{partId:part.id,twin:!!hit.twin,vertices:[edge.a,edge.b],closed:false}:null;
}

// A boundary choice is a directed edge or an unbranched opening. Winding follows
// the donor faces; reversing only one side later produces a consistently wound strip.
export function pickBoundary(parts, hit, { opening = true } = {}) {
    const part = parts.find(p=>p.id===hit?.partId);
    if(!part || part.mesh.vertexLinks) return null;
    const faceId=hit.sourceFaceId??hit.faceId%part.mesh.faces.length, edges=boundaries(part.mesh);
    const point = i => linkedPoint({partId:part.id,vertex:i,twin:!!hit.twin},parts);
    const segmentDistance = e => {
        const a=point(e.a),b=point(e.b),ab=subtract(b,a),t=Math.max(0,Math.min(1,dot(subtract(hit.point,a),ab)/(dot(ab,ab)||1)));
        return distance(hit.point,a.map((n,i)=>n+ab[i]*t));
    };
    const nearby=edges.filter(e=>e.faceId===faceId).sort((a,b)=>segmentDistance(a)-segmentDistance(b));
    const seed=nearby[0]; if(!seed) return null;
    let chosen=[seed],closed=false;
    if(opening) {
        const outgoing=new Map(),incoming=new Map();
        for(const edge of edges){const a=outgoing.get(edge.a)??[],b=incoming.get(edge.b)??[];a.push(edge);b.push(edge);outgoing.set(edge.a,a);incoming.set(edge.b,b);}
        let cursor=seed;
        while(chosen.length<=512){
            if(outgoing.get(cursor.b)?.length!==1 || incoming.get(cursor.b)?.length!==1) break;
            const next=outgoing.get(cursor.b)[0]; if(next===seed){closed=true;break;} if(chosen.includes(next))break;chosen.push(next);cursor=next;
        }
        if(!closed) return null;
    }
    const vertices=chosen.map(e=>e.a); if(!closed)vertices.push(chosen.at(-1).b);
    // World-space mirrors reverse face winding.
    let mirrored=!!hit.twin,p=part;
    while(p){mirrored=mirrored!==!!p.mirror;p=parts.find(row=>row.id===p.parentId);}
    if(mirrored)vertices.reverse();
    return {partId:part.id,twin:!!hit.twin,vertices,edges:chosen.map(e=>[e.a,e.b]),faceIds:chosen.map(e=>e.faceId),closed};
}

// A surface choice is transient. It describes a disk to open on Apply, without
// changing vertex identities, native projections or the donor's skeleton.
export function pickConnectionSurface(parts, hit, { mode = 'surface', steps = 0 } = {}) {
    if (mode !== 'surface') return pickBoundary(parts, hit, { opening: mode !== 'edge' });
    const part = parts.find(p => p.id === hit?.partId);
    if (!part || part.mesh.vertexLinks || part.visible === false) throw new Error('Choose a visible original part.');
    const mesh = part.mesh, faceId = hit.sourceFaceId ?? hit.faceId % mesh.faces.length;
    if (!mesh.faces[faceId]) throw new Error('Point at a face on the model.');
    const opening = pickBoundary(parts, hit);
    if (opening) return { ...opening, removeFaces: [], surfaceFaces: [faceId], normal: openingNormal(parts, opening) };
    const topology = meshTopology(mesh, { coincident: false }), removed = new Set([faceId]);
    for (let step = 0; step < Math.min(4, Math.max(0, steps)); step++) {
        for (const id of [...removed]) for (const next of topology.faceNeighbours[id]) {
            if (dot(unit(faceNormal(mesh, faceId)), unit(faceNormal(mesh, next))) > .35) removed.add(next);
        }
    }
    const rows = new Map();
    mesh.faces.forEach((face, id) => { for (let i = 0; i < 3; i++) {
        const a = face[i], b = face[(i + 1) % 3], key = edgeKey(a, b);
        if (!rows.has(key)) rows.set(key, []); rows.get(key).push({ a, b, faceId: id });
    } });
    const rim = [];
    for (const group of rows.values()) {
        if (!group.some(e => removed.has(e.faceId)) || group.every(e => removed.has(e.faceId))) continue;
        if (group.length !== 2 || group[0].a !== group[1].b) throw new Error('This area has overlapping faces. Choose a smaller area or an existing opening in Advanced.');
        rim.push(group.find(e => !removed.has(e.faceId)));
    }
    // Touching an existing hole or a disconnected patch needs an explicit edge
    // choice. Never guess a cap, erase a whole part or invent floating triangles.
    const removedEdges = [...rows.values()].filter(group => group.some(e => removed.has(e.faceId)));
    if (removed.size === mesh.faces.length || removedEdges.some(group => group.length === 1)) throw new Error('This area reaches an open edge. Choose the opening itself, or use Existing edge in Advanced.');
    const outgoing = new Map();
    for (const e of rim) { if (outgoing.has(e.a)) throw new Error('This area splits into several rims. Choose a smaller area.'); outgoing.set(e.a, e); }
    const ordered = [], seed = rim[0]; let cursor = seed;
    while (cursor && !ordered.includes(cursor) && ordered.length <= 512) { ordered.push(cursor); cursor = outgoing.get(cursor.b); }
    if (!seed || cursor !== seed || ordered.length !== rim.length) throw new Error('Choose a smaller, continuous area with one rim.');
    const side = { partId: part.id, twin: !!hit.twin, vertices: ordered.map(e => e.a), edges: ordered.map(e => [e.a, e.b]),
        faceIds: ordered.map(e => e.faceId), closed: true, removeFaces: [...removed], surfaceFaces: [...removed] };
    let mirrored = !!hit.twin, ancestor = part;
    while (ancestor) { mirrored = mirrored !== !!ancestor.mirror; ancestor = parts.find(p => p.id === ancestor.parentId); }
    if (mirrored) side.vertices.reverse();
    side.normal = openingNormal(parts, side);
    deleteFaces(mesh, removed); // The same safety checks as Apply, while still read-only.
    return side;
}

function openingNormal(parts, side) {
    const points = side.vertices.map(vertex => linkedPoint({ partId: side.partId, vertex, twin: side.twin }, parts));
    return unit(points.reduce((sum, p, i) => sum.map((n, a) => n - cross(p, points[(i + 1) % points.length])[a]), [0, 0, 0]));
}

function rotateBetween(from, to, point) {
    const a = unit(from), b = unit(to), cosine = Math.max(-1, Math.min(1, dot(a, b)));
    let axis = cross(a, b), sine = length(axis);
    if (sine < EPSILON) {
        if (cosine > 0) return [...point];
        axis = unit(cross(a, Math.abs(a[0]) < .8 ? [1,0,0] : [0,1,0]));
    } else axis = unit(axis);
    const c = cross(axis, point), projection = dot(axis, point);
    return point.map((n, i) => n * cosine + c[i] * sine + axis[i] * projection * (1 - cosine));
}

function placeConnectionSource(parts, first, second, { placement, gap }) {
    const source = parts.find(p => p.id === first.partId), target = parts.find(p => p.id === second.partId);
    if (source.id === target.id || placement === 'keep') return;
    let ancestor = target;
    while (ancestor) { if (ancestor.id === source.id) throw new Error('Move the child onto its parent. Choose the child first, or Keep placement in Advanced.'); ancestor = parts.find(p => p.id === ancestor.parentId); }
    if (first.twin || source.pair) throw new Error('Paired parts share their shape. Choose Keep placement in Advanced, or turn off Pair in Build before fitting.');
    const center = side => side.vertices.map(vertex => linkedPoint({partId:side.partId,vertex,twin:side.twin},parts))
        .reduce((sum,p) => sum.map((n,i) => n + p[i] / side.vertices.length), [0,0,0]);
    const origin = center(first), destination = center(second);
    let normal = openingNormal(parts, second);
    const approach = unit(subtract(origin,destination));
    if(dot(approach,normal)>.25)normal=approach;
    const radius = side => Math.max(...side.vertices.map(vertex => distance(linkedPoint({partId:side.partId,vertex,twin:side.twin},parts), center(side))));
    const spacing = gap ?? Math.max(4, Math.max(radius(first), radius(second)) * 2);
    const faceRotation = p => placement === 'align' ? rotateBetween(openingNormal(parts, first), normal.map(n => -n), p) : [...p];
    let rimAngle=0;
    if(placement==='align'){
        const a=[...first.vertices].reverse().map(vertex=>faceRotation(subtract(linkedPoint({partId:first.partId,vertex,twin:first.twin},parts),origin)));
        const b=second.vertices.map(vertex=>subtract(linkedPoint({partId:second.partId,vertex,twin:second.twin},parts),destination));
        let best=Infinity;
        for(let offset=0;offset<b.length;offset++){
            let cosine=0,sine=0;
            a.forEach((p,i)=>{const q=b[(offset+Math.floor(i*b.length/a.length))%b.length];cosine+=dot(p,q);sine+=dot(normal,cross(p,q));});
            const angle=Math.atan2(sine,cosine),score=a.reduce((sum,p,i)=>sum+distance(rotateAxis(p,normal,angle),b[(offset+Math.floor(i*b.length/a.length))%b.length])**2,0);
            if(score<best){best=score;rimAngle=angle;}
        }
    }
    const rotate = p => rotateAxis(faceRotation(p),normal,rimAngle);
    const convert = p => rotate(subtract(p, origin)).map((n,i) => n + destination[i] + normal[i] * spacing);
    const parent = parts.find(p => p.id === source.parentId), inParent = p => parent ? localPoint(p, parent, parts) : p;
    const pivot = source.pivot ?? [0,0,0], start = worldPoint(pivot, source, parts), next = inParent(convert(start));
    const basis = [0,1,2].map(axis => {
        const p = [...pivot]; p[axis]++;
        return subtract(inParent(convert(worldPoint(p, source, parts))), next);
    });
    const scale = basis.map(length), axes = basis.map((v,i) => v.map(n => n / scale[i]));
    if (scale.some(n => n < .01 || n > 100) || Math.max(Math.abs(dot(axes[0],axes[1])),Math.abs(dot(axes[0],axes[2])),Math.abs(dot(axes[1],axes[2]))) > 1e-5)
        throw new Error('This parent has uneven scaling. Choose Keep placement in Advanced, or detach the part before fitting.');
    if (source.mirror) axes[0] = axes[0].map(n => -n);
    const y = Math.asin(Math.max(-1,Math.min(1,-axes[0][2]))), cy = Math.cos(y);
    const x = Math.abs(cy) > 1e-7 ? Math.atan2(axes[1][2], axes[2][2]) : 0;
    const z = Math.abs(cy) > 1e-7 ? Math.atan2(axes[0][1], axes[0][0]) : Math.atan2(-axes[1][0],axes[1][1]);
    source.position = next.map((n,i) => n - pivot[i]); source.rotation = [x,y,z].map(n => n * 180 / Math.PI); source.scale = scale;
}

function rotateAxis(point,axis,angle){
    const cosine=Math.cos(angle),sine=Math.sin(angle),c=cross(axis,point),projection=dot(axis,point);
    return point.map((n,i)=>n*cosine+c[i]*sine+axis[i]*projection*(1-cosine));
}

export function planSurfaceConnection(parts, first, second, { variant, placement = 'align', gap, twist = 0, correspondence = 'uniform' } = {}) {
    if (!first || !second) throw new Error('Choose a source area, then a target area.');
    if (first.partId === second.partId && first.twin === second.twin) throw new Error('Choose a different part for the target, or use Existing openings in Advanced.');
    const prepared = parts.map(p => ({ ...p })), replacements = new Map();
    for (const side of [first,second]) if (side.removeFaces?.length) {
        const part = prepared.find(p => p.id === side.partId);
        let ancestor=part;
        while(ancestor){if(ancestor.pair)throw new Error('Opening a paired part would cut both copies. Turn off Pair in Build, or choose an existing opening in Advanced.');ancestor=prepared.find(p=>p.id===ancestor.parentId);}
        const occupied = parts.some(p => p.connectionEdges?.some(e => e.every(r => r.partId === side.partId) && side.removeFaces.some(i => e.every(r => part.mesh.faces[i].slice(0,3).includes(r.vertex)))));
        if (occupied) throw new Error('This area already supports a connection. Choose another face, or remove that connection in Build.');
        part.mesh = deleteFaces(part.mesh, side.removeFaces); replacements.set(part.id, part);
    }
    placeConnectionSource(prepared, first, second, { placement, gap });
    if (placement !== 'keep') replacements.set(first.partId, prepared.find(p => p.id === first.partId));
    const remap = side => {
        const part = prepared.find(p => p.id === side.partId), edges = boundaries(part.mesh);
        return { ...side, faceIds: side.edges.map(([a,b]) => edges.find(e => e.a === a && e.b === b)?.faceId ?? side.faceIds[0]) };
    };
    const plan = planBridge(prepared, remap(first), remap(second), { variant, twist, correspondence });
    if(placement==='align' && (first.removeFaces?.length||second.removeFaces?.length))addConnectionCollars(prepared,plan,replacements);
    plan.overlapFaces = assertConnectionClear(prepared, plan).map(hit=>{
        const side=hit.partId===first.partId?first:second,removed=new Set(side.removeFaces??[]);
        const kept=parts.find(p=>p.id===hit.partId).mesh.faces.flatMap((_,i)=>removed.has(i)?[]:[i]);
        return {...hit,faceId:kept[hit.faceId]};
    });
    return { ...plan, replacements, prepared, removed: (first.removeFaces?.length ?? 0) + (second.removeFaces?.length ?? 0) };
}

// Native extracted parts can have several boundary cycles meeting at one
// corner. Follow each simple cycle without welding vertices or their rig data.
export function connectionOpenings(parts, partId, { twin = false } = {}) {
    const part = parts.find(p => p.id === partId);
    if (!part || part.mesh.vertexLinks) return [];
    const edges = boundaries(part.mesh), outgoing = new Map(), found = new Map();
    for (const e of edges) { const rows = outgoing.get(e.a) ?? []; rows.push(e); outgoing.set(e.a, rows); }
    let budget = 16000;
    for (const seed of edges) {
        const walk = (path, vertices) => {
            if (--budget < 0 || path.length > 512 || found.size >= 128) return;
            for (const e of outgoing.get(path.at(-1).b) ?? []) {
                if (e.a < seed.a) continue; // one traversal per cycle
                if (e.b === seed.a && path.length >= 2) {
                    const rows = [...path, e], key = rows.map(r => `${r.a}:${r.b}`).sort().join('|');
                    found.set(key, rows); continue;
                }
                if (!vertices.has(e.b)) walk([...path, e], new Set([...vertices, e.b]));
            }
        };
        walk([seed], new Set([seed.a, seed.b]));
    }
    return [...found.values()].map(rows => {
        const side = { partId, twin, vertices: rows.map(e => e.a), edges: rows.map(e => [e.a,e.b]), faceIds: rows.map(e => e.faceId), closed: true, removeFaces: [] };
        let mirror = twin, ancestor = part;
        while (ancestor) { mirror = mirror !== !!ancestor.mirror; ancestor = parts.find(p => p.id === ancestor.parentId); }
        if (mirror) side.vertices.reverse();
        side.normal = openingNormal(parts, side); return side;
    }).filter(side => !parts.some(p => p.connectionEdges?.some(edge => side.edges.some(([a,b]) =>
        edge.every(r => r.partId === partId && r.twin === twin) && edge.some(r => r.vertex === a) && edge.some(r => r.vertex === b))))).sort((a,b)=>sideArea(parts,b)-sideArea(parts,a));
}

const sidePoints = (parts, side) => side.vertices.map(vertex => linkedPoint({partId:side.partId, vertex, twin:side.twin}, parts));
const centroid = points => points.reduce((sum,p) => sum.map((n,a) => n + p[a]/points.length), [0,0,0]);
const sideRadius = (parts, side) => { const points=sidePoints(parts,side),center=centroid(points); return Math.sqrt(points.reduce((n,p)=>n+distance(p,center)**2,0)/points.length); };
const sideArea = (parts, side) => { const points=sidePoints(parts,side); return length(points.reduce((sum,p,i)=>sum.map((n,a)=>n+cross(p,points[(i+1)%points.length])[a]),[0,0,0]))/2; };

// Guides use native corners so a saved connection can keep following the exact
// donor vertices, materials and animation without a second attachment system.
export function pickConnectionGuide(parts, hit, { opening = false } = {}) {
    const part=parts.find(p=>p.id===hit?.partId),faceId=hit?.sourceFaceId??hit?.faceId;
    if(!part||part.visible===false||part.mesh.vertexLinks||!part.mesh.faces[faceId]||part.mesh.alpha?.[faceId]===255||part.mesh.renderTypes?.[faceId]===2||hit.twin)throw new Error('Choose a visible original piece. Turn off paired copies before connecting.');
    let vertices=part.mesh.faces[faceId].slice(0,3);
    if(opening){
        const loops=connectionOpenings(parts,part.id).sort((a,b)=>sideArea(parts,b)-sideArea(parts,a));
        if(loops.length)vertices=loops[0].vertices;
    }
    const vertex=[...vertices].sort((a,b)=>distance(linkedPoint({partId:part.id,vertex:a},parts),hit.point)-distance(linkedPoint({partId:part.id,vertex:b},parts),hit.point))[0];
    return {partId:part.id,vertex,faceId:part.mesh.faces[faceId].slice(0,3).includes(vertex)?faceId:part.mesh.faces.findIndex(f=>f.slice(0,3).includes(vertex)),twin:false};
}

export function planGuidedConnection(parts,sourceId,targetId,{guides,variant,ramp=0,complexity=0,repairCrossings=true}={}){
    if(!Array.isArray(guides)||!guides.length)throw new Error('Complete a guide pair, then Fill connection.');
    if(!Number.isFinite(ramp)||!Number.isFinite(complexity))throw new Error('Choose valid Lift and Complexity amounts.');
    complexity=Math.max(0,Math.min(3,Math.round(complexity)));
    const source=parts.find(p=>p.id===sourceId),target=parts.find(p=>p.id===targetId);
    if(!source||!target||source===target||[source,target].some(p=>p.visible===false||p.mesh.vertexLinks))throw new Error('Choose two visible original pieces.');
    variant??=source.variant==='all'?target.variant:source.variant;
    if([source,target].some(p=>p.variant!=='all'&&p.variant!==variant))throw new Error('Choose pieces in the same gear view.');
    const paired=part=>{let p=part;while(p){if(p.pair)return true;p=parts.find(a=>a.id===p.parentId);}return false;};
    if(paired(source)||paired(target))throw new Error('Turn off "Mirror to other side" in Build before filling guides.');
    for(const g of guides)for(const [side,part]of [[g.source,source],[g.target,target]]){
        if(side?.partId!==part.id||side.twin||!part.mesh.vertices[side.vertex]||!part.mesh.faces[side.faceId]?.slice(0,3).includes(side.vertex))throw new Error('A guide changed. Pick its two points again.');
    }
    if(new Set(guides.map(g=>g.source.vertex)).size!==guides.length||new Set(guides.map(g=>g.target.vertex)).size!==guides.length)throw new Error('Each guide needs its own corner on both pieces. Move overlapping guides farther apart.');
    const first=connectionOpenings(parts,sourceId).find(s=>guides.every(g=>s.vertices.includes(g.source.vertex)))??pickConnectionSurface(parts,{...guides[0].source,sourceFaceId:guides[0].source.faceId,point:linkedPoint(guides[0].source,parts)});
    if(!first||!guides.every(g=>first.vertices.includes(g.source.vertex)))throw new Error('Source guides must sit around the same opening. Pick points on its orange rim.');
    const row=[...first.vertices].reverse(),ordered=[...guides].sort((a,b)=>row.indexOf(a.source.vertex)-row.indexOf(b.source.vertex));
    row.push(...row.splice(0,row.indexOf(ordered[0].source.vertex)));
    const prepared=parts.map(p=>({...p})),replacements=new Map(),donor=prepared.find(p=>p.id===targetId);
    donor.mesh=structuredClone(target.mesh);replacements.set(targetId,donor);
    if(first.removeFaces?.length){const p=prepared.find(p=>p.id===sourceId);p.mesh=deleteFaces(p.mesh,first.removeFaces);replacements.set(sourceId,p);}
    const world=target.mesh.vertices.map(v=>worldPoint(v,target,parts)),topology=meshTopology(target.mesh,{coincident:false});
    const reachable=new Set([guides[0].target.faceId]),pending=[guides[0].target.faceId];
    for(let i=0;i<pending.length;i++)for(const next of topology.faceNeighbours[pending[i]])if(!reachable.has(next)){reachable.add(next);pending.push(next);}
    if(guides.some(g=>!reachable.has(g.target.faceId)))throw new Error('These target points are on separate shells. Pick points on one continuous surface, or connect each shell separately.');
    const normals=target.mesh.faces.map((_,i)=>unit(faceNormal(target.mesh,i,world))),centers=target.mesh.faces.map(f=>centroid(f.slice(0,3).map(v=>world[v])));
    let guideNormal=first.normal??openingNormal(parts,first);
    const allowed=new Set(),queue=ordered.map(g=>g.target.faceId),limit=sideRadius(parts,first)*2.5;
    for(let i=0;i<queue.length;i++){
        const id=queue[i];if(allowed.has(id))continue;
        const nearest=ordered.reduce((best,g)=>distance(centers[id],world[g.target.vertex])<distance(centers[id],world[best.target.vertex])?g:best,ordered[0]);
        if(target.mesh.alpha?.[id]===255||target.mesh.renderTypes?.[id]===2||dot(normals[id],normals[nearest.target.faceId])<.05||distance(centers[id],world[nearest.target.vertex])>limit)continue;
        allowed.add(id);for(const next of topology.faceNeighbours[id])if(!allowed.has(next))queue.push(next);
    }
    const surface=point=>{
        let best,nearest;
        for(const id of allowed){
            const triangle=target.mesh.faces[id].slice(0,3).map(v=>world[v]);
            const n=faceNormal(target.mesh,id,world),den=dot(n,guideNormal);
            const q=closestTrianglePoint(point,...triangle),score=distance(point,q);
            if(!nearest||score<nearest.score)nearest={point:q,normal:guideNormal,score,faceId:id};
            if(Math.abs(den)<EPSILON)continue;
            const depth=dot(n,subtract(triangle[0],point))/den,p=point.map((v,a)=>v+guideNormal[a]*depth);
            if(distance(p,closestTrianglePoint(p,...triangle))>1e-5)continue;
            if(!best||depth>best.depth)best={point:p,normal:guideNormal,depth,faceId:id};
        }
        return best??nearest;
    };
    const newVertex=(point,faceId)=>{
        const mesh=donor.mesh,original=target.mesh.faces[faceId].slice(0,3).sort((a,b)=>distance(point,world[a])-distance(point,world[b]))[0],vertex=mesh.vertices.length;
        mesh.sourceVertices??=mesh.vertices.map((_,i)=>i);mesh.vertices.push(localPoint(point,donor,prepared));mesh.sourceVertices.push(mesh.sourceVertices[original]);
        for(const key of ['skins','bones','weights'])if(mesh[key])mesh[key].push(structuredClone(mesh[key][original]));return vertex;
    };
    const mesh={vertices:[],faces:[],vertexLinks:[],textureMappings:[]},refs=new Map();
    const include=ref=>{
        const key=`${ref.partId}/${ref.vertex}`;if(refs.has(key))return refs.get(key);
        const i=mesh.vertices.length;mesh.vertices.push(linkedPoint(ref,prepared));mesh.vertexLinks.push({partId:ref.partId,vertex:ref.vertex,twin:false});refs.set(key,i);return i;
    };
    const outer=row.map(vertex=>include({partId:sourceId,vertex})),inner=ordered.map(g=>include(g.target));
    const symmetry=connectionSymmetry(parts,source,outer.map(i=>mesh.vertices[i]),ordered,world);
    // Use a chart in which every guide sector is simple. A deep notch in a
    // native rim can overlap in its average plane even when the 3D rim is sound.
    // Try donor-local axes as well, so rotation of the assembled asset is immaterial.
    const origin=worldPoint([0,0,0],target,parts),axes=[0,1,2].map(a=>{
        const p=[0,0,0];p[a]=1;const axis=unit(subtract(worldPoint(p,target,parts),origin));
        return dot(axis,guideNormal)<0?axis.map(n=>-n):axis;
    }).sort((a,b)=>dot(b,guideNormal)-dot(a,guideNormal));
    const primary=axes[0],others=axes.slice(1),candidates=[guideNormal,...axes];
    if(ordered.length===1){
        let direction=unit(subtract(mesh.vertices[inner[0]],centroid(outer.map(i=>mesh.vertices[i]))));
        if(dot(direction,guideNormal)<0)direction=direction.map(n=>-n);
        if(length(direction)>EPSILON)candidates.push(direction);
    }
    for(const axis of others)for(const amount of [.2,-.2,.4,-.4,.7,-.7])candidates.push(unit(primary.map((n,a)=>n+axis[a]*amount)));
    for(const a of [-.4,-.2,.2,.4])for(const b of [-.4,-.2,.2,.4])candidates.push(unit(primary.map((n,i)=>n+others[0][i]*a+others[1][i]*b)));
    let triangles,chartError,chartGuidePaths,bestQuality=-Infinity;
    for(const candidate of candidates)try{
        const normal=symmetry?unit(candidate.map((n,i)=>n-symmetry.normal[i]*dot(candidate,symmetry.normal))):candidate;
        if(length(normal)<EPSILON)continue;
        const rows=[];
        let paths=ordered.map((g,i)=>[outer[row.indexOf(g.source.vertex)],inner[i]]);
        if(ordered.length===1){
            const fill=triangulateSingleGuide(outer,inner[0],outer[0],mesh.vertices,normal,symmetry);rows.push(...fill.triangles);paths=[fill.path];
        }else for(let k=0;k<ordered.length;k++){
            const start=row.indexOf(ordered[k].source.vertex),end=k===ordered.length-1?row.length:row.indexOf(ordered[k+1].source.vertex);
            rows.push(...triangulateGuidePolygon([...outer.slice(start,end+1),...(end===row.length?[outer[0]]:[]),inner[(k+1)%inner.length],inner[k]],mesh.vertices,normal,symmetry));
        }
        if(inner.length>2)rows.push(...triangulateGuidePolygon(inner,mesh.vertices,normal,symmetry));
        const quality=Math.min(...rows.map(([a,b,c])=>dot(unit(cross(subtract(mesh.vertices[b],mesh.vertices[a]),subtract(mesh.vertices[c],mesh.vertices[a]))),normal)));
        if(quality>bestQuality){triangles=rows;chartGuidePaths=paths;guideNormal=normal;bestQuality=quality;}
    }catch(error){chartError=error;}
    if(!triangles)throw chartError;
    const sourceEdges=new Map(first.edges.map(([a,b],i)=>[[a,b].sort((a,b)=>a-b).join(':'),first.faceIds[i]]));
    const materialFor=triangle=>{
        for(let i=0;i<3;i++){
            const a=mesh.vertexLinks[triangle[i]],b=mesh.vertexLinks[triangle[(i+1)%3]],key=[a.vertex,b.vertex].sort((a,b)=>a-b).join(':');
            if(a.partId===sourceId&&b.partId===sourceId&&sourceEdges.has(key))return {part:source,faceId:sourceEdges.get(key)};
        }
        return {part:target,faceId:surface(centroid(triangle.map(i=>mesh.vertices[i]))).faceId};
    };
    const mappings=new Map();
    const append=(triangle,material)=>{
        const donor=material.part.mesh,id=material.faceId,index=mesh.faces.length;
        mesh.faces.push([...triangle,donor.faces[id][3]]);
        for(const [key,fallback]of Object.entries(FACE_CHANNELS)){mesh[key]??=[];mesh[key].push(donor[key]?.[id]??fallback);}
        if((mesh.textures[index]??-1)>=0){const coord=donor.textureCoords?.[id]??-1,projection=coord>=0?donor.textureMappings[coord]:donor.faces[id].slice(0,3);
            const key=`${material.part.id}/${coord}/${coord<0?id:''}`;
            if(!mappings.has(key)){mappings.set(key,mesh.textureMappings.length);mesh.textureMappings.push(projection.map(vertex=>include({partId:material.part.id,vertex})));}
            mesh.textureCoords[index]=mappings.get(key);}
    };
    const raised=point=>{
        const projected=surface(point),depth=dot(subtract(point,projected.point),guideNormal),clearance=.75;
        return {point:depth<clearance?point.map((n,a)=>n+guideNormal[a]*(clearance-depth)):point,faceId:projected.faceId};
    };
    const nativeTriangle=points=>{
        const [a,b,c]=points.map(p=>p.map(Math.round));
        return length(cross(subtract(b,a),subtract(c,a)))>EPSILON;
    };
    // Split shared edges together. Keep native rim edges whole and reject a
    // subdivision if it would collapse when native integer vertices are encoded.
    const guidePaths=chartGuidePaths;
    let refined=triangles;
    const splitEdge=(a,b,lift=false,detail=false)=>{
        const edges=[[a,b]];
        if(symmetry){
            const indices=[...new Set(refined.flat())],ma=symmetry.match(mesh.vertices[a],indices,mesh.vertices),mb=symmetry.match(mesh.vertices[b],indices,mesh.vertices);
            if(ma===undefined||mb===undefined)return false;
            if(edgeKey(a,b)!==edgeKey(ma,mb))edges.push([ma,mb]);
        }
        const splits=[];
        for(const [a,b]of edges){
            const ra=mesh.vertexLinks[a],rb=mesh.vertexLinks[b];
            if(ra.partId===sourceId&&rb.partId===sourceId&&sourceEdges.has(edgeKey(ra.vertex,rb.vertex)))return false;
            const affected=refined.filter(f=>f.includes(a)&&f.includes(b));if(!affected.length)return false;
            const next=raised(centroid([mesh.vertices[a],mesh.vertices[b]]));
            if(lift)next.point=next.point.map((n,i)=>n+guideNormal[i]*sideRadius(parts,first)*Math.max(0,Math.min(100,ramp))*.004);
            splits.push({a,b,next,affected});
        }
        if(splits.length===2&&splits[0].affected.some(f=>splits[1].affected.includes(f)))return false;
        if(symmetry){
            const one=splits[0],other=splits[1]??one,reflected=symmetry.reflect(other.next.point),average=centroid([one.next.point,reflected]);
            // Retain the higher clearance so fitting cannot push one matching
            // side through the donor just to match a lower sample on the other.
            const lift=Math.max(dot(subtract(one.next.point,average),guideNormal),dot(subtract(reflected,average),guideNormal));
            one.next.point=average.map((n,i)=>n+guideNormal[i]*lift);
            // Native encoding rounds vertices to integers. Snap equal offsets
            // together so +32.5 and -32.5 cannot become +33 and -32.
            if(symmetry.normal.some(n=>Math.abs(n)>.999999)){
                const offset=symmetry.signed(one.next.point),snap=Math.sign(offset)*Math.round(Math.abs(offset))-offset;
                one.next.point=one.next.point.map((n,i)=>n+symmetry.normal[i]*snap);
            }
            if(splits[1])splits[1].next.point=symmetry.reflect(one.next.point);
        }
        for(const {a,b,next,affected}of splits)if(affected.some(f=>{const c=f.find(v=>v!==a&&v!==b);return !nativeTriangle([mesh.vertices[a],next.point,mesh.vertices[c]])||!nativeTriangle([next.point,mesh.vertices[b],mesh.vertices[c]]);}))return false;
        if(detail)for(const {a,b,next,affected}of splits)for(const f of affected){
            const j=f.findIndex((v,i)=>(v===a&&f[(i+1)%3]===b)||(v===b&&f[(i+1)%3]===a)),x=f[j],y=f[(j+1)%3],c=f[(j+2)%3];
            for(const edge of [[x,c],[y,c]])if(edge.every(v=>mesh.vertexLinks[v].partId!==sourceId)&&opposing.some(other=>crosses([mesh.vertices[edge[0]],mesh.vertices[edge[1]],next.point],other)))return false;
        }
        for(const {a,b,next}of splits){
            const affected=refined.filter(f=>f.includes(a)&&f.includes(b)),m=include({partId:targetId,vertex:newVertex(next.point,next.faceId)}),remove=new Set(affected);
            refined=refined.filter(f=>!remove.has(f));
            for(const f of affected){const j=f.findIndex((v,i)=>(v===a&&f[(i+1)%3]===b)||(v===b&&f[(i+1)%3]===a));
                const x=f[j],y=f[(j+1)%3],c=f[(j+2)%3];refined.push([x,m,c],[m,y,c]);}
            for(const path of guidePaths){const i=path.findIndex((v,i)=>i+1<path.length&&((v===a&&path[i+1]===b)||(v===b&&path[i+1]===a)));if(i>=0)path.splice(i+1,0,m);}
        }
        return true;
    };
    // Start at the native polygon count. Lift adds one bend on each guide,
    // rather than subdividing every long edge across the entire opening.
    if(ramp>0)for(const path of guidePaths){const segments=path.slice(1).map((v,i)=>[path[i],v]);for(const [a,b]of segments)splitEdge(a,b,true);}
    const opposite=faceId=>ordered.every(g=>dot(normals[faceId],normals[g.target.faceId])<-.25);
    const crosses=triangleIntersector(),opposing=target.mesh.faces.flatMap((face,id)=>opposite(id)&&target.mesh.alpha?.[id]!==255&&target.mesh.renderTypes?.[id]!==2?
        [face.slice(0,3).map(v=>world[v])]:[]);
    // Complexity spends at most eight additional faces per level, never a
    // blanket subdivision. Native boundaries and guide endpoints stay fixed.
    const detailBudget=refined.length+complexity*8;
    for(let pass=0;pass<complexity*4&&refined.length<detailBudget;pass++){
        const edges=new Map();for(const f of refined)for(let j=0;j<3;j++){const a=f[j],b=f[(j+1)%3];edges.set(edgeKey(a,b),{a,b,size:distance(mesh.vertices[a],mesh.vertices[b])});}
        let changed=false;
        for(const {a,b}of [...edges.values()].sort((a,b)=>b.size-a.size)){
            if(refined.length+(symmetry?4:2)>detailBudget)break;
            if(splitEdge(a,b,false,true)){changed=true;break;}
        }
        if(!changed)break;
    }
    // Spend a small budget relative to the native rim on actual crossings.
    // Both incident faces split together, preserving guide paths and the rim.
    const repaired=new Set(),faceBudget=refined.length+Math.max(8,outer.length);
    for(let pass=0;repairCrossings&&pass<8&&refined.length<faceBudget;pass++){
        const edges=new Map();
        for(const face of refined){
            if(face.some(v=>mesh.vertexLinks[v].partId===sourceId))continue;
            const points=face.map(v=>mesh.vertices[v]);if(!opposing.some(other=>crosses(points,other)))continue;
            repaired.add(face);
            for(let j=0;j<3;j++){const a=face[j],b=face[(j+1)%3];edges.set(edgeKey(a,b),{a,b,size:distance(mesh.vertices[a],mesh.vertices[b])});}
        }
        if(!edges.size)break;
        let changed=false;
        for(const {a,b}of [...edges.values()].sort((a,b)=>b.size-a.size))if(refined.length+(symmetry?4:2)<=faceBudget)changed=splitEdge(a,b)||changed;
        if(!changed)break;
    }
    for(const triangle of refined)append(triangle,materialFor(triangle));
    mesh.authoredFaces=mesh.faces.map((_,i)=>i);validateMesh(mesh);validateMesh(donor.mesh);
    const part={id:crypto.randomUUID(),name:`${source.name} to ${target.name}`,source:{...source.source},variant:variant??source.variant,visible:true,mirror:false,pair:false,parentId:null,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],pivot:[0,0,0],bindLabel:-1,bindBone:-1,role:'connection',mesh,
        connectionEdges:first.edges.map(e=>e.map(vertex=>({partId:sourceId,vertex,twin:false})))};
    const second={partId:targetId,twin:false,vertices:ordered.map(g=>g.target.vertex),edges:[],faceIds:ordered.map(g=>g.target.faceId),closed:ordered.length>2,surface:true};
    const plan={part,first,second,prepared,replacements,removed:first.removeFaces?.length??0,symmetric:!!symmetry,complexity,guides,guidePaths:guides.map(g=>guidePaths[ordered.indexOf(g)]),repairedFaces:repaired.size,triangles:mesh.faces.map(f=>f.slice(0,3).map(i=>mesh.vertices[i]))};
    assemble([...prepared,part],part.variant);
    plan.overlapFaces=assertConnectionClear(prepared,plan);
    // A native rim can already pass through a donor shell in the placed
    // assembly. Keep these boundary contacts visible for review, but reject any
    // newly authored interior that travels through the opposite-facing skin.
    if(plan.overlapFaces.some(hit=>hit.partId===targetId&&opposite(hit.faceId)&&hit.triangleIds.some(i=>
        !mesh.faces[i].slice(0,3).some(v=>mesh.vertexLinks[v].partId===sourceId)))){
        if(repairCrossings)throw new Error('This fill still crosses the target after fitting. Move a guide closer to the surface, or lower Lift.');
        else plan.blockedReason='Crossing faces remain. Enable Fit around crossings to repair them before applying.';
    }
    return plan;
}

// Cleanup is a read-only plan. Native vertex identities, rig arrays and texture
// projections stay intact; Apply uses the same replacements and undo as the join.
export function planConnectionCleanup(parts, input, {removeEnclosed=false,removeLoose=false}={}) {
    const plan={...input,part:{...input.part},prepared:(input.prepared??parts).map(p=>({...p})),replacements:new Map(input.replacements),
        first:{...input.first},second:{...input.second}},summary={enclosed:0,loose:0,protected:0,unclassified:0,removedItems:[]};
    plan.cleanup=summary;
    if(!removeEnclosed&&!removeLoose)return plan;
    const candidates=[plan.prepared.find(p=>p.id===plan.first.partId),plan.prepared.find(p=>p.id===plan.second.partId),plan.part];
    const refKey=r=>`${r.partId}/${!!r.twin}/${r.vertex}`,edgeRefKey=refs=>refs.map(refKey).sort().join('|');
    const anchors=new Set(plan.part.connectionEdges.map(edgeRefKey)),protectedEdges=new Set(anchors),removedByPart=new Map();
    for(const path of plan.guidePaths??[])for(let i=1;i<path.length;i++)protectedEdges.add(edgeRefKey([path[i-1],path[i]].map(v=>plan.part.mesh.vertexLinks[v])));
    const worldMeshes=new Map(candidates.map(p=>[p.id,{...p.mesh,vertices:p.mesh.vertices.map((v,i)=>p.mesh.vertexLinks?linkedPoint(p.mesh.vertexLinks[i],plan.prepared):worldPoint(v,p,plan.prepared))}]));
    const solids=[];
    if(removeEnclosed)for(const part of candidates.slice(0,2)){
        const found=closedOpaqueShells(worldMeshes.get(part.id));
        if(!found.length)summary.unclassified++;
        solids.push(...found.map(s=>({...s,partId:part.id})));
    }
    const crosses=triangleIntersector();
    const contained=(part,faceId)=>{
        const mesh=worldMeshes.get(part.id),points=mesh.faces[faceId].slice(0,3).map(i=>mesh.vertices[i]);
        return solids.some(s=>!(s.partId===part.id&&s.faceIds.has(faceId))&&points.every(p=>s.contains(p))&&!s.triangles.some(t=>crosses(points,t)));
    };
    const originalIds=new Map(candidates.slice(0,2).map(part=>{
        const side=[plan.first,plan.second].find(s=>s.partId===part.id),cut=new Set(side.removeFaces??[]);
        return [part.id,parts.find(p=>p.id===part.id).mesh.faces.flatMap((_,i)=>cut.has(i)?[]:[i])];
    }));
    const nativeProtected=(part,faceId)=>{
        const side=[plan.first,plan.second].find(s=>s.partId===part.id),original=originalIds.get(part.id)[faceId];
        const face=part.mesh.faces[faceId].slice(0,3);
        if(side.faceIds?.includes(original))return true;
        if((plan.guides??[]).some(g=>[g.source,g.target].some(r=>r.partId===part.id&&face.includes(r.vertex))))return true;
        return parts.some(p=>p.connectionEdges?.some(edge=>edge.every(r=>r.partId===part.id&&face.includes(r.vertex))));
    };
    const joinProtected=face=>face.slice(0,3).some((v,j)=>protectedEdges.has(edgeRefKey([v,face[(j+1)%3]].map(i=>plan.part.mesh.vertexLinks[i]))));
    const protectedJoin=new Set(plan.part.mesh.faces.flatMap((f,i)=>joinProtected(f)?[i]:[]));
    if(removeEnclosed)for(const part of candidates){
        const removed=new Set();
        for(let id=0;id<part.mesh.faces.length;id++)if(contained(part,id)){
            if(part===plan.part?protectedJoin.has(id):nativeProtected(part,id))summary.protected++;
            else removed.add(id);
        }
        // Removing a whole original part also changes its children and existing
        // connections. Leave that deliberate operation to Build.
        if(removed.size===part.mesh.faces.length){summary.protected+=removed.size;removed.clear();}
        summary.enclosed+=removed.size;removedByPart.set(part.id,removed);
    }
    const joinRemoved=removedByPart.get(plan.part.id)??new Set();
    if(removeLoose){
        const mesh=plan.part.mesh,topology=meshTopology(mesh,{coincident:false}),seen=new Set();
        for(let seed=0;seed<mesh.faces.length;seed++){
            if(joinRemoved.has(seed)||seen.has(seed))continue;
            const group=[seed];seen.add(seed);
            for(let i=0;i<group.length;i++)for(const next of topology.faceNeighbours[group[i]])if(!seen.has(next)&&!joinRemoved.has(next)){seen.add(next);group.push(next);}
            const attached=group.some(i=>mesh.faces[i].slice(0,3).some((v,j)=>anchors.has(edgeRefKey([v,mesh.faces[i][(j+1)%3]].map(k=>mesh.vertexLinks[k])))));
            if(attached)continue;
            if(group.some(i=>protectedJoin.has(i))){summary.protected+=group.length;continue;}
            for(const id of group)joinRemoved.add(id);summary.loose+=group.length;
        }
        removedByPart.set(plan.part.id,joinRemoved);
    }
    for(const part of candidates){
        const removed=removedByPart.get(part.id);if(!removed?.size)continue;
        const worldMesh=worldMeshes.get(part.id);
        summary.removedItems.push({id:`cleanup:${part.id}`,name:part.name,mesh:extract(worldMesh,removed),reference:true});
        part.mesh=removeFaces(part.mesh,removed);
        if(part===plan.part)continue;
        plan.replacements.set(part.id,part);
        const side=[plan.first,plan.second].find(s=>s.partId===part.id),cut=new Set(side.removeFaces??[]),old=parts.find(p=>p.id===part.id);
        const oldIds=old.mesh.faces.flatMap((_,i)=>cut.has(i)?[]:[i]);
        side.removeFaces=[...cut,...[...removed].map(i=>oldIds[i])];
    }
    plan.triangles=plan.part.mesh.faces.map(f=>f.slice(0,3).map(i=>plan.part.mesh.vertices[i]));
    plan.overlapFaces=assertConnectionClear(plan.prepared,plan);
    assemble([...plan.prepared,plan.part],plan.part.variant);
    return plan;
}

function closedOpaqueShells(mesh){
    const aliases=mesh.vertices.map(p=>p.map(n=>Math.round(n*1e5)).join(':')),edges=new Map(),neighbours=mesh.faces.map(()=>new Set());
    mesh.faces.forEach((f,id)=>{for(let i=0;i<3;i++){const a=aliases[f[i]],b=aliases[f[(i+1)%3]],key=a<b?`${a}/${b}`:`${b}/${a}`,rows=edges.get(key)??[];rows.push({id,a,b});edges.set(key,rows);}});
    for(const rows of edges.values())for(const a of rows)for(const b of rows)if(a.id!==b.id)neighbours[a.id].add(b.id);
    const seen=new Set(),solids=[];
    for(let seed=0;seed<mesh.faces.length;seed++){
        if(seen.has(seed))continue;
        const group=[seed];seen.add(seed);
        for(let i=0;i<group.length;i++)for(const next of neighbours[group[i]])if(!seen.has(next)){seen.add(next);group.push(next);}
        const ids=new Set(group);
        if(group.some(i=>(mesh.alpha?.[i]??0)!==0||(mesh.textures?.[i]??-1)>=0||mesh.renderTypes?.[i]===2))continue;
        if([...edges.values()].some(rows=>rows.some(r=>ids.has(r.id))&&(rows.length!==2||rows[0].a!==rows[1].b)))continue;
        const triangles=group.map(i=>mesh.faces[i].slice(0,3).map(v=>mesh.vertices[v]));
        if(Math.abs(triangles.reduce((n,[a,b,c])=>n+dot(a,cross(b,c))/6,0))<EPSILON)continue;
        const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],cache=new Map();
        for(const triangle of triangles)for(const point of triangle)for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
        const contains=point=>{
            if(cache.has(point))return cache.get(point);
            let inside=false;
            if(point.every((n,i)=>n>min[i]+.25&&n<max[i]-.25)){
                const votes=[[1,.371,.193],[-.227,1,.413],[.317,-.239,1]].map(direction=>{
                    const hits=[];
                    for(const [a,b,c]of triangles){
                        const ab=subtract(b,a),ac=subtract(c,a),h=cross(direction,ac),det=dot(ab,h);if(Math.abs(det)<EPSILON)continue;
                        const s=subtract(point,a),u=dot(s,h)/det,q=cross(s,ab),v=dot(direction,q)/det,t=dot(ac,q)/det;
                        if(u>=-EPSILON&&v>=-EPSILON&&u+v<=1+EPSILON&&t>EPSILON)hits.push(t);
                    }
                    hits.sort((a,b)=>a-b);return hits.filter((n,i)=>!i||n-hits[i-1]>1e-5).length%2;
                });
                inside=votes.every(Boolean);
            }
            cache.set(point,inside);return inside;
        };
        solids.push({faceIds:ids,triangles,contains});
    }
    return solids;
}

// Insert a single landing point into the native cap, then constrain its route
// from the chosen rim corner. Concave rims need a triangulated cap, not a fan
// through every edge. No automatic extra guide or arbitrary surface ID is used.
function triangulateSingleGuide(outer,point,source,vertices,normal,symmetry){
    const area=(a,b,c)=>dot(cross(subtract(vertices[b],vertices[a]),subtract(vertices[c],vertices[a])),normal);
    const failure=()=>new Error('This guide lands outside the opening\'s route. Move its landing closer, or add another guide to steer around the bend.');
    if(symmetry&&Math.abs(symmetry.signed(vertices[source]))<symmetry.tolerance&&Math.abs(symmetry.signed(vertices[point]))<symmetry.tolerance&&
        outer.every((v,i)=>symmetry.signed(vertices[v])*symmetry.signed(vertices[outer[(i+1)%outer.length]])>=-EPSILON)){
        try{
            const axis=unit(cross(normal,symmetry.normal)),at=v=>dot(vertices[v],axis),onAxis=v=>Math.abs(symmetry.signed(vertices[v]))<symmetry.tolerance;
            const halves=[-1,1].flatMap(sign=>{
                const half=outer.filter(v=>symmetry.signed(vertices[v])*sign>=-symmetry.tolerance);
                // A native center seam may have a small one-sided spur. Keep
                // its original edge on that side without doubling it on both.
                for(let changed=true;changed;){changed=false;
                    for(let i=0;i<half.length;i++){
                        const a=half[(i+half.length-1)%half.length],b=half[i],c=half[(i+1)%half.length];
                        if([a,b,c].every(onAxis)&&(at(b)-at(a))*(at(b)-at(c))>EPSILON){half.splice(i,1);changed=true;break;}
                    }
                }
                const seam=half.findIndex((a,i)=>{const b=half[(i+1)%half.length];return onAxis(a)&&onAxis(b)&&
                    (at(point)-at(a))*(at(point)-at(b))<-EPSILON&&!outer.some((v,j)=>v===a&&outer[(j+1)%outer.length]===b);});
                if(seam<0)throw failure();half.splice(seam+1,0,point);
                return triangulateGuidePolygon(half,vertices,normal,symmetry);
            });
            if(!outer.every((a,i)=>halves.some(f=>f.includes(a)&&f.includes(outer[(i+1)%outer.length]))))throw failure();
            const path=[source,...[...new Set(halves.flat())].filter(v=>v!==source&&v!==point&&onAxis(v)&&(at(v)-at(source))*(at(v)-at(point))<-EPSILON).sort((a,b)=>(at(a)-at(b))*Math.sign(at(point)-at(source))),point];
            if(path.slice(1).some((v,i)=>!halves.some(f=>f.includes(v)&&f.includes(path[i]))))throw failure();
            return {triangles:halves,path};
        }catch{}
    }
    const fan=outer.map((a,i)=>[a,outer[(i+1)%outer.length],point]);
    if(fan.every(f=>area(...f)>EPSILON))return {triangles:fan,path:[source,point]};
    let triangles=triangulateGuidePolygon(outer,vertices,normal,symmetry);
    const inside=triangles.findIndex(f=>f.every((a,i)=>area(a,f[(i+1)%3],point)>=-EPSILON));
    if(inside<0)throw failure();
    const face=triangles[inside],edge=face.findIndex((a,i)=>Math.abs(area(a,face[(i+1)%3],point))<EPSILON);
    if(edge>=0){
        const a=face[edge],b=face[(edge+1)%3],affected=triangles.filter(f=>f.includes(a)&&f.includes(b));
        triangles=triangles.filter(f=>!affected.includes(f));
        for(const f of affected){const j=f.findIndex((v,i)=>(v===a&&f[(i+1)%3]===b)||(v===b&&f[(i+1)%3]===a));
            triangles.push([f[j],point,f[(j+2)%3]],[point,f[(j+1)%3],f[(j+2)%3]]);}
    }else triangles.splice(inside,1,...face.map((a,i)=>[a,face[(i+1)%3],point]));
    // A concave rim can put the straight guide outside the cap. Follow existing
    // cap edges around that notch instead of adding faces across empty space.
    const routed=()=>{
        const neighbours=new Map();
        for(const f of triangles)for(let i=0;i<3;i++){
            const a=f[i],b=f[(i+1)%3];if(!neighbours.has(a))neighbours.set(a,new Set());if(!neighbours.has(b))neighbours.set(b,new Set());neighbours.get(a).add(b);neighbours.get(b).add(a);
        }
        const cost=new Map([[source,0]]),previous=new Map(),pending=new Set([source]);
        while(pending.size){
            let v;for(const i of pending)if(v===undefined||cost.get(i)<cost.get(v))v=i;
            pending.delete(v);if(v===point)break;
            for(const next of neighbours.get(v)??[]){const n=cost.get(v)+distance(vertices[v],vertices[next]);if(n<(cost.get(next)??Infinity)){cost.set(next,n);previous.set(next,v);pending.add(next);}}
        }
        if(!cost.has(point))throw failure();
        const path=[point];while(path[0]!==source)path.unshift(previous.get(path[0]));return {triangles,path};
    };
    const a=vertices[source],b=vertices[point],offset=subtract(b,a),direction=offset.map((n,i)=>n-normal[i]*dot(offset,normal)),den=dot(direction,direction);
    const parameter=v=>dot(subtract(vertices[v],a),direction)/den;
    const path=[source,...[...new Set(triangles.flat())].filter(v=>v!==source&&v!==point&&Math.abs(area(source,point,v))<EPSILON&&parameter(v)>EPSILON&&parameter(v)<1-EPSILON).sort((a,b)=>parameter(a)-parameter(b)),point];
    for(let segment=1;segment<path.length;segment++){
        const start=path[segment-1],end=path[segment];
        if(triangles.some(f=>f.includes(start)&&f.includes(end)))continue;
        const cavity=new Set();
        for(const f of triangles){
            let low=0,high=1;
            for(let i=0;i<3;i++){
                const u=area(f[i],f[(i+1)%3],start),v=area(f[i],f[(i+1)%3],end),change=v-u;
                if(Math.abs(change)<EPSILON){if(u<-EPSILON){high=-1;break;}continue;}
                const t=-u/change;if(change>0)low=Math.max(low,t);else high=Math.min(high,t);
            }
            if(high-low>EPSILON){
                const t=(low+high)/2;
                if(f.every((a,i)=>area(a,f[(i+1)%3],start)*(1-t)+area(a,f[(i+1)%3],end)*t>EPSILON))cavity.add(f);
            }
        }
        const edges=new Map();
        for(const f of cavity)for(let i=0;i<3;i++){
            const a=f[i],b=f[(i+1)%3],key=edgeKey(a,b);if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);
        }
        const outgoing=new Map();for(const [a,b]of edges.values()){if(outgoing.has(a))return routed();outgoing.set(a,b);}
        const ring=[start];let next=outgoing.get(start);
        while(next!==start&&next!==undefined&&ring.length<=edges.size){if(ring.includes(next))return routed();ring.push(next);next=outgoing.get(next);}
        const cut=ring.indexOf(end);
        if(next!==start||ring.length!==edges.size||cut<1)return routed();
        const pieces=[ring.slice(0,cut+1),[...ring.slice(cut),start]],replacement=pieces.flatMap(row=>triangulateGuidePolygon(row,vertices,normal,symmetry));
        triangles=triangles.filter(f=>!cavity.has(f)).concat(replacement);
    }
    return {triangles,path};
}

// Prefer mirrored ears together. A left-to-right ear walk gives different
// diagonals to the two sides of the same concave opening.
function triangulateGuidePolygon(indices,vertices,normal,symmetry){
    const result=[],ring=[...indices],cross2=(a,b,c)=>dot(cross(subtract(vertices[b],vertices[a]),subtract(vertices[c],vertices[a])),normal);
    if(ring.reduce((sum,b,i)=>sum+dot(cross(vertices[b],vertices[ring[(i+1)%ring.length]]),normal),0)<0)throw new Error('The target guides cross or reverse sides. Move a lettered point to match the opening.');
    const earAt=i=>{
        const f=[ring[(i+ring.length-1)%ring.length],ring[i],ring[(i+1)%ring.length]];
        if(cross2(...f)<=EPSILON||ring.some(v=>!f.includes(v)&&f.every((a,j)=>cross2(a,f[(j+1)%3],v)>=-EPSILON)))return null;
        return f;
    };
    while(ring.length>3){
        let ears=ring.flatMap((_,i)=>{const f=earAt(i);return f?[{i,f}]:[];});
        if(symmetry){
            const mirror=v=>symmetry.match(vertices[v],ring,vertices);
            for(const ear of ears){
                const reflected=ear.f.map(mirror);
                ear.pair=ears.find(other=>other!==ear&&other.f.every(v=>reflected.includes(v))&&other.f[1]!==ear.f[1]);
                ear.center=reflected.every(v=>ear.f.includes(v));
                // Geometry-based ties are unchanged by reflection or ring start.
                ear.score=cross2(...ear.f)/ear.f.reduce((n,v,j)=>n+distance(vertices[v],vertices[ear.f[(j+1)%3]])**2,0);
                ear.key=symmetry.key(vertices[ear.f[1]]);
            }
            ears.sort((a,b)=>Number(!!b.pair)*2+Number(b.center)-Number(!!a.pair)*2-Number(a.center)||b.score-a.score||a.key.localeCompare(b.key));
        }
        const ear=ears[0];if(!ear)throw new Error('The target guides overlap or become too thin. Spread the points around the intended landing.');
        result.push(ear.f);ring.splice(ear.i,1);
        if(symmetry&&ear.pair&&ring.length>3){
            const i=ring.indexOf(ear.pair.f[1]),paired=earAt(i);
            if(paired){result.push(paired);ring.splice(i,1);}
        }
    }
    if(cross2(...ring)<=EPSILON)throw new Error('A guide runs along a fold in the opening. Move that point slightly around the rim.');
    result.push(ring);return result;
}

// Use the piece's transformed native left/right plane. Symmetry is automatic
// only for a matching rim, matching target skin and centered or paired guides.
// No native corner, intentional asymmetry or authored guide is moved.
function connectionSymmetry(parts,source,rim,guides,targetWorld){
    const pivot=source.pivot??[0,0,0],origin=worldPoint(pivot,source,parts),basis=[0,1,2].map(a=>unit(subtract(worldPoint(pivot.map((n,i)=>n+(i===a?1:0)),source,parts),origin)));
    const normal=unit(cross(basis[1],basis[2]));if(Math.abs(dot(normal,basis[0]))<.9999)return null;
    const signed=p=>dot(subtract(p,origin),normal),reflect=p=>p.map((n,i)=>n-2*signed(p)*normal[i]);
    const radius=Math.max(...rim.map(p=>distance(p,origin))),tolerance=Math.max(.01,radius*.002),close=(a,b)=>distance(a,b)<tolerance;
    const paired=(points,ratio)=>points.filter(p=>points.some(q=>close(q,reflect(p)))).length>=points.length*ratio;
    if(!paired(rim,.8))return null;
    for(const g of guides){
        const a=linkedPoint(g.source,parts),b=linkedPoint(g.target,parts);
        if(!guides.some(h=>close(linkedPoint(h.source,parts),reflect(a))&&close(linkedPoint(h.target,parts),reflect(b))))return null;
    }
    const nearby=targetWorld.filter(p=>guides.some(g=>distance(p,linkedPoint(g.target,parts))<radius));
    if(!nearby.length||nearby.filter(p=>targetWorld.some(q=>close(q,reflect(p)))).length<nearby.length*.8)return null;
    return {normal,reflect,signed,tolerance,
        match:(p,indices,vertices)=>indices.find(i=>close(vertices[i],reflect(p))),
        key:p=>[Math.abs(signed(p)),...basis.slice(1).map(axis=>dot(subtract(p,origin),axis))].map(n=>n.toFixed(5)).join('/')};
}

// Closest point rather than a face's centroid: large triangles remain useful
// targets and do not steal the join from a much closer part of the surface.
function closestTrianglePoint(p,a,b,c) {
    const ab=subtract(b,a),ac=subtract(c,a),ap=subtract(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
    if(d1<=0&&d2<=0)return a;
    const bp=subtract(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return b;
    const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return a.map((n,i)=>n+ab[i]*d1/(d1-d3));
    const cp=subtract(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return c;
    const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return a.map((n,i)=>n+ac[i]*d2/(d2-d6));
    const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return b.map((n,i)=>n+(c[i]-n)*(d4-d3)/(d4-d3+d5-d6));
    const den=va+vb+vc;if(Math.abs(den)<EPSILON)return a;
    return a.map((n,i)=>n+ab[i]*vb/den+ac[i]*vc/den);
}

function surfacePatch(parts, part, seed, radius) {
    const mesh=part.mesh,topology=meshTopology(mesh,{coincident:false}),world=mesh.vertices.map(v=>worldPoint(v,part,parts));
    const normal=unit(faceNormal(mesh,seed.faceId,world)),removed=new Set([seed.faceId]),queue=[seed.faceId];
    for(let i=0;i<queue.length;i++)for(const id of topology.faceNeighbours[queue[i]]) {
        if(removed.has(id) || mesh.alpha?.[id]===255 || mesh.renderTypes?.[id]===2 || dot(normal,unit(faceNormal(mesh,id,world)))<.05)continue;
        const center=centroid(mesh.faces[id].slice(0,3).map(v=>world[v]));
        if(distance(center,seed.point)>radius)continue;
        removed.add(id);queue.push(id);
    }
    const cut=deleteFaces(mesh,removed),prepared=parts.map(p=>p.id===part.id?{...p,mesh:cut}:p);
    // Accept one cut rim. Disconnected native shells and existing holes stay
    // untouched; a cut which wraps around one is rejected instead of guessed.
    let loops=connectionOpenings(prepared,part.id).filter(s=>s.edges.some(([a,b])=>!boundaries(mesh).some(e=>e.a===a&&e.b===b)));
    loops.sort((a,b)=>sideArea(prepared,b)-sideArea(prepared,a));
    const side=loops[0];
    if(!side || side.edges.some(([a,b])=>boundaries(mesh).some(e=>e.a===a&&e.b===b)))throw new Error('That area reaches another opening. Reduce Coverage, or choose a clearer area in Advanced.');
    if(loops.length!==1)throw new Error('That area wraps around another opening. Reduce Coverage, or choose a clearer area in Advanced.');
    const final=side;
    // Face IDs always refer to the uncut donor until planSurfaceConnection.
    final.faceIds=final.faceIds.map(i=>mesh.faces.flatMap((_,i)=>removed.has(i)?[]:[i])[i]);
    final.removeFaces=[...removed];final.surfaceFaces=[...removed];return final;
}

function nearestSurface(parts, part, point, preferredNormal = null) {
    const vertices=part.mesh.vertices.map(v=>worldPoint(v,part,parts));
    return part.mesh.faces.flatMap((f,faceId)=>{
        if(part.mesh.alpha?.[faceId]===255||part.mesh.renderTypes?.[faceId]===2)return [];
        const normal=unit(faceNormal(part.mesh,faceId,vertices)),target=closestTrianglePoint(point,...f.slice(0,3).map(i=>vertices[i]));
        const score=distance(point,target)+(preferredNormal?Math.max(0,dot(normal,preferredNormal)) * 80:0);
        return [{faceId,point:target,score}];
    }).sort((a,b)=>a.score-b.score);
}

// Walk only the target's connected native shell. Travel is measured in world
// units, so rotating/scaling an assembly cannot turn "farther along" into a
// jump to a nearby tail, another shell, or a face on the other side of a gap.
function landingSurface(parts, target, first, second, amount) {
    const mesh=target.mesh,world=mesh.vertices.map(v=>worldPoint(v,target,parts)),topology=meshTopology(mesh,{coincident:false});
    const centers=mesh.faces.map(f=>centroid(f.slice(0,3).map(v=>world[v]))),normals=mesh.faces.map((_,i)=>unit(faceNormal(mesh,i,world)));
    const origin=centroid(sidePoints(parts,first)),direction=unit(subtract(centroid(world),origin)),radius=sideRadius(parts,first);
    const start=[...(second.surfaceFaces??second.removeFaces??[]),...second.faceIds].sort((a,b)=>distance(centers[a],origin)-distance(centers[b],origin))[0];
    const limit=Math.max(3,radius*2.5),cost=new Map([[start,0]]),pending=new Set([start]);
    while(pending.size){
        let id;for(const next of pending)if(id===undefined||cost.get(next)<cost.get(id))id=next;
        pending.delete(id);
        for(const next of topology.faceNeighbours[id]){
            if(mesh.alpha?.[next]===255||mesh.renderTypes?.[next]===2||dot(normals[id],normals[next])<-.25)continue;
            const travel=cost.get(id)+distance(centers[id],centers[next]);
            if(travel>limit||travel>=(cost.get(next)??Infinity))continue;
            cost.set(next,travel);pending.add(next);
        }
    }
    let end=start,best=0;
    for(const [id,travel]of cost){
        const offset=subtract(centers[id],centers[start]),forward=dot(offset,direction);
        const sideways=length(subtract(offset,direction.map(n=>n*forward))),score=forward-sideways*.35-travel*.1;
        if(score>best){best=score;end=id;}
    }
    if(end===start||best<Math.max(1,radius*.05))throw new Error('There is no clear connected surface farther along this piece. Choose another target area in Advanced modelling.');
    const maximum=dot(subtract(centers[end],centers[start]),direction),travel=maximum*Math.max(0,Math.min(100,amount))/100;
    const seeds=[...cost.keys()].flatMap(faceId=>{
        const offset=subtract(centers[faceId],centers[start]),forward=dot(offset,direction);
        if(forward<0||Math.abs(forward-travel)>Math.max(5,radius*.2))return [];
        const sideways=length(subtract(offset,direction.map(n=>n*forward)));
        const facing=(1+dot(normals[faceId],first.normal))*radius*.7;
        return [{faceId,point:centers[faceId],score:Math.abs(forward-travel)*3+sideways*.35+facing}];
    }).sort((a,b)=>a.score-b.score).slice(0,16);
    return {seeds,distance:travel,maxDistance:maximum};
}

/** Plan a join between placed pieces. Original placement and vertices are fixed.
 * Coverage sizes the target cut; shape controls only authored interior rings.
 * No caller needs to understand or supply vertex/edge IDs. */
export function planPlacedConnection(parts, sourceId, targetId, { variant, coverage = 100, ramp = 0, bend = 0, recess = 0, landing = 0, complexity = 0, sourceHit = null, targetHit = null } = {}) {
    const source=parts.find(p=>p.id===sourceId),target=parts.find(p=>p.id===targetId);
    if(!source||!target||source===target||source.mesh.vertexLinks||target.mesh.vertexLinks)throw new Error('Choose two different original pieces.');
    if(source.visible===false||target.visible===false)throw new Error('Show both pieces before connecting them.');
    if(parts.some(p=>p.mesh.vertexLinks?.some(r=>r.partId===sourceId)&&p.mesh.vertexLinks.some(r=>r.partId===targetId)))throw new Error('These pieces are already connected. Undo to adjust this join, or remove the connection in Build.');
    const paired=part=>{let ancestor=part;while(ancestor){if(ancestor.pair)return true;ancestor=parts.find(p=>p.id===ancestor.parentId);}return false;};
    if(paired(source)||paired(target)||sourceHit?.twin||targetHit?.twin)throw new Error('Turn off "Mirror to other side" in Build before adding connection faces. Connect each side separately.');
    for(const n of [coverage,ramp,bend,recess,landing,complexity])if(!Number.isFinite(n))throw new Error('Choose a valid connection shape.');
    complexity=Math.max(0,Math.min(3,Math.round(complexity)));
    const targetCenter=centroid(target.mesh.vertices.map(v=>worldPoint(v,target,parts)));
    const openings=connectionOpenings(parts,sourceId).filter(s=>sideArea(parts,s)>1);
    openings.sort((a,b)=>{
        if(sourceHit)return distance(centroid(sidePoints(parts,a)),sourceHit.point)-distance(centroid(sidePoints(parts,b)),sourceHit.point);
        return sideArea(parts,b)/(1+distance(centroid(sidePoints(parts,b)),targetCenter)*.001)-sideArea(parts,a)/(1+distance(centroid(sidePoints(parts,a)),targetCenter)*.001);
    });
    let first=openings[0];
    if(!first){
        const points=source.mesh.vertices.map(v=>worldPoint(v,source,parts)),center=centroid(points);
        const seed=sourceHit?{faceId:sourceHit.sourceFaceId??sourceHit.faceId,point:sourceHit.point}:nearestSurface(parts,source,targetCenter)[0];
        const radius=Math.max(3,Math.sqrt(points.reduce((n,p)=>n+distance(p,center)**2,0)/points.length)*.35);
        first=surfacePatch(parts,source,seed,radius);
    }
    const origin=centroid(sidePoints(parts,first)),radius=sideRadius(parts,first)*Math.max(.35,Math.min(1.8,coverage/100));
    const candidates=targetHit?[{faceId:targetHit.sourceFaceId??targetHit.faceId,point:targetHit.point}]:nearestSurface(parts,target,origin,first.normal).slice(0,16);
    let plan,chosenTarget,failure;
    const existing=connectionOpenings(parts,targetId).filter(s=>sideArea(parts,s)>sideArea(parts,first)*.15)
        .sort((a,b)=>distance(centroid(sidePoints(parts,a)),origin)-distance(centroid(sidePoints(parts,b)),origin));
    for(const second of existing){
        try{plan=planSurfaceConnection(parts,first,second,{variant,placement:'keep'});chosenTarget=second;break;}catch(error){failure=error;}
    }
    if(!plan)for(const seed of candidates){
        try{
            const second=surfacePatch(parts,target,seed,Math.max(3,radius));
            plan=planSurfaceConnection(parts,first,second,{variant,placement:'keep'});chosenTarget=second;break;
        }catch(error){failure=error;}
    }
    if(!plan)throw new Error(`Cannot fill this join safely. ${failure?.message??'Choose another target area in Advanced.'}`);
    const shapePlan=(candidate,second)=>{
        if(coverage!==100||ramp||bend||recess){
            shapePlacedConnection(candidate.prepared,candidate,candidate.replacements,{coverage,ramp,bend,recess});
            candidate.overlapFaces=assertConnectionClear(candidate.prepared,candidate).map(hit=>{
                const side=hit.partId===first.partId?first:second,removed=new Set(side.removeFaces??[]);
                const kept=parts.find(p=>p.id===hit.partId).mesh.faces.flatMap((_,i)=>removed.has(i)?[]:[i]);
                return {...hit,faceId:kept[hit.faceId]};
            });
        }
        return candidate;
    };
    if(landing>0){
        try{
            const travel=landingSurface(parts,target,first,chosenTarget,landing);
            let moved,lastFailure,attempts=0;const tried=new Set();
            // A neck can narrow or expose native seams farther down. Keep one
            // disk-shaped opening rather than wrapping around the whole neck.
            find:for(const seed of travel.seeds)for(const size of [.5,.25,.15,.08,0])try{
                const second=surfacePatch(parts,target,seed,radius*size);
                if(second.vertices.length>48)continue;
                const key=[...second.removeFaces].sort((a,b)=>a-b).join(',');if(tried.has(key))continue;tried.add(key);
                const count=second.vertices.length,twists=new Set([0,1,count-1,Math.floor(count/2),2,count-2]);
                for(const twist of twists)try{
                    if(++attempts>24)break find;
                    moved=shapePlan(planSurfaceConnection(parts,first,second,{variant,placement:'keep',twist,correspondence:'perimeter'}),second);
                    break;
                }catch(error){lastFailure=error;}
                if(moved){chosenTarget=second;break find;}
            }catch(error){lastFailure=error;}
            if(!moved)throw lastFailure??new Error('No continuous facing area fits this landing.');
            plan=moved;
            plan.landing={distance:travel.distance,maxDistance:travel.maxDistance};
        }catch(error){throw new Error(`Cannot land farther along here. ${error.message} Reduce Landing distance or Coverage, or choose a target area in Advanced modelling.`,{cause:error});}
    }
    else try{shapePlan(plan,chosenTarget);}
    catch(error){throw new Error('This shape folds or becomes too thin. Reduce Ramp, Bend or Recess, or bring Coverage closer to 100.',{cause:error});}
    // Hover/highlight IDs refer to the original donor, just like removeFaces.
    plan.first=first;plan.second=chosenTarget;plan.complexity=complexity;
    if(complexity){
        addPlacedConnectionDetail(plan,complexity);
        plan.overlapFaces=assertConnectionClear(plan.prepared,plan).map(hit=>{
            const side=hit.partId===first.partId?first:chosenTarget,removed=new Set(side.removeFaces??[]);
            const kept=parts.find(p=>p.id===hit.partId).mesh.faces.flatMap((_,i)=>removed.has(i)?[]:[i]);
            return {...hit,faceId:kept[hit.faceId]};
        });
    }
    plan.part.name=`${source.name} to ${target.name}`;return plan;
}

// Extra detail keeps every attachment edge and native projection unchanged.
// A fixed budget controls face count even for unequal native boundary loops.
function addPlacedConnectionDetail(plan,complexity){
    const mesh=plan.part.mesh,cloned=new Set(),budget=mesh.faces.length+complexity*8;
    for(let pass=0;pass<complexity*4&&mesh.faces.length+2<=budget;pass++){
        const rows=mesh.faces.map((f,id)=>({f,id,area:length(faceNormal(mesh,id))})).sort((a,b)=>b.area-a.area);
        let changed=false;
        for(const {f,id}of rows){
            const point=centroid(f.slice(0,3).map(i=>mesh.vertices[i])),rounded=point.map(Math.round);
            if(f.slice(0,3).some((v,i)=>length(cross(subtract(mesh.vertices[v].map(Math.round),rounded),subtract(mesh.vertices[f[(i+1)%3]].map(Math.round),rounded)))<EPSILON))continue;
            const i=f.slice(0,3).sort((a,b)=>distance(point,mesh.vertices[a])-distance(point,mesh.vertices[b]))[0],ref=mesh.vertexLinks[i],part=plan.prepared.find(p=>p.id===ref.partId);
            if(!cloned.has(part.id)){part.mesh=structuredClone(part.mesh);plan.replacements.set(part.id,part);cloned.add(part.id);}
            const donor=part.mesh,vertex=donor.vertices.length;
            donor.sourceVertices??=donor.vertices.map((_,i)=>i);donor.vertices.push(localPoint(point,part,plan.prepared));donor.sourceVertices.push(donor.sourceVertices[ref.vertex]);
            for(const key of ['skins','bones','weights'])if(donor[key])donor[key].push(structuredClone(donor[key][ref.vertex]));
            const m=mesh.vertices.length;mesh.vertices.push(point);mesh.vertexLinks.push({...ref,vertex});
            const pieces=f.slice(0,3).map((v,j)=>[v,f[(j+1)%3],m,f[3]]);mesh.faces.splice(id,1,...pieces);
            for(const key of Object.keys(FACE_CHANNELS))if(mesh[key])mesh[key].splice(id,1,...pieces.map(()=>mesh[key][id]));
            changed=true;break;
        }
        if(!changed)break;
    }
    mesh.authoredFaces=mesh.faces.map((_,i)=>i);validateMesh(mesh);
    plan.triangles=mesh.faces.map(f=>f.slice(0,3).map(i=>mesh.vertices[i]));assemble([...plan.prepared,plan.part],plan.part.variant);
}

function shapePlacedConnection(parts, plan, replacements, {coverage,ramp,bend,recess}) {
    const mesh=plan.part.mesh,faces=mesh.faces,channels=Object.fromEntries(Object.keys(FACE_CHANNELS).map(k=>[k,mesh[k]])),refs=mesh.vertexLinks;
    const sourceId=plan.first.partId,origin=centroid(sidePoints(parts,plan.first)),end=centroid(sidePoints(parts,plan.second));
    const direction=unit(subtract(end,origin)),normal=plan.first.normal??openingNormal(parts,plan.first),targetNormal=plan.second.normal??openingNormal(parts,plan.second);
    let lateral=unit(subtract(normal,direction.map(n=>n*dot(normal,direction))));
    if(length(lateral)<.1)lateral=unit(cross(direction,Math.abs(direction[1])<.8?[0,1,0]:[1,0,0]));
    const radius=sideRadius(parts,plan.first),points=new Map(),cloned=new Set(),levels=[0,.5,1];
    mesh.faces=[];for(const k of Object.keys(FACE_CHANNELS))mesh[k]=[];
    const include=(i,j,t)=>{
        if(t===0)return i;if(t===1)return j;
        if(refs[i].partId!==sourceId){[i,j]=[j,i];t=1-t;}
        const key=`${i}/${j}/${t}`;if(points.has(key))return points.get(key);
        const a=mesh.vertices[i],b=mesh.vertices[j],span=distance(a,b),arch=4*t*(1-t);
        const point=a.map((n,axis)=>n+(b[axis]-n)*t+
            (n+(b[axis]-n)*t-origin[axis]-(end[axis]-origin[axis])*t)*arch*(coverage-100)*.005+
            (normal[axis]*(1-t)+targetNormal[axis]*t)*span*arch*ramp*.0025+
            lateral[axis]*radius*arch*bend*.005-normal[axis]*radius*arch*(1-t)*recess*.0075);
        const ref=refs[t<.5?i:j],part=parts.find(p=>p.id===ref.partId);
        if(!cloned.has(part.id)){part.mesh=structuredClone(part.mesh);replacements.set(part.id,part);cloned.add(part.id);}
        const donor=part.mesh,parent=parts.find(p=>p.id===part.parentId),vertex=donor.vertices.length;
        donor.sourceVertices??=donor.vertices.map((_,i)=>i);
        donor.vertices.push(localPoint(ref.twin?reflectPoint(point,parent,parts):point,part,parts));donor.sourceVertices.push(donor.sourceVertices[ref.vertex]);
        for(const k of ['skins','bones','weights'])if(donor[k])donor[k].push(structuredClone(donor[k][ref.vertex]));
        const index=refs.length;refs.push({...ref,vertex});mesh.vertices.push(point);points.set(key,index);return index;
    };
    // Clip each original triangle into strips in attachment-distance space.
    // Shared cross-edges use the same vertices; there are no floating rows or
    // nonuniform-loop guesses. Each strip inherits its native face projection.
    faces.forEach((face,faceId)=>{
        const original=face.slice(0,3).map(i=>({i,t:refs[i].partId===sourceId?0:1}));
        const clip=(polygon,level,above)=>{
            const out=[];
            for(let i=0;i<polygon.length;i++){
                const a=polygon[i],b=polygon[(i+1)%polygon.length],inside=p=>above?p.t>=level:p.t<=level;
                if(inside(a))out.push(a);
                if(inside(a)!==inside(b)){
                    // Intersections are always on one original cross-edge.
                    let edge;
                    for(let j=0;j<3;j++){
                        const x=original[j],y=original[(j+1)%3];if(x.t===y.t)continue;
                        const at=p=>p.i===x.i||p.i===y.i||points.get(`${x.t===0?x.i:y.i}/${x.t===0?y.i:x.i}/${p.t}`)===p.i;
                        if(at(a)&&at(b)){edge=[x,y];break;}
                    }
                    if(!edge)throw new Error('Cannot subdivide this connection. Choose a different area.');
                    const [x,y]=edge;out.push({i:include(x.i,y.i,(level-x.t)/(y.t-x.t)),t:level});
                }
            }return out.filter((p,i)=>p.i!==out[(i+out.length-1)%out.length]?.i);
        };
        for(let n=0;n<levels.length-1;n++){
            const polygon=clip(clip(original,levels[n],true),levels[n+1],false);
            for(let j=1;j<polygon.length-1;j++){
                mesh.faces.push([polygon[0].i,polygon[j].i,polygon[j+1].i,face[3]]);
                for(const k of Object.keys(FACE_CHANNELS))mesh[k].push(channels[k][faceId]);
            }
        }
    });
    mesh.authoredFaces=mesh.faces.map((_,i)=>i);validateMesh(mesh);
    for(const id of cloned)validateMesh(parts.find(p=>p.id===id).mesh);
    plan.triangles=mesh.faces.map(f=>f.slice(0,3).map(i=>mesh.vertices[i]));assemble([...parts,plan.part],plan.part.variant);
}

function addConnectionCollars(parts,plan,replacements){
    const mesh=plan.part.mesh,originalRefs=structuredClone(mesh.vertexLinks),key=r=>`${r.partId}/${r.twin}/${r.vertex}`;
    const include=ref=>{let i=mesh.vertexLinks.findIndex(r=>key(r)===key(ref));if(i<0){i=mesh.vertexLinks.length;mesh.vertexLinks.push({...ref});mesh.vertices.push(linkedPoint(ref,parts));}return i;};
    const center=side=>side.vertices.map(vertex=>linkedPoint({partId:side.partId,vertex,twin:side.twin},parts)).reduce((sum,p)=>sum.map((n,i)=>n+p[i]/side.vertices.length),[0,0,0]);
    const spacing=distance(center(plan.first),center(plan.second)),collars=new Map();
    // Add a short straight collar at each opening before the unequal-width loft.
    // Collar points retain their native source vertex and weights. Native motion
    // adds the same donor deformation to their authored offset, including gear.
    for(const side of [plan.first,plan.second]){
        const part=parts.find(p=>p.id===side.partId);part.mesh=structuredClone(part.mesh);replacements.set(part.id,part);
        const donor=part.mesh,normal=unit(subtract(center(side===plan.first?plan.second:plan.first),center(side))),parent=parts.find(p=>p.id===part.parentId);
        const depth=spacing*.3,oldCount=donor.vertices.length;
        donor.sourceVertices??=donor.vertices.map((_,i)=>i);
        for(const vertex of side.vertices){
            const world=linkedPoint({partId:part.id,vertex,twin:side.twin},parts).map((n,i)=>n+normal[i]*depth);
            const local=localPoint(side.twin?reflectPoint(world,parent,parts):world,part,parts),index=donor.vertices.length;
            donor.vertices.push(local);donor.sourceVertices.push(donor.sourceVertices[vertex]);
            for(const channel of ['skins','bones','weights'])if(donor[channel])donor[channel].push(structuredClone(donor[channel][vertex]));
            collars.set(key({partId:part.id,vertex,twin:side.twin}),{partId:part.id,vertex:index,twin:side.twin});
        }
        if(donor.vertices.length===oldCount)throw new Error('Choose a continuous opening.');
        validateMesh(donor);
    }
    // Projection vertices stay at the original donor locations, even when they
    // were also rim vertices. Moving a rim must not flatten or slide a texture.
    const oldMappings=structuredClone(mesh.textureMappings??[]);
    mesh.vertexLinks=mesh.vertexLinks.map(ref=>collars.get(key(ref))??ref);
    mesh.vertices=mesh.vertexLinks.map(ref=>linkedPoint(ref,parts));
    mesh.textureMappings=oldMappings.map(mapping=>mapping.map(i=>include(originalRefs[i])));
    const originalFaces=structuredClone(mesh.faces);
    const append=(triangle,side,faceId)=>{
        const source=parts.find(p=>p.id===side.partId).mesh,index=mesh.faces.length;
        mesh.faces.push([...triangle,source.faces[faceId][3]]);
        for(const [channel,fallback] of Object.entries(FACE_CHANNELS))mesh[channel].push(source[channel]?.[faceId]??fallback);
        if((source.textures?.[faceId]??-1)>=0){
            const coord=source.textureCoords?.[faceId]??-1,vertices=coord>=0?source.textureMappings[coord]:source.faces[faceId].slice(0,3);
            mesh.textureCoords[index]=mesh.textureMappings.length;
            mesh.textureMappings.push(vertices.map(vertex=>include({partId:side.partId,vertex,twin:side.twin})));
        }
    };
    for(const side of [plan.first,plan.second])for(let e=0;e<side.edges.length;e++){
        const [va,vb]=side.edges[e],refA={partId:side.partId,vertex:va,twin:side.twin},refB={partId:side.partId,vertex:vb,twin:side.twin};
        let a=originalRefs.findIndex(r=>key(r)===key(refA)),b=originalRefs.findIndex(r=>key(r)===key(refB));
        if(!originalFaces.some(f=>f.slice(0,3).some((v,i)=>v===a&&f[(i+1)%3]===b)))[a,b]=[b,a];
        const originalA=include(originalRefs[a]),originalB=include(originalRefs[b]);
        append([originalA,originalB,b],side,side.faceIds[e]);append([originalA,b,a],side,side.faceIds[e]);
    }
    mesh.authoredFaces=mesh.faces.map((_,i)=>i);validateMesh(mesh);
    plan.triangles=mesh.faces.map(f=>f.slice(0,3).map(i=>mesh.vertices[i]));assemble([...parts,plan.part],plan.part.variant);
}

function triangleIntersector(){
    const bounds=new WeakMap(),box=triangle=>{
        if(!bounds.has(triangle))bounds.set(triangle,[0,1,2].map(a=>[Math.min(...triangle.map(p=>p[a])),Math.max(...triangle.map(p=>p[a]))]));
        return bounds.get(triangle);
    };
    const overlaps=(a,b)=>{const x=box(a),y=box(b);return [0,1,2].every(i=>x[i][0]<=y[i][1]+EPSILON&&y[i][0]<=x[i][1]+EPSILON);};
    const pierces=(a,b,c,d,e)=>{
        const direction=subtract(b,a),edge1=subtract(d,c),edge2=subtract(e,c),h=cross(direction,edge2),det=dot(edge1,h);
        // Collinear shared edges stay parallel after arbitrary parent transforms.
        // An absolute determinant tolerance can mistake rounding noise for a hit.
        if(Math.abs(det)<Math.max(1e-8,1e-10*length(direction)*length(edge1)*length(edge2)))return false;
        const s=subtract(a,c),u=dot(s,h)/det,q=cross(s,edge1),v=dot(direction,q)/det,t=dot(edge2,q)/det;
        return u>1e-6&&v>1e-6&&u+v<1-1e-6&&t>1e-6&&t<1-1e-6;
    };
    return (a,b)=>overlaps(a,b)&&[0,1,2].some(i=>pierces(a[i],a[(i+1)%3],...b)||pierces(b[i],b[(i+1)%3],...a));
}

// Reject self-crossings before opening either donor. This is a surface connector,
// not a boolean union of intersecting solids or a volumetric remesher.
function assertConnectionClear(parts, plan) {
    const triangles=plan.triangles,overlapFaces=[];
    const crosses=triangleIntersector();
    for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length;j++)if(crosses(triangles[i],triangles[j])){
        throw new Error('The connection folds across itself. Choose smaller facing areas, or adjust placement in Build.');}
    const ids=new Set([plan.first.partId,plan.second.partId]);
    for(const part of parts.filter(p=>ids.has(p.id)))for(const [faceId,face] of part.mesh.faces.entries()){
        const side=part.id===plan.first.partId?plan.first:plan.second;
        const donor=face.slice(0,3).map(vertex=>linkedPoint({partId:part.id,vertex,twin:side.twin},parts));
        // Native assets often contain intersecting shells. Do not claim a
        // boolean union: identify contacts in the preview for an informed Apply.
        const triangleIds=triangles.flatMap((t,i)=>crosses(t,donor)?[i]:[]);
        if(triangleIds.length)overlapFaces.push({partId:part.id,faceId,twin:side.twin,triangleIds});
    }
    return overlapFaces;
}

export function planBridge(parts, first, second, { variant, twist = 0, correspondence = 'uniform' } = {}) {
    if(!first || !second) throw new Error('Choose two open edges.');
    if(first.closed!==second.closed) throw new Error('Choose two openings, or switch to Edge for both sides.');
    if(parts.filter(p=>[first.partId,second.partId].includes(p.id)).some(p=>p.mesh.vertexLinks))throw new Error('Connect the original parts.');
    for(const side of [first,second]){
        const part=parts.find(p=>p.id===side.partId);if(!part)throw new Error('A boundary part is missing.');
        const edges=boundaries(part.mesh);
        if(!side.edges.length||side.edges.some(([a,b])=>!edges.some(e=>e.a===a&&e.b===b)))throw new Error('Choose open boundary edges.');
    }
    variant ??= [first,second].map(side=>parts.find(p=>p.id===side.partId).variant).find(v=>v!=='all')??'all';
    if([first,second].some(side=>{const view=parts.find(p=>p.id===side.partId).variant;return view!=='all'&&view!==variant;}))throw new Error('Connect boundaries in the same view.');
    const ref=(side,vertex)=>({partId:side.partId,vertex,twin:side.twin}),key=r=>`${r.partId}/${r.twin}/${r.vertex}`;
    if(first.vertices.some(v=>second.vertices.some(w=>key(ref(first,v))===key(ref(second,w))))) throw new Error('Choose separate boundaries.');
    const occupied=new Set(parts.flatMap(p=>(p.connectionEdges??[]).map(e=>e.map(key).sort().join('|'))));
    for(const side of [first,second]) for(const e of side.edges) if(occupied.has(e.map(v=>key(ref(side,v))).sort().join('|'))) throw new Error('That edge already has a connection.');
    // The first row is reversed to face against its donor boundary. The second
    // keeps its direction. Only rotate closed rows, never reverse their winding.
    const a=[...first.vertices].reverse(), b=[...second.vertices];
    if(first.closed){let best=Infinity,offset=0;for(let j=0;j<b.length;j++){let score=0;for(let k=0;k<a.length;k++)score+=distance(linkedPoint(ref(first,a[k]),parts),linkedPoint(ref(second,b[(j+Math.floor(k*b.length/a.length))%b.length]),parts));if(score<best){best=score;offset=j;}}offset=((offset+Math.trunc(twist))%b.length+b.length)%b.length;b.push(...b.splice(0,offset));}
    const refs=[...a.map(v=>ref(first,v)),...b.map(v=>ref(second,v))], mesh={vertices:refs.map(r=>linkedPoint(r,parts)),faces:[],vertexLinks:refs};
    const triangles=[],materials=[],n=first.closed?a.length:a.length-1,m=second.closed?b.length:b.length-1;
    const material=(side,a,b)=>side.faceIds[side.edges.findIndex(e=>e.includes(a)&&e.includes(b))]??side.faceIds[0];
    let i=0,j=0;
    const progression=(row,side,count)=>{
        if(correspondence!=='perimeter')return Array.from({length:count+1},(_,i)=>i/count);
        const progress=[0];for(let i=0;i<count;i++)progress.push(progress.at(-1)+distance(linkedPoint(ref(side,row[i]),parts),linkedPoint(ref(side,row[(i+1)%row.length]),parts)));
        return progress.map(n=>n/progress.at(-1));
    };
    let progressA=progression(a,first,n),progressB=progression(b,second,m);
    while(i<n||j<m){
        const ai=i%a.length,bj=a.length+j%b.length;
        if(j===m || i<n && progressA[i+1] <= progressB[j+1]){triangles.push([ai,(i+1)%a.length,bj]);materials.push([first,material(first,a[i%a.length],a[(i+1)%a.length])]);i++;}
        else{triangles.push([ai,a.length+(j+1)%b.length,bj]);materials.push([second,material(second,b[j%b.length],b[(j+1)%b.length])]);j++;}
    }
    validateTriangles(mesh,triangles);
    // Native projections reference three source vertices; keep those references
    // too, instead of replacing a textured material with a flat colour.
    const mappingIds=new Map();mesh.textureMappings=[];
    const include=r=>{const found=refs.findIndex(other=>key(other)===key(r));if(found>=0)return found;refs.push(r);mesh.vertices.push(linkedPoint(r,parts));return refs.length-1;};
    triangles.forEach((f,index)=>{
        const [side,faceId]=materials[index],source=parts.find(p=>p.id===side.partId).mesh;
        mesh.faces.push([...f,source.faces[faceId][3]]);
        for(const [channel,fallback] of Object.entries(FACE_CHANNELS)){mesh[channel]??=[];mesh[channel].push(source[channel]?.[faceId]??fallback);}
        if((mesh.textures[index]??-1)>=0){const coord=source.textureCoords?.[faceId]??-1,k=`${side.partId}/${side.twin}/${coord}/${coord<0?faceId:''}`;
            if(!mappingIds.has(k)){mappingIds.set(k,mesh.textureMappings.length);mesh.textureMappings.push((coord>=0?source.textureMappings[coord]:source.faces[faceId].slice(0,3)).map(v=>include(ref(side,v))));}
            mesh.textureCoords[index]=mappingIds.get(k);
        }
    });
    mesh.authoredFaces=mesh.faces.map((_,i)=>i); validateMesh(mesh);
    const connectionEdges=[first,second].flatMap(side=>side.edges.map(e=>e.map(v=>ref(side,v))));
    const part={id:crypto.randomUUID(),name:'Connection',source:{...parts.find(p=>p.id===first.partId).source},variant,visible:true,mirror:false,pair:false,parentId:null,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],pivot:[0,0,0],bindLabel:-1,bindBone:-1,role:'connection',mesh,connectionEdges};
    assemble([...parts,part],part.variant);return {part,first,second,triangles:triangles.map(f=>f.map(v=>mesh.vertices[v]))};
}

const EPSILON = 1e-7;
const subtract = (a, b) => a.map((n, i) => n - b[i]);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = v => Math.hypot(...v);
const unit = v => { const n = length(v); return n > EPSILON ? v.map(x => x / n) : [0, 0, 0]; };
const distance = (a, b) => length(subtract(a, b));
const midpoint = (a, b) => a.map((n, i) => (n + b[i]) / 2);
const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const validFaces = (mesh, faces) => new Set([...faces].filter(i => Number.isInteger(i) && mesh.faces[i]));

export function faceNormal(mesh, faceId, vertices = mesh.vertices) {
    const face = mesh.faces[faceId];
    if (!face) return [0, 0, 0];
    const [a, b, c] = face.slice(0, 3).map(i => vertices[i]);
    return cross(subtract(b, a), subtract(c, a));
}

// Coordinate-equivalent edges are connected for selection only. Vertex indices,
// source identities, skinning and material arrays are never merged or rewritten.
export function meshTopology(mesh, { coincident = true } = {}) {
    const vertexFaces = mesh.vertices.map(() => new Set()), vertexNeighbours = mesh.vertices.map(() => new Set());
    const faceNeighbours = mesh.faces.map(() => new Set()), faceEdges = mesh.faces.map(() => []);
    const rawEdges = new Map(), selectionEdges = new Map(), positions = new Map();
    const aliases = mesh.vertices.map((v, i) => {
        if (!coincident) return i;
        const key = v.map(n => Math.round(n * 100000)).join(',');
        if (!positions.has(key)) positions.set(key, i);
        return positions.get(key);
    });
    mesh.faces.forEach((face, faceId) => {
        for (const i of face.slice(0, 3)) vertexFaces[i].add(faceId);
        for (let j = 0; j < 3; j++) {
            const a = face[j], b = face[(j + 1) % 3];
            vertexNeighbours[a].add(b); vertexNeighbours[b].add(a);
            const raw = edgeKey(a, b), joined = edgeKey(aliases[a], aliases[b]);
            if (!rawEdges.has(raw)) rawEdges.set(raw, []);
            rawEdges.get(raw).push({ a, b, faceId });
            if (!selectionEdges.has(joined)) selectionEdges.set(joined, new Set());
            selectionEdges.get(joined).add(faceId); faceEdges[faceId].push(joined);
        }
    });
    for (const group of selectionEdges.values()) {
        // A shared edge normally has two faces. A star avoids quadratic growth
        // for malformed donors with thousands of coincident faces.
        const [first, ...others] = group;
        for (const next of others) { faceNeighbours[first].add(next); faceNeighbours[next].add(first); }
    }
    return { vertexFaces, vertexNeighbours, faceNeighbours, faceEdges, selectionEdges,
        boundaryEdges: [...rawEdges.values()].filter(group => group.length === 1).map(group => group[0]) };
}

export function connectedFaces(mesh, seeds, { angle = 180, topology = meshTopology(mesh) } = {}) {
    const result = validFaces(mesh, seeds), queue = [...result];
    const limit = Math.cos(Math.max(0, Math.min(180, angle)) * Math.PI / 180), normals = new Map();
    const normal = i => { if (!normals.has(i)) normals.set(i, unit(faceNormal(mesh, i))); return normals.get(i); };
    for (let at = 0; at < queue.length; at++) {
        const faceId = queue[at];
        for (const next of topology.faceNeighbours[faceId]) {
            if (result.has(next) || angle < 180 && dot(normal(faceId), normal(next)) < limit - EPSILON) continue;
            result.add(next); queue.push(next);
        }
    }
    return result;
}

export function changeFaceSelection(mesh, faces, operation, topology = meshTopology(mesh)) {
    const selected = validFaces(mesh, faces), result = new Set(selected);
    if (operation === 'all') return new Set(mesh.faces.map((_, i) => i));
    if (operation === 'clear') return new Set();
    if (operation === 'invert') return new Set(mesh.faces.flatMap((_, i) => result.has(i) ? [] : [i]));
    if (operation === 'connected') return connectedFaces(mesh, result, { topology });
    if (operation === 'grow') for (const i of [...result]) for (const next of topology.faceNeighbours[i]) result.add(next);
    if (operation === 'shrink') for (const i of [...result]) {
        if (topology.faceEdges[i].some(key => {
            const group = topology.selectionEdges.get(key);
            return group.size < 2 || [...group].some(next => !selected.has(next));
        })) result.delete(i);
    }
    return result;
}

export function regionVertices(mesh, faces = null, { lockBoundary = false, topology = meshTopology(mesh) } = {}) {
    if (faces === null) return new Set(mesh.vertices.map((_, i) => i));
    const selected = validFaces(mesh, faces), vertices = new Set();
    for (const i of selected) for (const v of mesh.faces[i].slice(0, 3)) vertices.add(v);
    if (lockBoundary) for (const v of vertices) if ([...topology.vertexFaces[v]].some(i => !selected.has(i))) vertices.delete(v);
    return vertices;
}

export function brushFaces(mesh, center, radius, { mirror = false, pivot = 0, metric = point => point } = {}) {
    if (!Number.isFinite(radius) || radius <= 0 || !center?.every(Number.isFinite)) return new Set();
    const centers = (mirror ? [center, [2 * pivot - center[0], center[1], center[2]]] : [center]).map(metric);
    const vertices = mesh.vertices.map(metric);
    // Point-to-triangle distance includes large triangles under a small brush.
    return new Set(mesh.faces.flatMap((face, i) => centers.some(p => pointTriangleDistance(p, ...face.slice(0, 3).map(v => vertices[v])) <= radius) ? [i] : []));
}

function pointTriangleDistance(p, a, b, c) {
    const ab = subtract(b, a), ac = subtract(c, a), ap = subtract(p, a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return distance(p, a);
    const bp = subtract(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return distance(p, b);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return distance(p, a.map((n, i) => n + ab[i] * d1 / (d1 - d3)));
    const cp = subtract(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return distance(p, c);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return distance(p, a.map((n, i) => n + ac[i] * d2 / (d2 - d6)));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return distance(p, b.map((n, i) => n + (c[i] - n) * (d4 - d3) / (d4 - d3 + d5 - d6)));
    const normal = unit(cross(ab, ac));
    return length(normal) ? Math.abs(dot(ap, normal)) : Math.min(distance(p, a), distance(p, b), distance(p, c));
}

// Reject a coordinate update if it would flip/collapse an existing triangle.
// Removing proposals can affect neighbouring triangles, so recheck those too.
export function safeVertexUpdates(mesh, proposed, topology = meshTopology(mesh)) {
    const updates = new Map(), queue = [], queued = new Set(), requested = new Set();
    const enqueue = faceId => { if (!queued.has(faceId)) { queued.add(faceId); queue.push(faceId); } };
    for (const [i, point] of proposed) {
        if (!mesh.vertices[i] || !Array.isArray(point) || point.length !== 3 || point.some(n => !Number.isFinite(n) || Math.abs(n) > 16000)) { requested.add(i); continue; }
        if (distance(point, mesh.vertices[i]) <= EPSILON) continue;
        requested.add(i);
        updates.set(i, [...point]); topology.vertexFaces[i].forEach(enqueue);
    }
    for (let at = 0; at < queue.length; at++) {
        const i = queue[at]; queued.delete(i);
        const face = mesh.faces[i], original = faceNormal(mesh, i);
        const [a, b, c] = face.slice(0, 3).map(v => updates.get(v) ?? mesh.vertices[v]);
        const next = cross(subtract(b, a), subtract(c, a)), area = length(original);
        if (area <= EPSILON || length(next) > Math.max(EPSILON, area * 1e-5) && dot(original, next) > area * length(next) * 1e-6) continue;
        for (const v of face.slice(0, 3)) if (updates.delete(v)) topology.vertexFaces[v].forEach(enqueue);
    }
    return { updates, skipped: requested.size - updates.size };
}

export function applyVertexUpdates(mesh, updates) {
    for (const [i, point] of updates) mesh.vertices[i] = [...point];
    return updates.size;
}

export function planSculpt(mesh, { center, radius = 22, amount = 4, tool = 'pull', normal = [0, -1, 0],
    faces = null, visibleFaces = null, lockBoundary = false, falloff = 'soft', mirror = false, pivot = 0,
    plane = null, metric = point => point, topology = meshTopology(mesh) } = {}) {
    if (!center?.every(Number.isFinite) || !(radius > 0) || !Number.isFinite(amount) || !['pull', 'push', 'smooth', 'flatten'].includes(tool)) return { updates: new Map(), skipped: 0 };
    const allowed = regionVertices(mesh, faces, { lockBoundary, topology }), proposed = new Map();
    const main = { center, normal: unit(normal), plane: plane ?? center };
    const brushes = [main];
    if (mirror) brushes.push({ center: [2 * pivot - center[0], center[1], center[2]], normal: [-main.normal[0], main.normal[1], main.normal[2]], plane: [2 * pivot - main.plane[0], main.plane[1], main.plane[2]] });
    for (const brush of brushes) brush.metricCenter = metric(brush.center);
    for (const i of allowed) {
        if (visibleFaces && ![...topology.vertexFaces[i]].some(faceId => visibleFaces.has(faceId))) continue;
        const vertex = mesh.vertices[i], measured = metric(vertex); let best = null, strength = 0;
        for (const brush of brushes) {
            const d = distance(measured, brush.metricCenter); if (d >= radius) continue;
            const weight = falloff === 'constant' ? 1 : (1 - d / radius) ** 2;
            if (weight > strength) { best = brush; strength = weight; }
        }
        if (!best) continue;
        let next;
        if (tool === 'smooth') {
            const neighbours = [...topology.vertexNeighbours[i]]; if (!neighbours.length) continue;
            next = vertex.map((n, axis) => n + (neighbours.reduce((sum, j) => sum + mesh.vertices[j][axis], 0) / neighbours.length - n) * strength * Math.min(1, Math.abs(amount) / 10));
        } else if (tool === 'flatten') {
            const offset = dot(subtract(vertex, best.plane), best.normal);
            next = vertex.map((n, axis) => n - best.normal[axis] * offset * strength * Math.min(1, Math.abs(amount) / 10));
        } else next = vertex.map((n, axis) => n + best.normal[axis] * amount * (tool === 'push' ? -1 : 1) * strength);
        proposed.set(i, next);
    }
    return safeVertexUpdates(mesh, proposed, topology);
}

export function planFlatten(mesh, faces, { axis = 'surface', amount = 10, lockBoundary = false } = {}) {
    const selection = validFaces(mesh, faces), topology = meshTopology(mesh), vertices = regionVertices(mesh, selection, { topology });
    if (!vertices.size) return { updates: new Map(), skipped: 0 };
    const center = [0, 1, 2].map(a => [...vertices].reduce((sum, i) => sum + mesh.vertices[i][a], 0) / vertices.size);
    const normal = axis === 'surface' ? unit([...selection].reduce((sum, i) => { const n = faceNormal(mesh, i); return sum.map((v, a) => v + n[a]); }, [0, 0, 0])) : [0, 1, 2].map(i => i === Number(axis) ? 1 : 0);
    if (!length(normal)) return { updates: new Map(), skipped: 0, reason: 'Choose a local X, Y or Z plane for a closed or folded selection.' };
    return planSculpt(mesh, { center, radius: Infinity, amount, tool: 'flatten', normal, faces: selection, lockBoundary, topology });
}

export function planRegionOffset(mesh, faces, { amount = 1, lockBoundary = false } = {}) {
    const selection = validFaces(mesh, faces), topology = meshTopology(mesh), proposed = new Map();
    if (!Number.isFinite(amount)) return { updates: proposed, skipped: 0 };
    const normals = new Map([...selection].map(i => [i, faceNormal(mesh, i)]));
    for (const i of regionVertices(mesh, selection, { lockBoundary, topology })) {
        const normal = unit([...topology.vertexFaces[i]].filter(id => selection.has(id)).reduce((sum, id) => sum.map((n, a) => n + normals.get(id)[a]), [0, 0, 0]));
        proposed.set(i, mesh.vertices[i].map((n, a) => n + normal[a] * amount));
    }
    return safeVertexUpdates(mesh, proposed, topology);
}

export function mirroredFaces(mesh, faces, pivot = 0, { unique = false } = {}) {
    const key = v => v.map(n => Math.round(n * 1000)).join(',');
    const faceKey = points => points.map(key).sort().join('|'), lookup = new Map();
    mesh.faces.forEach((f, i) => { const k = faceKey(f.slice(0, 3).map(v => mesh.vertices[v])); if (!lookup.has(k)) lookup.set(k, []); lookup.get(k).push(i); });
    const result = validFaces(mesh, faces);
    for (const i of [...result]) {
        const k = faceKey(mesh.faces[i].slice(0, 3).map(v => { const p = mesh.vertices[v]; return [2 * pivot - p[0], p[1], p[2]]; }));
        const matches=lookup.get(k)??[];
        if(!unique||matches.length===1)for (const other of matches) result.add(other);
    }
    return result;
}

function paired(part, parts) {
    const seen = new Set();
    while (part && !seen.has(part.id)) { if (part.pair) return true; seen.add(part.id); part = parts.find(p => p.id === part.parentId); }
    return false;
}

// Snap an entire boundary edge to another boundary edge. No new triangle,
// vertex, index or rig weight is introduced. Both endpoints must fit tolerance.
export function planSeamConnection(parts, sourceId, { faces = null, tolerance = 3, target = 'self',
    variant = 'all', sourceTwin = false, lockBoundary = false } = {}) {
    const source = parts.find(p => p.id === sourceId), empty = { updates: new Map(), pairs: [], skipped: 0 };
    if (!source || !Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 50) return empty;
    const topology = meshTopology(source.mesh), allowed = regionVertices(source.mesh, faces, { lockBoundary, topology });
    const parent = parts.find(p => p.id === source.parentId);
    const toWorld = (point, part, twin) => { const p = worldPoint(point, part, parts); return twin ? reflectPoint(p, parts.find(row => row.id === part.parentId), parts) : p; };
    const fromWorld = point => localPoint(sourceTwin ? reflectPoint(point, parent, parts) : point, source, parts);
    const edge = (part, raw, twin) => ({ ...raw, partId: part.id, twin,
        points: [raw.a, raw.b].map(i => toWorld(part.mesh.vertices[i], part, twin)) });
    const sourceEdges = topology.boundaryEdges.filter(e => (faces === null || faces.has(e.faceId)) && allowed.has(e.a) && allowed.has(e.b)).map(e => edge(source, e, sourceTwin));
    const targets = target === 'self' ? topology.boundaryEdges.map(e => edge(source, e, sourceTwin)) : parts.filter(p => p.id !== sourceId && p.visible !== false && (variant === 'all' || p.variant === 'all' || p.variant === variant)).flatMap(p => {
        const edges = meshTopology(p.mesh).boundaryEdges;
        return (paired(p, parts) ? [false, true] : [false]).flatMap(twin => edges.map(e => edge(p, e, twin)));
    });
    const buckets = new Map(), cell = point => point.map(n => Math.floor(n / tolerance));
    for (const candidate of targets) {
        const key = cell(midpoint(...candidate.points)).join(',');
        if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(candidate);
    }
    const assignedSource = new Map(), assignedTarget = new Map(), proposed = new Map(), pairs = [];
    const targetKey = (e, v) => `${e.partId}/${e.twin}/${v}`;
    for (const current of sourceEdges) {
        if (target === 'self' && [current.a, current.b].some(v => assignedTarget.has(targetKey(current, v)))) continue;
        const origin = cell(midpoint(...current.points)); let best = null, bestPoints = null, bestVertices = null, bestScore = Infinity;
        for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
            for (const candidate of buckets.get(origin.map((n, i) => n + [x, y, z][i]).join(',')) ?? []) {
                if (candidate.partId === sourceId && [candidate.a, candidate.b].some(v => v === current.a || v === current.b || assignedSource.has(v))) continue;
                // Avoid joining edges of the same triangle and collapsing it.
                if (candidate.partId === sourceId && candidate.faceId === current.faceId) continue;
                for (const vertices of [[candidate.a, candidate.b], [candidate.b, candidate.a]]) {
                    if ([current.a, current.b].some((v, i) => {
                        const key = targetKey(candidate, vertices[i]);
                        return assignedSource.has(v) && assignedSource.get(v) !== key || assignedTarget.has(key) && assignedTarget.get(key) !== v;
                    })) continue;
                    const points = vertices.map(v => candidate.points[v === candidate.a ? 0 : 1]);
                    const distances = points.map((p, i) => distance(p, current.points[i])), score = distances[0] + distances[1];
                    if (Math.max(...distances) > tolerance || score <= EPSILON || score >= bestScore) continue;
                    best = candidate; bestPoints = points; bestVertices = vertices; bestScore = score;
                }
            }
        }
        if (!best) continue;
        [current.a, current.b].forEach((v, i) => {
            const key = targetKey(best, bestVertices[i]);
            proposed.set(v, fromWorld(bestPoints[i])); assignedSource.set(v, key); assignedTarget.set(key, v);
        });
        pairs.push({ source: current, target: best });
    }
    let complete = pairs;
    // An edge is useful only if both endpoints reach the target. Removing a
    // partial repair can affect a neighbouring edge, so prune to a fixed point.
    while (true) {
        const vertices = new Set(complete.flatMap(pair => [pair.source.a, pair.source.b]));
        const safe = safeVertexUpdates(source.mesh, new Map([...proposed].filter(([v]) => vertices.has(v))), topology);
        const next = complete.filter(pair => [pair.source.a, pair.source.b].every(v => distance(proposed.get(v), source.mesh.vertices[v]) <= EPSILON || safe.updates.has(v)));
        if (next.length === complete.length) return { updates: safe.updates, pairs: complete,
            skipped: [...proposed].filter(([v, p]) => distance(p, source.mesh.vertices[v]) > EPSILON && !safe.updates.has(v)).length };
        complete = next;
    }
}

function containsPoint(points, point) {
    const sign = (a, b) => (a[0] - point[0]) * (b[1] - point[1]) - (a[1] - point[1]) * (b[0] - point[0]);
    const a = sign(points[0], points[1]), b = sign(points[1], points[2]), c = sign(points[2], points[0]);
    return !((a < -EPSILON || b < -EPSILON || c < -EPSILON) && (a > EPSILON || b > EPSILON || c > EPSILON));
}

// Reuses the viewport's painter order, with a small spatial index for occlusion.
// Four inset samples keep a partly exposed face selectable without selecting
// triangles that are wholly behind another part or the back of the model.
export function visibleFaceIds(polygons, partId, { candidates = null, faceCount = Infinity, twin = null, width = 4096, height = 4096, distance: cameraDistance = null } = {}) {
    const cells = new Map(), size = 16, bounds = [], usable = polygons.filter(p => !p.reference && (p.alpha ?? 1) > .01 && p.points?.length === 3);
    usable.forEach((p, index) => {
        const minX = Math.min(p.points[0][0], p.points[1][0], p.points[2][0]), maxX = Math.max(p.points[0][0], p.points[1][0], p.points[2][0]);
        const minY = Math.min(p.points[0][1], p.points[1][1], p.points[2][1]), maxY = Math.max(p.points[0][1], p.points[1][1], p.points[2][1]);
        bounds.push([minX, minY, maxX, maxY]);
        const min = [Math.max(0, Math.floor(minX / size)), Math.max(0, Math.floor(minY / size))];
        const max = [Math.min(Math.ceil(width / size), Math.floor(maxX / size)), Math.min(Math.ceil(height / size), Math.floor(maxY / size))];
        for (let x = min[0]; x <= max[0]; x++) for (let y = min[1]; y <= max[1]; y++) {
            const key = `${x},${y}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(index);
        }
    });
    const visible = new Set();
    for (const p of usable) {
        const id = p.sourceFaceId ?? p.faceId % faceCount;
        if (p.partId !== partId || twin !== null && !!p.twin !== !!twin || candidates && !candidates.has(id) || visible.has(id)) continue;
        const center = [0, 1].map(a => p.points.reduce((sum, v) => sum + v[a], 0) / 3);
        const samples = [center, ...p.points.map(v => [0, 1].map(a => center[a] * .1 + v[a] * .9))];
        if (samples.some(point => {
            if (point[0] < 0 || point[1] < 0 || point[0] > width || point[1] > height) return false;
            const group = cells.get(point.map(n => Math.floor(n / size)).join(',')) ?? [];
            let front=null,nearest=Infinity;
            for (let i = group.length - 1; i >= 0; i--) {
                const index = group[i], box = bounds[index];
                if (point[0] < box[0] || point[1] < box[1] || point[0] > box[2] || point[1] > box[3]) continue;
                const top = usable[index];
                if (!containsPoint(top.points, point))continue;
                if(!Number.isFinite(cameraDistance)||top.points.some(v=>v.length<3)){front=top;break;}
                const [a,b,c]=top.points,[x,y]=point,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(!den)continue;
                const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;
                const depth=1/[u,v,1-u-v].reduce((n,w,i)=>n+w/Math.max(5,cameraDistance+top.points[i][2]),0);
                if(depth<nearest-1e-7){nearest=depth;front=top;}
            }
            return front?.partId === partId && (front.sourceFaceId ?? front.faceId % faceCount) === id && (twin === null || !!front.twin === !!twin);
        })) visible.add(id);
    }
    return visible;
}
