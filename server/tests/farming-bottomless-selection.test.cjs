const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Patches, Model, hooks;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Model = require('../plugins/skills/farming/Model.Farming');
    Data.initializeFarmingData();
    hooks = {};
    Patches.attach(new Proxy({}, { get: (_target, name) => (...args) => {
        if (name === 'onItemOnItem' || name === 'onItemOnObject') hooks[name] = args[0];
    } }));
});
function prepare(t, { empty = false } = {}) {
    const player = new Player(null), varbits = new Map();
    const sender = new Proxy({}, { get: (_, name) => name === 'getVarbit' ? id => varbits.get(id) ?? 0
        : name === 'sendVarbit' ? (id, value) => { varbits.set(id, value); return sender; } : () => sender });
    player.getPacketSender = () => sender; player.sendMessage = () => {};
    player.performAnimation = () => {};
    player.getClickDelay = () => ({ elapsedTime: () => true, reset() {} });
    t.mock.method(core.MapObjects, 'get', () => null);
    const id = empty ? core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET : core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET_4;
    const first = new core.Item(id), selected = new core.Item(id);
    if (!empty) {
        first.setMetaValue('farming:charges', 2).setMetaValue('farming:tier', 1);
        selected.setMetaValue('farming:charges', 4).setMetaValue('farming:tier', 2);
    }
    player.getInventory().add(first, false).add(selected, false);
    // Read the slots live: filling commits a planned copy of the inventory, so the items are replaced.
    return { player, get first() { return player.getInventory().forSlot(0); }, get selected() { return player.getInventory().forSlot(1); } };
}
function useOnPatch(f, type = 'HERB') {
    const patch = Data.CACHE.patches.find(p => p.type === type), farm = Patches.farmFor(f.player);
    f.player.moveTo(new core.Location(patch.x, patch.y, patch.z));
    const state = { ...Model.emptyPatch(Date.now(), farm), weeds: 0 };
    if (type === 'COMPOST') state.bin = { count: 10, super: 10, tomatoes: 0, tier: 2, closedAt: Date.now() - 10000000, open: true };
    farm.patches[Data.patchKey(patch)] = state;
    const event = { player: f.player, itemId: f.selected.getId(), itemSlot: 1,
        object: { getId: () => patch.id }, location: { x: patch.x, y: patch.y, z: patch.z } };
    hooks.onItemOnObject(event);
    for (let i = 0; i < 2; i++) Patches.tick();
    assert.equal(event.handled, true);
    return state;
}
test('adding compost fills the selected empty bucket in either item-use orientation', t => {
    for (const reverse of [false, true]) {
        const f = prepare(t, { empty: true }), compost = Data.itemId('Supercompost');
        f.player.getInventory().add(new core.Item(compost), false);
        hooks.onItemOnItem({ player: f.player,
            usedItemId: reverse ? f.selected.getId() : compost, usedItemSlot: reverse ? 1 : 2,
            usedWithItemId: reverse ? compost : f.selected.getId(), usedWithItemSlot: reverse ? 2 : 1 });
        assert.equal(f.first.getMetaValue('farming:charges'), undefined);
        assert.equal(f.first.getId(), core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET);
        assert.equal(f.selected.getMetaValue('farming:charges'), 2);
        assert.equal(f.selected.getMetaValue('farming:tier'), 2);
        assert.equal(f.player.getInventory().getAmount(compost), 0);
        assert.equal(f.player.getInventory().getAmount(Data.itemId('Bucket')), 1);
    }
});
test('a different compost type in an earlier bucket does not block filling the selected one', t => {
    const f = prepare(t), compost = Data.itemId('Supercompost');
    f.player.getInventory().add(new core.Item(compost), false);
    hooks.onItemOnItem({ player: f.player, usedItemId: compost, usedItemSlot: 2,
        usedWithItemId: f.selected.getId(), usedWithItemSlot: 1 });
    assert.equal(f.first.getMetaValue('farming:charges'), 2);
    assert.equal(f.selected.getMetaValue('farming:charges'), 6);
    assert.equal(f.player.getInventory().getAmount(compost), 0);
});
test('collecting compost from a bin charges the selected bucket only', t => {
    const f = prepare(t), state = useOnPatch(f, 'COMPOST');
    assert.equal(f.first.getMetaValue('farming:charges'), 2);
    assert.equal(f.selected.getMetaValue('farming:charges'), 6);
    assert.equal(state.bin.count, 9);
});
test('fertilising uses the selected bucket type and charge', t => {
    const f = prepare(t), state = useOnPatch(f);
    assert.equal(state.compost, 2);
    assert.equal(f.first.getMetaValue('farming:charges'), 2);
    assert.equal(f.selected.getMetaValue('farming:charges'), 3);
});
test('a moved bucket does not fall back to an earlier matching inventory item', t => {
    const f = prepare(t), compost = Data.itemId('Compost');
    f.player.getInventory().add(new core.Item(compost), false);
    f.player.getInventory().deleteAtSlot(1);
    hooks.onItemOnItem({ player: f.player, usedItemId: compost, usedItemSlot: 2,
        usedWithItemId: f.first.getId(), usedWithItemSlot: 1 });
    assert.equal(f.first.getMetaValue('farming:charges'), 2);
    assert.equal(f.player.getInventory().getAmount(compost), 1);
});
test('the selected bucket blocks incompatible compost even when the first bucket would accept it', t => {
    const f = prepare(t), compost = Data.itemId('Compost');
    f.player.getInventory().add(new core.Item(compost), false);
    hooks.onItemOnItem({ player: f.player, usedItemId: compost, usedItemSlot: 2,
        usedWithItemId: f.selected.getId(), usedWithItemSlot: 1 });
    assert.equal(f.first.getMetaValue('farming:charges'), 2);
    assert.equal(f.selected.getMetaValue('farming:charges'), 4);
    assert.equal(f.player.getInventory().getAmount(compost), 1);
});
test('a full selected bucket does not consume a bin charge or fill another bucket', t => {
    const f = prepare(t);
    f.selected.setMetaValue('farming:charges', 10000);
    const state = useOnPatch(f, 'COMPOST');
    assert.equal(f.first.getMetaValue('farming:charges'), 2);
    assert.equal(f.selected.getMetaValue('farming:charges'), 10000);
    assert.equal(state.bin.count, 10);
});
test('the final selected charge empties only that bucket', t => {
    const f = prepare(t);
    f.selected.setMetaValue('farming:charges', 1);
    const state = useOnPatch(f);
    assert.equal(state.compost, 2);
    assert.equal(f.first.getMetaValue('farming:charges'), 2);
    assert.equal(f.first.getId(), core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET_4);
    assert.equal(f.selected.getMetaValue('farming:charges'), 0);
    assert.equal(f.selected.getId(), core.ItemIdentifiers.BOTTOMLESS_COMPOST_BUCKET);
});
