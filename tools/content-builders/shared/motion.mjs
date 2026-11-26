import { assemble, transformVertex, worldPoint, reflectPoint } from './mesh.mjs';
import { attackForRole } from './creature-attacks.mjs';
export const hasOwnMotion = p => !!p.attacks?.length || p.parts.some(part => p.kind==='npc' && part.mesh.vertexLinks || ['own', 'still'].includes(part.motion?.mode) || Object.values(part.motion?.keys ?? {}).some(keys => keys.length));
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => { const d = Math.hypot(...v) || 1; return v.map(n => n / d); };

// Authoring helpers only use fields already accepted by validateProject. A donor
// changes the sequence on the selected part's original rig, never its geometry.
export function sourceMovements(source) {
    const f = source.fields ?? {}, g = source.gameplay ?? {}, c = source.combat ?? {};
    const sequence = value => Number.isInteger(value) && value >= 0 && value <= 65534 ? value : -1;
    return Object.fromEntries(Object.entries({ idle: f.idleSeqId ?? g.standAnim, walk: f.walkSeqId ?? g.walkAnim, run: g.runAnim,
        attack: c.anims?.attack ?? g.attackAnim, block: c.anims?.block ?? g.blockAnim, death: c.anims?.death }).map(([role, id]) => [role, sequence(id)]));
}
export function motionSequence(project, part, role) {
    if (project.kind === 'gear') return project.animations?.[role] ?? -1;
    const attack=attackForRole(project,role);
    if(attack){const override=attack.parts[part.id];return override?override.sequence:motionSequence(project,part,'attack');}
    if (part.motion?.mode === 'still') return -1;
    return part.motion?.mode === 'own' ? part.motion.sequences?.[role] ?? -1 : !part.parentId ? project.animations?.[role] ?? -1 : -1;
}
export function motionCompatibility(part, source, sequence) {
    if (!(sequence >= 0)) return { usable: false, text: 'This source has no movement for this action. Choose another action or make a pose.' };
    const mesh = source?.mesh;
    if (!mesh) return { usable: false, text: 'Load this part\'s source before borrowing movement.' };
    const mapping = part.mesh.sourceVertices;
    if (mapping ? mapping.length !== part.mesh.vertices.length || mapping.some(i => !Number.isInteger(i) || !mesh.vertices[i]) : part.mesh.vertices.length !== mesh.vertices.length)
        return { usable: false, text: 'This part lost its source mapping. Re-add it in Build, or use custom poses.' };
    if (!mesh.skins?.some(n => n >= 0) && !mesh.bones?.some(row => row.length))
        return { usable: false, text: 'This source has no animation joints. Use custom poses to move this part.' };
    return { usable: true, text: 'Uses this part\'s original joints. Preview the movement before exporting.' };
}
const identityPose = () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
export function motionPreset(name, duration = 600) {
    if (!['swing', 'flap', 'bob', 'recoil'].includes(name)) throw new Error('Choose a movement preset.');
    if (!Number.isFinite(duration) || duration < 80 || duration > 8000) throw new Error('A movement must last 0.08 to 8 seconds.');
    const end = Math.round(duration / 20) * 20;
    const values = name === 'swing' ? [0, -30, 70, 0] : name === 'flap' ? [0, 45, -45, 0] : name === 'bob' ? [0, -12, 0, 0] : [0, -20, 8, 0];
    return values.map((value, index) => {
        const pose = { time: index === 3 ? end : Math.round(end * [0, .3, .55][index] / 20) * 20, ...identityPose() };
        if (name === 'bob') pose.position[1] = value;
        else pose.rotation[name === 'flap' ? 2 : 0] = value;
        return pose;
    });
}
export function putPose(keys, time, pose = keyPose(keys, time)) {
    if (!Number.isFinite(time) || time < 0 || time > 8000) throw new Error('Keep poses between 0 and 8 seconds.');
    const tick = Math.round(time / 20) * 20, out = structuredClone(keys ?? []), existing = out.findIndex(key => key.time === tick);
    if (existing < 0 && out.length >= 32) throw new Error('A movement supports at most 32 poses. Remove a pose first.');
    const key = { time: tick, ...Object.fromEntries(['position', 'rotation', 'scale'].map(name => [name, [...pose[name]]])) };
    if (existing >= 0) out[existing] = key; else out.push(key);
    return out.sort((a, b) => a.time - b.time);
}
export function retimePoses(keys, duration) {
    if (!keys?.length) return [];
    if (!Number.isFinite(duration) || duration < 20 || duration > 8000) throw new Error('Choose a length between 0.02 and 8 seconds.');
    const end = Math.round(duration / 20) * 20, previousEnd = keys.at(-1).time;
    if (!previousEnd) throw new Error('Add another pose before changing the movement length.');
    const out = structuredClone(keys).map(key => ({ ...key, time: Math.round(key.time / previousEnd * end / 20) * 20 }));
    if (out.some((key, i) => i && key.time <= out[i - 1].time)) throw new Error('That length puts poses on the same frame. Use a longer movement.');
    return out;
}
export function copyRoleMotion(part, role) {
    const m = part.motion ?? {};
    return structuredClone({ source: part.source, mode: m.mode ?? 'follow', sequence: m.sequences?.[role] ?? -1,
        speed: m.speed ?? 1, phase: m.phase ?? 0, strength: m.strength ?? 1, keys: m.keys?.[role] ?? [] });
}
export function pasteRoleMotion(motion, role, copied, sameSource = true) {
    if (!copied) throw new Error('Copy a movement first.');
    if (copied.mode === 'own' && copied.sequence >= 0 && !sameSource)
        throw new Error('These parts have different source rigs. Copy custom poses, or choose and preview a movement for this part.');
    return { ...motion, mode: copied.mode, speed: copied.speed, phase: copied.phase, strength: copied.strength,
        sequences: { ...motion.sequences, [role]: copied.sequence }, keys: { ...motion.keys, [role]: structuredClone(copied.keys) } };
}
function basis(a, b, c) { const x = unit(subtract(b, a)), z = unit(cross(x, subtract(c, a))), y = cross(z, x); return [x, y, z]; }
function socket(mesh, posed, anchor) {
    let triangle = null, distance = Infinity;
    for (const f of mesh.faces) {
        const vertices = f.slice(0, 3).map(i => mesh.vertices[i]);
        if (Math.hypot(...cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0]))) < .01)
            continue;
        const centre = vertices[0].map((_, a) => vertices.reduce((n, v) => n + v[a], 0) / 3), d = Math.hypot(...subtract(centre, anchor));
        if (d < distance) {
            distance = d;
            triangle = f;
        }
    }
    if (!triangle)
        return point => point;
    const ids = triangle.slice(0, 3), rest = ids.map(i => mesh.vertices[i]), moved = ids.map(i => posed[i]), before = basis(...rest), after = basis(...moved);
    return point => { const v = subtract(point, rest[0]); return add(moved[0], [0, 1, 2].map(i => before.reduce((n, axis, a) => n + dot(v, axis) * after[a][i], 0))); };
}
export function keyPose(keys, time) {
    if (!keys?.length)
        return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    let a = keys[0], b = keys.at(-1);
    for (let i = 1; i < keys.length; i++)
        if (time <= keys[i].time) {
            a = keys[i - 1];
            b = keys[i];
            break;
        }
    const t = a === b ? 0 : Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
    return Object.fromEntries(['position', 'rotation', 'scale'].map(key => [key, a[key].map((n, i) => n + (b[key][i] - n) * t)]));
}
function nativeFrame(clip, time) { let t = ((time % clip.duration) + clip.duration) % clip.duration; for (const frame of clip.frames) {
    t -= frame.duration;
    if (t < 0)
        return frame;
} return clip.frames.at(-1); }
export function compileMotion(project, cache, role) {
    const parts = project.parts, active = parts.filter(p => p.visible && (p.variant === 'body' || p.variant === 'all')), base = assemble(parts, 'body'), sources = new Map(), clips = new Map(), entries = new Map();
    const sourceFor = part => { const key = [part.source.kind, part.source.id, part.source.variant].join('/'); if (!sources.has(key))
        sources.set(key, cache.describe(part.source.kind, part.source.id, part.source.variant)); return sources.get(key); };
    let duration = 0;
    for (const part of active) {
        const override=attackForRole(project,role)?.parts[part.id];
        const motion = override ? {...part.motion,...override} : part.motion, keys = motion?.keys?.[role] ?? (attackForRole(project,role)?motion?.keys?.attack:[]) ?? [], isRoot = !part.parentId;
        const sequence = part.mesh.vertexLinks ? -1 : motionSequence(project, part, role);
        let source = null, clip = null;
        if (sequence >= 0) {
            source = sourceFor(part);
            if(override){
                if(part.source.kind!=='npc')throw new Error('Borrow attack movements from an original creature part, or use poses.');
                const allowed=cache.attackChoices?.(part.source.id)?.rows;
                if(allowed && !allowed.some(row=>row.sequence===sequence))throw new Error(`Choose a named attack from ${part.name}'s original source, or use poses.`);
                const compatibility=motionCompatibility(part,source,sequence);if(!compatibility.usable)throw new Error(compatibility.text);
            }
            const key = [source.kind, source.id, source.variant, sequence].join('/');
            if (!clips.has(key))
                clips.set(key, cache.sample(source.mesh, sequence));
            clip = clips.get(key);
        }
        if (clip)
            duration = Math.max(duration, Math.round(clip.duration / (motion?.speed ?? 1) / 20) * 20);
        duration = Math.max(duration, keys.at(-1)?.time ?? 0);
        entries.set(part.id, { part, source, clip, keys, motion });
    }
    if (!duration)
        return null;
    if (duration > 8000)
        throw new Error('Combined movement exceeds eight seconds. Increase its speed or shorten its poses.');
    // Sample on exact 20ms client cycles. Longer movements use 40ms samples. The
    // exported per-frame durations sum to the complete timeline, without truncation.
    const step = duration > 4800 ? 40 : 20, frames = [];
    if (base.vertices.length * Math.ceil(duration / step) > 3000000)
        throw new Error('Combined animation is too large. Use fewer parts or a shorter movement.');
    for (let time = 0; time < duration; time += step) {
        const poses = new Map(), transforms = new Map(), sockets = new Map();
        for (const { part, source, clip, keys, motion } of entries.values()) {
            let vertices = part.mesh.vertices;
            if (clip) {
                const m = motion, frame = nativeFrame(clip, time * (m?.speed ?? 1) + (m?.phase ?? 0) * clip.duration), pivot = part.donorPivot ?? [0, 0, 0], map = part.mesh.sourceVertices ?? part.mesh.vertices.map((_, i) => i);
                if (!part.mesh.sourceVertices && part.mesh.vertices.length !== source.mesh.vertices.length)
                    throw new Error(`Re-add ${part.name} from its source to restore its animation mapping.`);
                let anchor = pivot;
                if (part.parentId) {
                    let nearest = 0, d = Infinity;
                    source.mesh.vertices.forEach((v, i) => { const n = Math.hypot(...subtract(v, pivot)); if (n < d) {
                        nearest = i;
                        d = n;
                    } });
                    anchor = add(pivot, subtract(frame.vertices[nearest], source.mesh.vertices[nearest]));
                }
                vertices = part.mesh.vertices.map((v, i) => { const id = map[i], original = source.mesh.vertices[id], moved = frame.vertices[id]; if (!original || !moved)
                    throw new Error(`Re-add ${part.name} from its source to restore its animation mapping.`); let delta = subtract(subtract(moved, original), subtract(anchor, pivot)); if (part.donorBasis)
                    delta = [0, 1, 2].map(a => delta.reduce((n, v, i) => n + v * part.donorBasis[i][a], 0)); return v.map((n, a) => n + delta[a] * (m?.strength ?? 1)); });
            }
            poses.set(part.id, vertices);
            const key = keyPose(keys, time), posed = { ...part, position: add(part.position, key.position), rotation: add(part.rotation, key.rotation), scale: part.scale.map((n, i) => n * key.scale[i]) };
            transforms.set(part.id, posed);
        }
        const animateWorld = (v, part) => { const posed = transforms.get(part.id) ?? part; let point = transformVertex(v, posed); const parent = parts.find(p => p.id === part.parentId); if (parent) {
            if (!sockets.has(part.id)) {
                const anchor = transformVertex(part.pivot, part);
                sockets.set(part.id, socket(parent.mesh, poses.get(parent.id) ?? parent.mesh.vertices, anchor));
            }
            point = sockets.get(part.id)(point);
            return animateWorld(point, parent);
        } return point; };
        const vertices = [];
        for (const part of active) {
            let ancestor = part, paired = false;
            while (ancestor) {
                paired ||= !!ancestor.pair;
                ancestor = parts.find(p => p.id === ancestor.parentId);
            }
            for (const twin of paired ? [false, true] : [false])
                for (const vertex of poses.get(part.id)) {
                    let point = animateWorld(vertex, part);
                    if (twin)
                        point = reflectPoint(point, parts.find(p => p.id === part.parentId), parts);
                    vertices.push(point.map(n => Math.round(n) || 0));
                }
        }
        let offset=0;
        for(const part of active){
            if(part.mesh.vertexLinks)part.mesh.vertexLinks.forEach((ref,i)=>{
                const endpoint=parts.find(p=>p.id===ref.partId);if(!active.includes(endpoint))throw new Error('Show both connected parts before previewing or exporting.');
                let point=animateWorld(poses.get(endpoint.id)[ref.vertex],endpoint);
                if(ref.twin)point=reflectPoint(point,parts.find(p=>p.id===endpoint.parentId),parts);
                vertices[offset+i]=point.map(Math.round);
            });
            let ancestor=part,paired=false;while(ancestor){paired ||=!!ancestor.pair;ancestor=parts.find(p=>p.id===ancestor.parentId);}offset+=part.mesh.vertices.length*(paired?2:1);
        }
        frames.push({ duration: Math.min(step, duration - time), vertices });
    }
    return { mesh: base, frames, length: frames.length, duration, role };
}
