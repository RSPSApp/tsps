import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { BuilderCache } from '../cache';
import { createBuilderServer } from '../server';
import { encodeModel } from '../shared/model-codec.mjs';
import { assemble, components, extract, nearestRig, validateMesh } from '../shared/mesh.mjs';
import { makePart, newProject, validateProject } from '../shared/project.mjs';
import { compileProject, pluginZip, transportCheck } from '../export.mjs';
import { ProjectStore } from '../store.mjs';
import { newAttack } from '../shared/creature-attacks.mjs';
import { ModelData } from '../../../client/rs/model/ModelData';
const root = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(root, 'server/package.json'));
const { readPluginZip } = require(path.join(root, 'server/plugins/tools/worldadmin/PluginZip.WorldAdmin.js'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-builder-tests-'));
let cache: BuilderCache;
before(() => { cache = new BuilderCache(root); });
after(() => { cache?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
const ids = { definition: 58000, modelBase: 1100000 };
function creature(name = 'test-creature', definition = 58000) { return newProject(name, 'npc', cache.describe('npc', 655), { ...ids, definition }, cache.info.name); }
function gear(name = 'test-gear', definition = 60000) {
    const p = newProject(name, 'gear', cache.describe('item', 4587, 'inventory'), { definition, modelBase: 1100100 }, cache.info.name);
    for (const variant of ['male', 'female']) p.parts.push(makePart(cache.describe('item', 4587, variant), variant));
    return p;
}
function faceSignature(mesh: any) { return mesh.faces.map((f: number[]) => JSON.stringify(f.slice(0, 3).map(id => [mesh.vertices[id].map(Math.round), mesh.skins?.[id] === -1 ? 255 : mesh.skins?.[id], mesh.bones?.[id] ?? [], mesh.weights?.[id] ?? []]).concat([f[3]] as any))).sort(); }
function decodeMesh(mesh: any) { const data = ModelData.decode(new Int8Array(encodeModel(mesh))); return { vertices: Array.from({ length: data.verticesCount }, (_, i) => [data.verticesX[i], data.verticesY[i], data.verticesZ[i]]), faces: Array.from({ length: data.faceCount }, (_, i) => [data.indices1[i], data.indices2[i], data.indices3[i], data.faceColors[i]]), skins: Array.from(data.vertexSkins ?? []), bones: Array.from({ length: data.verticesCount }, (_, i) => Array.from(data.animMayaGroups?.[i] ?? [])), weights: Array.from({ length: data.verticesCount }, (_, i) => Array.from(data.animMayaScales?.[i] ?? [])) }; }

test('native model codec preserves classic and weighted geometry, labels, colours and bones', () => {
    for (const id of [655, 7221]) { const source = cache.describe('npc', id); assert.deepEqual(faceSignature(decodeMesh(source.mesh)), faceSignature(source.mesh)); const result = cache.animate(source.mesh, source.fields.idleSeqId, 4); assert.equal(result.frames.length, 4); assert.notDeepEqual(result.frames[0].vertices, result.frames.at(-1).vertices); }
    const weighted = cache.describe('npc', 7221); assert.ok(weighted.mesh.bones.some(row => row.length));
});
test('composition, mirroring and rig binding operate on copies and preserve metadata', () => {
    const source = cache.describe('npc', 655), original = JSON.stringify(source.mesh), part = makePart(source, 'body');
    part.mirror = true; part.position[0] = 20; const merged = assemble([part], 'body');
    assert.equal(merged.faces[0][0], source.mesh.faces[0][2]); assert.equal(merged.vertices[0][0], Math.round(-source.mesh.vertices[0][0] + 20)); assert.equal(JSON.stringify(source.mesh), original);
    const subset = extract(source.mesh, [0, 1, 2]); validateMesh(subset); nearestRig(subset, source.mesh); assert.equal(subset.skins.length, subset.vertices.length);
    const separated = { vertices: [[0,0,0],[1,0,0],[0,1,0],[4,0,0],[5,0,0],[4,1,0]], faces: [[0,1,2,100],[3,4,5,100]] }; assert.equal(components(separated).length, 2);
});
test('project validation blocks unsafe IDs, invalid weights, transforms and empty exports', () => {
    const p = creature(); assert.equal(validateProject(p).name, p.name);
    for (const id of ['../outside', 'a/b', '__proto__']) assert.throws(() => validateProject({ ...p, id }), /ID/);
    const broken = structuredClone(p); broken.parts[0].scale[1] = NaN; assert.throws(() => validateProject(broken), /scale/);
    const weights = structuredClone(p.parts[0].mesh); delete weights.bones; assert.throws(() => validateMesh(weights), /together/);
    const hidden = structuredClone(p); hidden.parts[0].visible = false; assert.throws(() => validateProject(hidden), /visible geometry/);
    const g = gear(); g.parts = g.parts.slice(0, 1); assert.throws(() => compileProject(g, cache), /male and female/);
});
test('atomic project saves preserve the previous revision and reserve IDs', () => {
    const store = new ProjectStore(path.join(directory, 'store'), root), p = creature();
    const first = store.save(p, null); assert.equal(store.read(p.id).revision, first.revision);
    p.name = 'Changed'; assert.throws(() => store.save(p, null), /newer saved version/);
    const next = store.save(p, first.revision); assert.notEqual(next.revision, first.revision);
    assert.throws(() => store.save(p, first.revision), /newer saved version/);
    assert.notEqual(store.allocate('npc').definition, p.ids.definition);
    assert.notEqual(store.allocate('gear').modelBase, p.ids.modelBase);
    assert.deepEqual(fs.readdirSync(store.directory), [`${p.id}.json`]);
});
test('older saved project revisions survive optional schema additions',()=>{
    const store=new ProjectStore(path.join(directory,'old-schema'),root),p=creature('legacy');
    const revision=createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0,20);
    fs.mkdirSync(store.directory,{recursive:true});fs.writeFileSync(store.file(p.id),JSON.stringify(p));
    assert.equal(store.read(p.id).revision,revision);assert.equal(store.read(p.id).project.parts[0].parentId,null);
    const changed=store.read(p.id).project;changed.name='Still editable';assert.equal(store.save(changed,revision).project.name,'Still editable');
});
test('generated ZIPs pass TSPS importer and enforce packet and package budgets', () => {
    for (const p of [creature(), gear()]) { const compiled = compileProject(p, cache), parsed = readPluginZip(pluginZip(compiled)); assert.equal(parsed.manifest.name, compiled.manifest.name); assert.equal(parsed.source, compiled.code); assert.equal(parsed.manifest.category, '@ Ghost Plugins @'); }
    assert.throws(() => transportCheck('models', [{ data: Array.from({ length: 150000 }, (_, i) => `${i * Math.random()}`).join('') }]), /packet budget/);
});
function environment() {
    const owners = new Map(), defs: any[] = [], items: any[] = [{ id: 50001, objType: { name: 'Unrelated' } }], model = { id: 1000001, data: 'existing' }, models = [model], npcs = new Map(), itemDefs = new Map(), hooks: any = {}, emitted: any[] = [];
    const type = { getSlot: () => 3 }; class Equipment { static WEAPON = type; } const base = { getEquipmentType: () => Object.assign(Object.create(Equipment.prototype), type) };
    const core: any = { CombatType: { MELEE: 0, RANGED: 1, MAGIC: 2 }, WeaponInterfaces: { SCIMITAR: {} }, encodeContentData: (source, data) => { data.forEach(d => transportCheck(d.key, d.rows)); return Buffer.alloc(0); }, CombatSpecial: { getForWeaponId: id => id === 4587 ? {} : null, setItemSpecial: (id, value) => emitted.push(['special', id, value]) }, CacheDefinitions: { getBaseCounts: () => ({ npcs: cache.counts().npc, items: cache.counts().item }), getCustomDefinitionOwner: (kind, id) => owners.get(`${kind}:${id}`), getCustomItems: () => [...items], getCustomModels: () => [...models], registerCustomDefinitions: (rows, source) => { for (const row of rows) { owners.set(`${row.kind}:${row.id}`, source); defs.push(row); } }, registerCustomItems: rows => { items.splice(0, items.length, ...rows); models.length = 0; }, setCustomModels: rows => models.splice(0, models.length, ...rows) }, NpcDefinition: { invalidateCache: () => {}, forId: id => { if (!npcs.has(id)) npcs.set(id, {}); return npcs.get(id); } }, ItemDefinition: { forId: id => itemDefs.get(id) ?? base, registerCustom: (id, baseId, raw) => { const row = { ...raw }; itemDefs.set(id, row); return row; } } };
    const api = { core, log: () => {}, onServerStartup: fn => hooks.startup = fn, onCustomEvent: (name, fn) => hooks[name] = fn, emitCustomEvent: (name, event) => { emitted.push([name, event]); if (name === 'npc-drops:roll-table') event.drops.push({ itemId: 995, amount: 3 }); } };
    return { api, owners, defs, items, models, npcs, itemDefs, hooks, emitted };
}
function load(compiled, env) { const module = { exports: {} as any }; vm.runInNewContext(compiled.code, { module, Buffer, console, Math }); module.exports.register(env.api); return module.exports; }
test('plugin registration is attach-only; new definitions and models coexist without mutating templates', () => {
    const env = environment(), p = creature(); p.drops = { mode: 'custom', sourceId: 655, emptyWeight: 0, rows: [{ itemId: 995, min: 5, max: 5, weight: 0 }] };
    load(compileProject(p, cache), env); assert.equal(env.models.length, 1); assert.equal(env.defs.length, 0);
    env.hooks.startup(); assert.equal(env.npcs.get(p.ids.definition).attackType, 0); assert.equal(env.defs[0].baseId, 655); assert.equal(env.models[0].data, 'existing');
    const claim = { killer: {}, npcId: p.ids.definition, handled: false, npc: { getLocation: () => ({ x: 1, y: 2 }) } }; env.hooks['npc-drops:claim'](claim); assert.equal(claim.handled, true); assert.deepEqual(JSON.parse(JSON.stringify(env.emitted.at(-1)[1].drops)), [{ itemId: 995, amount: 5 }]);
    const other = { ...claim, npcId: 655, handled: false }; env.hooks['npc-drops:claim'](other); assert.equal(other.handled, false);
    const g = gear(); load(compileProject(g, cache), env); env.hooks.startup(); assert.equal(env.items.length, 2); assert.equal(env.items[0].objType.name, 'Unrelated'); assert.ok(env.models.some(row => row.id === p.ids.modelBase)); assert.equal(env.itemDefs.get(g.ids.definition).attackSpeed, 4);
});
test('runtime rejects model and definition collisions before mutating registries', () => {
    for (const collision of ['model', 'npc', 'gear']) {
        const env = environment(), p = collision === 'gear' ? gear() : creature();
        if (collision === 'model') env.models.push({ id: p.ids.modelBase, data: 'owned' });
        else env.owners.set(`${collision === 'npc' ? 'npc' : 'item'}:${p.ids.definition}`, 'another-source');
        const before = JSON.stringify([env.models, env.items, env.defs]); load(compileProject(p, cache), env); assert.throws(() => env.hooks.startup(), /collision|another package/); assert.equal(JSON.stringify([env.models, env.items, env.defs]), before);
    }
});
test('local API creates, saves, imports and exports projects without writable cache routes', async () => {
    const app = createBuilderServer({ root, directory: path.join(directory, 'api'), cache });
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(app.server.address() as any).port}`;
    const post = (route, data, headers = {}) => fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
    try {
        assert.equal((await fetch(origin + '/')).status, 200);
        assert.equal((await post('/api/create', { kind: 'npc', baseId: 655 }, { Origin: 'https://example.com' })).status, 403);
        const hostStatus = await new Promise(resolve => { http.get(origin + '/api/info', { headers: { Host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); });
        assert.equal(hostStatus, 403);
        const created = await (await post('/api/create', { kind: 'npc', baseId: 655 })).json(); assert.ok(created.revision);
        const editor={tabId:'creator-befb16b9-077e-43db-8cb6-e56ffba8d89a',label:'Creature · Sculpt',mode:'sculpt',variant:'body'};
        const changed={...created.project,name:'Changed in another tab'},saved=await post('/api/save',{...created,project:changed,editor});assert.equal(saved.status,200);
        const conflict=await post('/api/save',created);assert.equal(conflict.status,409);assert.deepEqual((await conflict.json()).conflict,{projectId:created.project.id,editor});
        const stored=JSON.parse(fs.readFileSync(app.store.file(created.project.id),'utf8'));assert.equal(stored.editor,undefined,'tab metadata is transient and never enters portable project data');
        const imported = await (await post('/api/import', { project: created.project })).json(); assert.notEqual(imported.project.ids.definition, created.project.ids.definition);
        const exported = await post('/api/export', { project: created.project }); assert.equal(exported.status, 200); readPluginZip(Buffer.from(await exported.arrayBuffer()));
        assert.equal((await post('/api/source', {})).status, 404);
        const female = await (await fetch(origin + '/api/mannequin?gender=female&slot=WEAPON')).json(); assert.ok(female.mesh.faces.length);
    } finally { await new Promise<void>(resolve => app.server.close(() => resolve())); }
});

test('HTTP saves reserve extra attacks and subsequent projects cannot reuse their sequence IDs',async()=>{
    const app=createBuilderServer({root,directory:path.join(directory,'attack-api'),cache});await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${(app.server.address() as any).port}`,post=async(route:string,data:any)=>{const response=await fetch(origin+'/api/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const result=await response.json();assert.equal(response.status,route==='create'?201:200,JSON.stringify(result));return result;};
    try{
        const created=await post('create',{kind:'npc',baseId:655});created.project.attacks=[newAttack(created.project,'Axe swing')];
        const saved=await post('save',created);assert.ok(saved.project.ids.attackSequenceBase>=50000);
        const loaded=await (await fetch(origin+'/api/projects/'+saved.project.id)).json();assert.equal(loaded.project.attacks[0].name,'Axe swing');assert.deepEqual(loaded.project.ids,saved.project.ids);
        const other=await post('create',{kind:'npc',baseId:655}),used=new Set([...Array(6).keys()].map(i=>saved.project.ids.sequenceBase+i).concat([...Array(8).keys()].map(i=>saved.project.ids.attackSequenceBase+i)));
        assert.ok([...Array(6).keys()].every(i=>!used.has(other.project.ids.sequenceBase+i)));
        const choices=await (await fetch(origin+'/api/creature-attacks?id=7700')).json();assert.equal(choices.rows.length,3);
        const compiled=await post('verify',{project:saved.project});assert.ok(compiled.animations.includes(saved.project.ids.attackSequenceBase));
        const refreshed=await post('reassign',{project:saved.project});assert.ok(refreshed.project.ids.attackSequenceBase);assert.notEqual(refreshed.project.ids.attackSequenceBase,saved.project.ids.attackSequenceBase);
    }finally{await new Promise<void>(resolve=>app.server.close(()=>resolve()));}
});

test('cache-editor plugin registers an optional local tool without starting a process during registration', () => {
    const code = fs.readFileSync(path.join(root, 'server/plugins/tools/content-builders/ContentBuilders.entry.js'), 'utf8');
    for (const [enabled, browserHost] of [['0', '0'], ['1', '0'], ['1', '1']]) {
        const available = enabled === '1' && browserHost !== '1';
        const module = { exports: {} as any }, hooks: any = {}, endpoints: any = {}, spawned: any[] = [], killed: any[] = [];
        const fakeRequire = name => name === 'node:path' ? path : name === 'node:fs' ? fs : { spawn: (...args) => { spawned.push(args); return { on: () => {}, kill: signal => killed.push(signal) }; } };
        vm.runInNewContext(code, { module, require: fakeRequire, __dirname: path.join(root, 'server/plugins/tools/content-builders'), process: { env: { CACHE_EDITOR_ENABLED: enabled, BROWSER_HOST: browserHost, WT_SLOT: '1' }, execPath: process.execPath }, console, clearTimeout });
        const api = { registerContentEndpoint: (name, fn) => endpoints[name] = fn, onServerStartup: fn => hooks.start = fn, onServerShutdown: fn => hooks.stop = fn, onCustomEvent: (name, fn) => hooks[name] = fn, log: () => {} };
        module.exports.register(api); assert.equal(spawned.length, 0);
        const discovery = { tools: [] }; hooks['cache-editor:tools'](discovery);
        assert.equal(discovery.tools.length, available ? 2 : 0);
        const event = { tools: [] }; hooks['WorldAdmin:tools'](event);
        assert.equal(event.tools.length, available ? 2 : 0);
        assert.equal(module.exports.category, '@ Ghost Plugins @');
        if (available) {
            const entries = discovery.tools;
            assert.deepEqual(Array.from(entries, entry => entry.label), ['NPC Creator', 'Gear Creator']);
            assert.deepEqual(Array.from(entries, entry => new URL(entry.url).searchParams.get('view')), ['npc', 'gear']);
            assert.deepEqual(Array.from(event.tools, entry => entry.params.tool), Array.from(entries, entry => entry.id));
            assert.deepEqual(Array.from(event.tools, entry => entry.label), ['NPC Creator', 'Gear Creator']);
        }
        hooks.start(); assert.equal(spawned.length, available ? 1 : 0);
        if (available) { assert.equal(spawned[0][1][1], '3891'); hooks.stop(); assert.deepEqual(killed, ['SIGTERM']); }
    }
});

test('Creator restarts a failed tool process and cancels recovery during shutdown', () => {
    const code = fs.readFileSync(path.join(root, 'server/plugins/tools/content-builders/ContentBuilders.entry.js'), 'utf8');
    const module = { exports: {} as any }, hooks: any = {}, children: any[] = [], timers: any[] = [];
    const fakeRequire = name => name === 'node:child_process' ? { spawn: () => {
        const callbacks = {}, child = { on: (event, fn) => { callbacks[event] = fn; }, kill: () => {}, callbacks };
        children.push(child); return child;
    } } : require(name);
    vm.runInNewContext(code, { module, require: fakeRequire, __dirname: path.join(root, 'server/plugins/tools/content-builders'), process: { env: { CACHE_EDITOR_ENABLED: '1' }, execPath: process.execPath }, console: { error() {} },
        setTimeout: fn => { const timer = { fn, cancelled: false, unref() {} }; timers.push(timer); return timer; }, clearTimeout: timer => { if (timer) timer.cancelled = true; } });
    module.exports.register({ registerContentEndpoint() {}, onServerStartup: fn => hooks.start = fn, onServerShutdown: fn => hooks.stop = fn, log() {}, onCustomEvent() {} });
    hooks.start(); children[0].callbacks.exit(1, null);
    assert.equal(timers.length, 1, 'a failed sidecar schedules recovery instead of leaving a broken iframe');
    timers[0].fn(); assert.equal(children.length, 2);
    children[1].callbacks.exit(1, null); hooks.stop();
    assert.equal(timers[1].cancelled, true, 'intentional shutdown cancels pending recovery');
    hooks.start(); hooks.stop(); children[2].callbacks.exit(0, 'SIGTERM');
    assert.equal(timers.length, 2, 'stopping the world never relaunches its Creator');
});

test('pictured parts use real rig subsets for classic and modern creatures', () => {
    for(const id of [655,2477,239,7221]) {
        const source=cache.describe('npc',id),before=JSON.stringify(source.mesh);
        assert.equal(source.parts[0].faces.length,source.mesh.faces.length);
        assert.ok(source.parts.some(p=>p.key==='body'));
        assert.ok(source.parts.some(p=>p.role==='head'||p.role==='neck'));
        for(const offer of source.parts){assert.ok(offer.faces.length>0);validateMesh(extract(source.mesh,offer.faces));}
        assert.equal(JSON.stringify(source.mesh),before);
    }
    const goblin=cache.describe('npc',655);assert.ok(goblin.parts.some(p=>p.name==='Head'));assert.ok(goblin.parts.some(p=>p.role==='arm'));
    assert.ok(cache.search('npc','goblin',0,{unique:true}).total<cache.search('npc','goblin').total);
    assert.equal(cache.search('npc','655',0,{creaturesOnly:true,unique:true}).rows[0].id,655);
});

test('attachments retain parent transforms, inverse movement and reflected rig bindings', async () => {
    const {worldPoint,localPoint,reflectPoint,reparentPart}=await import('../shared/mesh.mjs');
    const p=creature('hierarchy'),rootPart=p.parts[0],child=makePart(cache.describe('npc',655),'body');
    rootPart.position=[25,-10,7];rootPart.rotation=[20,35,-15];rootPart.scale=[1.4,.8,1.2];rootPart.mirror=true;
    child.parentId=rootPart.id;child.position=[40,-20,5];child.rotation=[10,0,30];child.pair=true;child.bindLabel=4;child.twinBindLabel=9;child.bindBone=2;child.twinBindBone=7;p.parts.push(child);
    const point=[3,-5,8],world=worldPoint(point,child,p.parts),local=localPoint(world,child,p.parts);local.forEach((v,i)=>assert.ok(Math.abs(v-point[i])<1e-8));
    const only=assemble(p.parts,'body',new Set([child.id]));assert.deepEqual(only.vertices[0],worldPoint(child.mesh.vertices[0],child,p.parts).map(Math.round));
    assert.deepEqual(only.vertices[child.mesh.vertices.length],reflectPoint(worldPoint(child.mesh.vertices[0],child,p.parts),rootPart,p.parts).map(Math.round));assert.equal(only.skins[0],4);assert.equal(only.skins[child.mesh.vertices.length],9);assert.equal(only.bones[child.mesh.vertices.length][0],7);assert.equal(only.faces[0][0],child.mesh.faces[0][2],'ancestor mirroring reverses the winding');
    const old=only.vertices[0];rootPart.position[0]+=30;const moved=assemble(p.parts,'body',new Set([child.id]));assert.equal(moved.vertices[0][0],old[0]+30);assert.equal(moved.vertices[child.mesh.vertices.length][0],only.vertices[child.mesh.vertices.length][0]+30,'the mirrored attachment follows its body too');
    assert.equal(validateProject(p).parts[1].parentId,rootPart.id);
    const cyclic=structuredClone(p);cyclic.parts[0].parentId=child.id;assert.throws(()=>validateProject(cyclic),/loop/);
    const oldProject=creature('old-project');assert.equal(validateProject(oldProject).parts[0].parentId,null,'earlier project files still open');
    const grandchild=makePart(cache.describe('npc',655),'body');grandchild.parentId=child.id;grandchild.position=[10,20,-5];p.parts.push(grandchild);
    const beforeChild=child.mesh.vertices.map(v=>worldPoint(v,child,p.parts)),beforeGrandchild=grandchild.mesh.vertices.map(v=>worldPoint(v,grandchild,p.parts));
    reparentPart(p.parts,child.id,null);
    for(const [part,expected] of [[child,beforeChild],[grandchild,beforeGrandchild]] as any) {
        assert.equal(part.mesh.vertices.length,expected.length,'reparenting does not bake mirrored duplicates into source geometry');
        part.mesh.vertices.forEach((v,i)=>worldPoint(v,part,p.parts).forEach((n,a)=>assert.ok(Math.abs(n-expected[i][a])<1e-7,'reparenting preserves the whole subtree')));
    }
    assert.equal(grandchild.parentId,child.id);assert.equal(child.parentId,null);assert.ok(child.donorBasis);validateProject(p);
});
