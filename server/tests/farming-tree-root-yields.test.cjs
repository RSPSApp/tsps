const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Model, Patches, dig;
const TREES = [['OAK', 'Oak roots', 15], ['WILLOW', 'Willow roots', 30],
    ['MAPLE', 'Maple roots', 45], ['YEW', 'Yew roots', 60], ['MAGIC', 'Magic roots', 75]];
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Model = require('../plugins/skills/farming/Model.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Data.initializeFarmingData();
    Patches.attach(new Proxy({}, { get: (_, name) => (...args) => {
        if (name === 'onObjectInteraction') dig = args[0];
    } }));
});
function prepare(t, { key = 'MAGIC', level = 99, base = level, free = 27, spade = true,
    status = 'grown', stump = true } = {}) {
    const player = new Player(null), messages = [], bits = new Map();
    const sender = new Proxy({}, { get: (_, name) => name === 'getVarbit' ? id => bits.get(id) ?? 0
        : name === 'sendVarbit' ? (id, value) => { bits.set(id, value); return sender; } : () => sender });
    player.getPacketSender = () => sender;
    player.sendMessage = text => messages.push(text);
    player.performAnimation = () => {};
    player.busy = () => false;
    player.getClickDelay = () => ({ elapsedTime: () => true, reset() {} });
    player.getSkillManager().setMaxLevels(core.Skill.FARMING, base, false).setCurrentLevels(core.Skill.FARMING, level, false);
    const patch = Data.CACHE.patches.find(p => p.type === Data.CROPS.get(key).type);
    player.moveTo(new core.Location(patch.x, patch.y, patch.z));
    const farm = { offset: 0, patches: {}, tools: {} };
    farm.patches[Data.patchKey(patch)] = { ...Model.emptyPatch(Date.now(), farm), crop: key,
        stage: Data.CROPS.get(key).stages, status, stump, checked: true, lives: 1, nextAt: Number.MAX_SAFE_INTEGER };
    player.setAttribute(Patches.FARM_ATTRIBUTE, farm);
    t.mock.method(core.MapObjects, 'get', () => null);
    t.mock.method(core.ObjectDefinition, 'forPlayer', () => ({ getInteractions: () => ['Dig-up'] }));
    const inventory = player.getInventory();
    if (spade) inventory.add(new core.Item(core.ItemIdentifiers.SPADE), false);
    const filler = 28 - free - (spade ? 1 : 0);
    if (filler > 0) inventory.add(new core.Item(core.ItemIdentifiers.BRONZE_AXE, filler), false);
    const event = { player, object: { getId: () => patch.id }, clickType: 1,
        location: { x: patch.x, y: patch.y, z: patch.z } };
    return { player, inventory, messages, farm, patch, dig: () => { dig(event); ticks(5); },
        state: () => farm.patches[Data.patchKey(patch)],
        roots: name => inventory.getAmount(Data.itemId(name)) };
}
for (const [key, rootName, planting] of TREES) test(`${key} roots follow every published eight-level threshold`, t => {
    for (const [level, expected] of [[planting, 1], [planting + 7, 1], [planting + 8, 2],
        [planting + 15, 2], [planting + 16, 3], [planting + 23, 3], [planting + 24, 4], [105, 4]]) {
        const f = prepare(t, { key, level });
        f.dig();
        assert.equal(f.roots(rootName), expected, `${key}, current Farming ${level}`);
        assert.equal(f.state().crop, undefined);
        f.dig();
        assert.equal(f.roots(rootName), expected, 'an emptied patch cannot award roots twice');
    }
});
// Farming actions finish on later farming ticks, as in the captures.
const ticks = (n) => { for (let i = 0; i < n; i++) Patches.tick(); };
test('root quantity uses the current boosted or drained level when the stump is dug', t => {
    for (const [base, level, expected] of [[96, 99, 4], [99, 98, 3], [75, 83, 2]]) {
        const f = prepare(t, { base, level });
        f.dig();
        assert.equal(f.roots('Magic roots'), expected, `base ${base}, current ${level}`);
    }
});
test('insufficient inventory space preserves the entire stump and gives no partial roots', t => {
    const f = prepare(t, { free: 3 }), original = structuredClone(f.state());
    f.dig();
    assert.equal(f.roots('Magic roots'), 0);
    assert.deepEqual(f.state(), original);
});
test('an exact-fit inventory receives all four roots before the stump is cleared', t => {
    const f = prepare(t, { free: 4 });
    f.dig();
    assert.equal(f.roots('Magic roots'), 4);
    assert.equal(f.inventory.getFreeSlots(), 0);
    assert.equal(f.state().crop, undefined);
});
test('a missing spade cannot clear the stump or award roots', t => {
    const f = prepare(t, { spade: false }), original = structuredClone(f.state());
    f.dig();
    assert.equal(f.roots('Magic roots'), 0);
    assert.deepEqual(f.state(), original);
});
test('clearing a dead uncut tree or a fruit-tree stump does not give ordinary tree roots', t => {
    for (const options of [{ status: 'dead', stump: false }, { key: 'APPLE' }]) {
        const f = prepare(t, options);
        f.dig();
        for (const [, name] of TREES) assert.equal(f.roots(name), 0);
        assert.equal(f.state().crop, undefined);
    }
});
test('a successful stump dig emits the roots payload after the whole amount is given', t => {
    const f = prepare(t, { key: 'MAGIC', level: 91 });
    const events = [];
    t.mock.method(core.PluginManager, 'emitCustomEvent', (name, event) => {
        if (name === 'farming:roots') events.push(event);
    });
    f.dig();
    assert.equal(f.roots('Magic roots'), 3);
    assert.equal(events.length, 1);
    assert.equal(events[0].crop, 'MAGIC');
    assert.equal(events[0].amount, 3);
    assert.equal(events[0].itemId, Data.itemId('Magic roots'));
    assert.equal(events[0].patch.id, f.patch.id);
});
test('a full inventory does not emit a partial roots payload', t => {
    const f = prepare(t, { key: 'MAGIC', level: 91, free: 2 });
    const events = [];
    t.mock.method(core.PluginManager, 'emitCustomEvent', (name, event) => {
        if (name === 'farming:roots') events.push(event);
    });
    f.dig();
    assert.equal(f.roots('Magic roots'), 0);
    assert.deepEqual(events, []);
});
