// Run after the server build: node --test tests/item-editor.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const server = path.resolve(__dirname, '..');
process.chdir(server);
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const plugin = require('../plugins/tools/item-editor/Catalog.ItemEditor.plugin');
let endpoint;
test('weapon inspection resolves style animations and XP without mutating the base', () => {
    const combat = '../dist/game/content/combat/';
    const { WeaponProfiles } = require(combat + 'WeaponProfile');
    const { CombatType } = require(combat + 'CombatType');
    const { CombatSpecial } = require(combat + 'CombatSpecial');
    const { Skill } = require('../dist/game/model/Skill');
    const { createCombatReader } = require('../plugins/tools/item-editor/Combat.ItemEditor.cjs');
    const read = createCombatReader({ ItemDefinition, CacheDefinitions, WeaponProfiles, CombatType, CombatSpecial, Skill }, path.resolve(server, '..'));
    const original = JSON.stringify(CacheDefinitions.getItem(1205));
    const dagger = read(1205);
    assert.equal(dagger.weapon, true);
    assert.equal(dagger.styles.length, 4);
    assert.deepEqual(dagger.styles[0].xp, ['Attack']);
    assert.deepEqual(dagger.styles[1].xp, ['Strength']);
    assert.deepEqual(dagger.styles[3].xp, ['Defence']);
    assert.notEqual(dagger.styles[0].animation, dagger.styles[2].animation);
    assert.equal(dagger.idle, ItemDefinition.forId(1205).getStandAnim());
    const bow = read(841);
    assert.deepEqual(bow.styles[0].xp, ['Ranged']);
    assert.deepEqual(bow.styles.at(-1).xp, ['Ranged', 'Defence']);
    assert.equal(read(440).weapon, false);
    assert.equal(read(1206).weapon, false);
    const register = require('../plugins/combat/specials/DragonDagger.SpecialAttack.js');
    const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
    register({ core: { Animation: require('../dist/game/model/Animation').Animation,
            Graphic: require('../dist/game/model/Graphic').Graphic,
            GraphicHeight: require('../dist/game/model/GraphicHeight').GraphicHeight,
            MeleeCombatMethod: require(combat + 'method/impl/MeleeCombatMethod').MeleeCombatMethod,
            ItemIdentifiers, CombatSpecial }, registerCombatSpecial: definition => CombatSpecial.register(definition) });
    assert.deepEqual(read(1215).special.animations, [1062]);
    assert.equal(JSON.stringify(CacheDefinitions.getItem(1205)), original);
});
before(async () => {
    await CachePipeline.initialize(server);
    require('../plugins/items/ItemDefinitionLoader.plugin').register({
        log() { }, registerContentEndpoint() { }, onPlayerLogin() { },
    });
    let startup;
    plugin.register({ core: { CacheDefinitions, ItemDefinition },
        onServerStartup(fn) { startup = fn; },
        registerContentEndpoint(name, fn) { assert.equal(name, 'item-editor'); endpoint = fn; },
    });
    startup();
});
test('real cache ore, normal dagger and noted dagger have the correct equipment rules', () => {
    const items = endpoint().items;
    const ore = items.find(row => row.id === 440);
    const dagger = items.find(row => row.id === 1205);
    const note = items.find(row => row.id === 1206);
    assert.equal(ore.name, 'Iron ore');
    assert.equal(ore.equipable, false);
    assert.equal(dagger.name, 'Bronze dagger');
    assert.equal(dagger.equipable, true);
    assert.equal(dagger.equipmentSlot, 3);
    assert.equal(note.name, 'Bronze dagger');
    assert.equal(note.noted, true);
    assert.equal(note.equipable, false);
    assert.equal(note.reason, 'Noted items cannot be equipped');
});
test('custom definitions appear separately and reading does not mutate cache definitions', () => {
    const original = JSON.stringify(CacheDefinitions.getItem(1205));
    const catalog = endpoint();
    assert.equal(catalog.status, 'ok');
    const katana = catalog.items.find(row => row.id === 50000);
    assert.ok(katana);
    assert.equal(katana.source, 'custom');
    assert.equal(katana.equipable, true);
    assert.equal(katana.equipmentSlot, 3);
    assert.equal(catalog.items.filter(row => row.id === 50000).length, 1);
    assert.equal(JSON.stringify(CacheDefinitions.getItem(1205)), original);
    assert.equal(endpoint(), catalog);
});
test('saved custom definitions inherit equipment and retain explicit bonuses without changing the base', () => {
    const originals = CacheDefinitions.getCustomItems();
    const originalObj = JSON.stringify(CacheDefinitions.getItem(1205));
    const baseBonuses = [...(ItemDefinition.forId(1205).getBonuses() ?? [])];
    const item = { id: 60000, baseItemId: 1205, objType: { name: 'Purple dagger fixture', note: -1, noteTemplate: -1, recolorFrom: [61], recolorTo: [50000] },
        itemDef: { bonuses: [4, 34, -4, 1, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0], requirements: [60, ...new Array(23).fill(0)] } };
    try {
        CacheDefinitions.registerCustomItems([...originals, item]);
        const def = ItemDefinition.registerCustom(item.id, item.baseItemId, item.itemDef);
        assert.equal(def.getEquipmentType().getSlot(), 3);
        assert.equal(def.getBonuses()[1], 34);
        assert.equal(def.getRequirements()[0], 60);
        assert.equal(CacheDefinitions.getItem(60000).model, CacheDefinitions.getItem(1205).model);
        assert.equal(CacheDefinitions.getItem(60000).maleModel, CacheDefinitions.getItem(1205).maleModel);
        assert.equal(CacheDefinitions.getItem(60000).femaleModel, CacheDefinitions.getItem(1205).femaleModel);
        assert.equal(JSON.stringify(CacheDefinitions.getItem(1205)), originalObj);
        assert.deepEqual(ItemDefinition.forId(1205).getBonuses(), baseBonuses);
    }
    finally {
        CacheDefinitions.registerCustomItems(originals);
        ItemDefinition.definitions.delete(60000);
    }
});
test('local authoring validates, saves atomically and detects stale drafts', async (t) => {
    const fs = require('node:fs'), os = require('node:os');
    const { createAuthoring } = require('../plugins/tools/item-editor/Authoring.ItemEditor.plugin');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-item-authoring-'));
    t.after(() => {
        assert.ok(path.resolve(workspace).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(workspace, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(workspace, 'server/data/definitions'), { recursive: true });
    const canonical = path.join(workspace, 'server/data/definitions/custom-items.json');
    fs.writeFileSync(canonical, '[]\n');
    const service = createAuthoring({ CacheDefinitions, ItemDefinition }, workspace);
    const initial = service.snapshot();
    const item = { id: 60000, baseItemId: 1205, objType: { name: 'Purple dagger', recolorFrom: [10], recolorTo: [50000], note: -1, noteTemplate: -1 }, itemDef: { bonuses: new Array(14).fill(0), requirements: new Array(24).fill(0) } };
    const payload = { revision: initial.revision, existing: false, item };
    const saved = service.save(payload);
    assert.equal(saved.restartRequired, true);
    assert.notEqual(saved.revision, initial.revision);
    assert.deepEqual(JSON.parse(fs.readFileSync(canonical)), [item]);
    assert.equal(service.metadata(1205).equipmentSlot, 3);
    assert.throws(() => service.save(payload), /changed on disk/);
    assert.throws(() => service.save({ ...payload, revision: saved.revision }), /already used/);
    for (const invalid of [
        { ...item, id: 50000 },
        { ...item, baseItemId: 1206 },
        { ...item, objType: { ...item.objType, recolorTo: [] } },
        { ...item, objType: { ...item.objType, zoom2d: 0 } },
        { ...item, objType: { ...item.objType, model: 123456789 } },
        { ...item, itemDef: { requirements: [1] } },
        { ...item, itemDef: { bonuses: new Array(14).fill(NaN) } },
        { ...item, itemDef: { equipmentType: 'WEAPON' } },
        { ...item, models: { 1000002: '../../outside.dat' } },
    ]) {
        assert.throws(() => service.save({ revision: saved.revision, existing: true, item: invalid }));
        assert.deepEqual(JSON.parse(fs.readFileSync(canonical)), [item]);
    }
    const changed = { ...item, objType: { ...item.objType, name: 'Purple dagger II' } };
    const updated = service.save({ revision: saved.revision, existing: true, item: changed });
    assert.deepEqual(createAuthoring({ CacheDefinitions, ItemDefinition }, workspace).snapshot().items, [changed]);
    assert.deepEqual(CacheDefinitions.getCustomItems().map(row => row.id), [50000]); // Saving never hot-reloads a running world.
    assert.ok(!fs.readdirSync(path.dirname(canonical)).some(name => name.endsWith('.tmp')));
});
test('local authoring HTTP rejects foreign origins and accepts only JSON writes', async (t) => {
    const http = require('node:http'), fs = require('node:fs'), os = require('node:os');
    const { createAuthoring } = require('../plugins/tools/item-editor/Authoring.ItemEditor.plugin');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-item-http-'));
    fs.mkdirSync(path.join(workspace, 'server/data/definitions'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'server/data/definitions/custom-items.json'), '[]');
    const service = createAuthoring({ CacheDefinitions, ItemDefinition }, workspace);
    const server = http.createServer(service.handle);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        assert.ok(path.resolve(workspace).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(workspace, { recursive: true, force: true });
    });
    const url = `http://127.0.0.1:${server.address().port}/items`;
    for (const origin of [undefined, 'https://evil.example', 'http://localhost:9999', 'http://localhost.evil.example:3000']) {
        const response = await fetch(url, { headers: origin ? { Origin: origin } : {} });
        assert.equal(response.status, 403);
    }
    const headers = { Origin: `http://localhost:${process.env.PORT || 3000}` };
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items, []);
    assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
    assert.equal((await fetch(url, { method: 'POST', headers, body: '{}' })).status, 405);
    assert.equal((await fetch(url, { method: 'OPTIONS', headers })).status, 204);
    assert.equal((await fetch(`${url}/1205`, { headers })).status, 200);
});

test('canonical saves preserve unrelated upstream customs and their ordering', t => {
    const fs = require('node:fs'), os = require('node:os');
    const { createAuthoring } = require('../plugins/tools/item-editor/Authoring.ItemEditor.plugin');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-item-preservation-'));
    t.after(() => {
        assert.ok(path.resolve(workspace).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(workspace, { recursive: true, force: true });
    });
    const document = path.join(workspace, 'server/data/definitions/custom-items.json');
    fs.mkdirSync(path.dirname(document), { recursive: true });
    // Existing upstream content can use fields outside the editor's write schema.
    const upstream = JSON.parse(fs.readFileSync(path.join(server, 'data/definitions/custom-items.json')));
    const outsideEditor = { id: 65500, baseItemId: 1205, objType: { name: 'Unrelated variant' } };
    const originals = [outsideEditor, ...upstream];
    fs.writeFileSync(document, JSON.stringify(originals));
    const service = createAuthoring({ CacheDefinitions, ItemDefinition }, workspace);
    assert.deepEqual(service.snapshot().items, []); // Unrelated customs must not be appended again by draft refresh.
    const item = { id: 60000, baseItemId: 1205, objType: { name: 'Temporary variant' } };
    const saved = service.save({ revision: service.snapshot().revision, existing: false, item });
    assert.deepEqual(saved.items, [item]);
    assert.deepEqual(JSON.parse(fs.readFileSync(document)), [...originals, item]);
    const edited = { ...item, objType: { name: 'Updated temporary variant' } };
    service.save({ revision: saved.revision, existing: true, item: edited });
    assert.deepEqual(JSON.parse(fs.readFileSync(document)), [...originals, edited]);
    // A manual edit to any unrelated row must invalidate an open editor draft.
    const beforeExternalChange = service.snapshot();
    const external = [...originals, edited, { ...item, id: 60001 }];
    fs.writeFileSync(document, JSON.stringify(external));
    assert.throws(() => service.save({ revision: beforeExternalChange.revision, existing: true, item }), /changed on disk/);
    assert.deepEqual(JSON.parse(fs.readFileSync(document)), external);
});

test('authoring startup is opt-in and disabled for browser-host worlds', () => {
    const plugin = require('../plugins/tools/item-editor/Authoring.ItemEditor.plugin');
    const previousEnabled = process.env.ITEM_EDITOR_ENABLED;
    const previousBrowserHost = process.env.BROWSER_HOST;
    // Accessing core would mean startup passed the disabled-service guard.
    const core = new Proxy({}, { get() { throw Error('Disabled service accessed core'); } });
    let startup;
    plugin.register({ core, onServerStartup(handler) { startup = handler; } });
    try {
        delete process.env.ITEM_EDITOR_ENABLED;
        startup();
        process.env.ITEM_EDITOR_ENABLED = '1';
        process.env.BROWSER_HOST = '1';
        startup();
    } finally {
        if (previousEnabled === undefined) delete process.env.ITEM_EDITOR_ENABLED;
        else process.env.ITEM_EDITOR_ENABLED = previousEnabled;
        if (previousBrowserHost === undefined) delete process.env.BROWSER_HOST;
        else process.env.BROWSER_HOST = previousBrowserHost;
    }
});
