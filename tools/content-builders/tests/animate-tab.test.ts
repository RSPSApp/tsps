import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { makePart, newProject, newMotion, validateProject } from '../shared/project.mjs';
import { assemble, extract } from '../shared/mesh.mjs';
import { compileMotion, hasOwnMotion, keyPose, sourceMovements, motionSequence, motionCompatibility, motionPreset, putPose, retimePoses, copyRoleMotion, pasteRoleMotion } from '../shared/motion.mjs';
import { BuilderCache } from '../cache';
import { compileProject } from '../export.mjs';
import { newAttack, attackRole, withPartAttack } from '../shared/creature-attacks.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(root, 'client/package.json'));
const { JSDOM } = require('jsdom');
// Browser modules use the server's absolute module URLs. Resolve those URLs for
// DOM tests without changing the production imports or starting a server.
const resolveShared = (source: string) => source.replace(/from '(\/shared\/[^']+)'/g, (_, url) => `from '${pathToFileURL(path.join(import.meta.dirname, '..', url.slice(1))).href}'`);
const attackSource = resolveShared(fs.readFileSync(path.join(import.meta.dirname, '../public/creature-attacks.mjs'), 'utf8'))
    .replace("from '/picker.mjs'", `from '${pathToFileURL(path.join(import.meta.dirname,'../public/picker.mjs')).href}'`);
const tabSource = resolveShared(fs.readFileSync(path.join(import.meta.dirname, '../public/animate.mjs'), 'utf8'))
    .replace("from '/creature-attacks.mjs'", `from 'data:text/javascript;base64,${Buffer.from(attackSource).toString('base64')}'`);
const factory = import(`data:text/javascript;base64,${Buffer.from(tabSource).toString('base64')}`).then(module => module.createAnimateTab);
const mesh = () => ({ vertices: [[0, 0, 0], [10, 0, 0], [0, -20, 0]], faces: [[0, 1, 2, 1234]], skins: [0, 1, 2], bones: [[], [], []], weights: [[], [], []] });
function source(kind = 'npc', id = 655, variant = 'body'): any {
    return { kind, id, variant, name: kind === 'item' ? 'Axe' : id === 655 ? 'Goblin' : 'Cow', mesh: mesh(),
        fields: kind === 'npc' ? { idleSeqId: 1, walkSeqId: 2, combatLevel: 2, size: 1 } : {}, gameplay: kind === 'item' ? { attackAnim: 12, standAnim: -1 } : {}, combat: kind === 'npc' ? { anims: { attack: id === 655 ? 3 : 4, block: 5, death: 6 } } : {} };
}
function creature(): any {
    const project = newProject('motion-test', 'npc', source('npc', 2790), { definition: 58000, modelBase: 1100000, sequenceBase: 50000 }, 'fixture');
    const arm = makePart(source(), 'body'); arm.name = 'Axe arm (Goblin)'; arm.parentId = project.parts[0].id; arm.position = [20, -10, 0]; project.parts.push(arm);
    return project;
}
function rigCache() {
    return {
        describe: (kind: string, id: number, variant: string) => source(kind, id, variant),
        sample: (mesh: any, sequence: number) => ({ duration: 80, frames: [0, 1, 2, 3].map(index => ({ duration: 20, vertices: mesh.vertices.map((v: number[], vertex: number) => v.map((n, axis) => n + (axis === 2 && vertex === 1 ? sequence * index : 0))) })) })
    };
}
const flush = async () => { for (let i = 0; i < 7; i++) await new Promise(resolve => setImmediate(resolve)); };
async function harness(project = creature(), intercept?: (route: string, body?: any) => any) {
    const dom = new JSDOM('<main><aside id="tools"></aside><aside id="properties"></aside></main>');
    const document = dom.window.document, tools = document.getElementById('tools'), properties = document.getElementById('properties');
    const state: any = { project, selected: project.parts.at(-1).id, variant: project.kind === 'gear' ? 'inventory' : 'body', mode: 'animate', motionRole: 'attack', poseIndex: null, playing: false, history: [], future: [], sections: {} };
    const errors: string[] = [], statuses: string[] = [], calls: any[] = [];
    let tab: any;
    const safe = (fn: Function) => async (...args: any[]) => { try { return await fn(...args); } catch (error: any) { errors.push(error.message); } };
    function element(tag: string, attrs: any = {}, ...children: any[]) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
            else if (key === 'text') node.textContent = value;
            else if (key === 'class') node.className = value;
            else if (key in node) node[key] = value;
            else node.setAttribute(key, value);
        }
        node.append(...children.filter(child => child !== null && child !== undefined && child !== false)); return node;
    }
    const viewport: any = {
        items: [], animation: null,
        play(clip: any) { this.animation = { ...clip, start: performance.now() }; },
        pause() { if (!this.animation) return; if (this.animation.pausedAt !== undefined) { this.animation.start += performance.now() - this.animation.pausedAt; delete this.animation.pausedAt; } else this.animation.pausedAt = performance.now(); },
        stop() { this.animation = null; }, setItems(items: any[]) { this.items = items; this.animation = null; }
    };
    const ctx: any = {
        state, element, viewport, safe,
        button: (text: string, fn: Function, attrs = {}) => element('button', { text, onClick: safe(fn), ...attrs }),
        selected: () => state.project.parts.find((p: any) => p.id === state.selected),
        activeParts: () => state.project.parts.filter((p: any) => p.visible && ['all', state.variant].includes(p.variant)),
        api: async (route: string, body?: any) => {
            calls.push({ route, body });
            const override = intercept?.(route, body); if (override !== undefined) return override;
            if (route.startsWith('source?')) { const params = new URLSearchParams(route.split('?')[1]); return source(params.get('kind')!, Number(params.get('id')), params.get('variant')!); }
            if (route.startsWith('mannequin?')) return { mesh: mesh() };
            if (route === 'animate-project') return compileMotion(body.project, rigCache(), body.role);
            if (route.startsWith('creature-attacks?')) return {rows:[{sourceKind:'npc',sourceId:Number(new URLSearchParams(route.split('?')[1]).get('id')),sequence:3,name:'Melee attack',style:'MELEE'},{sourceKind:'npc',sourceId:Number(new URLSearchParams(route.split('?')[1]).get('id')),sequence:9,name:'Magic attack',style:'MAGIC'}]};
            if (route === 'animate') return { mesh: body.mesh, frames: [{ duration: 40, vertices: structuredClone(body.mesh.vertices) }, { duration: 60, vertices: body.mesh.vertices.map((v: number[]) => v.map(n => n + 5)) }], length: 2 };
            if (route.startsWith('search?kind=seq')) return { rows: [{ id: 9, name: 'goblin_axe_attack', frames: 4 }], total: 1 };
            if (route.startsWith('search?')) return { rows: [{ id: 655, name: 'Goblin' }], total: 1 };
            throw new Error(`Unexpected API route ${route}`);
        },
        checkpoint() { state.history.push(JSON.stringify(state.project)); },
        stop() { state.playing = false; viewport.stop(); },
        change(fn: Function) { ctx.checkpoint(); fn(); state.dirty = true; ctx.stop(); ctx.render(); },
        render() { ctx.renderView(); tab.renderTools(tools); tab.renderProperties(properties); },
        renderView() { viewport.setItems([{ id: 'rest', mesh: assemble(state.project.parts, state.variant) }]); },
        status: (text: string, error = false) => (error ? errors : statuses).push(text),
        thumbnail: (canvas: any, m: any) => { canvas.dataset.vertices = m.vertices.length; },
        disclosure(target: any, title: string) { const area = element('details', {}, element('summary', { text: title })); target.append(area); return area; },
        slider(target: any, label: string, value: number, set: Function, options: any) {
            const range = element('input', { type: 'range', 'aria-label': label, min: options.min, max: options.max, step: options.step, value });
            range.oninput = () => { set(Number(range.value)); state.dirty = true; ctx.stop(); ctx.renderView(); }; target.append(range);
        }, updateReference: async () => { state.reference = mesh(); }
    };
    tab = (await factory)(ctx); ctx.render(); await flush();
    const click = async (text: string, scope = properties) => {
        const found = [...scope.querySelectorAll('button')].find((node: any) => node.textContent === text) as any;
        assert.ok(found, `Missing button ${text}`); assert.equal(found.disabled, false, `Disabled button ${text}`); found.click(); await flush(); return found;
    };
    const clickLabel = async (label: string, scope = tools) => {
        const found = [...scope.querySelectorAll('button')].find((node: any) => node.getAttribute('aria-label') === label) as any;
        assert.ok(found, `Missing button ${label}`); found.click(); await flush();
    };
    return { state, tab, ctx, viewport, tools, properties, errors, statuses, calls, click, clickLabel, document,
        close() { tab.reset(); dom.window.close(); } };
}

test('source actions use creature combat data and equipment player movements without inventing IDs', () => {
    assert.deepEqual(sourceMovements(source()), { idle: 1, walk: 2, run: -1, attack: 3, block: 5, death: 6 });
    assert.equal(sourceMovements(source('item', 1, 'inventory')).attack, 12);
    assert.equal(sourceMovements({ fields: {}, gameplay: { attackAnim: '12', standAnim: -1 } }).attack, -1);
    assert.deepEqual(sourceMovements({}), Object.fromEntries(['idle', 'walk', 'run', 'attack', 'block', 'death'].map(role => [role, -1])));
});

test('follow, own and pose-only resolve the part sequence without losing the parent attachment', () => {
    const project = creature(), body = project.parts[0], arm = project.parts[1];
    assert.equal(motionSequence(project, body, 'attack'), 4);
    assert.equal(motionSequence(project, arm, 'attack'), -1);
    arm.motion.mode = 'own'; arm.motion.sequences.attack = 3;
    assert.equal(motionSequence(project, arm, 'attack'), 3);
    arm.motion.mode = 'still'; assert.equal(motionSequence(project, arm, 'attack'), -1);
    assert.equal(arm.parentId, body.id);
});

test('compatibility reports missing mappings and static rigs with an actionable alternative', () => {
    const donor = source(), arm = makePart(donor, 'body');
    assert.equal(motionCompatibility(arm, donor, 3).usable, true);
    arm.mesh.vertices.push([1, 2, 3]); assert.match(motionCompatibility(arm, donor, 3).text, /Re-add/);
    arm.mesh.vertices.pop(); arm.mesh.sourceVertices = [0, 1, 99]; assert.equal(motionCompatibility(arm, donor, 3).usable, false);
    delete arm.mesh.sourceVertices; donor.mesh.skins = [-1, -1, -1]; assert.match(motionCompatibility(arm, donor, 3).text, /custom poses/);
    assert.equal(motionCompatibility(arm, donor, -1).usable, false);
});

test('four starter movements contain editable, interpolated poses that close their loops', () => {
    for (const name of ['swing', 'flap', 'bob', 'recoil']) {
        const keys = motionPreset(name);
        assert.equal(keys.length, 4); assert.equal(keys.at(-1).time, 600);
        assert.ok(keys.every((key: any, i: number) => key.time % 20 === 0 && (!i || key.time > keys[i - 1].time)));
        const { time: firstTime, ...first } = keys[0], { time: lastTime, ...last } = keys.at(-1);
        assert.deepEqual(first, last); assert.notDeepEqual(keyPose(keys, 200), first);
    }
    assert.throws(() => motionPreset('unknown'), /preset/);
    assert.throws(() => motionPreset('swing', 10), /seconds/);
});

test('pose insertion samples the authored motion, snaps to client cycles and respects export limits', () => {
    const keys = motionPreset('swing'), previous = structuredClone(keys);
    const updated = putPose(keys, 210);
    assert.equal(updated.length, 5); assert.equal(updated[2].time, 220);
    assert.deepEqual(updated[2].rotation, keyPose(keys, 210).rotation);
    assert.deepEqual(keys, previous);
    assert.equal(putPose(updated, 220).length, 5, 'editing an existing pose replaces it');
    const maximum = Array.from({ length: 32 }, (_, i) => ({ ...keys[0], time: i * 20 }));
    assert.equal(putPose(maximum, 20).length, 32); assert.throws(() => putPose(maximum, 800), /32 poses/);
    assert.throws(() => putPose(keys, 8001), /8 seconds/);
});

test('retiming retains pose values and rejects colliding client frames without mutating the input', () => {
    const keys = motionPreset('swing'), original = structuredClone(keys), doubled = retimePoses(keys, 1200);
    assert.equal(doubled.at(-1).time, 1200); assert.deepEqual(doubled.map((k: any) => k.rotation), keys.map((k: any) => k.rotation));
    assert.deepEqual(keys, original); assert.throws(() => retimePoses(keys, 20), /same frame/);
});

test('copy/paste preserves other actions, deep copies poses and refuses native movement on a different donor rig', () => {
    const part = creature().parts[1]; part.motion.mode = 'own'; part.motion.sequences.attack = 3; part.motion.keys.attack = motionPreset('swing');
    const copied = copyRoleMotion(part, 'attack'), target = newMotion(); target.sequences.idle = 42;
    const pasted = pasteRoleMotion(target, 'walk', copied);
    assert.equal(pasted.sequences.idle, 42); assert.equal(pasted.sequences.walk, 3);
    pasted.keys.walk[1].rotation[0] = 999; assert.notEqual(copied.keys[1].rotation[0], 999);
    assert.throws(() => pasteRoleMotion(target, 'walk', copied, false), /different source rigs/);
    copied.mode = 'still'; copied.sequence = -1; assert.equal(pasteRoleMotion(target, 'walk', copied, false).keys.walk.length, 4);
});

test('selected part, trigger and movement source stay visible; source restore only changes the chosen attachment', async () => {
    const h = await harness();
    try {
        const bodyBefore = structuredClone(h.state.project.parts[0]);
        assert.match(h.properties.textContent, /Axe arm \(Goblin\)/); assert.match(h.properties.textContent, /Attached to Cow/);
        assert.match(h.tools.textContent, /When attacking/); assert.ok(h.properties.querySelector('canvas'));
        await h.click("Use this part's source movements");
        assert.equal(h.state.project.parts[1].motion.mode, 'own'); assert.equal(h.state.project.parts[1].motion.sequences.attack, 3);
        assert.deepEqual(h.state.project.parts[0], bodyBefore); assert.ok(h.viewport.animation);
        assert.equal(h.state.history.length, 1); assert.equal(JSON.parse(h.state.history[0]).parts[1].motion.mode, 'follow');
        assert.deepEqual(h.errors, []);
        assert.equal(validateProject(h.state.project).parts[1].motion.mode, 'own', 'existing schema saves the authored state');
    } finally { h.close(); }
});

test('pictured donor Try previews a real compiled clip without saving; Use replaces only the selected action', async () => {
    const h = await harness();
    try {
        const before = structuredClone(h.state.project), armId = h.state.selected;
        await h.clickLabel('Browse Goblin movements');
        await h.clickLabel('Try goblin axe attack');
        assert.deepEqual(h.state.project, before); assert.ok(h.viewport.animation.frames.length > 1); assert.equal(h.state.history.length, 0);
        assert.match(h.properties.textContent, /saved movement has not changed/);
        await h.clickLabel('Use goblin axe attack');
        assert.equal(h.state.project.parts.find((p: any) => p.id === armId).motion.sequences.attack, 9);
        assert.equal(h.state.project.parts[1].motion.sequences.walk, -1); assert.deepEqual(h.state.project.parts[0], before.parts[0]);
        assert.equal(h.state.history.length, 1); assert.deepEqual(h.errors, []);
    } finally { h.close(); }
});

test('scrubbing and stepping display compiled vertices and never edit the project', async () => {
    const h = await harness();
    try {
        const before = structuredClone(h.state.project);
        assert.equal(h.properties.querySelector('[data-animate-scrub]').disabled, true);
        await h.click('Play'); const clip = h.viewport.animation;
        const range = h.properties.querySelector('[data-animate-scrub]'); range.value = '40'; range.dispatchEvent(new h.document.defaultView.Event('input')); await flush();
        assert.deepEqual(h.viewport.items[0].mesh.vertices, clip.frames[2].vertices); assert.equal(h.viewport.animation, null);
        await h.click('Next frame'); assert.deepEqual(h.viewport.items[0].mesh.vertices, clip.frames[3].vertices);
        assert.deepEqual(h.state.project, before); assert.equal(h.state.history.length, 0);
        await h.click('Play'); await h.click('Pause'); assert.ok(h.viewport.animation.pausedAt !== undefined);
        await h.click('Resume'); assert.equal(h.viewport.animation.pausedAt, undefined); assert.deepEqual(h.errors, []);
    } finally { h.close(); }
});

test('starter poses remain exportable and custom editing affects only the chosen part and action', async () => {
    const h = await harness();
    try {
        const originalBody = structuredClone(h.state.project.parts[0]);
        await h.click('Swing', h.tools); const arm = h.state.project.parts[1];
        assert.equal(arm.motion.keys.attack.length, 4); assert.equal(arm.motion.keys.walk, undefined);
        assert.deepEqual(h.state.project.parts[0], originalBody);
        await h.click('0.18 s');
        const swing = h.properties.querySelector('input[aria-label="Swing"]'); swing.value = '85'; swing.dispatchEvent(new h.document.defaultView.Event('input'));
        assert.equal(arm.motion.keys.attack[1].rotation[0], 85); assert.equal(h.state.poseIndex, 1);
        await h.click('Poses only');
        assert.equal(validateProject(h.state.project).parts[1].motion.keys.attack[1].rotation[0], 85);
        assert.ok(compileMotion(h.state.project, rigCache(), 'attack').frames.length);
        assert.deepEqual(h.errors, []);
    } finally { h.close(); }
});

test('a late preview cannot replace a new part selection', async () => {
    let resolveClip: Function | undefined;
    const h = await harness(creature(), (route, body) => route === 'animate-project' ? new Promise(resolve => { resolveClip = () => resolve(compileMotion(body.project, rigCache(), body.role)); }) : undefined);
    try {
        const play = [...h.properties.querySelectorAll('button')].find((b: any) => b.textContent === 'Play'); play.click(); await flush();
        h.state.selected = h.state.project.parts[0].id; h.ctx.render(); resolveClip!(); await flush();
        assert.equal(h.viewport.animation, null); assert.equal(h.state.playing, false); assert.match(h.properties.textContent, /Creature body/);
    } finally { h.close(); }
});

test('a failed donor preflight leaves saved movement, history and playback untouched', async () => {
    const h = await harness(creature(), route => { if (route === 'animate-project') throw new Error('This movement needs a weighted donor rig.'); });
    try {
        const before = structuredClone(h.state.project);
        await h.clickLabel('Browse Goblin movements'); await h.clickLabel('Use goblin axe attack');
        assert.deepEqual(h.state.project, before); assert.equal(h.state.history.length, 0); assert.equal(h.viewport.animation, null);
        assert.deepEqual(h.errors, ['This movement needs a weighted donor rig.']);
    } finally { h.close(); }
});

test('a late source response cannot restore movement on an attachment after selecting another part', async () => {
    let resolveSource: Function | undefined;
    const h = await harness(creature(), route => route.startsWith('source?') && /[?&]id=655(?:&|$)/.test(route) ? new Promise(resolve => { resolveSource = resolve; }) : undefined);
    try {
        const before = structuredClone(h.state.project);
        await h.click("Use this part's source movements");
        h.state.selected = h.state.project.parts[0].id; h.ctx.render(); resolveSource!(source()); await flush();
        assert.deepEqual(h.state.project, before); assert.equal(h.state.history.length, 0); assert.equal(h.viewport.animation, null); assert.deepEqual(h.errors, []);
    } finally { h.close(); }
});

test('copy poses only can reuse a movement on another source rig and another action', async () => {
    const h = await harness();
    try {
        await h.click('Swing', h.tools); const armId = h.state.selected, keys = structuredClone(h.state.project.parts[1].motion.keys.attack);
        await h.click('Copy poses only');
        h.state.selected = h.state.project.parts[0].id; h.ctx.render(); await h.click('Walk', h.tools); await h.click('Paste movement');
        const body = h.state.project.parts[0], arm = h.state.project.parts.find((p: any) => p.id === armId);
        assert.equal(body.motion.mode, 'still'); assert.deepEqual(body.motion.keys.walk, keys); assert.deepEqual(arm.motion.keys.attack, keys);
        assert.equal(body.motion.keys.attack, undefined); assert.equal(validateProject(h.state.project).parts[0].motion.keys.walk.length, 4);
        assert.deepEqual(h.errors, []);
    } finally { h.close(); }
});

test('gear uses a moving player plus worn gear, keeps defaults unsaved, hides creature poses and supports empty worn views', async () => {
    const project = newProject('gear-motion', 'gear', source('item', 4587, 'inventory'), { definition: 60000, modelBase: 1100100 }, 'fixture');
    for (const variant of ['male', 'female']) project.parts.push(makePart(source('item', 4587, variant), variant));
    project.animations.attack = -1;
    const h = await harness(project);
    try {
        assert.match(h.properties.textContent, /Inventory and head models/);
        assert.ok(!h.tools.textContent.includes('Death')); assert.ok(!h.properties.textContent.includes('Poses only'));
        assert.ok(!h.tools.textContent.includes('Make a movement'));
        await h.click('Male worn'); const before = structuredClone(h.state.project); await h.click('Play');
        const call = h.calls.find(call => call.route === 'animate');
        assert.equal(call.body.mesh.vertices.length, 6, 'three gear and three player vertices');
        assert.equal(call.body.sequence, 422, 'basic player attack only for preview');
        assert.deepEqual(h.state.project, before); assert.equal(hasOwnMotion(h.state.project), false);
        h.state.project.parts = h.state.project.parts.filter((p: any) => p.variant !== 'female');
        await h.click('Female worn'); assert.match(h.properties.textContent, /Player rig/);
        await h.click('Male worn'); assert.match(h.properties.textContent, /Player \/ weapon style default/);
        assert.deepEqual(h.errors, []);
    } finally { h.close(); }
});

test('keyboard playback does not consume typing or button activation', async () => {
    const h = await harness();
    try {
        let prevented = false;
        assert.equal(h.tab.onKeyDown({ code: 'Space', target: { tagName: 'INPUT' }, preventDefault() { prevented = true; } }), false);
        assert.equal(prevented, false);
        assert.equal(h.tab.onKeyDown({ code: 'Space', target: { tagName: 'CANVAS' }, preventDefault() { prevented = true; } }), true);
        await flush(); assert.equal(prevented, true); assert.ok(h.viewport.animation);
        assert.deepEqual(h.errors, []);
    } finally { h.close(); }
});

test('real cow with a goblin axe arm preserves independent source and custom attack export', () => {
    const cache = new BuilderCache(root);
    try {
        const cow = cache.describe('npc', 2790), goblin = cache.describe('npc', 655), offer = goblin.parts.find(p => p.name === 'Right arm')!;
        assert.ok(offer);
        const project = newProject('animate-axe-cow', 'npc', cow, { definition: 58000, modelBase: 1100000, sequenceBase: 50000 }, cache.info.name);
        const arm = makePart(goblin, 'body', offer.key); arm.mesh = extract(goblin.mesh, offer.faces);
        arm.mesh.vertices = arm.mesh.vertices.map((v: number[]) => v.map((n, axis) => n - offer.pivot[axis]));
        arm.donorPivot = [...offer.pivot]; arm.position = [45, -85, 0]; arm.parentId = project.parts[0].id;
        arm.motion.mode = 'own'; arm.motion.sequences = sourceMovements(goblin); project.parts.push(arm);
        assert.equal(motionCompatibility(arm, goblin, arm.motion.sequences.attack).usable, true);
        const clip = compileMotion(validateProject(project), cache, 'attack'); assert.ok(clip?.frames.length);
        const still = structuredClone(project); still.parts[1].motion.mode = 'still'; const baseline = compileMotion(still, cache, 'attack');
        const start = cow.mesh.vertices.length;
        assert.ok(clip.frames.some((frame: any, index: number) => frame.vertices.slice(start).some((vertex: number[], i: number) => vertex.some((value, axis) => value !== baseline.frames[Math.min(index, baseline.frames.length - 1)].vertices[start + i][axis]))), 'source attack really changes the attached arm');
        arm.motion.mode = 'still'; arm.motion.keys.attack = motionPreset('swing');
        const compiled = compileProject(project, cache);
        assert.ok(compiled.content.animationRows.some((row: any) => row.id === 50003));
        assert.equal(arm.parentId, project.parts[0].id); assert.deepEqual(arm.mesh.textures, extract(goblin.mesh, offer.faces).textures);
    } finally { cache.close(); }
});

test('named donor attacks create separate part movements and keep the primary body animation',async()=>{
    const h=await harness();
    try{
        const bodyBefore=structuredClone(h.state.project.parts[0]),animationsBefore=structuredClone(h.state.project.animations);
        await h.clickLabel('Try Magic attack on Axe arm (Goblin)');
        assert.equal(h.state.project.attacks,undefined);assert.equal(h.state.history.length,0);assert.ok(h.viewport.animation);
        await h.clickLabel('Use Magic attack on Axe arm (Goblin)');
        assert.equal(h.state.project.attacks.length,1);const a=h.state.project.attacks[0];
        assert.equal(a.name,'Magic attack');assert.equal(a.style,'MAGIC');assert.equal(a.parts[h.state.selected].sequence,9);
        assert.deepEqual(h.state.project.parts[0],bodyBefore);assert.deepEqual(h.state.project.animations,animationsBefore);
        assert.equal(validateProject(h.state.project).attacks[0].name,'Magic attack');assert.equal(h.state.motionRole,attackRole(a.id));
        await h.click('Swing',h.tools);assert.equal(h.state.project.parts[1].motion.keys[attackRole(a.id)].length,4);
        assert.deepEqual(h.state.project.parts[0],bodyBefore);assert.deepEqual(h.errors,[]);
        await h.click('Remove attack',h.tools);assert.equal(h.state.project.attacks.length,0);assert.equal(h.state.motionRole,'attack');
    }finally{h.close();}
});

test('a failed named attack preflight never saves a variant or changes the primary body',async()=>{
    const h=await harness(creature(),route=>{if(route==='animate-project')throw new Error('This donor rig is unavailable.');});
    try{const before=structuredClone(h.state.project);await h.clickLabel('Use Magic attack on Axe arm (Goblin)');assert.deepEqual(h.state.project,before);assert.equal(h.state.history.length,0);assert.deepEqual(h.errors,['This donor rig is unavailable.']);}finally{h.close();}
});

test('JalTok-Jad offers recorded melee, ranged and magic attacks and exports an attached head without replacing body movement',()=>{
    const cache=new BuilderCache(root);
    try{
        const choices=cache.attackChoices(7700);assert.deepEqual(new Set(choices.rows.map(r=>r.style)),new Set(['MELEE','RANGED','MAGIC']));
        assert.ok(!choices.rows.some(r=>r.sequence===7591||r.sequence===7594),'block/death are not offered as attacks');
        const cow=cache.describe('npc',2790),jad=cache.describe('npc',7700),offer=jad.parts.find(p=>p.name==='Head')!;assert.ok(offer);
        let project=newProject('jad-head-attacks','npc',cow,{definition:58000,modelBase:1100000,sequenceBase:50000,attackSequenceBase:50006},cache.info.name);
        const head=makePart(jad,'body',offer.key);head.mesh=extract(jad.mesh,offer.faces);head.mesh.vertices=head.mesh.vertices.map(v=>v.map((n,a)=>n-offer.pivot[a]));head.donorPivot=[...offer.pivot];head.parentId=project.parts[0].id;head.position=[30,-90,0];project.parts.push(head);
        const originalBody=structuredClone(project.parts[0]),animations=structuredClone(project.animations);
        for(const choice of choices.rows){const a=newAttack(project,choice.name);project.attacks??=[];project.attacks.push(a);project=withPartAttack(project,a.id,head.id,choice);}
        project=validateProject(project);assert.deepEqual(project.parts[0],validateProject({...project,parts:[originalBody],attacks:[]}).parts[0]);assert.deepEqual(project.animations,animations);
        const clips=project.attacks.map(a=>compileMotion(project,cache,attackRole(a.id)));assert.ok(clips.every(c=>c.frames.length>1));
        const exported=compileProject(project,cache);assert.equal(exported.content.attacks.length,4);
        assert.deepEqual(exported.content.attacks.map(a=>a.animation),[50003,50006,50007,50008]);assert.equal(exported.content.animations.attack,50003);
        assert.ok(exported.content.attacks.every(a=>exported.content.animationRows.some(row=>row.id===a.animation)));
        project.attacks[0].parts[head.id].sequence=7594;assert.throws(()=>compileProject(project,cache),/named attack/);
    }finally{cache.close();}
});
