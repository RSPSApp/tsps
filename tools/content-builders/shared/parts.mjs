import { bounds, components } from './mesh.mjs';
const mean = points => points.length ? [0, 1, 2].map(a => points.reduce((n, p) => n + p[a], 0) / points.length) : [0, 0, 0];
// Recover nested classic transform groups or use native weighted bone parents. Names are
// geometry-based guesses; cards always show the exact extracted geometry before adding it.
export function describeParts(mesh, rig = null) {
    const box = bounds(mesh), height = Math.max(1, box.max[1] - box.min[1]);
    let bones = [];
    if (rig?.weighted)
        bones = rig.parents.map((parent, id) => ({ id, parent, labels: new Set([id]), pivotLabels: [] }));
    else if (rig?.types) {
        let origin = [];
        rig.types.forEach((type, group) => {
            if (type === 0)
                origin = rig.labels[group] ?? [];
            if (type === 2 && rig.labels[group]?.length)
                bones.push({ id: bones.length, parent: -1, labels: new Set(rig.labels[group]), pivotLabels: origin });
        });
        for (const b of bones) {
            const candidates = bones.filter(p => p !== b && (p.labels.size > b.labels.size || p.labels.size === b.labels.size && p.id < b.id) && [...b.labels].every(l => p.labels.has(l)));
            candidates.sort((a, b) => a.labels.size - b.labels.size || b.id - a.id);
            b.parent = candidates[0]?.id ?? -1;
        }
    }
    const depth = b => { let n = 0, p = b, seen = new Set(); while (p?.parent >= 0 && !seen.has(p.id)) {
        seen.add(p.id);
        n++;
        p = bones[p.parent];
    } return n; };
    for (const b of bones) {
        b.depth = depth(b);
        b.children = bones.filter(c => c.parent === b.id).map(c => c.id);
    }
    const vertexOwner = mesh.vertices.map((_, i) => {
        if (rig?.weighted) {
            const weights = mesh.weights?.[i] ?? [], ids = mesh.bones?.[i] ?? [];
            return ids[weights.indexOf(Math.max(...weights))] ?? -1;
        }
        const owners = bones.filter(b => b.labels.has(mesh.skins?.[i]));
        owners.sort((a, b) => b.depth - a.depth || b.id - a.id);
        return owners[0]?.id ?? -1;
    });
    const faceOwner = mesh.faces.map(f => {
        const ids = f.slice(0, 3).map(i => vertexOwner[i]);
        return ids.find(id => ids.filter(n => n === id).length >= 2) ?? ids[0];
    });
    for (const b of bones) {
        const descendants = new Set([b.id]);
        for (const id of descendants)
            for (const child of bones[id].children)
                descendants.add(child);
        b.faces = faceOwner.flatMap((id, i) => descendants.has(id) ? [i] : []);
        b.own = faceOwner.flatMap((id, i) => id === b.id ? [i] : []);
        const ids = [...new Set(b.faces.flatMap(i => mesh.faces[i].slice(0, 3)))];
        b.points = ids.map(i => mesh.vertices[i]);
        b.center = mean(b.points);
        b.box = b.points.length ? bounds({ vertices: b.points }) : box;
        const pivot = mesh.vertices.filter((_, i) => b.pivotLabels.includes(mesh.skins?.[i]));
        const ownPoints = mesh.vertices.filter((_, i) => vertexOwner[i] === b.id);
        b.pivot = pivot.length ? mean(pivot) : ownPoints.length ? mean(ownPoints) : [...b.center];
        b.share = ids.length / mesh.vertices.length;
        const distant = [...b.points].sort((a, c) => Math.hypot(...c.map((n, i) => n - b.pivot[i])) - Math.hypot(...a.map((n, i) => n - b.pivot[i])));
        const tip = mean(distant.slice(0, Math.max(1, Math.ceil(distant.length * .1))));
        const direction = tip.map((n, i) => n - b.pivot[i]), length = Math.hypot(...direction) || 1, dir = direction.map(n => n / length);
        const lateral = Math.abs(b.center[0] - box.center[0]) > height * .1;
        const nearGround = b.box.max[1] >= box.max[1] - height * .14;
        const pivotHigh = b.pivot[1] < b.box.max[1] - height * .18;
        let role = 'piece';
        if (b.parent === -1 || b.share > .6)
            role = 'body';
        else if (nearGround && pivotHigh && b.share < .45 && dir[1] > .2)
            role = 'leg';
        else if (b.box.min[1] <= box.min[1] + height * .14 && b.pivot[1] < box.center[1] && b.share < .4 && !lateral)
            role = 'head';
        else if (lateral && !nearGround && Math.abs(dir[0]) > .55 && b.share < .35)
            role = b.box.max[1] < box.max[1] - height * .45 && Math.abs(tip[0] - box.center[0]) > height * .45 ? 'wing' : 'arm';
        else if (lateral && !nearGround && dir[1] > .3 && b.share < .3)
            role = 'arm';
        else if (!nearGround && dir[2] > .6 && b.share < .35)
            role = 'tail';
        else if (b.parent >= 0 && dir[2] < -.5 && b.share < .3)
            role = 'neck';
        b.role = role;
    }
    for (const b of [...bones].sort((a, b) => a.depth - b.depth)) {
        const parent = bones[b.parent];
        if (parent && ['leg', 'arm', 'wing', 'tail', 'head'].includes(parent.role))
            b.role = parent.role;
    }
    // The largest independently moving core is a more reliable torso than a long
    // transform group that also rotates its limbs.
    const core = bones.filter(b => b.own.length > 8).sort((a, b) => b.own.length - a.own.length)[0];
    if (core) {
        let at = core;
        while (at) {
            at.role = 'body';
            at = bones[at.parent];
        }
    }
    // Recognise low, multi-legged bodies using the many limbs that fan away from
    // the centre. A raised bind-pose foot is still a leg.
    const lowBody = (box.max[0] - box.min[0]) > height * 2.5;
    const lateralChains = bones.filter(b => b.faces.length >= 20 && b.share < .2 && Math.abs(b.center[0] - box.center[0]) > height * .2);
    if (lowBody && lateralChains.length >= 6) {
        for (const b of lateralChains)
            if (b.role !== 'body')
                b.role = 'leg';
        for (const b of [...bones].sort((a, b) => a.depth - b.depth))
            if (bones[b.parent]?.role === 'leg')
                b.role = 'leg';
    }
    // Paired arm groups at the same height should have the same name even when
    // one holds a long weapon that otherwise resembles a wing.
    for (const b of bones.filter(b => b.role === 'wing'))
        if (bones.some(other => other.role === 'arm' && Math.sign(other.center[0] - box.center[0]) !== Math.sign(b.center[0] - box.center[0]) && Math.abs(other.pivot[1] - b.pivot[1]) < height * .08))
            b.role = 'arm';
    const offers = [{ key: 'whole', name: 'Whole creature', role: 'body', faces: mesh.faces.map((_, i) => i), pivot: [0, 0, 0] }];
    const body = core;
    if (body && body.own.length < mesh.faces.length * .96)
        offers.push({ key: 'body', name: 'Body only', role: 'body', faces: body.own, pivot: mean([...new Set(body.own.flatMap(i => mesh.faces[i].slice(0, 3)))].map(i => mesh.vertices[i])) });
    for (const b of bones) {
        if (b.parent < 0 || b.faces.length < 6 || b.faces.length > mesh.faces.length * .9 || b.role === 'body' || bones[b.parent]?.role === b.role && b.role !== 'piece')
            continue;
        const side = ['leg', 'arm', 'wing'].includes(b.role) ? b.center[0] > box.center[0] ? 'Left ' : 'Right ' : '';
        const label = b.role === 'piece' ? `${b.center[1] < box.center[1] ? 'Upper' : 'Lower'} piece` : b.role;
        offers.push({ key: `joint-${b.id}`, name: side + label, role: b.role, faces: b.faces, pivot: b.pivot });
    }
    const known = new Set(offers.map(p => p.faces.join(',')));
    const disconnected = components(mesh).filter(f => f.length >= 8 && f.length < mesh.faces.length * .9);
    for (const [i, faces] of disconnected.slice(0, 18).entries()) {
        if (known.has(faces.join(',')))
            continue;
        const points = [...new Set(faces.flatMap(i => mesh.faces[i].slice(0, 3)))].map(i => mesh.vertices[i]);
        offers.push({ key: `piece-${i}`, name: `Separate piece ${i + 1}`, role: 'piece', faces, pivot: mean(points) });
    }
    if (offers.length === 1) {
        const groups = new Map();
        mesh.faces.forEach((f, i) => { const labels = f.slice(0, 3).map(v => mesh.skins?.[v] ?? -1); const label = labels.find(l => labels.filter(n => n === l).length >= 2) ?? labels[0]; if (!groups.has(label))
            groups.set(label, []); groups.get(label).push(i); });
        for (const [id, faces] of groups)
            if (faces.length >= 6 && faces.length < mesh.faces.length * .95) {
                const points = [...new Set(faces.flatMap(i => mesh.faces[i].slice(0, 3)))].map(i => mesh.vertices[i]);
                const center = mean(points);
                const role = center[1] < box.min[1] + height * .3 ? 'head' : center[1] > box.max[1] - height * .3 ? 'leg' : 'body';
                offers.push({ key: `label-${id}`, name: `${role === 'head' ? 'Head piece' : role === 'leg' ? 'Lower piece' : 'Body piece'}`, role, faces, pivot: center });
            }
    }
    const counts = {};
    return offers.slice(0, 48).map(p => { p.name = p.name[0].toUpperCase() + p.name.slice(1); const count = counts[p.name] = (counts[p.name] ?? 0) + 1; return { ...p, name: p.name + (count > 1 ? ` ${count}` : '') }; });
}

// Gear uses shells and colour areas rather than Creature's anatomical guesses.
// Inspired by GhostScape's gear/segment.js. Position welding is an adjacency
// lookup only: offers contain original face IDs and never rewrite the mesh.
export function describeGearParts(mesh) {
    const all=mesh.faces.map((_,i)=>i), box=bounds(mesh);
    const positions=new Map(), welded=mesh.vertices.map(v=>{
        const key=v.join(',');if(!positions.has(key))positions.set(key,positions.size);return positions.get(key);
    });
    const parents=all.slice(), colours=all.slice();
    const find=(table,id)=>{while(table[id]!==id){table[id]=table[table[id]];id=table[id];}return id;};
    const join=(table,a,b)=>{a=find(table,a);b=find(table,b);if(a!==b)table[Math.max(a,b)]=Math.min(a,b);};
    const material=i=>[mesh.textures?.[i]??-1,mesh.renderTypes?.[i]??0,mesh.alpha?.[i]??0].join('/');
    const edges=new Map();
    mesh.faces.forEach((face,i)=>{
        const v=face.slice(0,3).map(id=>welded[id]);
        for(let n=0;n<3;n++){
            const a=v[n],b=v[(n+1)%3];if(a===b)continue;
            const key=a<b?`${a}/${b}`:`${b}/${a}`,neighbours=edges.get(key)??[];
            for(const other of neighbours){join(parents,i,other);if(face[3]===mesh.faces[other][3]&&material(i)===material(other))join(colours,i,other);}
            neighbours.push(i);edges.set(key,neighbours);
        }
    });
    const groups=table=>{
        const rows=new Map();for(const id of all){const owner=find(table,id);if(!rows.has(owner))rows.set(owner,[]);rows.get(owner).push(id);}
        return [...rows.values()].sort((a,b)=>b.length-a.length||a[0]-b[0]);
    };
    const centre=faces=>mean([...new Set(faces.flatMap(i=>mesh.faces[i].slice(0,3)))].map(i=>mesh.vertices[i]));
    const where=faces=>{
        const c=centre(faces),rel=c.map((n,a)=>(n-box.center[a])/Math.max(1,box.max[a]-box.min[a]));
        return [rel[1]<-.2?'Upper':rel[1]>.2?'Lower':'',rel[2]<-.2?'Front':rel[2]>.2?'Back':'',rel[0]<-.2?'Right':rel[0]>.2?'Left':''].filter(Boolean).join(' ')||'Middle';
    };
    const offer=(key,name,faces,group,extra={})=>({key,name,faces,group,role:group==='pieces'?'component':'colour',pivot:centre(faces),...extra});
    const offers=[offer('whole','Whole item',all,'pieces')],shells=groups(parents),regions=groups(colours);
    for(const faces of shells)if(faces.length<all.length)offers.push(offer(`gear-piece-${faces[0]}`,`${where(faces)} piece`,faces,'pieces'));
    for(const faces of regions){
        if(faces.length===all.length)continue;
        const texture=mesh.textures?.[faces[0]]??-1;
        offers.push(offer(`gear-colour-${faces[0]}`,`${texture>=0?'Textured':gearColourName(mesh.faces[faces[0]][3])} area, ${where(faces).toLowerCase()}`,faces,'colours',{colour:mesh.faces[faces[0]][3],texture}));
    }
    // Existing saved part keys remain resolvable, but the pictured gear
    // browser shows the more useful connected and colour offers first.
    for(const legacy of describeParts(mesh).slice(1))offers.push({...legacy,group:'legacy'});
    const counts=new Map();return offers.map(p=>{const n=(counts.get(p.name)??0)+1;counts.set(p.name,n);return {...p,name:p.name+(n>1?` ${n}`:'')};});
}
export function gearColourName(hsl) {
    const hue=(hsl>>>10)&63,saturation=(hsl>>>7)&7,light=hsl&127;
    if(light<14)return 'Black';
    if(saturation<=1)return light>90?'White':light>50?'Light grey':'Grey';
    let name=['Red','Orange','Orange','Yellow','Yellow','Green','Green','Green','Teal','Blue','Blue','Purple','Purple','Pink','Red','Red'][hue>>>2];
    if(name==='Orange'&&light<50)name='Brown';if(name==='Yellow'&&saturation>4&&light>55)name='Gold';
    return light<30?`Dark ${name.toLowerCase()}`:name;
}
