import { hslRgb, rgbHsl } from './mesh.mjs';

// PlayerComposition recolours this exact native HSL to the wearer's skin tone.
export const NATIVE_SKIN_COLOUR = 4550;
export const SKIN_PREVIEW_HEX = '#ef4cdb';
export const isSkinColour = colour => colour === NATIVE_SKIN_COLOUR;

const packed = (h, s, l) => (h << 10) | (s << 7) | l;
// Native HSL values used by the original GhostScape material picker.
export const PAINT_PRESETS = [
    { name: 'Rune', colours: [packed(35, 2, 37), packed(6, 7, 74), packed(0, 0, 8)] },
    { name: 'Dragon', colours: [packed(0, 7, 28), packed(6, 7, 14), packed(6, 7, 74)] },
    { name: 'Bronze', colours: [packed(5, 4, 20), packed(5, 4, 38), packed(7, 2, 90)] },
    { name: 'Steel', colours: [packed(0, 0, 61), packed(40, 5, 45), packed(0, 0, 8)] },
    { name: 'Mithril', colours: [packed(42, 2, 33), packed(0, 0, 61), packed(48, 4, 40)] },
    { name: 'Adamant', colours: [packed(21, 1, 30), packed(5, 3, 20), packed(6, 7, 74)] },
    { name: 'Forest', colours: [packed(22, 3, 35), packed(5, 4, 38), packed(8, 2, 100)] },
    { name: 'Bone', colours: [packed(7, 2, 90), packed(5, 3, 20), packed(0, 6, 35)] },
];

export const colourHex = colour => '#' + hslRgb(colour).map(n => n.toString(16).padStart(2, '0')).join('');
export function parsePaintColour(value) {
    if (Number.isInteger(value) && value >= 0 && value <= 65535) return value;
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return rgbHsl(value);
    throw new Error('Use a six-digit colour such as #b99558.');
}

export function paintScope(parts, { scope = 'view', selectedId, chosenIds = [], variant = 'body' } = {}) {
    if (scope === 'all') return [...parts];
    if (scope === 'chosen') { const ids = new Set(chosenIds); return parts.filter(p => ids.has(p.id)); }
    if (scope === 'branch') {
        const ids = new Set([selectedId]);
        for (const id of ids) for (const p of parts) if (p.parentId === id) ids.add(p.id);
        return parts.filter(p => ids.has(p.id));
    }
    if (scope === 'selected') return parts.filter(p => p.id === selectedId);
    return parts.filter(p => p.visible !== false && (p.variant === variant || p.variant === 'all'));
}

const textureAt = (mesh, i) => mesh.textures?.[i] ?? -1;
const eligible = (mesh, i, textureMode) => mesh.renderTypes?.[i] !== 2 && mesh.alpha?.[i] !== 255 && (textureMode === 'replace' || textureAt(mesh, i) < 0);

export function collectPaintPalette(parts, { textureMode = 'keep', limit = 256 } = {}) {
    const colours = new Map();
    for (const { mesh } of parts) mesh.faces.forEach((f, i) => {
        if (!eligible(mesh, i, textureMode) || isSkinColour(f[3])) return;
        const row = colours.get(f[3]) ?? { colour: f[3], count: 0, hex: colourHex(f[3]) };
        row.count++;
        colours.set(f[3], row);
    });
    return [...colours.values()].sort((a, b) => b.count - a.count || a.colour - b.colour).slice(0, limit);
}

export function colourChannels(mesh, textureMode = 'keep') {
    const groups = new Map();
    mesh.faces.forEach((f, i) => {
        if (!eligible(mesh, i, textureMode) || isSkinColour(f[3])) return;
        const key = f[3] >> 7, row = groups.get(key) ?? { key, count: 0, light: 0 };
        row.count++; row.light += f[3] & 127; groups.set(key, row);
    });
    return [...groups.values()].sort((a, b) => b.count - a.count || a.key - b.key).map((g, i) => ({
        ...g, light: g.light / g.count, channel: i === 0 ? 'main' : i === 1 ? 'accent' : 'detail',
        colour: (g.key << 7) | Math.round(g.light / g.count),
    }));
}

export function paletteFromParts(parts, textureMode = 'keep') {
    const mesh = { faces: [], textures: [], renderTypes: [], alpha: [] };
    for (const p of parts) p.mesh.faces.forEach((f, i) => {
        mesh.faces.push(f); mesh.textures.push(textureAt(p.mesh, i));
        mesh.renderTypes.push(p.mesh.renderTypes?.[i] ?? 0); mesh.alpha.push(p.mesh.alpha?.[i] ?? 0);
    });
    return colourChannels(mesh, textureMode).slice(0, 12).map(g => g.colour);
}

export function shadedPaint(original, target, averageLight, keepShading = true) {
    if (!keepShading || isSkinColour(original) || isSkinColour(target)) return target;
    const light = Math.max(2, Math.min(126, Math.round((original & 127) + (target & 127) - averageLight)));
    return (target & 65408) | light;
}

function addChange(plan, part, i, to, textureMode) {
    const from = part.mesh.faces[i][3], textureFrom = textureAt(part.mesh, i);
    const textureTo = textureMode === 'replace' ? -1 : textureFrom;
    if (from !== to || textureFrom !== textureTo) plan.changes.push({ partId: part.id, faceId: i, from, to, textureFrom, textureTo });
}

// Plans contain original values, so colour swaps never cascade and stale previews
// fail before any face is modified. Nothing here adds fields to a saved project.
export function createPalettePlan(parts, palette, { textureMode = 'keep', keepShading = true, channel = 'all' } = {}) {
    if (!Array.isArray(palette) || !palette.length || palette.length > 256) throw new Error('Choose a palette with 1 to 256 colours.');
    palette = palette.map(parsePaintColour);
    const plan = { changes: [], skippedTextures: 0 };
    for (const part of parts) {
        const channels = new Map(colourChannels(part.mesh, textureMode).map(g => [g.key, g]));
        part.mesh.faces.forEach((f, i) => {
            if (textureMode !== 'replace' && textureAt(part.mesh, i) >= 0) plan.skippedTextures++;
            if (!eligible(part.mesh, i, textureMode) || isSkinColour(f[3])) return;
            const g = channels.get(f[3] >> 7);
            if (channel !== 'all' && g.channel !== channel) return;
            const index = channel === 'all' ? g.channel === 'main' ? 0 : g.channel === 'accent' ? 1 : 2 : 0;
            const target = palette[Math.min(index, palette.length - 1)];
            addChange(plan, part, i, shadedPaint(f[3], target, g.light, keepShading), textureMode);
        });
    }
    return plan;
}

export function createColourReplacePlan(parts, from, to, { textureMode = 'keep' } = {}) {
    from = parsePaintColour(from); to = parsePaintColour(to);
    const plan = { changes: [], skippedTextures: 0 };
    for (const part of parts) part.mesh.faces.forEach((f, i) => {
        if (f[3] !== from) return;
        if (textureMode !== 'replace' && textureAt(part.mesh, i) >= 0) plan.skippedTextures++;
        if (eligible(part.mesh, i, textureMode)) addChange(plan, part, i, to, textureMode);
    });
    return plan;
}

export function paintPlanRows(plan) {
    const rows = new Map();
    for (const c of plan.changes) {
        const key = `${c.from}/${c.to}`, row = rows.get(key) ?? { key, from: c.from, to: c.to, count: 0, textures: 0 };
        row.count++; row.textures += Number(c.textureFrom >= 0 && c.textureTo < 0); rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => b.count - a.count || a.from - b.from || a.to - b.to);
}

export function editPaintPlanRow(plan, key, colour) {
    const to = parsePaintColour(colour);
    return { ...plan, changes: plan.changes.map(c => `${c.from}/${c.to}` === key ? { ...c, to } : { ...c }) };
}

export function validatePaintPlan(parts, plan) {
    const byId = new Map(parts.map(p => [p.id, p]));
    for (const c of plan.changes) {
        const mesh = byId.get(c.partId)?.mesh;
        if (!mesh || mesh.faces[c.faceId]?.[3] !== c.from || textureAt(mesh, c.faceId) !== c.textureFrom)
            throw new Error('The model changed. Preview the colours again.');
    }
    return byId;
}

export function applyPaintPlan(parts, plan) {
    const byId = validatePaintPlan(parts, plan);
    for (const c of plan.changes) {
        const mesh = byId.get(c.partId).mesh;
        mesh.faces[c.faceId][3] = c.to;
        if (mesh.textures && c.textureTo !== c.textureFrom) mesh.textures[c.faceId] = c.textureTo;
    }
    return plan.changes.length;
}

const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const sub = (a, b) => a.map((n, i) => n - b[i]);
export function paintFaceNormal(mesh, id) {
    const [a, b, c] = mesh.faces[id].slice(0, 3).map(i => mesh.vertices[i]), u = sub(b, a), v = sub(c, a);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n) || 1;
    return n.map(x => x / length);
}

const pointKey = p => p.map(n => Math.round(n * 1000)).join(',');
const triangleKey = points => points.map(pointKey).sort().join(';');
export function paintTopology(mesh) {
    const edges = new Map(), adjacent = Array.from({ length: mesh.faces.length }, () => new Set());
    const triangles = new Map();
    mesh.faces.forEach((f, i) => {
        const points = f.slice(0, 3).map(v => mesh.vertices[v]), key = triangleKey(points);
        if (!triangles.has(key)) triangles.set(key, []);
        triangles.get(key).push(i);
        const keys = points.map(pointKey);
        for (let a = 0; a < 3; a++) {
            const edge = [keys[a], keys[(a + 1) % 3]].sort().join(';');
            for (const other of edges.get(edge) ?? []) { adjacent[i].add(other); adjacent[other].add(i); }
            if (!edges.has(edge)) edges.set(edge, []);
            edges.get(edge).push(i);
        }
    });
    return { adjacent, triangles };
}

export function connectedPaintFaces(mesh, seed, { sameColour = false, allow = () => true, topology = paintTopology(mesh) } = {}) {
    if (!mesh.faces[seed] || !allow(seed)) return [];
    const seen = new Set([seed]), queue = [seed], colour = mesh.faces[seed][3], texture = textureAt(mesh, seed);
    for (let head = 0; head < queue.length; head++) for (const id of topology.adjacent[queue[head]]) {
        if (seen.has(id) || !allow(id) || sameColour && (mesh.faces[id][3] !== colour || textureAt(mesh, id) !== texture)) continue;
        seen.add(id); queue.push(id);
    }
    return queue;
}

// Distance to the triangle itself. Testing only vertices misses large faces when
// the cursor is over their middle and the brush is smaller than the face.
export function triangleDistanceSquared(point, a, b, c) {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(point, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
    const bp = sub(point, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); const d = sub(ap, ab.map(x => x * v)); return dot(d, d); }
    const cp = sub(point, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); const d = sub(ap, ac.map(x => x * w)); return dot(d, d); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + d5 - d6), bc = sub(c, b), d = sub(bp, bc.map(x => x * w)); return dot(d, d);
    }
    const sum = va + vb + vc;
    if (Math.abs(sum) < 1e-12) return Math.min(dot(ap, ap), dot(bp, bp), dot(cp, cp));
    const v = vb / sum, w = vc / sum, d = ap.map((x, i) => x - ab[i] * v - ac[i] * w);
    return dot(d, d);
}

export function mirrorPaintFaces(mesh, ids, plane = 0, topology = paintTopology(mesh)) {
    const found = new Set(), missing = [];
    for (const id of ids) {
        const key = triangleKey(mesh.faces[id].slice(0, 3).map(v => mesh.vertices[v].map((n, axis) => axis === 0 ? 2 * plane - n : n)));
        // Ambiguous coincident triangles are left alone rather than painting an
        // arbitrary inner lining. Exact matching also avoids distant near misses.
        const partners = topology.triangles.get(key) ?? [];
        if (partners.length === 1) found.add(partners[0]); else missing.push(id);
    }
    return { ids: [...found], missing };
}

export function paintHitFaces(mesh, seed, point, {
    tool = 'face', radius = 22, textureMode = 'keep', protectBack = true,
    connected = true, mirror = false, mirrorPlane = 0, topology = paintTopology(mesh),
} = {}) {
    if (!mesh.faces[seed]) return { ids: [], missing: [] };
    const allow = id => eligible(mesh, id, textureMode);
    let ids;
    if (tool === 'colour') ids = mesh.faces.flatMap((f, i) => f[3] === mesh.faces[seed][3] && allow(i) ? [i] : []);
    else if (tool === 'fill') ids = connectedPaintFaces(mesh, seed, { sameColour: true, allow, topology });
    else if (tool === 'piece') ids = connectedPaintFaces(mesh, seed, { allow, topology });
    else if (tool === 'brush') {
        const normal = paintFaceNormal(mesh, seed);
        const withinBrush = id => allow(id) && (!protectBack || dot(normal, paintFaceNormal(mesh, id)) > .05)
            && triangleDistanceSquared(point, ...mesh.faces[id].slice(0, 3).map(v => mesh.vertices[v])) <= radius * radius;
        // Follow only edges under the brush instead of scanning the full body
        // every pointer movement. Gaps and bridges outside the brush stop it.
        ids = connected ? connectedPaintFaces(mesh, seed, { allow: withinBrush, topology }) : mesh.faces.flatMap((_, i) => withinBrush(i) ? [i] : []);
    } else ids = allow(seed) ? [seed] : [];
    if (!mirror) return { ids, missing: [] };
    const mirrored = mirrorPaintFaces(mesh, ids, mirrorPlane, topology);
    return { ids: [...new Set([...ids, ...mirrored.ids.filter(allow)])], missing: mirrored.missing };
}

export function createBrushPlan(part, ids, colour, { textureMode = 'keep', keepShading = false } = {}) {
    colour = parsePaintColour(colour);
    const plan = { changes: [], skippedTextures: 0 };
    const channels = keepShading ? new Map(colourChannels(part.mesh, textureMode).map(g => [g.key, g])) : null;
    for (const id of new Set(ids)) {
        if (!part.mesh.faces[id] || !eligible(part.mesh, id, textureMode)) continue;
        const from = part.mesh.faces[id][3], g = channels?.get(from >> 7);
        addChange(plan, part, id, shadedPaint(from, colour, g?.light ?? 0, keepShading), textureMode);
    }
    return plan;
}

const orientedKey = indices => [indices, [indices[1], indices[2], indices[0]], [indices[2], indices[0], indices[1]]].map(v => v.join(',')).sort()[0];
export function sourceMaterialPlan(mesh, source) {
    // Old extracted meshes without source identities cannot safely use their
    // renumbered local indices as indices in the full donor.
    if (!mesh.sourceVertices && mesh.vertices.length !== source.vertices.length)
        return { faces: [], skipped: mesh.faces.map((_, i) => i) };
    const oriented = new Map(), unordered = new Map(), currentVertices = new Map();
    const add = (map, key, id) => { if (!map.has(key)) map.set(key, []); map.get(key).push(id); };
    source.faces.forEach((f, i) => { add(oriented, orientedKey(f.slice(0, 3)), i); add(unordered, f.slice(0, 3).sort((a, b) => a - b).join(','), i); });
    mesh.vertices.forEach((_, i) => { const original = mesh.sourceVertices?.[i] ?? i; if (!currentVertices.has(original)) currentVertices.set(original, i); });
    const faces = [], skipped = [];
    mesh.faces.forEach((f, i) => {
        const indices = f.slice(0, 3).map(v => mesh.sourceVertices?.[v] ?? v);
        let candidates = oriented.get(orientedKey(indices));
        if (!candidates?.length) candidates = unordered.get([...indices].sort((a, b) => a - b).join(','));
        if (candidates?.length !== 1) { skipped.push(i); return; }
        const id = candidates[0], texture = textureAt(source, id), coord = source.textureCoords?.[id] ?? -1;
        const projection = texture >= 0 ? (coord >= 0 ? source.textureMappings?.[coord] : source.faces[id].slice(0, 3)) : null;
        const mapping = projection?.map(v => currentVertices.get(v));
        if (mapping?.some(v => v === undefined)) { skipped.push(i); return; }
        faces.push({ faceId: i, colour: source.faces[id][3], texture, mapping });
    });
    return { faces, skipped };
}

export function restoreSourceMaterials(mesh, plan) {
    let changed = 0;
    const mappings = new Map((mesh.textureMappings ?? []).map((m, i) => [m.join(','), i]));
    for (const row of plan.faces) {
        const { faceId: id, colour, texture, mapping } = row;
        if (!mesh.faces[id]) continue;
        const currentCoord = mesh.textureCoords?.[id] ?? -1;
        const currentMapping = currentCoord >= 0 ? mesh.textureMappings?.[currentCoord] : mesh.faces[id].slice(0, 3);
        const mappingChanged = mapping && mapping.some((v, i) => v !== currentMapping?.[i]);
        if (mesh.faces[id][3] === colour && textureAt(mesh, id) === texture && !mappingChanged) continue;
        mesh.faces[id][3] = colour;
        if (mesh.textures || texture >= 0) { mesh.textures ??= mesh.faces.map(() => -1); mesh.textures[id] = texture; }
        if (mapping && !mapping.every((v, i) => v === mesh.faces[id][i])) {
            mesh.textureMappings ??= []; mesh.textureCoords ??= mesh.faces.map(() => -1);
            let coord = mappings.get(mapping.join(','));
            if (coord === undefined) { coord = mesh.textureMappings.length; mesh.textureMappings.push([...mapping]); mappings.set(mapping.join(','), coord); }
            mesh.textureCoords[id] = coord;
        } else if (mesh.textureCoords) mesh.textureCoords[id] = -1;
        changed++;
    }
    if (mesh.textureMappings?.length > 40000) {
        const used = new Map();
        mesh.textureCoords = mesh.textureCoords.map(id => {
            if (id < 0) return -1;
            if (!used.has(id)) used.set(id, used.size);
            return used.get(id);
        });
        mesh.textureMappings = [...used.keys()].map(id => mesh.textureMappings[id]);
    }
    return changed;
}

export function parsePaintPalette(text) {
    if (typeof text !== 'string' || text.length > 32768) throw new Error('Palette files must be smaller than 32 KB.');
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Choose a palette JSON file.'); }
    const colours = Array.isArray(data) ? data : data?.colours;
    if (!Array.isArray(colours) || !colours.length || colours.length > 256) throw new Error('A palette needs 1 to 256 colours.');
    return { name: typeof data.name === 'string' ? data.name.slice(0, 80) : 'Imported palette', colours: colours.map(parsePaintColour) };
}

export function exportPaintPalette(name, colours) {
    return JSON.stringify({ format: 'tsps-palette/1', name: String(name).slice(0, 80), colours: colours.map(parsePaintColour) }, null, 2);
}
