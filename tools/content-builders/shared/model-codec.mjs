import { validateMesh } from './mesh.mjs';
export function modelVertexOrder(mesh){const order=[],seen=new Set();for(const face of mesh.faces)for(const i of face.slice(0,3))if(!seen.has(i)){seen.add(i);order.push(i);}for(let i=0;i<mesh.vertices.length;i++)if(!seen.has(i))order.push(i);return order;}

// OSRS model v3. This preserves both classic vertex labels and modern weighted bones.
// Encoded files are consumed by the existing client ModelData decoder, without a client patch.
export function encodeModel(mesh) {
    validateMesh(mesh);
    const flags = [], xs = [], ys = [], zs = [], faceOrder = [], indices = [], colours = [], skins = [], alphas = [], priorities = [],textures=[],coords=[],mappings=[],renderTypes=[],faceLabels=[];
    const short = (out, n) => { out.push((n >>> 8) & 255, n & 255); };
    const signedSmart = (out, n) => {
        if (n < -16384 || n > 16383) throw new Error('Neighbouring vertices are too far apart for a cache model.');
        if (n >= -64 && n < 64) out.push(n + 64); else short(out, n + 49152);
    };
    // Reorder vertices into first-use order. A face then only refers to vertices already seen or
    // the next vertex, and signed index deltas remain representable after model composition.
    const order = modelVertexOrder(mesh), remap = new Map(order.map((n,i)=>[n,i]));
    const mapIndex=new Map(),mappingIds=new Map();
    for(let i=0;i<mesh.faces.length;i++)if((mesh.textures?.[i]??-1)>=0&&(mesh.textureCoords?.[i]??-1)>=0){const id=mesh.textureCoords[i],triple=mesh.textureMappings[id].map(n=>remap.get(n)),key=triple.join(',');if(!mapIndex.has(key)){mapIndex.set(key,mappings.length/6);triple.forEach(n=>short(mappings,n));}mappingIds.set(id,mapIndex.get(key));}
    if(mappings.length/6>255)throw new Error('This model needs more than 255 texture projections. Use fewer mirrored textured pieces.');
    let previous = [0, 0, 0];
    for (const id of order) {
        const vertex = mesh.vertices[id].map(Math.round), delta = vertex.map((n, i) => n - previous[i]);
        flags.push(delta.reduce((f, n, i) => n ? f | (1 << i) : f, 0));
        delta.forEach((n, i) => { if (n) signedSmart([xs, ys, zs][i], n); }); previous = vertex;
        skins.push(mesh.skins?.[id] >= 0 ? mesh.skins[id] : 255);
    }
    const weighted = mesh.bones?.some(bones => bones.length > 0) ?? false;
    if (weighted) for (const id of order) {
        const bones = mesh.bones[id], weights = mesh.weights[id]; skins.push(bones.length);
        for (let j = 0; j < bones.length; j++) skins.push(bones[j], weights[j]);
    }
    let last = 0;
    for (let i = 0; i < mesh.faces.length; i++) {
        const face = mesh.faces[i], ids = face.slice(0, 3).map(n => remap.get(n)); faceOrder.push(1);
        for (const id of ids) { signedSmart(indices, id - last); last = id; }
        short(colours, face[3]); alphas.push(mesh.alpha?.[i] ?? 0); priorities.push(mesh.priorities?.[i] ?? 0);
        short(textures,(mesh.textures?.[i]??-1)+1);
        if((mesh.textures?.[i]??-1)>=0)coords.push((mappingIds.get(mesh.textureCoords?.[i])??-1)+1);
        renderTypes.push(mesh.renderTypes?.[i]??0);faceLabels.push(mesh.faceLabels?.[i]>=0?mesh.faceLabels[i]:255);
    }
    for (const bytes of [xs, ys, zs, indices, skins]) if (bytes.length > 65535) throw new Error('A model section exceeds 65 KB. Reduce the model size.');
    const textureCount=mappings.length/6,hasTextures=mesh.textures?.some(n=>n>=0)??false;
    const out = [...Array(textureCount).fill(0),...flags,...renderTypes, ...faceOrder, ...priorities,...faceLabels, ...skins, ...alphas, ...indices,...(hasTextures?textures:[]),...(hasTextures?coords:[]), ...colours, ...xs, ...ys, ...zs,...mappings, 0];
    short(out, order.length); short(out, mesh.faces.length);
    out.push(textureCount, 1, 255, 1, 1, hasTextures?1:0, 1, weighted ? 1 : 0);
    for (const bytes of [xs, ys, zs, indices, hasTextures?coords:[], skins]) short(out, bytes.length);
    out.push(255, 253);
    return Uint8Array.from(out);
}
