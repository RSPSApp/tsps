import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
    PAINT_PRESETS, colourHex, parsePaintColour, paintScope, collectPaintPalette, colourChannels,
    paletteFromParts, createPalettePlan, createColourReplacePlan, paintPlanRows, editPaintPlanRow,
    applyPaintPlan, paintTopology, connectedPaintFaces, triangleDistanceSquared, mirrorPaintFaces,
    paintHitFaces, createBrushPlan, sourceMaterialPlan, restoreSourceMaterials, parsePaintPalette, exportPaintPalette,
} from '../shared/paint.mjs';
import { assemble, extract, validateMesh } from '../shared/mesh.mjs';

const C = (h: number, s: number, l: number) => (h << 10) | (s << 7) | l;
const red = C(0, 6, 40), blue = C(40, 4, 45), gold = C(6, 7, 74);
const mesh = () => ({
    vertices: [[-4, 0, 0], [-1, 0, 0], [-1, 3, 0], [-4, 3, 0], [4, 0, 0], [1, 0, 0], [1, 3, 0], [4, 3, 0]],
    faces: [[0, 1, 2, red], [0, 2, 3, red], [4, 6, 5, blue], [4, 7, 6, blue]],
    textures: [-1, -1, -1, -1], alpha: [0, 0, 0, 0], renderTypes: [0, 0, 0, 0],
});
const part = (id = 'body', variant = 'body', m = mesh()) => ({
    id, name: id, variant, mesh: m, visible: true, parentId: null, pair: false, mirror: false,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], pivot: [0, 0, 0], bindLabel: -1, bindBone: -1,
    source: { kind: variant === 'body' ? 'npc' : 'item', id: 1, variant, region: 'whole' },
});

test('paint scopes include attachments, explicit subparts and hidden gear views only when requested', () => {
    const body = part('body'), child = { ...part('child'), parentId: 'body' }, nested = { ...part('nested'), parentId: 'child' };
    const worn = part('worn', 'male'), hidden = { ...part('hidden'), visible: false }, shared = part('shared', 'all');
    const parts = [body, child, nested, worn, hidden, shared];
    assert.deepEqual(paintScope(parts).map(p => p.id), ['body', 'child', 'nested', 'shared']);
    assert.deepEqual(paintScope(parts, { scope: 'branch', selectedId: 'child' }).map(p => p.id), ['child', 'nested']);
    assert.deepEqual(paintScope(parts, { scope: 'chosen', chosenIds: ['hidden', 'worn'] }).map(p => p.id), ['worn', 'hidden']);
    assert.deepEqual(paintScope(parts, { scope: 'selected', selectedId: 'missing' }), []);
    assert.equal(paintScope(parts, { scope: 'all' }).length, 6);
});

test('channel palettes preserve each part shading and native textures until replacement is deliberate', () => {
    const p = part(); p.mesh.faces[0][3] = C(0, 6, 30); p.mesh.faces[1][3] = C(0, 6, 50);
    p.mesh.textures[2] = 10;
    const before = structuredClone(p), plan = createPalettePlan([p], [gold, blue], { keepShading: true });
    assert.deepEqual(p, before, 'preview must not mutate the original');
    assert.equal(plan.skippedTextures, 1);
    applyPaintPlan([p], plan);
    assert.equal(p.mesh.faces[0][3] & 127, 64); assert.equal(p.mesh.faces[1][3] & 127, 84);
    assert.deepEqual(p.mesh.faces[2], before.mesh.faces[2]); assert.equal(p.mesh.textures[2], 10);
    assert.deepEqual(p.mesh.vertices, before.mesh.vertices);
    const replace = createPalettePlan([p], [red], { textureMode: 'replace', keepShading: false });
    applyPaintPlan([p], replace);
    assert.ok(p.mesh.faces.every(f => f[3] === red)); assert.ok(p.mesh.textures.every(t => t === -1));
    validateMesh(p.mesh);
});

test('main, accent and detail group colours by native hue coverage, not face order', () => {
    const m = mesh(); m.faces.push([1, 2, 3, gold]); m.textures.push(-1); m.alpha.push(0); m.renderTypes.push(0);
    assert.deepEqual(colourChannels(m).map(g => g.channel), ['main', 'accent', 'detail']);
    const p = part('body', 'body', m), before = structuredClone(p);
    applyPaintPlan([p], createPalettePlan([p], [C(20, 4, 80)], { channel: 'detail', keepShading: false }));
    assert.deepEqual(p.mesh.faces.slice(0, 4), before.mesh.faces.slice(0, 4));
    assert.equal(p.mesh.faces[4][3], C(20, 4, 80));
    assert.equal(paletteFromParts([p]).length, 3);
});

test('palette swaps use original colours once and reject stale plans before changing any part', () => {
    const a = part('a'), b = part('b');
    const one = createColourReplacePlan([a, b], red, blue), two = createColourReplacePlan([a, b], blue, red);
    const swap = { changes: [...one.changes, ...two.changes] };
    applyPaintPlan([a, b], swap);
    assert.deepEqual(a.mesh.faces.map(f => f[3]), [blue, blue, red, red]);
    const stale = createPalettePlan([a, b], [gold]); b.mesh.faces[0][3] = 123;
    const before = structuredClone([a, b]);
    assert.throws(() => applyPaintPlan([a, b], stale), /changed/);
    assert.deepEqual([a, b], before, 'stale preview is atomic');
});

test('before/after row editing changes only that swap and never edits project data', () => {
    const p = part(), original = structuredClone(p), plan = createPalettePlan([p], [gold], { keepShading: false });
    const row = paintPlanRows(plan)[0], edited = editPaintPlanRow(plan, row.key, red);
    assert.deepEqual(p, original);
    assert.ok(plan.changes.every(c => c.to === gold));
    applyPaintPlan([p], edited);
    assert.equal(p.mesh.faces.find(f => f[3] === red)?.[3], red);
    assert.ok(p.mesh.faces.some(f => f[3] === gold));
});

test('connected fills join full edges across split vertices but do not leak through a point', () => {
    const m = { vertices: [[0, 0, 0], [4, 0, 0], [0, 4, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0], [-3, 0, 0], [0, -3, 0]],
        faces: [[0, 1, 2, red], [3, 4, 5, red], [0, 6, 7, red]] };
    assert.deepEqual(connectedPaintFaces(m, 0).sort(), [0, 1]);
    m.faces[1][3] = blue;
    assert.deepEqual(connectedPaintFaces(m, 0, { sameColour: true }), [0]);
    assert.deepEqual(connectedPaintFaces(m, 0).sort(), [0, 1]);
});

test('round brushes hit triangle interiors while protecting nearby opposite-facing faces', () => {
    const m = { vertices: [[0, 0, 0], [20, 0, 0], [0, 20, 0], [0, 0, .1], [20, 0, .1], [0, 20, .1]],
        faces: [[0, 1, 2, red], [5, 4, 3, red]] };
    assert.equal(triangleDistanceSquared([5, 5, 0], ...m.vertices.slice(0, 3)), 0);
    assert.equal(triangleDistanceSquared([5, 5, 2], ...m.vertices.slice(0, 3)), 4);
    assert.deepEqual(paintHitFaces(m, 0, [5, 5, 0], { tool: 'brush', radius: 1, connected: false }).ids, [0]);
    assert.deepEqual(paintHitFaces(m, 0, [5, 5, 0], { tool: 'brush', radius: 1, connected: false, protectBack: false }).ids, [0, 1]);
    assert.deepEqual(paintHitFaces(m, 0, [5, 5, 0], { tool: 'brush', radius: 1, protectBack: false }).ids, [0]);
});

test('mirror painting finds the matching triangle and reports missing/ambiguous partners honestly', () => {
    const m = mesh(), topology = paintTopology(m);
    assert.deepEqual(mirrorPaintFaces(m, [0], 0, topology), { ids: [2], missing: [] });
    assert.deepEqual(paintHitFaces(m, 0, [-2, 1, 0], { mirror: true }).ids.sort(), [0, 2]);
    m.vertices[4][1] += 1;
    assert.deepEqual(mirrorPaintFaces(m, [0]).ids, []);
    m.faces.push([...m.faces[0]]);
    assert.deepEqual(mirrorPaintFaces(m, [2]).ids, []);
});

test('brush plans skip protected/invisible faces and do not alter UVs, alpha or rig metadata', () => {
    const p = part(); p.mesh.textures[0] = 7; p.mesh.alpha[1] = 255; p.mesh.renderTypes[2] = 2;
    Object.assign(p.mesh, { textureCoords: [-1, -1, -1, -1], textureMappings: [], skins: Array(8).fill(1) });
    const before = structuredClone(p.mesh);
    const plan = createBrushPlan(p, [0, 1, 2, 3], gold); assert.equal(plan.changes.length, 1);
    applyPaintPlan([p], plan);
    for (const key of ['vertices', 'alpha', 'renderTypes', 'textureCoords', 'textureMappings', 'skins']) assert.deepEqual(p.mesh[key], before[key]);
    assert.deepEqual(collectPaintPalette([p]).map(r => r.colour), [gold]);
});

test('source restore maps extracted/sculpted faces through source vertex identities and restores projection vertices', () => {
    const source = mesh(); Object.assign(source, { textureCoords: [0, -1, -1, -1], textureMappings: [[1, 2, 7]] }); source.textures[0] = 12;
    const cut = extract(source, [0]), beforeGeometry = structuredClone(cut.vertices);
    cut.vertices[0][1] += 8; cut.faces[0][3] = gold; cut.textures[0] = -1;
    const plan = sourceMaterialPlan(cut, source);
    assert.equal(plan.skipped.length, 0); assert.equal(restoreSourceMaterials(cut, plan), 1);
    assert.equal(cut.textures[0], 12); assert.equal(cut.faces[0][3], red);
    assert.equal(cut.vertices[0][1], beforeGeometry[0][1] + 8, 'sculpted geometry survives');
    const mapping = cut.textureMappings[cut.textureCoords[0]].map(v => cut.sourceVertices[v]);
    assert.deepEqual(mapping, [1, 2, 7]); assert.equal(restoreSourceMaterials(cut, plan), 0, 'restore is idempotent');
    validateMesh(cut);
});

test('source restore refuses new/ambiguous faces rather than guessing a material', () => {
    const source = mesh(); source.faces.push([...source.faces[0]]);
    const m = mesh(); m.faces[1] = [0, 1, 7, gold];
    const plan = sourceMaterialPlan(m, source);
    assert.deepEqual(plan.skipped, [0, 1]);
    const before = m.faces.map(f => [...f]); restoreSourceMaterials(m, plan);
    assert.deepEqual(m.faces.slice(0, 2), before.slice(0, 2));
    const oldCut = extract(source, [2]); delete oldCut.sourceVertices;
    assert.equal(sourceMaterialPlan(oldCut, source).faces.length, 0, 'old cut meshes need a verified source mapping');
});

test('palette imports validate a bounded native format and round-trip exact game colours', () => {
    const value = exportPaintPalette('Rune', PAINT_PRESETS[0].colours);
    assert.deepEqual(parsePaintPalette(value), PAINT_PRESETS[0]);
    assert.equal(parsePaintColour(blue), blue); assert.match(colourHex(blue), /^#[0-9a-f]{6}$/);
    assert.equal(parsePaintPalette('["#123456"]').colours.length, 1);
    for (const value of ['{}', '[]', '[65536]', '[-1]', '["#bad"]', '{', ' '.repeat(32769), JSON.stringify(Array(257).fill(0))]) assert.throws(() => parsePaintPalette(value));
});

// Reuse the installed client DOM dependency. No service, browser, copied checkout
// or generated output is needed to exercise the real tab event handlers.
const requireClient = createRequire(new URL('../../../client/package.json', import.meta.url));
const { JSDOM } = requireClient('jsdom');
const modulePath = new URL('../public/paint.mjs', import.meta.url);
const code = fs.readFileSync(modulePath, 'utf8').replaceAll("'/shared/mesh.mjs'", JSON.stringify(pathToFileURL(fileURLToPath(new URL('../shared/mesh.mjs', import.meta.url))).href))
    .replaceAll("'/shared/paint.mjs'", JSON.stringify(pathToFileURL(fileURLToPath(new URL('../shared/paint.mjs', import.meta.url))).href));
let createPaintTab;
before(async () => { ({ createPaintTab } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)); });
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(t, overrides = {}) {
    const dom = new JSDOM('<div id="tools"></div><div id="properties"></div>'); t.after(() => dom.window.close());
    const doc = dom.window.document, state = { project: { name: 'Test creature', kind: 'npc', parts: [part()] }, selected: 'body', mode: 'paint', variant: 'body', colour: '#b99558', ...overrides };
    const history = [], messages = [], pictures = [], calls = []; let tab, apiImpl;
    const element = (tag, attrs = {}, ...children) => {
        const e = doc.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key.startsWith('on')) e.addEventListener(key.slice(2).toLowerCase(), value);
            else if (key === 'class') e.className = value;
            else if (key === 'text') e.textContent = value;
            else if (key in e) e[key] = value;
            else e.setAttribute(key, value);
        }
        e.append(...children.filter(c => c !== null && c !== undefined && c !== false)); return e;
    };
    const ctx = {
        state, element, button: (text, fn, attrs = {}) => element('button', { text, onClick: fn, ...attrs }),
        selected: () => state.project.parts.find(p => p.id === state.selected),
        api: async route => { calls.push(route); if (apiImpl) return apiImpl(route); throw new Error('Unexpected API request: ' + route); },
        checkpoint: () => history.push(structuredClone(state.project)), stop: () => {}, draft: () => {},
        status: (text, error = false) => messages.push({ text, error }), viewport: { dirty: false },
        thumbnail: (canvas, mesh) => pictures.push(structuredClone(mesh)),
        change: fn => { ctx.checkpoint(); fn(); ctx.changed(); },
        changed: (refresh = true) => { state.dirty = true; if (refresh) ctx.render(); },
        render: () => { tab.renderTools(doc.getElementById('tools')); tab.renderProperties(doc.getElementById('properties')); },
        toolSlider: (target, label, value, set, min, max) => target.append(element('input', { type: 'range', value, min, max, 'aria-label': label, onInput: event => set(Number(event.target.value)) })),
    };
    tab = createPaintTab(ctx); ctx.render();
    const findButton = text => [...doc.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
    const click = async text => { const b = findButton(text); assert.ok(b, `button exists: ${text}`); b.click(); await tick(); };
    const set = (label, value) => { const e = doc.querySelector(`[aria-label="${label}"]`); assert.ok(e, `input exists: ${label}`); if (e.type === 'checkbox') e.checked = value; else e.value = value; e.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
    const hit = (faceId = 0, extra = {}) => ({ partId: 'body', faceId, sourceFaceId: faceId, twin: false, point: [-2, 1, 0], ...extra });
    return { dom, doc, state, ctx, tab, history, messages, pictures, calls, click, set, hit, setApi: fn => { apiImpl = fn; } };
}

test('opening Paint and changing tools/scopes never change the project or create undo records', async t => {
    const h = harness(t), before = structuredClone(h.state.project);
    await h.click('Brush'); h.set('Apply to', 'chosen'); h.set('Native textures', 'replace');
    assert.deepEqual(h.state.project, before); assert.equal(h.history.length, 0); assert.equal(h.calls.length, 0);
    assert.ok(h.doc.querySelector('.paint-part-choices')); assert.equal(h.tab.getBrush().radius, 22);
});

test('palette preview shows actual before/after meshes, cancels cleanly and applies in one undo step', async t => {
    const h = harness(t), original = structuredClone(h.state.project);
    await h.click('Preview Rune palette');
    assert.deepEqual(h.state.project, original); assert.equal(h.history.length, 0);
    assert.ok(h.pictures.length >= 2); assert.notDeepEqual(h.pictures[0].faces, h.pictures[1].faces);
    await h.click('Cancel'); assert.deepEqual(h.state.project, original);
    await h.click('Preview Dragon palette'); await h.click('Apply colours');
    assert.equal(h.history.length, 1); assert.deepEqual(h.history[0], original); assert.notDeepEqual(h.state.project, original);
    h.state.project = h.history.pop(); h.ctx.render(); assert.deepEqual(h.state.project, original);
});

test('changing shading cancels the old preview and scaled parts show a matching brush size', async t => {
    const h = harness(t); await h.click('Preview Rune palette');
    const shading = [...h.doc.querySelectorAll('label')].find(label => label.textContent === 'Keep original shading');
    shading.querySelector('input').click();
    assert.equal(h.doc.querySelector('.paint-comparison'), null); assert.equal(h.history.length, 0);
    h.state.project.parts[0].scale = [2, 2, 2]; await h.click('Brush');
    assert.equal(h.tab.getBrush().radius, 44);
});

test('one stroke paints matching mirror faces once, linked twins stay linked and undo is one step', t => {
    const h = harness(t); h.state.project.parts[0].pair = true;
    h.tab.edit(h.hit(), null, 'start'); h.tab.edit(h.hit(), null, 'move'); h.tab.edit(h.hit(1), null, 'move'); h.tab.edit(null, null, 'end');
    assert.equal(h.history.length, 1);
    const colours = h.state.project.parts[0].mesh.faces.map(f => f[3]); assert.ok(colours.every(c => c === colours[0]));
    const assembled = assemble(h.state.project.parts, 'body'); assert.deepEqual(assembled.faces.slice(0, 4).map(f => f[3]), assembled.faces.slice(4).map(f => f[3]));
    assert.match(h.messages.at(-1).text, /Linked twins/);
    assert.match(h.doc.getElementById('tools').textContent, /Both instances always share paint/);
});

test('native textures require deliberate replacement and picking preserves exact packed colours without undo', async t => {
    const h = harness(t), p = h.state.project.parts[0]; p.mesh.textures[0] = 7;
    h.tab.edit(h.hit(), null, 'start'); h.tab.edit(null, null, 'end');
    assert.equal(p.mesh.textures[0], 7); assert.equal(h.history.length, 0);
    await h.click('Pick colour'); h.tab.edit(h.hit(2), null, 'start'); h.tab.edit(h.hit(1), null, 'move'); h.tab.edit(null, null, 'end');
    assert.equal(h.state.paintTab.colour, blue); assert.equal(h.history.length, 0); assert.equal(p.mesh.faces[1][3], red);
    h.set('Native textures', 'replace'); h.tab.edit(h.hit(), null, 'start'); h.tab.edit(null, null, 'end');
    assert.equal(p.mesh.textures[0], -1); assert.equal(h.history.length, 1);
});

test('exact-colour tool replaces across chosen gear views while preserving unrelated subparts', async t => {
    const h = harness(t, { project: { name: 'Gear', kind: 'gear', parts: [part('body', 'inventory'), part('worn', 'male'), part('other', 'female')] }, variant: 'inventory' });
    h.set('Apply to', 'chosen');
    const checks = [...h.doc.querySelectorAll('.paint-part-choices input')];
    checks[0].click(); h.doc.querySelectorAll('.paint-part-choices input')[1].click();
    await h.click('Replace colour'); h.tab.edit(h.hit(), null, 'start'); h.tab.edit(null, null, 'end');
    const [inventory, worn, other] = h.state.project.parts;
    assert.equal(inventory.mesh.faces[0][3], h.state.paintTab.colour); assert.equal(worn.mesh.faces[0][3], h.state.paintTab.colour);
    assert.equal(other.mesh.faces[0][3], red); assert.equal(worn.mesh.faces[2][3], blue); assert.equal(h.history.length, 1);
});

test('entire-item palette application includes hidden worn/head views and keeps a single undo snapshot', async t => {
    const h = harness(t, { project: { name: 'Gear', kind: 'gear', parts: [part('body', 'inventory'), { ...part('head', 'maleHead'), visible: false }] }, variant: 'inventory' });
    h.set('Apply to', 'all'); await h.click('Preview Rune palette');
    assert.match(h.doc.getElementById('properties').textContent, /Applying also paints every other item view/);
    await h.click('Apply colours');
    assert.notEqual(h.state.project.parts[1].mesh.faces[0][3], red); assert.equal(h.state.project.parts[1].visible, false); assert.equal(h.history.length, 1);
});

test('pictured creature/item palette search uses the existing API and only previews on selection', async t => {
    const h = harness(t), original = structuredClone(h.state.project);
    const donor = { kind: 'item', id: 55, name: 'Rune armour', mesh: mesh() };
    h.setApi(async route => route.startsWith('search?') ? { total: 1, rows: [{ id: 55, name: 'Rune armour' }] } : donor);
    h.set('Look in', 'item');
    h.doc.querySelector('.paint-search').dispatchEvent(new h.dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.ok(h.doc.querySelector('.paint-source canvas')); assert.ok(h.pictures.length);
    h.doc.querySelector('.paint-source').click(); await tick();
    assert.deepEqual(h.state.project, original); assert.equal(h.history.length, 0);
    assert.match(h.doc.getElementById('properties').textContent, /Preview: Rune armour/);
    assert.ok(h.calls.some(route => route.startsWith('source?kind=item')));
    h.set('Look in', 'npc');
    h.setApi(async route => route.startsWith('search?') ? { total: 1, rows: [{ id: 1, name: 'Goblin' }] } : { ...donor, kind: 'npc', id: 1, name: 'Goblin' });
    h.doc.querySelector('.paint-search').dispatchEvent(new h.dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    h.doc.querySelector('.paint-source').click(); await tick();
    assert.match(h.doc.getElementById('properties').textContent, /Preview: Goblin/);
    assert.ok(h.calls.some(route => route.startsWith('source?kind=npc'))); assert.deepEqual(h.state.project, original);
});

test('switching source kind cancels a pending search without leaving the loading indicator', async t => {
    const h = harness(t); let resolve;
    h.setApi(() => new Promise(r => { resolve = r; }));
    h.doc.querySelector('.paint-search').dispatchEvent(new h.dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.match(h.doc.querySelector('.paint-source-results').textContent, /Finding palettes/);
    h.set('Look in', 'item'); resolve({ total: 1, rows: [{ id: 2, name: 'Old result' }] }); await tick();
    assert.equal(h.doc.querySelector('.paint-source'), null); assert.doesNotMatch(h.doc.querySelector('.paint-source-results').textContent, /Finding palettes/);
});

test('late source restore cannot mutate a replacement project', async t => {
    const h = harness(t); let resolve;
    h.setApi(() => new Promise(r => { resolve = r; }));
    h.state.project.parts[0].mesh.faces[0][3] = gold;
    h.doc.querySelectorAll('button').forEach(button => { if (button.textContent === 'Restore source materials') button.click(); });
    const next = { ...h.state.project, parts: [part('new-body')] }; h.state.project = next; h.state.selected = 'new-body'; h.ctx.render();
    resolve({ mesh: mesh() }); await tick();
    assert.equal(h.history.length, 0); assert.equal(h.state.project, next); assert.equal(next.parts[0].mesh.faces[0][3], red);
});

test('paint made while a source restore is loading cannot be overwritten by the late response', async t => {
    const h = harness(t); let resolve;
    h.setApi(() => new Promise(r => { resolve = r; }));
    h.doc.querySelectorAll('button').forEach(button => { if (button.textContent === 'Restore source materials') button.click(); });
    h.state.project.parts[0].mesh.faces[0][3] = gold;
    resolve({ mesh: mesh() }); await tick();
    assert.equal(h.history.length, 0); assert.equal(h.state.project.parts[0].mesh.faces[0][3], gold);
    assert.match(h.messages.at(-1).text, /model changed while sources loaded/);
});

test('restore source materials is undoable and leaves geometry, hierarchy and motion untouched', async t => {
    const h = harness(t), source = mesh(), p = h.state.project.parts[0];
    p.mesh.faces[0][3] = gold; p.mesh.vertices[0][1] = 12; p.motion = { mode: 'own', sequences: { idle: 7 } };
    const before = structuredClone(h.state.project);
    h.setApi(async () => ({ mesh: source }));
    await h.click('Restore source materials');
    assert.equal(h.history.length, 1); assert.equal(p.mesh.faces[0][3], red); assert.equal(p.mesh.vertices[0][1], 12);
    assert.deepEqual(p.motion, before.parts[0].motion); assert.deepEqual(h.history[0], before);
});

test('hover highlights actual mirror targets; keyboard shortcuts ignore typing and other tabs', t => {
    const h = harness(t); h.tab.onHover(h.hit());
    assert.ok(h.tab.faceOverlay(h.hit(2))); assert.equal(h.tab.faceOverlay(h.hit(1)), null);
    let prevented = false;
    assert.equal(h.tab.onKeyDown({ key: 'b', target: { tagName: 'INPUT' }, preventDefault() { prevented = true; } }), false);
    assert.equal(h.tab.onKeyDown({ key: 'b', target: {}, preventDefault() { prevented = true; } }), true);
    assert.equal(h.tab.getBrush().radius, 22); assert.ok(prevented);
    h.state.mode = 'build'; assert.equal(h.tab.faceOverlay(h.hit()), null); assert.equal(h.tab.getBrush(), null);
});

test('cache-native textured cape can be painted, restored, saved and encoded with its native materials', async () => {
    const { BuilderCache } = await import('../cache');
    const { newProject, validateProject } = await import('../shared/project.mjs');
    const { encodeModel } = await import('../shared/model-codec.mjs');
    const { ModelData } = await import('../../../client/rs/model/ModelData');
    const cache = new BuilderCache(fileURLToPath(new URL('../../..', import.meta.url)));
    try {
        const source = cache.describe('item', 6570, 'male'), p = part('cape', 'male', structuredClone(source.mesh));
        const textured = p.mesh.textures.findIndex(id => id >= 0); assert.ok(textured >= 0);
        applyPaintPlan([p], createBrushPlan(p, [textured], gold, { textureMode: 'replace' })); assert.equal(p.mesh.textures[textured], -1);
        restoreSourceMaterials(p.mesh, sourceMaterialPlan(p.mesh, source.mesh));
        assert.deepEqual(p.mesh.faces, source.mesh.faces); assert.deepEqual(p.mesh.textures, source.mesh.textures);
        validateMesh(p.mesh);
        const project = newProject('paint-test', 'gear', cache.describe('item', 6570, 'inventory'), { definition: 60000, modelBase: 1100000 }, cache.info.name);
        project.parts.push(p); const valid = validateProject(project); assert.deepEqual(valid.parts[1].mesh.textures, p.mesh.textures);
        const result = assemble(valid.parts, 'male'); const decoded = ModelData.decode(new Int8Array(encodeModel(result)));
        assert.deepEqual(Array.from(decoded.faceTextures!), result.textures);
    } finally { cache.close(); }
});


test('skin brush writes the exact native wearer marker, preserves materials and undoes one stroke', async t => {
    const p=part('body','male');p.mesh.faces[0][3]=4550;
    const h=harness(t,{project:{name:'Skin test',kind:'gear',parts:[p]},variant:'male'});
    const before=structuredClone(h.state.project);
    await h.click('Skin');await h.click('Piece');
    assert.equal(h.history.length,0);
    h.tab.edit(h.hit(0),null,'start');h.tab.edit(null,null,'end');
    assert.equal(p.mesh.faces[0][3],4550);assert.equal(p.mesh.faces[1][3],4550,'shading never changes the exact skin marker');
    assert.deepEqual(p.mesh.vertices,before.parts[0].mesh.vertices);assert.deepEqual(p.mesh.textures,before.parts[0].mesh.textures);
    assert.equal(h.history.length,1);assert.deepEqual(h.history[0],before);
    const plan=createPalettePlan([p],[gold]);applyPaintPlan([p],plan);
    assert.equal(p.mesh.faces[0][3],4550,'automatic palettes protect exposed skin');
    assert.equal(p.mesh.faces[1][3],4550);
    h.set('Hex colour','#ff0000');assert.equal(h.state.paintTab.material,'colour');
});
