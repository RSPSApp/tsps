import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { makePart } from '../shared/project.mjs';
import { assemble, partScaleAxes, worldPoint } from '../shared/mesh.mjs';
import { drawGizmo } from '../public/gizmo.mjs';

const require = createRequire(path.resolve(import.meta.dirname, '../../../client/package.json'));
const { JSDOM } = require('jsdom');
// Browser absolute imports resolve to the real shared modules, without a server or copies.
const source = fs.readFileSync(path.resolve(import.meta.dirname, '../public/build.mjs'), 'utf8')
    .replaceAll("'/shared/mesh.mjs'", JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname, '../shared/mesh.mjs')).href))
    .replaceAll("'/shared/project.mjs'", JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname, '../shared/project.mjs')).href));
const buildModule = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

async function harness(kind = 'npc') {
    const { createBuildTab } = await buildModule;
    const dom = new JSDOM('<div id="properties"></div><div id="tools"></div><canvas tabindex="0"></canvas>');
    const document = dom.window.document;
    const variant = kind === 'npc' ? 'body' : 'inventory';
    const mesh = { vertices: [[-10, -20, 0], [10, 0, 0], [0, -10, 12]], faces: [[0, 1, 2, 1234]],
        skins: [1, 1, 2], bones: [[1], [1], [2]], weights: [[255], [255], [255]],
        textures: [42], textureCoords: [0], textureMappings: [[0, 1, 2]] };
    const part = makePart({ kind: kind === 'npc' ? 'npc' : 'item', id: 655, name: 'Goblin arm', variant, mesh }, variant);
    part.position = [12, -45, 8]; part.rotation = [15, 20, 25]; part.scale = [1, 2, 3]; part.role = 'arm';
    part.motion.mode = 'own'; part.motion.sequences.attack = 123;
    part.motion.keys.attack = [{ time: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }];
    const state: any = { project: { id: 'build-test', kind, parts: [part] }, variant, selected: part.id,
        mode: 'build', sections: {}, isolate: false, playing: false, history: [] };
    const errors: string[] = [], calls: any = { render: 0, view: 0, draft: 0, fit: 0, source: [] };
    const target = document.getElementById('properties'), tools = document.getElementById('tools');
    const element = (tag, attrs = {}, ...children) => {
        const e = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key.startsWith('on')) e.addEventListener(key.slice(2).toLowerCase(), value);
            else if (key === 'class') e.className = value;
            else if (key === 'text') e.textContent = value;
            else if (key in e) e[key] = value;
            else e.setAttribute(key, value);
        }
        e.append(...children.filter(v => v !== null && v !== undefined && v !== false));
        return e;
    };
    const selected = () => state.project?.parts.find(p => p.id === state.selected);
    const safe = fn => (...args) => { try { return Promise.resolve(fn(...args)).catch(e => errors.push(e.message)); } catch (e) { errors.push(e.message); } };
    let tab;
    const ctx: any = {
        state, element, selected, safe,
        button: (text, fn, attrs = {}) => element('button', { text, onClick: safe(fn), ...attrs }),
        section: (parent, title) => { const e = element('section', { class: 'property-section' }, element('h3', { text: title })); parent.append(e); return e; },
        disclosure: (parent, title, open = false) => { const e = element('details', { class: 'property-section', open }, element('summary', { text: title })); parent.append(e); return e; },
        descendants: id => { const ids = new Set([id]); for (const key of ids) for (const p of state.project.parts) if (p.parentId === key) ids.add(p.id); return ids; },
        activeParts: () => state.project.parts.filter(p => p.visible && [state.variant, 'all'].includes(p.variant)),
        checkpoint: () => state.history.push(JSON.stringify(state.project)),
        changed: (refresh = true) => { state.dirty = true; state.checked = null; if (refresh) ctx.render(); else ctx.renderView(); },
        change: (fn, refresh = true) => { ctx.checkpoint(); fn(); ctx.changed(refresh); },
        render: () => { calls.render++; tab.renderProperties(target); },
        renderProperties: () => tab.renderProperties(target), renderView: () => calls.view++, renderParts: () => {},
        draft: () => calls.draft++, stop: () => { state.playing = false; },
        status: (text, error) => { if (error) errors.push(text); },
        library: { select: async (...args) => calls.source.push(args) },
        viewport: { canvas: document.querySelector('canvas'), fit: () => calls.fit++, dirty: false },
        views: [['inventory', 'Inventory'], ['male', 'Male worn'], ['female', 'Female worn'], ['maleHead', 'Male head'], ['femaleHead', 'Female head']],
    };
    tab = createBuildTab(ctx);
    tab.renderProperties(target);
    const input = label => { const e = target.querySelector(`input[aria-label="${label}"]`); assert.ok(e, `${label} exists`); return e; };
    const click = text => { const e = [...target.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(e, `${text} exists`); e.click(); };
    const set = (label, value, type = 'change') => { const e = input(label); e.value = String(value); e.dispatchEvent(new dom.window.Event(type, { bubbles: true })); return e; };
    return { dom, document, target, tools, state, ctx, tab, input, click, set, errors, calls, part,
        close: () => dom.window.close() };
}

for (const kind of ['npc', 'gear']) test(`${kind}: gizmo updates sync numbers and sliders in place, preserving a numeric draft`, async () => {
    const h = await harness(kind);
    try {
        const number = h.input('X (left) value'), range = h.input('X (left)');
        const rotation = h.input('Pitch value'), scale = h.input('Width value');
        number.focus(); number.value = '72.125';
        h.part.position = [900.125, -321.5, 12.75]; h.part.rotation[0] = 410.25; h.part.scale[0] = 6.25;
        h.tab.syncValues();
        assert.equal(h.input('X (left) value'), number, 'same number element survives each drag update');
        assert.equal(h.document.activeElement, number, 'focus survives');
        assert.equal(number.value, '72.125', 'active numeric draft survives');
        assert.equal(Number(range.value), 900.125, 'slider tracks current model while numeric draft has focus');
        assert.equal(Number(h.input('Y (down) value').value), -321.5);
        assert.equal(Number(rotation.value), 410.25, 'rotation outside the old +/-180 slider range stays visible');
        assert.equal(Number(scale.value), 6.25);
        assert.ok(Number(range.max) >= 900.125, 'working range expands before setting the range value');
        number.blur(); h.tab.syncValues();
        assert.equal(Number(number.value), 900.125, 'unfocused number resumes tracking the model');
        assert.equal(h.calls.render, 0, 'sync never rebuilds the inspector');
        assert.equal(h.state.history.length, 0, 'sync does not mutate undo history');
    } finally { h.close(); }
});

for (const kind of ['npc', 'gear']) test(`${kind}: continuous sliders and typed values retain DOM nodes and meaningful undo boundaries`, async () => {
    const h = await harness(kind);
    try {
        const number = h.input('X (left) value'), slider = h.input('X (left)');
        slider.focus(); slider.dispatchEvent(new h.dom.window.Event('pointerdown'));
        h.set('X (left)', 15.1, 'input'); h.set('X (left)', 18.2, 'input'); h.set('X (left)', 23.3, 'input');
        assert.equal(h.part.position[0], 23.3);
        assert.equal(Number(number.value), 23.3, 'numeric counterpart updates during the slide');
        assert.equal(h.document.activeElement, slider);
        assert.equal(h.state.history.length, 1, 'one history checkpoint per gesture');
        assert.equal(h.calls.render, 0);
        slider.dispatchEvent(new h.dom.window.Event('pointercancel'));
        h.set('X (left)', 24.4, 'input');
        assert.equal(h.state.history.length, 2, 'a cancelled pointer closes the previous gesture');
        slider.dispatchEvent(new h.dom.window.Event('change'));
        number.focus(); h.set('X (left) value', -78.125);
        assert.equal(h.part.position[0], -78.125);
        assert.equal(h.document.activeElement, number);
        assert.equal(h.input('X (left) value'), number);
        assert.equal(Number(slider.value), -78.125);
        assert.equal(h.state.history.length, 3);
        const history = JSON.parse(h.state.history[0]);
        assert.deepEqual(history.parts[0].position, [12, -45, 8], 'undo restores the full starting pose');
        assert.equal(h.errors.length, 0);
    } finally { h.close(); }
});

test('invalid and empty numeric edits never corrupt the project or create undo entries', async () => {
    const h = await harness();
    try {
        const before = structuredClone(h.part);
        const number = h.input('X (left) value');
        number.focus(); h.set('X (left) value', '');
        assert.equal(number.getAttribute('aria-invalid'), 'true');
        h.set('Y (down) value', 16001); h.set('Pitch value', 36001); h.set('Width value', .001);
        assert.deepEqual(h.part, before);
        assert.equal(h.state.history.length, 0);
        assert.equal(h.errors.length, 4);
        number.blur(); h.tab.syncValues();
        assert.equal(Number(number.value), 12);
        assert.equal(number.hasAttribute('aria-invalid'), false);
    } finally { h.close(); }
});

for (const kind of ['npc', 'gear']) test(`${kind}: proportion locking uses the current scale and covers the size gizmo`, async () => {
    const h = await harness(kind);
    try {
        h.input('Keep proportions').click();
        assert.equal(h.state.history.length, 0, 'tool preferences are transient');
        h.set('Width value', 2); assert.deepEqual(h.part.scale, [2, 4, 6]);
        h.set('Height value', 6); assert.deepEqual(h.part.scale, [3, 6, 9]);
        assert.equal(h.tab.scaleFromGizmo([...h.part.scale], 1, 2), true);
        h.tab.syncValues(); assert.deepEqual(h.part.scale, [6, 12, 18]);
        assert.equal(Number(h.input('Depth value').value), 18);
        // An external gizmo update must become the basis of the next Overall edit.
        h.part.scale = [2, 4, 6]; h.tab.syncValues();
        h.set('Overall value', Math.cbrt(2 * 4 * 6) * 2);
        assert.ok(h.part.scale.every((n, i) => Math.abs(n - [4, 8, 12][i]) < 1e-10));
        h.tab.scaleFromGizmo([2, 4, 6], 0, 1000);
        assert.ok(Math.abs(h.part.scale[2] - 100) < 1e-10);
        assert.ok(Math.abs(h.part.scale[1] / h.part.scale[0] - 2) < 1e-10, 'clamping preserves proportions');
        h.input('Keep proportions').click();
        h.part.scale = [2, 4, 6]; h.tab.scaleFromGizmo([2, 4, 6], 1, .5);
        assert.deepEqual(h.part.scale, [2, 2, 6]);
        assert.equal(h.tab.scaleFromGizmo([2, 4, 6], 5, 2), false);
        assert.equal(h.tab.scaleFromGizmo([2, 4, 6], 1, NaN), false);
        assert.deepEqual(h.part.scale, [2, 2, 6]);
    } finally { h.close(); }
});

test('group resets affect only their group and do not rebuild the inspector', async () => {
    const h = await harness();
    try {
        const x = h.input('X (left) value');
        h.target.querySelector('button[aria-label="Reset rotation"]').click();
        assert.deepEqual(h.part.rotation, [0, 0, 0]);
        assert.deepEqual(h.part.position, [12, -45, 8]);
        assert.deepEqual(h.part.scale, [1, 2, 3]);
        h.target.querySelector('button[aria-label="Reset scale"]').click();
        assert.deepEqual(h.part.scale, [1, 1, 1]);
        h.target.querySelector('button[aria-label="Reset position"]').click();
        assert.deepEqual(h.part.position, [0, 0, 0]);
        assert.equal(h.input('X (left) value'), x);
        assert.equal(h.calls.render, 0);
        assert.equal(h.state.history.length, 3);
    } finally { h.close(); }
});

function childOf(h, parent = h.part) {
    const child = structuredClone(parent);
    child.id = crypto.randomUUID(); child.name = 'Axe'; child.parentId = parent.id;
    child.position = [4, -3, 2]; child.scale = [1, 1, 1]; child.rotation = [0, 0, 0];
    h.state.project.parts.push(child); return child;
}

for (const kind of ['npc', 'gear']) test(`${kind}: duplicate retains textures, hierarchy, pairing and independent motion`, async () => {
    const h = await harness(kind);
    try {
        h.part.pair = true;
        const child = childOf(h), original = structuredClone(h.state.project);
        h.click('Duplicate');
        assert.equal(h.state.project.parts.length, 4);
        const copy = h.ctx.selected(), childCopy = h.state.project.parts.find(p => p.parentId === copy.id);
        assert.notEqual(copy.id, h.part.id);
        assert.equal(copy.pair, true); assert.ok(childCopy);
        assert.deepEqual(copy.motion, h.part.motion); assert.deepEqual(childCopy.motion, child.motion);
        assert.deepEqual(copy.mesh, h.part.mesh); assert.deepEqual(childCopy.mesh, child.mesh);
        copy.mesh.textures[0] = 7; copy.motion.sequences.attack = 200;
        assert.equal(h.part.mesh.textures[0], 42); assert.equal(h.part.motion.sequences.attack, 123);
        assert.deepEqual(h.state.project.parts.slice(0, 2), original.parts);
        assert.equal(h.state.history.length, 1);
        h.click('Delete');
        assert.deepEqual(h.state.project.parts, original.parts, 'delete removes the copied subtree only');
        assert.equal(h.errors.length, 0);
    } finally { h.close(); }
});

test('deletion protects the required inventory view even when other gear views exist', async () => {
    const h = await harness('gear');
    try {
        const worn = structuredClone(h.part); worn.id = 'worn'; worn.variant = 'male'; h.state.project.parts.push(worn);
        h.click('Delete');
        assert.equal(h.state.project.parts.length, 2);
        assert.equal(h.state.history.length, 0);
        assert.match(h.errors[0], /inventory view/);
    } finally { h.close(); }
});

test('attachment choices exclude descendants and preserve world geometry when detached', async () => {
    const h = await harness();
    try {
        const child = childOf(h), grandchild = childOf(h, child);
        h.state.selected = child.id; h.ctx.render();
        const select = h.target.querySelector('select[aria-label="Attached to"]');
        assert.equal([...select.options].some(o => [child.id, grandchild.id].includes(o.value)), false);
        const ids = h.ctx.descendants(child.id);
        const before = assemble(h.state.project.parts, h.state.variant, ids);
        select.value = ''; select.dispatchEvent(new h.dom.window.Event('change'));
        assert.equal(child.parentId, null);
        assert.deepEqual(assemble(h.state.project.parts, h.state.variant, ids).vertices, before.vertices);
        assert.deepEqual(child.mesh.textures, [42]);
        assert.equal(child.motion.mode, 'own');
    } finally { h.close(); }
});

for(const kind of ['gear','npc'])test(`${kind}: following parent animation is explicit, undoable and updated in the native preview`,async()=>{
    const h=await harness(kind);
    try{
        const child=childOf(h);child.motion.mode='follow';child.bindLabel=49;child.position=[0,0,0];h.state.selected=child.id;h.ctx.render();
        const before=JSON.stringify(h.state.project),toggle=[...h.target.querySelectorAll('label')].find(label=>label.textContent==='Follow parent animation')?.querySelector('input');
        assert.ok(toggle,'the attachment control is visible without opening Advanced');toggle.checked=true;toggle.dispatchEvent(new h.dom.window.Event('change'));
        assert.equal(child.rigMode,'parent');assert.equal(h.state.history.length,1);assert.equal(h.state.history[0],before);
        assert.ok(!h.target.querySelector('input[aria-label="Classic joint (−1: original) value"]'),'manual joints cannot silently contradict the parent attachment');
        const assembled=assemble(h.state.project.parts,h.state.variant,new Set([child.id]));assert.ok(assembled.skins.every(n=>n!==49));
        assert.deepEqual(h.errors,[]);
    }finally{h.close();}
});

test('source lookup, framing, nudging, isolation and keyboard shortcuts work without intercepting text entry', async () => {
    const h = await harness();
    try {
        const child = childOf(h);
        h.click('Fit selection');
        const mesh = assemble(h.state.project.parts, h.state.variant, new Set([h.part.id, child.id]));
        const centre = [0, 1, 2].map(axis => (Math.min(...mesh.vertices.map(v => v[axis])) + Math.max(...mesh.vertices.map(v => v[axis]))) / 2);
        assert.deepEqual(h.ctx.viewport.target, centre);
        assert.ok(h.ctx.viewport.distance >= 40);
        h.click('Show source'); assert.deepEqual(h.calls.source[0], ['npc', 655, 'body']);
        const distance = h.target.querySelector('select[aria-label="Nudge distance"]');
        distance.value = '0.1'; distance.dispatchEvent(new h.dom.window.Event('change'));
        h.target.querySelector('button[aria-label="Move X plus"]').click();
        assert.equal(h.part.position[0], 12.1);
        const key = (value, attrs = {}, target = h.ctx.viewport.canvas) => {
            const e = new h.dom.window.KeyboardEvent('keydown', { key: value, cancelable: true, ...attrs });
            target.dispatchEvent(e); return [h.tab.onKeyDown(e), e.defaultPrevented];
        };
        assert.deepEqual(key('ArrowUp', { altKey: true, shiftKey: true }), [true, true]);
        assert.equal(h.part.position[1], -46);
        assert.deepEqual(key('PageDown', { altKey: true }), [true, true]); assert.equal(h.part.position[2], 8.1);
        assert.deepEqual(key('R'), [true, true]); assert.equal(h.ctx.viewport.gizmoMode, 'scale');
        assert.deepEqual(key('F', { shiftKey: true }), [true, true]); assert.equal(h.calls.fit, 1);
        const before = [...h.part.position];
        assert.deepEqual(key('ArrowUp', { altKey: true }, h.input('X (left) value')), [false, false]);
        assert.deepEqual(h.part.position, before);
        h.state.placement = {}; assert.deepEqual(key('R'), [false, false]); h.state.placement = null;
        h.click('Isolate part'); assert.equal(h.state.isolate, true);
        h.click('Show all parts'); assert.equal(h.state.isolate, false);
        assert.equal(h.errors.length, 0);
    } finally { h.close(); }
});

for (const whole of [false, true]) test(`gear ${whole ? 'whole-view' : 'subtree'} copies preserve parts and animation instead of flattening`, async () => {
    const h = await harness('gear');
    try {
        const child = childOf(h); h.part.pair = true;
        const original = structuredClone(h.state.project.parts);
        h.ctx.render();
        const destination = h.target.querySelector('select[aria-label="Copy destination"]');
        assert.equal([...destination.options].some(o => o.value === 'inventory'), false);
        destination.value = 'female';
        h.click(whole ? 'Copy whole view' : 'Copy part + children');
        const copies = h.state.project.parts.filter(p => p.variant === 'female');
        assert.equal(copies.length, 2);
        const copy = h.ctx.selected(), childCopy = copies.find(p => p.parentId === copy.id);
        assert.ok(childCopy); assert.equal(copy.pair, true);
        assert.deepEqual(copy.mesh, h.part.mesh); assert.deepEqual(childCopy.mesh, child.mesh);
        assert.deepEqual(copy.motion, h.part.motion); assert.deepEqual(childCopy.motion, child.motion);
        assert.deepEqual(h.state.project.parts.filter(p => p.variant === 'inventory'), original);
        assert.equal(h.state.variant, 'female'); assert.equal(h.state.reference, null);
        assert.equal(h.state.history.length, 1);
        assert.equal(h.errors.length, 0);
    } finally { h.close(); }
});

test('copying an attached gear subtree carries its parent placement into the destination', async () => {
    const h = await harness('gear');
    try {
        const child = childOf(h); childOf(h, child);
        h.state.selected = child.id; h.ctx.render();
        const ids = h.ctx.descendants(child.id);
        const before = assemble(h.state.project.parts, 'inventory', ids);
        h.target.querySelector('select[aria-label="Copy destination"]').value = 'male';
        h.click('Copy part + children');
        const copies = h.state.project.parts.filter(p => p.variant === 'male');
        assert.equal(copies.length, 2);
        assert.equal(h.ctx.selected().parentId, null);
        assert.deepEqual(assemble(h.state.project.parts, 'male').vertices, before.vertices);
        assert.equal(copies[0].motion.mode, 'own'); assert.deepEqual(copies[0].mesh.textures, [42]);
    } finally { h.close(); }
});

test('copying a shared gear root copies only children in the active view', async () => {
    const h = await harness('gear');
    try {
        h.part.variant = 'all';
        const inventoryChild = childOf(h); inventoryChild.variant = 'inventory'; inventoryChild.name = 'Inventory detail';
        const maleChild = childOf(h); maleChild.variant = 'male'; maleChild.name = 'Worn detail';
        h.ctx.render();
        h.target.querySelector('select[aria-label="Copy destination"]').value = 'female';
        h.click('Copy part + children');
        const copies = h.state.project.parts.filter(p => p.variant === 'female');
        assert.deepEqual(copies.map(p => p.name), ['Goblin arm', 'Inventory detail']);
        assert.equal(h.state.project.parts.find(p => p.id === maleChild.id).variant, 'male');
        assert.equal(h.state.history.length, 1);
    } finally { h.close(); }
});

test('gear copying guides an inherited mirrored child to its paired parent instead of losing a side', async () => {
    const h = await harness('gear');
    try {
        h.part.pair = true;
        const child = childOf(h); child.pair = false;
        h.state.selected = child.id; h.ctx.render();
        const copy = [...h.target.querySelectorAll('button')].find(b => b.textContent === 'Copy part + children');
        assert.equal(copy.disabled, true);
        h.click('Select mirrored parent');
        assert.equal(h.state.selected, h.part.id);
        h.target.querySelector('select[aria-label="Copy destination"]').value = 'female';
        h.click('Copy part + children');
        const before = assemble(h.state.project.parts, 'inventory'), after = assemble(h.state.project.parts, 'female');
        assert.deepEqual(after.vertices, before.vertices);
        assert.deepEqual(after.textures, before.textures);
        assert.equal(h.errors.length, 0);
    } finally { h.close(); }
});

test('joint tools preserve materials and source animation while copying nearest rig weights', async () => {
    const h = await harness();
    try {
        const child = childOf(h);
        h.state.selected = child.id; h.ctx.render();
        const materials = structuredClone(child.mesh.textures), motion = structuredClone(child.motion);
        h.set('Classic joint (−1: original) value', 4);
        h.set('Weighted bone (−1: original) value', 5);
        assert.equal(child.bindLabel, 4); assert.equal(child.bindBone, 5);
        const donor = assemble(h.state.project.parts, 'body', new Set([h.part.id]));
        const skinned = assemble(h.state.project.parts, 'body', new Set([child.id]));
        const expected = skinned.vertices.map(v => {
            const sorted = donor.vertices.map((p, i) => ({ i, distance: p.reduce((n, x, a) => n + (x - v[a]) ** 2, 0) })).sort((a, b) => a.distance - b.distance);
            return donor.skins[sorted[0].i];
        });
        h.click('Bind to nearest body joints');
        assert.deepEqual(child.mesh.skins, expected);
        assert.equal(child.bindLabel, -1); assert.equal(child.bindBone, -1);
        assert.deepEqual(child.mesh.textures, materials); assert.deepEqual(child.motion, motion);
        assert.equal(h.errors.length, 0);
    } finally { h.close(); }
});

test('duplicate rejects part-limit overflow before changing the project', async () => {
    const h = await harness();
    try {
        for (let i = 1; i < 128; i++) { const part = structuredClone(h.part); part.id = `part-${i}`; h.state.project.parts.push(part); }
        h.click('Duplicate');
        assert.equal(h.state.project.parts.length, 128);
        assert.equal(h.state.history.length, 0);
        assert.match(h.errors[0], /128 parts/);
    } finally { h.close(); }
});

test('sync is inert for a stale selection, restored history object, different mode or reset tab', async () => {
    const h = await harness();
    try {
        const input = h.input('X (left) value');
        h.state.selected = null; h.part.position[0] = 25;
        assert.equal(h.tab.syncValues(), false); assert.equal(Number(input.value), 12);
        h.state.selected = h.part.id; h.state.project = structuredClone(h.state.project);
        assert.equal(h.tab.syncValues(), false);
        h.ctx.render(); assert.equal(Number(h.input('X (left) value').value), 25);
        h.state.mode = 'paint'; assert.equal(h.tab.syncValues(), false);
        h.state.mode = 'build'; h.tab.reset(); assert.equal(h.tab.syncValues(), false);
        assert.deepEqual(h.state.build, { uniform: false, nudge: 1 });
        assert.equal(h.state.history.length, 0);
    } finally { h.close(); }
});

for (const kind of ['npc', 'gear']) test(`${kind}: connections follow copied endpoints and deletion clears attack overrides`, async () => {
    const h = await harness(kind);
    try {
        const child = childOf(h);
        const bridge = structuredClone(h.part);
        bridge.id = 'bridge'; bridge.name = 'Connection'; bridge.parentId = null;
        bridge.mesh.vertexLinks = [{ partId: h.part.id, vertex: 0, twin: false }, { partId: child.id, vertex: 1, twin: false }, { partId: child.id, vertex: 2, twin: false }];
        h.state.project.parts.push(bridge);
        h.state.project.attacks = [{ parts: { [child.id]: { sequence: 123 } } }];
        h.ctx.render();
        h.click('Duplicate');
        const copy = h.ctx.selected();
        const childCopy = h.state.project.parts.find(p => p.parentId === copy.id);
        const bridgeCopy = h.state.project.parts.find(p => p.id !== bridge.id && p.mesh.vertexLinks);
        assert.ok(bridgeCopy);
        assert.deepEqual(bridgeCopy.mesh.vertexLinks.map(ref => ref.partId), [copy.id, childCopy.id, childCopy.id]);
        assert.deepEqual(h.state.project.attacks[0].parts[childCopy.id], { sequence: 123 });
        h.click('Delete');
        assert.equal(h.state.project.parts.length, 3);
        assert.deepEqual(Object.keys(h.state.project.attacks[0].parts), [child.id]);
        h.state.selected = bridge.id; h.ctx.render();
        assert.equal(h.target.querySelector('input[aria-label="X (left) value"]'), null);
        assert.equal(h.tab.scaleFromGizmo([1, 1, 1], 0, 2), false);
        assert.equal([...h.target.querySelectorAll('button')].some(b => b.textContent === 'Duplicate'), false);
        assert.equal(h.errors.length, 0);
    } finally { h.close(); }
});

test('whole gear view copies remap connection endpoints to the destination', async () => {
    const h = await harness('gear');
    try {
        const child = childOf(h), bridge = structuredClone(h.part);
        bridge.id = 'bridge'; bridge.parentId = null;
        bridge.mesh.vertexLinks = [{ partId: h.part.id, vertex: 0, twin: false }, { partId: child.id, vertex: 1, twin: false }, { partId: child.id, vertex: 2, twin: false }];
        bridge.connectionEdges = [[structuredClone(bridge.mesh.vertexLinks[0]), structuredClone(bridge.mesh.vertexLinks[1])]];
        h.state.project.parts.push(bridge); h.ctx.render();
        h.target.querySelector('select[aria-label="Copy destination"]').value = 'female';
        h.click('Copy whole view');
        const copies = h.state.project.parts.filter(p => p.variant === 'female');
        assert.equal(copies.length, 3);
        const ids = new Set(copies.map(p => p.id));
        const copiedBridge = copies.find(p => p.mesh.vertexLinks);
        assert.ok(copiedBridge.mesh.vertexLinks.every(ref => ids.has(ref.partId)));
        assert.ok(copiedBridge.connectionEdges.flat().every(ref => ids.has(ref.partId)));
        assert.equal(h.errors.length, 0);
    } finally { h.close(); }
});


test('gear item naming is separate from part naming and creates one undo step', async () => {
    const h=await harness('gear');
    try {
        h.state.project.name='Original item';h.ctx.renderProperties();
        const partName=h.part.name;
        h.set('Item name','Ancient Helmet');
        assert.equal(h.state.project.name,'Ancient Helmet');assert.equal(h.part.name,partName);
        assert.equal(h.state.history.length,1);
        h.set('Part name','Small sigil');
        assert.equal(h.state.project.name,'Ancient Helmet');assert.equal(h.part.name,'Small sigil');
    } finally {h.close();}
});


test('Cape of Ancients: scale labels follow its rotated staff sigil, including its parent',async()=>{
    const h=await harness('gear');
    try {
        h.part.rotation=[82,180,0];h.part.scale=[.55,.55,.55];h.part.position=[0,-87.623,6.3];
        h.ctx.renderProperties();
        const height=h.input('Height value'),depth=h.input('Depth value');
        h.set('Height value',1.3);
        assert.deepEqual(h.part.scale,[.55,.55,1.3],'Height must control rotated local Z, not local Y');
        assert.equal(height.closest('label').querySelector('small').textContent,'Z','badge identifies its actual local axis');
        const row=height.closest('label');row.dispatchEvent(new h.dom.window.Event('pointerenter'));
        assert.equal(h.ctx.viewport.scaleAxisPreview.axis,2,'hover previews the same local Size handle');
        row.dispatchEvent(new h.dom.window.Event('pointerleave'));
        assert.equal(h.ctx.viewport.scaleAxisPreview,null);
        const parent=structuredClone(h.part);parent.id='parent';parent.parentId=null;parent.rotation=[90,0,0];parent.scale=[1,1,1];parent.position=[0,0,0];
        h.state.project.parts.push(parent);h.part.parentId=parent.id;h.tab.syncValues();
        assert.equal(h.input('Height value'),depth,'labels update in place when parent orientation changes');
        assert.equal(Number(h.input('Height value').value),.55);
    } finally {h.close();}
});

test('scale directions follow actual transformed geometry through skewed and mirrored parents',async()=>{
    const h=await harness('gear');
    try {
        const parent=structuredClone(h.part);parent.id='parent';parent.parentId=null;
        parent.rotation=[30,70,10];parent.scale=[2,.5,3];parent.mirror=true;
        h.part.rotation=[82,180,0];h.part.parentId=parent.id;h.part.mirror=true;
        h.state.project.parts.push(parent);
        const before=structuredClone(h.state.project),axes=partScaleAxes(h.part,h.state.project.parts);
        assert.equal(new Set(axes.map(info=>info.dimension)).size,3,'each scene dimension has one control');
        for(const info of axes){
            const start=worldPoint(h.part.pivot,h.part,h.state.project.parts);
            const end=worldPoint(h.part.pivot.map((n,i)=>n+(i===info.axis?1:0)),h.part,h.state.project.parts);
            const delta=end.map((n,i)=>n-start[i]),length=Math.hypot(...delta);
            assert.ok(info.direction.every((n,i)=>Math.abs(n-delta[i]/length)<1e-8));
        }
        assert.deepEqual(h.state.project,before,'describing handles does not bake or mutate geometry');
        h.ctx.renderProperties();
        const height=h.input('Height value');height.focus();height.value='1.234';
        assert.ok(h.ctx.viewport.scaleAxisPreview);
        h.part.rotation=[-90,0,0];h.tab.syncValues();
        assert.equal(h.document.activeElement,height);assert.equal(height.value,'1.234','orientation changes preserve numeric drafts');
        height.blur();assert.equal(h.ctx.viewport.scaleAxisPreview,null);
        h.tab.reset();assert.equal(h.ctx.viewport.scaleAxisPreview,null);
    } finally {h.close();}
});

test('diagonal scale controls explain angled axes and preview without changing the active gizmo',async()=>{
    const h=await harness();
    try {
        h.part.rotation=[45,0,0];h.ctx.renderProperties();
        assert.match(h.input('Height value').closest('label').textContent,/↗/);
        assert.match(h.input('Height value').closest('label').title,/angled/);
        const labels=[],alpha=[];
        const ctx:any=new Proxy({globalAlpha:1,save(){},restore(){},strokeText(text){labels.push(text);},stroke(){alpha.push(this.globalAlpha);}},
            {get:(target,key)=>key in target?target[key]:()=>{}});
        const axes=partScaleAxes(h.part,h.state.project.parts);
        const view:any={ctx,distance:300,height:500,gizmoMode:'move',project:([x,y,z])=>[x+z*.6,y+z*.6,0]};
        const config={origin:[0,0,0],directions:axes.map(info=>info.direction),partId:h.part.id,scaleLabels:axes.map(info=>info.label)};
        const preview=drawGizmo(view,{...config,mode:'scale',previewAxis:2});
        assert.deepEqual(preview,[],'hover feedback cannot start an unexpected transform');
        assert.equal(view.gizmoMode,'move');assert.ok(alpha.includes(.25)&&alpha.includes(1));
        assert.ok(labels.includes('Z Depth'));
        const handles=drawGizmo(view,{...config,mode:'scale'});
        assert.ok(handles.some(handle=>handle.axis===2&&handle.mode==='scale'));
    } finally {h.close();}
});
