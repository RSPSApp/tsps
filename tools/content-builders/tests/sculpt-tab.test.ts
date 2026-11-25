import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyVertexUpdates, brushFaces, changeFaceSelection, connectedFaces, faceNormal, meshTopology, mirroredFaces,
    planFlatten, planRegionOffset, planSculpt, planSeamConnection, regionVertices, safeVertexUpdates, visibleFaceIds,
    pickBoundary, planBridge, addFace, buildFace, startFace, fillOpening, deleteFaces } from '../shared/sculpt.mjs';
import { assemble, localPoint, reflectPoint, validateMesh, worldPoint } from '../shared/mesh.mjs';
import { makePart } from '../shared/project.mjs';

const quad = () => ({ vertices: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], faces: [[0, 1, 2, 32000], [0, 2, 3, 22000]],
    skins: [0, 1, 2, 3], bones: [[1], [2], [3], [4]], weights: [[255], [255], [255], [255]],
    sourceVertices: [17, 9, 35, 4], textures: [7, -1], textureCoords: [0, -1], textureMappings: [[0, 1, 2]],
    alpha: [0, 23], priorities: [2, 4], renderTypes: [0, 1], faceLabels: [2, 3], sourceFaces: [17, 19] });
const withoutCoordinates = mesh => Object.fromEntries(Object.entries(mesh).filter(([key]) => key !== 'vertices'));
const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} should equal ${b}`);
const pointClose = (a, b) => a.forEach((n, i) => close(n, b[i]));
const part = (id, mesh, variant = 'body') => ({ ...makePart({ name: id, kind: 'npc', id: 1, variant, mesh }, variant), id });
function splitMesh() {
    return { vertices: [[0, 0, 0], [0, 10, 0], [-10, 0, 0], [1, 0, 0], [1, 10, 0], [11, 0, 0]],
        faces: [[0, 1, 2, 32000], [3, 5, 4, 32001]], skins: [0, 0, 0, 1, 1, 1],
        sourceVertices: [1, 4, 8, 12, 16, 20], bones: [[1], [1], [1], [2], [2], [2]], weights: [[255], [255], [255], [255], [255], [255]] };
}
function grid(size = 5) {
    const vertices = [], faces = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) vertices.push([x * 10, y * 10, 0]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const i = y * size + x; faces.push([i, i + 1, i + size + 1, 1], [i, i + size + 1, i + size, 2]);
    }
    return { vertices, faces };
}

test('add and delete face edits preserve source vertices, skeletal weights and native texture projections',()=>{
    const original=quad(),cut=deleteFaces(original,[1]);
    assert.equal(cut.faces.length,1);assert.deepEqual(cut.vertices,original.vertices);assert.deepEqual(cut.sourceVertices,original.sourceVertices);
    assert.deepEqual(cut.sourceFaces,[17],'deleting a face must retain the correct donor face identities');
    const filled=addFace(cut,[0,2,3],0);assert.deepEqual(filled.faces[1].slice(0,3),[0,2,3]);
    assert.equal(filled.textures[1],7);assert.equal(filled.textureCoords[1],0);assert.deepEqual(filled.textureMappings,original.textureMappings);
    assert.deepEqual(filled.sourceFaces,[17,-1],'an authored face does not claim a native donor face identity');
    assert.deepEqual(filled.weights,original.weights);assert.deepEqual(filled.bones,original.bones);validateMesh(filled);
    assert.throws(()=>addFace(filled,[2,1,0]),/already|overlap/);assert.throws(()=>deleteFaces(original,[0,1]),/whole part/);
    const corrupt=structuredClone(filled);corrupt.vertices[3]=corrupt.vertices[0];assert.throws(()=>validateMesh(corrupt),/collapsed/);
});

test('bridges add wound faces and preserve animated endpoint identities and textured materials',()=>{
    const first=part('first',splitMesh()),second=part('second',quad());second.position=[20,0,10];second.rotation=[0,180,0];
    const a={partId:first.id,twin:false,vertices:[0,1],edges:[[0,1]],faceIds:[0],closed:false};
    const b={partId:first.id,twin:false,vertices:[4,3],edges:[[4,3]],faceIds:[1],closed:false};
    const before=structuredClone(first),plan=planBridge([first],a,b);
    assert.equal(plan.part.mesh.faces.length,2);assert.equal(plan.part.mesh.vertexLinks.length,4);assert.deepEqual(first,before);
    const assembled=assemble([first,plan.part],'body');validateMesh(assembled);assert.equal(assembled.faces.length,4);
    assert.deepEqual(assembled.skins.slice(6),[0,0,1,1]);assert.deepEqual(assembled.weights.slice(6),[[255],[255],[255],[255]]);
    first.mesh.vertices[0][2]=7;assert.deepEqual(assemble([first,plan.part],'body').vertices[7],first.mesh.vertices[0]);
    assert.throws(()=>planBridge([first,plan.part],a,b),/already/);
    const boundary=pickBoundary([second],{partId:second.id,faceId:0,point:worldPoint([5,0,0],second,[second])});
    assert.equal(boundary.closed,true);assert.equal(boundary.vertices.length,4);
});

test('an unequal opening bridge uses both complete boundaries without moving source geometry',()=>{
    const a=part('a',{vertices:[[0,0,0],[10,0,0],[0,10,0]],faces:[[0,1,2,100]]});
    const b=part('b',{vertices:[[0,0,10],[10,0,10],[10,10,10],[0,10,10]],faces:[[2,1,0,200],[3,2,0,200]]});
    const first=pickBoundary([a,b],{partId:'a',faceId:0,point:[2,0,0]}),second=pickBoundary([a,b],{partId:'b',faceId:0,point:[2,0,10]});
    const plan=planBridge([a,b],first,second);assert.equal(plan.part.mesh.faces.length,7);validateMesh(plan.part.mesh);
    assert.equal(plan.part.connectionEdges.length,7);assert.deepEqual(a.mesh.vertices,[[0,0,0],[10,0,0],[0,10,0]]);
});

test('connected selection follows shared edges and coordinate seams, but not a single touching corner', () => {
    const mesh = { vertices: [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 0, 0], [0, 10, 0], [10, 10, 0], [20, 0, 0], [20, 10, 0]],
        faces: [[0, 1, 2, 1], [3, 5, 4, 2], [5, 6, 7, 3]] };
    assert.deepEqual([...connectedFaces(mesh, [0])], [0, 1]);
    assert.deepEqual([...connectedFaces(mesh, [0], { topology: meshTopology(mesh, { coincident: false }) })], [0]);
    assert.equal(mesh.vertices.length, 8);
});

test('connected surface selection stops at the chosen bend angle', () => {
    const mesh = { vertices: [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]], faces: [[0, 1, 2, 1], [1, 0, 3, 1]] };
    assert.deepEqual([...connectedFaces(mesh, [0], { angle: 45 })], [0]);
    assert.deepEqual([...connectedFaces(mesh, [0], { angle: 95 })], [0, 1]);
});

test('grow, shrink, connected, invert and clear preserve valid source face indices', () => {
    const mesh = grid(), all = changeFaceSelection(mesh, new Set(), 'all');
    const inner = changeFaceSelection(mesh, all, 'shrink');
    assert.ok(inner.size > 0 && inner.size < all.size);
    const grown = changeFaceSelection(mesh, inner, 'grow');
    assert.ok(grown.size > inner.size);
    assert.deepEqual([...changeFaceSelection(mesh, new Set([0]), 'connected')].sort((a, b) => a - b), [...all]);
    assert.deepEqual([...changeFaceSelection(quad(), new Set([0, 99]), 'invert')], [1]);
    assert.equal(changeFaceSelection(mesh, all, 'clear').size, 0);
});

test('selection borders can remain fixed while region-only sculpting moves interior vertices', () => {
    const mesh = quad(), original = structuredClone(mesh);
    assert.deepEqual([...regionVertices(mesh, new Set([0]), { lockBoundary: true })], [1]);
    const plan = planSculpt(mesh, { center: [5, 5, 0], radius: Infinity, amount: 2, normal: [0, 0, 1], faces: new Set([0]), lockBoundary: true });
    assert.deepEqual([...plan.updates.keys()], [1]); applyVertexUpdates(mesh, plan.updates);
    assert.deepEqual(mesh.vertices[0], original.vertices[0]); assert.deepEqual(mesh.vertices[2], original.vertices[2]);
    assert.equal(mesh.vertices[1][2], 2); assert.deepEqual(mesh.vertices[3], original.vertices[3]);
    assert.deepEqual(withoutCoordinates(mesh), withoutCoordinates(original)); validateMesh(mesh);
});

test('brush selection includes a large face even when all its vertices are outside the brush', () => {
    const mesh = { vertices: [[0, 0, 0], [100, 0, 0], [0, 100, 0]], faces: [[0, 1, 2, 1]] };
    assert.deepEqual([...brushFaces(mesh, [20, 20, 0], 1)], [0]);
    assert.equal(brushFaces(mesh, [80, 80, 0], 1).size, 0);
    assert.equal(brushFaces(mesh, [20, 20, 0], 0).size, 0);
});

test('brush size can be measured in displayed world units through scaled parts', () => {
    const mesh = quad(), plan = planSculpt(mesh, { center: [0, 0, 0], radius: 5, amount: 1, normal: [0, 0, 1], metric: p => p.map(n => n * 10) });
    assert.deepEqual([...plan.updates.keys()], [0]);
});

test('mirror selection and brushing edit opposite source faces without doubling the centre', () => {
    const mesh = { vertices: [[-4, 0, 0], [-2, 0, 0], [-3, 2, 0], [4, 0, 0], [2, 0, 0], [3, 2, 0]],
        faces: [[0, 1, 2, 1], [5, 4, 3, 2]] };
    assert.deepEqual([...mirroredFaces(mesh, new Set([0]))], [0, 1]);
    const plan = planSculpt(mesh, { center: [-3, 1, 0], radius: 100, amount: 1, normal: [0, 0, 1], mirror: true, falloff: 'constant' });
    assert.equal(plan.updates.size, 6); applyVertexUpdates(mesh, plan.updates);
    assert.ok(mesh.vertices.every(v => v[2] === 1));
});

test('push, smooth and flatten use existing vertices and preserve every material and rig array', () => {
    const mesh = quad(), identity = structuredClone(withoutCoordinates(mesh));
    mesh.vertices[2][2] = 4;
    applyVertexUpdates(mesh, planSculpt(mesh, { center: [5, 5, 0], radius: Infinity, amount: 1, tool: 'push', normal: [0, 0, 1] }).updates);
    assert.equal(mesh.vertices[0][2], -1);
    const before = mesh.vertices[2][2];
    applyVertexUpdates(mesh, planSculpt(mesh, { center: [10, 10, 3], radius: 1, amount: 1, tool: 'smooth' }).updates);
    assert.ok(mesh.vertices[2][2] < before);
    applyVertexUpdates(mesh, planFlatten(mesh, new Set([0, 1]), { axis: 2 }).updates);
    mesh.vertices.forEach(v => close(v[2], mesh.vertices[0][2]));
    assert.deepEqual(withoutCoordinates(mesh), identity); validateMesh(mesh);
});

test('inflate and deflate follow each vertex normal on a closed selection', () => {
    const mesh = { vertices: [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]], faces: [[0, 2, 1, 1], [0, 1, 3, 1], [0, 3, 2, 1], [1, 2, 3, 1]] };
    const faces = new Set([0, 1, 2, 3]), plan = planRegionOffset(mesh, faces, { amount: .2 });
    assert.equal(plan.updates.size, 4);
    for (const [i, next] of plan.updates) close(Math.hypot(...next.map((n, a) => n - mesh.vertices[i][a])), .2);
    assert.match(planFlatten(mesh, faces).reason, /local X, Y or Z/);
});

test('safety checks reject collapsed, inverted, invalid and out-of-bounds coordinates', () => {
    const mesh = quad();
    assert.equal(safeVertexUpdates(mesh, new Map([[1, mesh.vertices[0]]])).updates.size, 0);
    assert.equal(safeVertexUpdates(mesh, new Map([[1, [-10, 0, 0]]])).updates.size, 0);
    const plan = safeVertexUpdates(mesh, new Map([[0, [16001, 0, 0]], [1, [NaN, 0, 0]], [2, null], [99, [0, 0, 0]]]));
    assert.equal(plan.updates.size, 0); assert.equal(plan.skipped, 4);
    assert.deepEqual(mesh, quad());
});

test('surface repair snaps both seam endpoints and preserves topology, source identities and skinning', () => {
    const mesh = splitMesh(), source = part('body', mesh), original = structuredClone(mesh);
    assert.deepEqual([...connectedFaces(mesh, [0])], [0]);
    const plan = planSeamConnection([source], source.id, { faces: new Set([0]), tolerance: 2 });
    assert.equal(plan.pairs.length, 1); assert.equal(plan.updates.size, 2);
    assert.deepEqual(mesh, original, 'preview is read-only');
    applyVertexUpdates(mesh, plan.updates);
    assert.deepEqual(mesh.vertices[0], mesh.vertices[3]); assert.deepEqual(mesh.vertices[1], mesh.vertices[4]);
    assert.deepEqual([...connectedFaces(mesh, [0])], [0, 1], 'the repaired surface can be selected across the seam');
    assert.deepEqual(withoutCoordinates(mesh), withoutCoordinates(original)); validateMesh(mesh);
    assert.equal(planSeamConnection([source], source.id, { faces: new Set([0]), tolerance: .25 }).pairs.length, 0);
});

test('surface repair rejects a partial match and an edge that would collapse a donor face', () => {
    const source = part('source', { vertices: [[0, 0, 0], [0, 10, 0], [-10, 0, 0], [-20, 10, 0]], faces: [[0, 1, 2, 1], [1, 3, 2, 1], [2, 3, 0, 1]] });
    const target = part('target', { vertices: [[-10, 0, 0], [-10, 10, 0], [-20, 0, 0]], faces: [[0, 1, 2, 1]] });
    const plan = planSeamConnection([source, target], source.id, { target: 'parts', tolerance: 11, faces: new Set([0]) });
    assert.equal(plan.pairs.length, 0); assert.equal(plan.updates.size, 0);
    target.mesh.vertices = [[1, 0, 0], [1, 30, 0], [20, 0, 0]];
    assert.equal(planSeamConnection([source, target], source.id, { target: 'parts', tolerance: 2, faces: new Set([0]) }).pairs.length, 0);
});

test('adjacent seam edges can share consistently matched endpoints', () => {
    const source = part('source', { vertices: [[0, 0, 0], [0, 10, 0], [0, 20, 0], [-10, 10, 0]], faces: [[0, 1, 3, 1], [1, 2, 3, 1]] });
    const target = part('target', { vertices: [[1, 0, 0], [1, 10, 0], [1, 20, 0], [11, 10, 0]], faces: [[0, 3, 1, 1], [1, 3, 2, 1]] });
    const plan = planSeamConnection([source, target], source.id, { target: 'parts', tolerance: 2 });
    assert.equal(plan.pairs.length, 2); assert.equal(plan.updates.size, 3);
    applyVertexUpdates(source.mesh, plan.updates);
    for (let i = 0; i < 3; i++) assert.deepEqual(source.mesh.vertices[i], target.mesh.vertices[i]);
});

test('gear seam snapping respects hidden ancestor transforms and leaves the target and transforms untouched', () => {
    const parent = part('parent', quad(), 'all'); parent.rotation = [10, 20, 75]; parent.scale = [1.3, .8, 2]; parent.position = [25, -80, 12]; parent.visible = false;
    const source = part('source', { vertices: [[0, 0, 0], [0, 10, 0], [-10, 0, 0]], faces: [[0, 1, 2, 1]], sourceVertices: [14, 20, 3] }, 'male');
    source.parentId = parent.id; source.position = [5, 0, 0]; source.rotation = [0, 10, 5];
    const target = part('target', quad(), 'all'); target.position = [-12, 9, 4]; target.rotation = [5, 30, 0];
    const parts = [parent, source, target], destinations = source.mesh.vertices.slice(0, 2).map(p => worldPoint(p, source, parts).map((n, a) => n + (a === 2 ? .8 : 0)));
    target.mesh = { vertices: [...destinations.map(p => localPoint(p, target, parts)), localPoint(destinations[0].map((n, a) => n + (a === 0 ? 20 : 0)), target, parts)], faces: [[0, 2, 1, 1]] };
    const before = structuredClone(parts), plan = planSeamConnection(parts, source.id, { target: 'parts', tolerance: 1, variant: 'male' });
    assert.equal(plan.pairs.length, 1); applyVertexUpdates(source.mesh, plan.updates);
    pointClose(worldPoint(source.mesh.vertices[0], source, parts), destinations[0]); pointClose(worldPoint(source.mesh.vertices[1], source, parts), destinations[1]);
    assert.deepEqual(target, before[2]); assert.deepEqual(parent, before[0]);
    assert.deepEqual({ ...source, mesh: null }, { ...before[1], mesh: null });
    assert.deepEqual(source.mesh.sourceVertices, [14, 20, 3]);
});

test('seam snapping on a paired instance edits its original source and still assembles both copies', () => {
    const source = part('source', { vertices: [[0, 0, 0], [0, 10, 0], [-10, 0, 0]], faces: [[0, 1, 2, 1]] });
    source.position = [-10, 0, 0]; source.pair = true;
    const target = part('target', { vertices: [[11, 0, 0], [11, 10, 0], [30, 0, 0]], faces: [[0, 2, 1, 1]] });
    const parts = [source, target], plan = planSeamConnection(parts, source.id, { target: 'parts', tolerance: 2, sourceTwin: true });
    assert.equal(plan.pairs.length, 1); applyVertexUpdates(source.mesh, plan.updates);
    pointClose(reflectPoint(worldPoint(source.mesh.vertices[0], source, parts), null, parts), [11, 0, 0]);
    assert.equal(assemble(parts, 'body').faces.length, 3); assert.equal(source.pair, true);
});

test('visible-only selection excludes occluded faces and ignores reference mannequins', () => {
    const points = [[2, 2, 0], [30, 2, 0], [2, 30, 0]];
    const polygons = [
        { partId: 'body', faceId: 0, sourceFaceId: 0, points, alpha: 1 },
        { partId: 'body', faceId: 1, sourceFaceId: 1, points, alpha: 1 },
        { partId: 'mannequin', faceId: 0, points, reference: true, alpha: 1 }
    ];
    assert.deepEqual([...visibleFaceIds(polygons, 'body', { width: 40, height: 40 })], [1]);
    assert.equal(visibleFaceIds([...polygons, { partId: 'other', faceId: 0, points }], 'body', { width: 40, height: 40 }).size, 0);
    assert.deepEqual([...visibleFaceIds([{ partId: 'body', faceId: 3, sourceFaceId: 1, twin: true, points }], 'body', { twin: true, width: 40, height: 40 })], [1]);
});

// Import the actual browser module without a server or a duplicate checkout.
async function sculptFactory() {
    const source = readFileSync(new URL('../public/sculpt.mjs', import.meta.url), 'utf8')
        .replace("'/shared/mesh.mjs'", JSON.stringify(new URL('../shared/mesh.mjs', import.meta.url).href))
        .replace("'/shared/sculpt.mjs'", JSON.stringify(new URL('../shared/sculpt.mjs', import.meta.url).href));
    return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).createSculptTab;
}

class Control {
    tagName: string; children: any[] = []; handlers: Record<string, Function> = {}; textContent = ''; value: any; disabled = false; isConnected = true;
    constructor(tag, attrs = {}, ...children) {
        this.tagName = tag.toUpperCase();
        for (const [key, value] of Object.entries(attrs)) {
            if (key.startsWith('on')) this.handlers[key.slice(2).toLowerCase()] = value as Function;
            else if (key === 'text') this.textContent = String(value);
            else this[key] = value;
        }
        this.append(...children);
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    emit(name) { return this.handlers[name]?.({ target: this }); }
    find(fn): Control | undefined {
        if (fn(this)) return this;
        for (const child of this.children) if (child instanceof Control) { const match = child.find(fn); if (match) return match; }
    }
}

async function harness(kind = 'npc') {
    const variant = kind === 'npc' ? 'body' : 'male', first = part('first', quad(), variant), other = part('other', quad(), variant);
    other.position = [40, 0, 0];
    const state: any = { mode: 'sculpt', variant, selected: first.id, project: { id: 'test', kind, parts: [first, other] }, history: [], future: [], playing: false };
    const tools = new Control('div'), properties = new Control('div'); let factory;
    const calls = { changed: 0, checkpoint: 0, render: 0, status: '', draft: 0 };
    const ctx: any = { state, element: (tag, attrs, ...children) => new Control(tag, attrs, ...children), button: (text, fn, attrs) => new Control('button', { text, onClick: fn, ...attrs }),
        selected: () => state.project.parts.find(p => p.id === state.selected), activeParts: () => state.project.parts.filter(p => p.visible && (p.variant === state.variant || p.variant === 'all')),
        checkpoint: () => { calls.checkpoint++; state.history.push(JSON.stringify(state.project)); }, changed: () => { calls.changed++; state.dirty = true; },
        status: text => calls.status = text, stop: () => state.playing = false, draft: () => calls.draft++,
        render: () => { calls.render++; factory.renderTools(tools); factory.renderProperties(properties); },
        renderProperties: () => factory.renderProperties(properties), renderParts: () => {}, renderView: () => {},
        viewport: { dirty: false, polygons: [], width: 100, height: 100 } };
    factory = (await sculptFactory())(ctx); ctx.render();
    return { state, ctx, tab: factory, calls, tools, properties, first, other, hit: (faceId = 0, twin = false) => ({ partId: first.id, faceId: faceId + (twin ? first.mesh.faces.length : 0), sourceFaceId: faceId, twin, point: twin ? [-5, 5, 0] : [5, 5, 0] }) };
}
const control = (root, text) => { const node = root.find(n => n.tagName === 'BUTTON' && n.textContent === text); assert.ok(node, `Missing ${text} button`); return node; };

for(const kind of ['npc','gear'])test(`${kind}: Add face mirrors its preview, toggles without losing the draft, applies once and respects linked pairs`,async()=>{
    const h=await harness(kind),left={vertices:[[-20,0,0],[-10,0,0],[-15,10,0]],faces:[[0,1,2,100]]};
    h.first.mesh={vertices:[...left.vertices,...left.vertices.map(([x,y,z])=>[-x,y,z])],faces:[[0,1,2,100],[5,4,3,200]]};
    const before=structuredClone(h.state.project);control(h.tools,'Add face').emit('click');
    h.tab.edit({...h.hit(),point:[-15,0,0]},[],'start');
    const toggle=()=>{const m=h.tools.find(n=>n['aria-label']==='Mirror across part X');assert.ok(m,'face creation exposes mirror');m.checked=!m.checked;m.emit('change');};
    toggle();assert.equal(control(h.tools,'Apply face').disabled,false,h.calls.status);
    assert.equal(h.ctx.viewport.previewItems().find(p=>p.id===h.first.id).mesh.faces.length,4);
    assert.deepEqual(h.state.project,before);assert.equal(h.calls.checkpoint,0);
    toggle();assert.equal(h.ctx.viewport.previewItems().find(p=>p.id===h.first.id).mesh.faces.length,3);
    toggle();control(h.tools,'Apply face').emit('click');assert.equal(h.first.mesh.faces.length,4);assert.equal(h.calls.checkpoint,1);
    assert.deepEqual(JSON.parse(h.state.history[0]),before);
    h.first.pair=true;control(h.tools,'Add face').emit('click');h.tab.edit({...h.hit(),point:[-15,10,0]},[],'start');
    assert.equal(control(h.tools,'Apply face').disabled,false,h.calls.status);control(h.tools,'Apply face').emit('click');
    assert.equal(h.first.mesh.faces.length,5,'a shared pair receives the edit once');
});

test('Move corners mirrors the drag and selected-face deletion checks the opposite side at Apply time',async()=>{
    const h=await harness(),left=quad(),vertices=left.vertices.map(([x,y,z])=>[x-30,y,z]),n=vertices.length;
    h.first.mesh={vertices:[...vertices,...vertices.map(([x,y,z])=>[-x,y,z])],faces:[...left.faces,...left.faces.map(([a,b,c,col])=>[c+n,b+n,a+n,col])]};
    const before=structuredClone(h.first.mesh);h.ctx.render();control(h.tools,'Move corners').emit('click');
    const m=h.tools.find(n=>n['aria-label']==='Mirror across part X');m.checked=true;m.emit('change');
    h.tab.edit({...h.hit(),point:vertices[0]},[],'start');const drag=h.ctx.viewport.toolInteraction();drag.start('vertex');drag.move('vertex',{movement:[-1,0,2]},{ctrlKey:true});drag.end();
    assert.deepEqual(h.first.mesh.vertices[0],[-31,0,2]);assert.deepEqual(h.first.mesh.vertices[n],[31,0,2]);assert.equal(h.calls.checkpoint,1);
    assert.deepEqual(JSON.parse(h.state.history[0]).parts[0].mesh,before);
    h.state.sculpt.faces[h.first.id]=[0];h.ctx.render();control(h.properties,'Delete selected faces').emit('click');
    assert.equal(h.first.mesh.faces.length,2);assert.equal(h.calls.checkpoint,2);
});

test('mirrored connection UI previews both joins, cancels without edits and applies in one undo',async()=>{
    const h=await harness(),mesh={vertices:[[-20,0,0],[-10,0,0],[-15,10,0],[20,0,0],[10,0,0],[15,10,0]],faces:[[0,1,2,100],[5,4,3,200]]};
    h.first.mesh=structuredClone(mesh);h.other.mesh=structuredClone(mesh);h.other.position=[0,0,12];h.other.mesh.faces=h.other.mesh.faces.map(f=>[f[2],f[1],f[0],f[3]]);h.ctx.render();
    const before=structuredClone(h.state.project);control(h.tools,'Pick connection areas').emit('click');h.state.sculpt.opening=false;
    const m=h.tools.find(n=>n['aria-label']==='Mirror across part X');assert.ok(m);m.checked=true;m.emit('change');
    const pick=()=>{h.tab.edit({partId:h.first.id,faceId:0,point:[-15,0,0]},[],'start');h.tab.edit({partId:h.other.id,faceId:0,point:[-15,0,12]},[],'start');};
    pick();assert.equal(control(h.tools,'Apply connection').disabled,false,h.calls.status);assert.equal(h.ctx.viewport.previewItems().at(-1).mesh.faces.length,4);assert.deepEqual(h.state.project,before);
    control(h.tools,'Cancel').emit('click');assert.equal(h.ctx.viewport.previewItems(),null);assert.deepEqual(h.state.project,before);assert.equal(h.calls.checkpoint,0);
    pick();control(h.tools,'Apply connection').emit('click');assert.equal(h.calls.checkpoint,1);assert.equal(h.state.project.parts.at(-1).mesh.faces.length,4);assert.deepEqual(JSON.parse(h.state.history[0]),before);
});

test('seam repair mirrors the vertex updates while keeping one undo checkpoint',async()=>{
    const h=await harness(),one=splitMesh(),vertices=one.vertices.map(([x,y,z])=>[x-30,y,z]),n=vertices.length;
    h.first.mesh={vertices:[...vertices,...vertices.map(([x,y,z])=>[-x,y,z])],faces:[...one.faces,...one.faces.map(([a,b,c,col])=>[c+n,b+n,a+n,col])]};
    h.ctx.render();h.state.sculpt.faces[h.first.id]=[0];h.state.sculpt.seamTarget='self';h.state.sculpt.mirror=true;h.ctx.render();
    const before=structuredClone(h.first.mesh);control(h.properties,'Find nearby seams').emit('click');
    const apply=control(h.properties,'Apply connection');assert.equal(apply.disabled,false,h.calls.status);assert.deepEqual(h.first.mesh,before);
    apply.emit('click');assert.equal(h.calls.checkpoint,1);
    for(let i=0;i<n;i++)assert.deepEqual(h.first.mesh.vertices[n+i],h.first.mesh.vertices[i].map((v,a)=>a===0?-v:v));
    assert.deepEqual(JSON.parse(h.state.history[0]).parts[0].mesh,before);
});

test('face feedback requests solid dark and bright boundaries independent of material colour', async () => {
    const h = await harness(); h.tab.edit(h.hit(), [], 'start'); h.tab.endEdit();
    const selected = h.tab.faceOverlay(h.hit());
    assert.equal(selected.underStroke, '#101010'); assert.equal(selected.stroke, '#ffffff');
    assert.ok(selected.underWidth >= selected.lineWidth + 2);
    h.tab.onHover(h.hit()); const hover = h.tab.faceOverlay(h.hit());
    assert.notEqual(hover.fill, selected.fill); assert.equal(hover.underStroke, '#101010');
});

for (const kind of ['npc', 'gear']) test(`${kind} direct delete brush removes hit faces during a drag with one undo and no selection step`, async () => {
    const h = await harness(kind); h.first.mesh = grid(3); h.ctx.render();
    const before = structuredClone(h.state.project);
    h.tools.find(n => n['data-sculpt-tool'] === 'delete-face')!.emit('click');
    h.tab.onHover(h.hit());
    assert.ok(h.tab.faceOverlay(h.hit()), 'the hit face previews deletion');
    h.tab.edit(h.hit(), [], 'start');
    assert.equal(h.first.mesh.faces.length, 7, 'pointerdown directly deletes the hit face');
    h.tab.edit(h.hit(3), [], 'move'); h.tab.endEdit();
    assert.equal(h.first.mesh.faces.length, 6, 'dragging deletes the next hit face');
    assert.equal(h.calls.checkpoint, 1); assert.equal(h.calls.draft, 1);
    assert.deepEqual(JSON.parse(h.state.history[0]), before);
    assert.deepEqual(h.other, before.parts[1]); assert.deepEqual(h.first.mesh.vertices, before.parts[0].mesh.vertices);
});

test('a delete stroke never drills through its original visible shell, crosses parts, or deletes the final face',async()=>{
    const h=await harness();h.first.mesh={vertices:[[0,0,0],[10,0,0],[0,10,0],[0,0,10],[10,0,10],[0,10,10]],faces:[[0,1,2,1],[3,4,5,2]]};
    h.ctx.viewport.polygons=[{partId:h.first.id,faceId:1,sourceFaceId:1,twin:false,points:[[0,0,10],[30,0,10],[0,30,10]]},{partId:h.first.id,faceId:0,sourceFaceId:0,twin:false,points:[[0,0,0],[30,0,0],[0,30,0]]}];h.ctx.viewport.distance=100;
    h.ctx.render();control(h.tools,'Delete faces brush').emit('click');
    const hit={...h.hit(),screenPoint:[5,5]};h.tab.edit(hit,[],'start');assert.equal(h.first.mesh.faces.length,1);
    h.tab.edit(hit,[],'move');assert.equal(h.first.mesh.faces.length,1,'newly exposed rear triangle is protected for this gesture');
    const other=structuredClone(h.other);h.tab.edit({...hit,partId:h.other.id},[],'move');assert.deepEqual(h.other,other);
    h.tab.endEdit();h.tab.edit(h.hit(),[],'start');h.tab.endEdit();assert.equal(h.first.mesh.faces.length,1);assert.equal(h.calls.checkpoint,1);assert.match(h.calls.status,/whole part/);
});

for(const kind of ['npc','gear'])test(`${kind} delete brush previews and erases exact mirrored faces with one undo`,async()=>{
    const h=await harness(kind),left=grid(3),vertices=left.vertices.map(([x,y,z])=>[x-30,y,z]),count=vertices.length;
    const mesh:any={vertices:[...vertices,...vertices.map(([x,y,z])=>[-x,y,z])],faces:[...left.faces,...left.faces.map(([a,b,c,color])=>[a+count,c+count,b+count,color])]};
    for(const key of ['skins','sourceVertices'])mesh[key]=mesh.vertices.map((_,i)=>i);
    mesh.bones=mesh.vertices.map((_,i)=>[i]);mesh.weights=mesh.vertices.map(()=>[255]);
    mesh.textures=mesh.faces.map(()=>7);mesh.textureCoords=mesh.faces.map(()=>0);mesh.textureMappings=[[0,1,2]];mesh.sourceFaces=mesh.faces.map((_,i)=>100+i);
    h.first.mesh=mesh;h.ctx.render();
    const before=structuredClone(h.state.project);
    control(h.tools,'Delete faces brush').emit('click');
    const mirror=h.tools.find(n=>n.tagName==='INPUT'&&n.type==='checkbox'&&n['aria-label']==='Mirror across part X');assert.ok(mirror,'delete brush has the shared mirror control');
    mirror.checked=true;mirror.emit('change');
    const hit=h.hit(0);h.tab.onHover(hit);
    const mirrored=[...mirroredFaces(mesh,new Set([0]))].filter(i=>i!==0);assert.equal(mirrored.length,1);
    assert.ok(h.tab.faceOverlay(h.hit(mirrored[0])),'the actual opposite deletion previews too');
    h.tab.edit(hit,[],'start');assert.equal(h.first.mesh.faces.length,before.parts[0].mesh.faces.length-2);
    h.tab.edit(h.hit(0),[],'move');h.tab.endEdit();
    assert.equal(h.first.mesh.faces.length,before.parts[0].mesh.faces.length-4);assert.equal(h.calls.checkpoint,1);
    assert.deepEqual(JSON.parse(h.state.history[0]),before);assert.deepEqual(h.other,before.parts[1]);assert.deepEqual(h.first.mesh.vertices,mesh.vertices);
    for(const key of ['vertices','skins','sourceVertices','bones','weights','textureMappings'])assert.deepEqual(h.first.mesh[key],mesh[key],key+' survives a mirrored stroke');
    assert.deepEqual(h.first.mesh.sourceFaces,mesh.sourceFaces.filter((_,i)=>![0,1,8,9].includes(i)));
});

test('mirrored delete never guesses between coincident shells or removes protected rigged connection supports',async()=>{
    const h=await harness(),mesh={vertices:[[-4,0,0],[-2,0,0],[-3,2,0],[4,0,0],[2,0,0],[3,2,0],[4,0,10],[2,0,10],[3,2,10]],
        faces:[[0,1,2,1],[5,4,3,2],[5,4,3,3],[8,7,6,4]]};
    h.first.mesh=mesh;h.ctx.render();control(h.tools,'Delete faces brush').emit('click');
    const mirror=h.tools.find(n=>n['aria-label']==='Mirror across part X');mirror.checked=true;mirror.emit('change');
    h.tab.onHover(h.hit());assert.equal(h.tab.faceOverlay(h.hit(1)),null,'coincident reflected shells are ambiguous');
    h.tab.edit(h.hit(),[],'start');h.tab.endEdit();assert.deepEqual(h.first.mesh.faces,mesh.faces.slice(1),'only the explicit hit is removed');
    const h2=await harness();h2.first.mesh={...mesh,faces:[mesh.faces[0],mesh.faces[1],mesh.faces[3]]};
    h2.state.project.parts.push({id:'connection',mesh:{vertexLinks:[]},connectionEdges:[[{partId:h2.first.id,vertex:3},{partId:h2.first.id,vertex:4}]]});
    h2.ctx.render();control(h2.tools,'Delete faces brush').emit('click');h2.state.sculpt.mirror=true;
    h2.tab.onHover(h2.hit());assert.equal(h2.tab.faceOverlay(h2.hit(1)),null,'protected reflected supports are not advertised as deletable');
    h2.tab.edit(h2.hit(),[],'start');h2.tab.endEdit();assert.deepEqual(h2.first.mesh.faces,[mesh.faces[1],mesh.faces[3]]);
});

for(const kind of ['npc','gear'])test(`${kind} every Sculpt brush exposes the same working mirror state`,async()=>{
    const h=await harness(kind);
    for(const name of ['Select faces','Pull','Push','Smooth','Flatten','Delete faces brush']){
        control(h.tools,name).emit('click');const toggle=h.tools.find(n=>n['aria-label']==='Mirror across part X');assert.ok(toggle,name);
        toggle.checked=true;toggle.emit('change');assert.equal(h.state.sculpt.mirror,true,name);
    }
});

test('mirrored visible-patch deletion previews only the first shell throughout a stroke and protects a final mirrored pair',async()=>{
    const h=await harness(),left=grid(3),vertices=left.vertices.map(([x,y,z])=>[x-30,y,z]),count=vertices.length;
    h.first.mesh={vertices:[...vertices,...vertices.map(([x,y,z])=>[-x,y,z]),...vertices.map(([x,y,z])=>[x,y,z+10])],
        faces:[...left.faces,...left.faces.map(([a,b,c,color])=>[a+count,c+count,b+count,color]),...left.faces.map(([a,b,c,color])=>[a+count*2,b+count*2,c+count*2,color])]};
    h.ctx.viewport.polygons=[{partId:h.first.id,faceId:16,sourceFaceId:16,points:[[0,0,10],[30,0,10],[0,30,10]]},{partId:h.first.id,faceId:0,sourceFaceId:0,points:[[0,0,0],[30,0,0],[0,30,0]]}];h.ctx.viewport.distance=100;
    h.ctx.render();control(h.tools,'Delete faces brush').emit('click');Object.assign(h.state.sculpt,{mirror:true,deleteSize:'area',radius:5});
    const hit={...h.hit(),point:[-25,2,0],screenPoint:[5,5]};h.tab.onHover(hit);
    assert.ok(h.tab.faceOverlay(h.hit(0)));assert.ok(h.tab.faceOverlay(h.hit(8)));assert.equal(h.tab.faceOverlay(h.hit(16)),null);
    h.tab.edit(hit,[],'start');const remaining=h.first.mesh.faces.length;
    const rear={...hit,sourceFaceId:14};h.tab.onHover(rear);assert.equal(h.tab.faceOverlay(rear),null,'the newly exposed rear shell does not advertise an edit in this stroke');
    h.tab.edit(rear,[],'move');h.tab.endEdit();assert.equal(h.first.mesh.faces.length,remaining);assert.equal(h.calls.checkpoint,1);
    const final=await harness();final.first.mesh={vertices:[[-4,0,0],[-2,0,0],[-3,2,0],[4,0,0],[2,0,0],[3,2,0]],faces:[[0,1,2,1],[5,4,3,2]]};
    final.ctx.render();control(final.tools,'Delete faces brush').emit('click');final.state.sculpt.mirror=true;final.tab.edit(final.hit(),[],'start');final.tab.endEdit();
    assert.equal(final.first.mesh.faces.length,2,'a mirrored deletion is atomic when it would remove the whole piece');assert.equal(final.calls.checkpoint,0);
});

for(const kind of ['npc','gear'])test(`${kind} closed surface connection chooses recognizable faces and prepares openings only on Apply`, async () => {
    const h = await harness(kind), closed = { vertices: [[0,0,0],[12,0,0],[0,12,0],[0,0,12]], faces: [[0,2,1,1],[0,1,3,1],[0,3,2,1],[1,2,3,1]] };
    h.first.mesh = structuredClone(closed); h.other.mesh = structuredClone(closed); h.other.position = [30,0,0]; h.ctx.render();
    const before = structuredClone(h.state.project);
    h.tools.find(n => n['data-sculpt-tool'] === 'bridge')!.emit('click');
    h.tab.edit({partId:h.first.id,faceId:3,point:[4,4,4]}, [], 'start');
    h.tab.edit({partId:h.other.id,faceId:2,point:[30,4,4]}, [], 'move');
    assert.equal(control(h.tools,'Apply connection').disabled, false, h.calls.status);
    assert.deepEqual(h.state.project, before, 'candidate preview must be read-only');
    control(h.tools,'Apply connection').emit('click');
    assert.equal(h.first.mesh.faces.length,3); assert.equal(h.other.mesh.faces.length,3);
    assert.equal(h.state.project.parts.length,3); assert.equal(h.calls.checkpoint,1);
    validateMesh(assemble(h.state.project.parts,h.state.variant));
});

for(const kind of ['npc','gear'])test(`${kind} face tools preview a real addition, apply once and delete only the chosen faces`,async()=>{
    const h=await harness(kind),before=grid(3);h.first.mesh=deleteFaces(before,[1]);h.ctx.render();
    control(h.tools,'Add face').emit('click'); h.state.sculpt.faceMode='corners';
    for(const vertex of before.faces[1].slice(0,3)){
        const faceId=h.first.mesh.faces.findIndex(f=>f.slice(0,3).includes(vertex));
        h.tab.edit({...h.hit(faceId),point:h.first.mesh.vertices[vertex]},[],'start');
    }
    assert.equal(h.calls.checkpoint,0,'preview does not edit the project');assert.equal(h.first.mesh.faces.length,7);
    assert.equal(control(h.tools,'Apply face').disabled,false);control(h.tools,'Apply face').emit('click');
    assert.equal(h.first.mesh.faces.length,8);assert.equal(h.calls.checkpoint,1);assert.deepEqual(h.first.mesh.vertices,before.vertices);
    control(h.tools,'Select faces').emit('click');h.tab.edit(h.hit(7),[],'start');h.tab.endEdit();control(h.properties,'Delete selected faces').emit('click');
    assert.equal(h.first.mesh.faces.length,7);assert.equal(h.calls.checkpoint,2);
    const undo=JSON.parse(h.state.history.pop());assert.equal(undo.parts[0].mesh.faces.length,8);
});

test('bridge UI accepts click and cross-part drag targets, previews without editing and cancels or applies once',async()=>{
    const h=await harness();h.first.mesh=splitMesh();h.other.mesh=splitMesh();h.other.position=[40,0,10];h.ctx.render();
    control(h.tools,'Pick connection areas').emit('click');h.state.sculpt.opening=false;
    h.tab.edit({partId:h.first.id,faceId:0,point:[0,5,0]},[],'start');
    assert.equal(h.ctx.viewport.crossPartEdit(),true);assert.equal(h.state.project.parts.length,2);assert.equal(h.calls.checkpoint,0);
    h.tab.edit({partId:h.other.id,faceId:1,point:[41,5,10]},[],'move');
    assert.equal(control(h.tools,'Apply connection').disabled,false);assert.equal(h.ctx.viewport.previewItems().length,3,'the actual pending connection is rendered in the scene');
    control(h.tools,'Cancel').emit('click');assert.equal(h.state.project.parts.length,2);
    h.tab.edit({partId:h.first.id,faceId:0,point:[0,5,0]},[],'start');h.tab.edit({partId:h.other.id,faceId:1,point:[41,5,10]},[],'start');
    control(h.tools,'Apply connection').emit('click');assert.equal(h.state.project.parts.length,3);assert.equal(h.calls.checkpoint,1);assert.equal(h.state.project.parts[2].mesh.faces.length,2);
    assert.deepEqual(JSON.parse(h.state.history[0]).parts.length,2);
});

for (const kind of ['npc', 'gear']) test(`${kind} tab selection is transient, hover highlights a face, and one stroke creates one undo checkpoint`, async () => {
    const { state, tab, calls, first, other, hit } = await harness(kind);
    const original = structuredClone(state.project);
    tab.onHover(hit()); assert.equal(tab.faceOverlay(hit()).lineWidth, 2);
    tab.edit(hit(), [0, 0, 0], 'start'); tab.edit(hit(1), [0, 0, 0], 'move'); tab.endEdit();
    assert.deepEqual(state.sculpt.faces.first, [0, 1]); assert.equal(calls.checkpoint, 0); assert.deepEqual(state.project, original);
    assert.ok(tab.faceOverlay(hit()).fill); tab.onHover(null); assert.equal(tab.faceOverlay(hit()).lineWidth, 1.5);
    Object.assign(state.sculpt, { tool: 'pull', visibleOnly: false, radius: 100, strength: 1 });
    tab.edit(hit(), [0, 0, 0], 'start'); tab.edit(hit(1), [1, 0, 0], 'move'); tab.edit(null, [], 'end');
    assert.equal(calls.checkpoint, 1); assert.equal(calls.draft, 1); assert.ok(calls.changed > 0);
    assert.ok(first.mesh.vertices.some(v => v[2] > 0)); assert.deepEqual(other.mesh, original.parts[1].mesh);
    assert.deepEqual(withoutCoordinates(first.mesh), withoutCoordinates(original.parts[0].mesh));
    state.project = JSON.parse(state.history.pop()); tab.syncValues(); assert.deepEqual(state.project, original);
});

test('selection add/remove/replace and keyboard commands do not alter a project or steal text input keys', async () => {
    const { tab, state, hit, calls } = await harness();
    tab.edit(hit(), [], 'start'); tab.endEdit(); state.sculpt.selectionMode = 'add'; tab.edit(hit(1), [], 'start'); tab.endEdit();
    assert.deepEqual(state.sculpt.faces.first, [0, 1]);
    state.sculpt.selectionMode = 'remove'; tab.edit(hit(), [], 'start'); tab.endEdit(); assert.deepEqual(state.sculpt.faces.first, [1]);
    let prevented = false;
    assert.equal(tab.onKeyDown({ key: '2', target: { tagName: 'INPUT' } }), false); assert.equal(state.sculpt.tool, 'select');
    assert.equal(tab.onKeyDown({ key: 'a', ctrlKey: true, preventDefault: () => prevented = true }), true); assert.equal(prevented, true);
    assert.deepEqual(state.sculpt.faces.first, [0, 1]); tab.onKeyDown({ key: 'Escape' }); assert.deepEqual(state.sculpt.faces.first, []);
    assert.equal(calls.checkpoint, 0); assert.equal(calls.changed, 0);
});

test('optional viewport modifiers add and remove faces while the explicit selection mode stays unchanged', async () => {
    const { tab, state, hit } = await harness();
    tab.edit(hit(), [], 'start'); tab.endEdit();
    tab.edit({ ...hit(1), shiftKey: true }, [], 'start'); tab.endEdit(); assert.deepEqual(state.sculpt.faces.first, [0, 1]);
    tab.edit({ ...hit(), altKey: true }, [], 'start'); tab.endEdit(); assert.deepEqual(state.sculpt.faces.first, [1]);
    assert.equal(state.sculpt.selectionMode, 'replace');
});

test('restore selected geometry is undoable and retains materials edited later', async () => {
    const { state, tab, hit, ctx, properties, calls } = await harness();
    tab.edit(hit(), [], 'start'); tab.endEdit();
    Object.assign(state.sculpt, { tool: 'pull', visibleOnly: false, radius: 100, strength: 1 });
    tab.edit(hit(), [], 'start'); tab.endEdit();
    const changed = structuredClone(state.project.parts[0].mesh.vertices);
    state.project.parts[0].mesh.faces[0][3] = 1234; ctx.render();
    const restore = control(properties, 'Restore selected'); assert.equal(restore.disabled, false); restore.emit('click');
    assert.deepEqual(state.project.parts[0].mesh.vertices, quad().vertices);
    assert.equal(state.project.parts[0].mesh.faces[0][3], 1234); assert.equal(calls.checkpoint, 2);
    state.project = JSON.parse(state.history.pop()); tab.syncValues(); assert.deepEqual(state.project.parts[0].mesh.vertices, changed);
});

test('brush controls synchronise without a full render and technical sections stay open', async () => {
    const { tab, state, tools, properties, ctx, calls } = await harness();
    state.sculpt.tool = 'pull'; ctx.render(); const before = calls.render;
    const strength = tools.find(n => n['aria-label'] === 'Strength'); strength.value = '7'; strength.emit('input');
    assert.equal(state.sculpt.strength, 7); assert.equal(properties.find(n => n['aria-label'] === 'Amount').value, '7'); assert.equal(calls.render, before);
    const details = properties.find(n => n.tagName === 'DETAILS' && n.children[0].textContent === 'Connect nearby edges');
    details['open'] = true; details.emit('toggle');
    const target = properties.find(n => n['aria-label'] === 'Connect to'); target.value = 'parts'; target.emit('change');
    assert.equal(properties.find(n => n.tagName === 'DETAILS' && n.children[0].textContent === 'Connect nearby edges')['open'], true);
    tab.reset(); assert.equal(state.sculpt.tool, 'select'); assert.equal(tab.getBrush(), null);
});

test('seam preview changes no geometry until applied and invalidates after an ancestor moves', async () => {
    const { tab, state, first, ctx, properties, calls } = await harness('gear');
    first.mesh = splitMesh(); const parent = part('parent', quad(), 'all'); parent.visible = false;
    first.parentId = parent.id; state.project.parts.push(parent); ctx.render();
    tab.edit({ partId: first.id, sourceFaceId: 0, faceId: 0, point: [0, 5, 0] }, [], 'start'); tab.endEdit();
    const before = structuredClone(first.mesh); control(properties, 'Find nearby seams').emit('click');
    assert.deepEqual(first.mesh, before); assert.equal(calls.checkpoint, 0); assert.equal(control(properties, 'Apply connection').disabled, false);
    const overlay = tab.faceOverlay({ partId: first.id, sourceFaceId: 0, faceId: 0, twin: false }); assert.equal(overlay.stroke, '#ffb75e');
    parent.position[0] = 5; tab.syncValues(); assert.equal(control(properties, 'Apply connection').disabled, true);
    control(properties, 'Find nearby seams').emit('click'); control(properties, 'Apply connection').emit('click');
    assert.equal(calls.checkpoint, 1); assert.deepEqual(first.mesh.vertices[0], first.mesh.vertices[3]); assert.deepEqual(first.mesh.vertices[1], first.mesh.vertices[4]);
});

test('hidden or other gear views cannot be edited and empty selection cannot silently sculpt a whole part', async () => {
    const { tab, state, first, hit, calls } = await harness('gear'), before = structuredClone(first.mesh);
    Object.assign(state.sculpt, { tool: 'pull', visibleOnly: false }); tab.edit(hit(), [], 'start'); tab.endEdit();
    assert.deepEqual(first.mesh, before); assert.equal(calls.checkpoint, 0); assert.match(calls.status, /Select faces/);
    state.sculpt.scope = 'part'; first.variant = 'inventory'; assert.equal(tab.edit(hit(), [], 'start'), false);
    first.variant = 'male'; first.visible = false; assert.equal(tab.edit(hit(), [], 'start'), false); assert.deepEqual(first.mesh, before);
});

test('dragging a transformed paired copy produces the same source edit as dragging the original', async () => {
    const meshes = [];
    for (const twin of [false, true]) {
        const { tab, state, first } = await harness('gear');
        first.position = [-40, -20, 10]; first.rotation = [15, 20, 35]; first.scale = [2, .8, 1.4]; first.pair = true;
        tab.onKeyDown({ key: 'a', ctrlKey: true }); Object.assign(state.sculpt, { tool: 'pull', visibleOnly: false, radius: 100, strength: 1 });
        let point = worldPoint([5, 5, 0], first, state.project.parts);
        if (twin) point = reflectPoint(point, null, state.project.parts);
        tab.edit({ partId: first.id, sourceFaceId: 0, faceId: twin ? 2 : 0, twin, point }, [], 'start'); tab.endEdit();
        meshes.push(first.mesh);
    }
    meshes[0].vertices.forEach((v, i) => pointClose(v, meshes[1].vertices[i]));
    assert.deepEqual(withoutCoordinates(meshes[0]), withoutCoordinates(meshes[1]));
});

test('whole-part session restore recovers a heavily bent shape without a false face-flip rejection', async () => {
    const { tab, state, first, hit, ctx, properties } = await harness();
    Object.assign(state.sculpt, { tool: 'pull', scope: 'part', visibleOnly: false, radius: 100, strength: 1 });
    tab.edit(hit(), [], 'start'); tab.endEdit();
    first.mesh.vertices = first.mesh.vertices.map(([x, y, z]) => [-x, y, -z]);
    ctx.render(); control(properties, 'Restore whole part').emit('click');
    assert.deepEqual(first.mesh.vertices, quad().vertices); assert.equal(state.history.length, 2);
});

// A real hole has used corners all around it, unlike a lone deleted triangle.
test('partial patches may reach another corner on their rim, but cannot attach to a closed or unrelated corner',()=>{
    const mesh=grid(5),cut=deleteFaces(mesh,[10,11,12,13,18,19,20,21]);
    const edges=meshTopology(cut).boundaryEdges,outer=new Set([0,1,2,3,4,5,9,10,14,15,19,20,21,22,23,24]);
    const inner=edges.filter(e=>!outer.has(e.a)&&!outer.has(e.b)),edge=inner[0];
    const third=inner.map(e=>e.a).find(v=>v!==edge.a&&v!==edge.b&&!inner.some(e=>[e.a,e.b].includes(v)&&[e.a,e.b].includes(edge.a))&&!inner.some(e=>[e.a,e.b].includes(v)&&[e.a,e.b].includes(edge.b)));
    assert.ok(third!==undefined);
    const result=addFace(cut,[edge.b,edge.a,third]);assert.equal(result.faces.length,cut.faces.length+1);validateMesh(result);
    assert.throws(()=>addFace(cut,[edge.b,edge.a,0]),/open edge|overlap|small/,'another boundary loop cannot be point-attached');
});

for(const shape of ['triangle','quad'])test(`${shape} construction preserves rig and projections and rejects crossed or collapsed corners`,()=>{
    const mesh=quad(),before=structuredClone(mesh),corners=startFace(mesh,0,[5,0,0],{shape});
    const out=buildFace(mesh,corners,{materialFace:0});validateMesh(out);assert.deepEqual(mesh,before);
    assert.equal(out.faces.length,mesh.faces.length+(shape==='quad'?2:1));
    assert.equal(out.vertices.length,mesh.vertices.length+(shape==='quad'?2:1));
    assert.deepEqual(out.vertices.slice(0,4),mesh.vertices);assert.deepEqual(out.textureMappings,mesh.textureMappings);
    const donor=corners.find(c=>c.point).donor;
    assert.deepEqual(out.bones[4],mesh.bones[donor]);assert.deepEqual(out.weights[4],mesh.weights[donor]);assert.equal(out.sourceVertices[4],mesh.sourceVertices[donor]);
    const bad=structuredClone(corners);for(const c of bad)if(c.point)c.point=[...mesh.vertices[bad[0].vertex]];
    assert.throws(()=>buildFace(mesh,bad),/small|collapsed|cross/);
    const free=startFace(mesh,0,[5,4,0],{mode:'free',shape});assert.ok(free.every(c=>c.point));
    const forward=buildFace(mesh,free),backward=buildFace(mesh,free,{flip:true});
    assert.deepEqual(forward.faces.at(-1).slice(0,3),backward.faces.at(-1).slice(0,3).reverse());
});

test('edge snapping inserts a shared rigged corner and subdivides native material channels without a T junction',()=>{
    const mesh=quad(),cut=deleteFaces(mesh,[1]),draft=[{vertex:2},{vertex:0},{point:[5,0,0],donor:3,edge:[0,1]}];
    assert.throws(()=>buildFace(cut,draft),/already|overlap|inside out|small|collapsed/,'an overlapping fill is still rejected');
    const panel={vertices:[[-20,-20,0],[20,-20,0],[20,20,0],[-20,20,0],[-10,-10,0],[10,-10,0],[10,10,0],[-10,10,0]],faces:[]};
    for(let i=0;i<4;i++){const j=(i+1)%4;panel.faces.push([i,j,4+j,32000],[i,4+j,4+i,22000]);}
    for(const key of ['skins','bones','weights','sourceVertices'])panel[key]=Array.from({length:8},(_,i)=>structuredClone(mesh[key][i%4]));
    for(const key of ['textures','textureCoords','alpha','priorities','renderTypes','faceLabels','sourceFaces'])panel[key]=Array.from({length:8},(_,i)=>mesh[key][i%2]);
    panel.textureMappings=mesh.textureMappings;
    const created=buildFace(panel,[{vertex:4},{vertex:5},{point:[0,10,0],donor:6,edge:[6,7]}]);
    validateMesh(created);assert.equal(created.vertices.length,panel.vertices.length+1);
    const mid=created.vertices.length-1;assert.ok(created.faces.filter(f=>f.slice(0,3).includes(mid)).length>=3);
    assert.deepEqual(created.textureMappings,panel.textureMappings);
});

for(const kind of ['npc','gear'])test(`${kind} draggable face previews do not mutate geometry until Apply, and corner drags make one undo`,async()=>{
    const h=await harness(kind),before=structuredClone(h.first.mesh);h.ctx.viewport.items=[];
    control(h.tools,'Add face').emit('click');h.tab.edit({...h.hit(),point:worldPoint([5,0,0],h.first,h.state.project.parts)},[],'start');
    const tool=h.ctx.viewport.toolInteraction();assert.ok(tool);assert.equal(tool.points().length,3);
    assert.ok(tool.points().filter(p=>p.locked).length===2);assert.deepEqual(h.first.mesh,before);
    tool.start('face-2');tool.move('face-2',{movement:[0,-8,3]},{shiftKey:true});tool.end();
    assert.deepEqual(h.first.mesh,before);assert.equal(h.calls.checkpoint,0);
    control(h.tools,'Apply face').emit('click');assert.equal(h.calls.checkpoint,1);assert.equal(h.first.mesh.vertices.length,before.vertices.length+1);
    const added=structuredClone(h.first.mesh),newVertex=h.first.mesh.vertices.length-1;
    control(h.tools,'Move corners').emit('click');h.tab.edit({partId:h.first.id,sourceFaceId:h.first.mesh.faces.length-1,point:worldPoint(h.first.mesh.vertices[newVertex],h.first,h.state.project.parts)},[],'start');
    const move=h.ctx.viewport.toolInteraction();assert.equal(move.points().length,1);
    move.start('vertex');move.move('vertex',{movement:[0,-2,1]},{ctrlKey:true});move.move('vertex',{movement:[0,-4,2]},{ctrlKey:true});move.end();
    assert.equal(h.calls.checkpoint,2);assert.notDeepEqual(h.first.mesh.vertices[newVertex],added.vertices[newVertex]);
    assert.deepEqual(h.first.mesh.vertices.slice(0,before.vertices.length),before.vertices);
    validateMesh(h.first.mesh);
});

test('face snapping welds a matching corner while Shift and Ctrl preserve free movement',async()=>{
    const h=await harness();h.ctx.viewport.items=[];h.ctx.viewport.project=p=>[p[0]*10,p[1]*10,p[2]];h.ctx.viewport.distance=200;
    control(h.tools,'Add face').emit('click');h.tab.edit({...h.hit(),point:[5,0,0]},[],'start');
    const t=h.ctx.viewport.toolInteraction(),origin=t.points().find(p=>p.id==='face-2').point;
    const movement=h.first.mesh.vertices[3].map((n,i)=>n-origin[i]);
    t.start('face-2');t.move('face-2',{movement},{});t.end();
    control(h.tools,'Apply face').emit('click');
    assert.equal(h.first.mesh.vertices.length,4,'snap reuses a corner rather than making a coincident duplicate');
    assert.equal(h.first.mesh.faces.length,3);
});

test('Shift and Ctrl suppress nearby corner snaps without moving joined endpoints',async()=>{
    for(const key of ['shiftKey','ctrlKey']){
        const h=await harness();h.ctx.viewport.items=[];h.ctx.viewport.project=p=>[p[0]*10,p[1]*10,p[2]];h.ctx.viewport.distance=200;
        control(h.tools,'Add face').emit('click');h.tab.edit({...h.hit(),point:[5,0,0]},[],'start');
        const t=h.ctx.viewport.toolInteraction(),origin=t.points().find(p=>!p.locked).point,target=[0,10.4,0];
        t.start('face-2');t.move('face-2',{movement:target.map((n,i)=>n-origin[i])},{[key]:true});t.end();
        pointClose(t.points().find(p=>!p.locked).point,target);
        assert.equal(h.calls.checkpoint,0);control(h.tools,'Cancel').emit('click');assert.equal(h.ctx.viewport.toolInteraction(),null);
        assert.deepEqual(h.first.mesh,quad());
    }
});

test('moving a native seam corner keeps coincident vertices together and can return to the original position within one drag',async()=>{
    const h=await harness();h.first.mesh={vertices:[[0,0,0],[10,0,0],[0,10,0],[0,0,0],[0,10,0],[0,0,10]],faces:[[0,1,2,100],[3,4,5,200]],skins:[1,1,1,2,2,2]};
    const before=structuredClone(h.first.mesh);h.ctx.render();control(h.tools,'Move corners').emit('click');
    h.tab.edit({...h.hit(),point:[0,0,0]},[],'start');const t=h.ctx.viewport.toolInteraction();
    t.start('vertex');t.move('vertex',{movement:[1,-1,1]},{ctrlKey:true});
    pointClose(h.first.mesh.vertices[0],[1,-1,1]);pointClose(h.first.mesh.vertices[3],[1,-1,1]);assert.deepEqual(h.first.mesh.skins,before.skins);
    t.move('vertex',{movement:[0,0,0]},{ctrlKey:true});assert.deepEqual(h.first.mesh,before);t.end();assert.equal(h.calls.checkpoint,1);
});

for(const kind of ['corner','edge','surface'])test(`gear face corners snap to the visible body reference ${kind} without copying reference geometry`,async()=>{
    const h=await harness('gear'),reference={id:'reference',reference:true,opacity:.3,mesh:{vertices:[[2,-15,5],[22,-15,5],[2,-35,5]],faces:[[0,1,2,60]]}},before=structuredClone(reference);
    const target=kind==='corner'?[2,-15,5]:kind==='edge'?[12,-15,5]:[8,-21,5];
    const raw=kind==='corner'?[2.3,-15.2,5]:kind==='edge'?[12,-15.3,5]:[8,-21,4];
    Object.assign(h.ctx.viewport,{items:[reference],project:p=>[p[0]*10,p[1]*10,p[2]],distance:200,pick:()=>null,
        pickSnap:(x,y,filter)=>{const p={partId:'reference',faceId:0,reference:true,point:[x/10,y/10,5]};return filter(p)?p:null;}});
    control(h.tools,'Add face').emit('click');h.tab.edit({...h.hit(),point:[5,0,0]},[],'start');
    const t=h.ctx.viewport.toolInteraction(),origin=t.points().find(p=>!p.locked).point;t.start('face-2');t.move('face-2',{movement:raw.map((n,i)=>n-origin[i])},{});t.end();
    pointClose(t.points().find(p=>!p.locked).point,target);
    assert.deepEqual(reference,before);assert.equal(h.calls.checkpoint,0);control(h.tools,'Apply face').emit('click');
    assert.equal(h.state.project.parts.length,2);assert.equal(h.first.mesh.vertices.length,5);assert.deepEqual(reference,before);
    assert.equal(h.calls.checkpoint,1);assert.equal(h.first.mesh.faces.length,3);
});

test('reference snapping respects visibility, preview gear and temporary Shift/Ctrl bypass',async()=>{
    for(const option of ['preview gear','hidden','transparent','shiftKey','ctrlKey']){
        const h=await harness('gear'),reference={id:'set-peer',reference:true,opacity:option==='transparent'?0:.3,visible:option!=='hidden',mesh:{vertices:[[2,-15,5],[22,-15,5],[2,-35,5]],faces:[[0,1,2,60]]}},raw=[2.3,-15.2,5];
        Object.assign(h.ctx.viewport,{items:[reference],project:p=>[p[0]*10,p[1]*10,p[2]],distance:200,pick:()=>null,pickSnap:(x,y,filter)=>{const p={partId:'set-peer',faceId:0,reference:true,point:[x/10,y/10,5]};return filter(p)?p:null;}});
        control(h.tools,'Add face').emit('click');h.tab.edit({...h.hit(),point:[5,0,0]},[],'start');
        const t=h.ctx.viewport.toolInteraction(),origin=t.points().find(p=>!p.locked).point;
        t.start('face-2');t.move('face-2',{movement:raw.map((n,i)=>n-origin[i])},{[option]:true});t.end();
        pointClose(t.points().find(p=>!p.locked).point,option==='preview gear'?[2,-15,5]:raw);
    }
});

test('Move corners aligns the actual piece to a read-only cuff reference with one undo',async()=>{
    const h=await harness('gear'),reference={id:'reference',reference:true,mesh:{vertices:[[2,-15,5],[22,-15,5],[2,-35,5]],faces:[[0,1,2,60]]}},before=structuredClone(reference);
    Object.assign(h.ctx.viewport,{items:[reference],project:p=>[p[0]*10,p[1]*10,p[2]],distance:200,pick:()=>null,pickSnap:(x,y,filter)=>{const p={partId:'reference',faceId:0,reference:true,point:[x/10,y/10,5]};return filter(p)?p:null;}});
    control(h.tools,'Move corners').emit('click');h.tab.edit({...h.hit(),point:[0,0,0]},[],'start');
    const t=h.ctx.viewport.toolInteraction();t.start('vertex');t.move('vertex',{movement:[2.3,-15.2,5]},{});t.end();
    pointClose(h.first.mesh.vertices[0],[2,-15,5]);assert.equal(h.calls.checkpoint,1);assert.equal(h.first.mesh.vertices.length,4);assert.equal(h.state.project.parts.length,2);assert.deepEqual(reference,before);
});
