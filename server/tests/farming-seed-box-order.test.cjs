// Run after `yarn build`: node --test tests/farming-seed-box-order.test.cjs
//
// Seed box slot order and the box used on a patch. The box is six fixed slots: kinds keep the slot they were stored in,
// a kind taken out in full frees its slot for the next new kind, and a drag in the Check window swaps two slots
// (rsprox 238/4222, 235/4293). Check, Close and Empty follow that order. Used on a patch, the box plants the first
// seed in it that suits the patch (Wiki: Seed box, 3 June 2026), says so in a message box when it has none, and does
// nothing on a tree patch (rsprox 238/4222). Native fixture: a real Player and the plugin handlers called directly.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Model, Guild, SeedBox, Patches, itemOnObject, drag;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Model = require('../plugins/skills/farming/Model.Farming');
    Guild = require('../plugins/skills/farming/Guild.Farming');
    SeedBox = require('../plugins/skills/farming/SeedBox.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Data.initializeFarmingData();
    Patches.attach(new Proxy({}, { get: (_, name) => (...args) => {
        if (name === 'onItemOnObject') itemOnObject = args[0];
        if (name === 'onCustomEvent' && args[1] === SeedBox.drag) drag = args[1];
    } }));
});
const STORED = 'farming:stored';
const id = name => Data.itemId(name);
const name = itemId => core.CacheDefinitions.getItem(itemId).name;
function fixture(t, { stored, slots, seeds = [] } = {}) {
    const player = new Player(null), calls = [], messages = [], statements = [];
    const sender = new Proxy({}, { get: (_, key) => (...args) => {
        calls.push([key, ...args]);
        if (key === 'sendTypedMessage') messages.push(args[0] === core.ChatType.SPAM ? `spam:${args[1]}`
            : args[0] === core.ChatType.MESBOX ? `mesbox:${args[1]}` : args[1]);
        return sender;
    } });
    sender.isSubInterfaceOpen = () => calls.some(call => call[0] === 'sendSubInterface');
    sender.getVarbit = () => 0;
    player.getPacketSender = () => sender;
    player.sendMessage = text => messages.push(text);
    player.performAnimation = () => {};
    player.getClickDelay = () => ({ elapsedTime: () => true, reset() {} });
    player.getDialogueManager = () => ({ startDialogues: chain => statements.push(chain), getCurrent: () => null });
    t.mock.method(core.PluginManager, 'emitCustomEvent', (event, payload) => { if (event === 'interface:closed') SeedBox.closed(payload); });
    const meta = {};
    if (stored) meta[STORED] = Object.fromEntries(stored.map(([seed, n]) => [id(seed), n]));
    if (slots) meta['farming:slots'] = slots.map(seed => (seed ? id(seed) : -1));
    const inventory = player.getInventory();
    inventory.add(new core.Item(id('Open seed box'), 1, Object.keys(meta).length ? meta : undefined), false);
    for (const [seed, n] of seeds) inventory.add(new core.Item(id(seed), n), false);
    const box = inventory.forSlot(0), layer = core.CacheDefinitions.getComponentId('hosidius_seedbox:seed_layer');
    const lastSent = () => calls.filter(call => call[0] === 'sendInventory').at(-1)[3].map(e => (e ? name(e.id) : null));
    return { player, inventory, box, calls, messages, statements,
        action: option => Guild.storageAction({ player, slot: 0, itemId: box.getId(), option }),
        click: (op, slot) => SeedBox.click({ player, op, action: op, slot, buttonId: layer, handled: false }),
        drag: (from, to, target = layer) => {
            const event = { player, packet: { sourceWidgetId: layer, sourceSlot: from, targetWidgetId: target, targetSlot: to }, handled: false };
            drag(event);
            return event;
        },
        close: () => core.PluginManager.emitCustomEvent('interface:closed', { player, interfaceId: core.CacheDefinitions.getInterfaceId('hosidius_seedbox') }),
        order: () => SeedBox.slotsOf(box).map(e => (e ? name(e[0]) : null)),
        lastSent };
}

test('kinds keep the order they were stored in, not item id order, in Check and the Close listing', t => {
    const f = fixture(t, { seeds: [['Watermelon seed', 2], ['Irit seed', 3], ['Belladonna seed', 1]] });
    f.action('Fill');
    f.action('Check');
    assert.deepEqual(f.lastSent(), ['Watermelon seed', 'Irit seed', 'Belladonna seed', null, null, null]);
    f.messages.length = 0;
    f.close();
    assert.deepEqual(f.messages, ['spam:The seed box contains:', 'spam:2 x Watermelon seed.', 'spam:3 x Irit seed.', 'spam:1 x Belladonna seed.']);
});
test('a kind withdrawn in full leaves its slot free, and the next new kind takes the first free slot', t => {
    const f = fixture(t, { stored: [['Toadflax seed', 5], ['Cadantine seed', 1], ['Irit seed', 1]], slots: ['Toadflax seed', 'Cadantine seed', 'Irit seed'],
        seeds: [['Snapdragon seed', 2]] });
    f.action('Check');
    f.click(1, 1);
    assert.deepEqual(f.lastSent(), ['Toadflax seed', null, 'Irit seed', null, null, null]);
    f.close();
    // Fill stores in inventory order: the Snapdragon seeds into the freed slot, the withdrawn Cadantine seed after Irit.
    f.action('Fill');
    assert.deepEqual(f.order(), ['Toadflax seed', 'Snapdragon seed', 'Irit seed', 'Cadantine seed', null, null]);
});
test('dragging a slot onto another swaps them, and later listings follow the new order', t => {
    const f = fixture(t, { seeds: [['Belladonna seed', 34], ['Potato cactus seed', 8], ['Poison ivy seed', 44]] });
    f.action('Fill');
    f.action('Check');
    const script = f.calls.find(call => call[0] === 'sendInterfaceScript');
    assert.equal(script[2][4], 1, 'the window is opened draggable');
    const flags = f.calls.find(call => call[0] === 'sendInterfaceFlagsRange')[4];
    assert.ok(flags & (1 << 20) && flags & (1 << 17), 'drag target and depth 1 are set');
    assert.equal(f.drag(1, 0).handled, true);
    assert.deepEqual(f.lastSent(), ['Potato cactus seed', 'Belladonna seed', 'Poison ivy seed', null, null, null]);
    f.messages.length = 0;
    f.close();
    assert.deepEqual(f.messages, ['spam:The seed box contains:', 'spam:8 x Potato cactus seed.', 'spam:34 x Belladonna seed.', 'spam:44 x Poison ivy seed.']);
    f.action('Check');
    assert.deepEqual(f.lastSent(), ['Potato cactus seed', 'Belladonna seed', 'Poison ivy seed', null, null, null]);
});
test('a drag from a free slot, from outside the window or with the window closed changes nothing', t => {
    const f = fixture(t, { stored: [['Irit seed', 1], ['Kwuarm seed', 1]], slots: ['Kwuarm seed', 'Irit seed'] });
    assert.equal(f.drag(1, 0).handled, true, 'the seed layer drag is ours even with the window shut');
    assert.deepEqual(f.order().slice(0, 2), ['Kwuarm seed', 'Irit seed']);
    f.action('Check');
    f.drag(4, 0);
    assert.equal(f.drag(0, 1, core.CacheDefinitions.getComponentId('hosidius_seedbox:close_button')).handled, false);
    assert.deepEqual(f.order().slice(0, 2), ['Kwuarm seed', 'Irit seed']);
    f.drag(0, 3);
    assert.deepEqual(f.order(), [null, 'Irit seed', null, 'Kwuarm seed', null, null]);
});
test('Empty returns the kinds in slot order', t => {
    const f = fixture(t, { stored: [['Toadflax seed', 24], ['Avantoe seed', 1], ['Irit seed', 2]], slots: ['Toadflax seed', 'Avantoe seed', null, 'Irit seed'] });
    f.action('Empty');
    assert.deepEqual(f.messages, ['spam:Emptied 24 x Toadflax seed to your inventory.', 'spam:Emptied 1 x Avantoe seed to your inventory.',
        'spam:Emptied 2 x Irit seed to your inventory.']);
    assert.equal(f.box.getMetaValue('farming:slots'), undefined, 'an empty box keeps no order');
});
test('a box saved before slot order lists its kinds by item id', t => {
    const f = fixture(t, { stored: [['Watermelon seed', 1], ['Irit seed', 1]] });
    assert.deepEqual(f.order().slice(0, 2), ['Irit seed', 'Watermelon seed']);
});

function herbPatch(t, f) {
    const patch = Data.CACHE.patches.find(p => p.type === 'HERB' && p.name !== 'Troll Stronghold') ?? Data.CACHE.patches.find(p => p.type === 'HERB');
    const farm = { offset: 0, patches: {}, tools: {} }, state = Model.emptyPatch(Date.now(), farm);
    farm.patches[Data.patchKey(patch)] = state;
    f.player.setAttribute(Patches.FARM_ATTRIBUTE, farm);
    f.player.getSkillManager().setMaxLevels(core.Skill.FARMING, 99, false).setCurrentLevel(core.Skill.FARMING, 99, false);
    f.player.moveTo(new core.Location(patch.x, patch.y, patch.z));
    t.mock.method(core.MapObjects, 'get', () => null);
    return { patch, state };
}
const useBox = (f, patch) => itemOnObject({ player: f.player, object: { getId: () => patch.id },
    location: { x: patch.x, y: patch.y, z: patch.z }, itemId: f.box.getId(), itemSlot: 0 });
const ticks = n => { for (let i = 0; i < n; i++) Patches.tick(); };

test('the box used on a herb patch plants the first herb seed in slot order from the box', t => {
    const f = fixture(t, { stored: [['Potato cactus seed', 8], ['Ranarr seed', 2], ['Guam seed', 5]], slots: ['Potato cactus seed', 'Ranarr seed', 'Guam seed'],
        seeds: [['Seed dibber', 1], ['Guam seed', 3]] });
    const { patch, state } = herbPatch(t, f);
    state.weeds = 0;
    useBox(f, patch);
    ticks(4);
    assert.equal(state.crop, 'RANARR');
    assert.deepEqual(SeedBox.entriesOf(f.box).map(([seed, n]) => [name(seed), n]), [['Potato cactus seed', 8], ['Ranarr seed', 1], ['Guam seed', 5]]);
    assert.equal(f.inventory.getAmount(id('Guam seed')), 3, 'the inventory seeds are left alone');
});
test('the box with no seed for the patch says so in a message box; on a tree patch nothing happens', t => {
    const f = fixture(t, { stored: [['Potato cactus seed', 8], ['Magic seed', 1]], seeds: [['Seed dibber', 1]] });
    const { patch, state } = herbPatch(t, f);
    state.weeds = 0;
    useBox(f, patch);
    const text = 'Your seed box does not contain any seeds that can be planted in this patch.';
    assert.deepEqual(f.messages, [`mesbox:${text}`]);
    assert.equal(f.statements.length, 1, 'the message box opens');
    assert.equal(state.crop, undefined);
    f.messages.length = 0;
    const tree = Data.CACHE.patches.find(p => p.type === 'TREE');
    const farm = f.player.getAttribute(Patches.FARM_ATTRIBUTE);
    farm.patches[Data.patchKey(tree)] = Model.emptyPatch(Date.now(), farm);
    f.player.moveTo(new core.Location(tree.x, tree.y, tree.z));
    useBox(f, tree);
    assert.deepEqual(f.messages, ['Nothing interesting happens.']);
});
test('the box passes over a seed above the player\'s level for one they can plant, and tries the first when none fits', t => {
    const f = fixture(t, { stored: [['Torstol seed', 1], ['Guam seed', 2]], slots: ['Torstol seed', 'Guam seed'], seeds: [['Seed dibber', 1]] });
    const { patch, state } = herbPatch(t, f);
    state.weeds = 0;
    f.player.getSkillManager().setMaxLevels(core.Skill.FARMING, 30, false).setCurrentLevel(core.Skill.FARMING, 30, false);
    useBox(f, patch);
    ticks(4);
    assert.equal(state.crop, 'GUAM');
    const low = fixture(t, { stored: [['Torstol seed', 1]], seeds: [['Seed dibber', 1]] });
    const second = herbPatch(t, low);
    second.state.weeds = 0;
    low.player.getSkillManager().setMaxLevels(core.Skill.FARMING, 30, false).setCurrentLevel(core.Skill.FARMING, 30, false);
    useBox(low, second.patch);
    assert.equal(second.state.crop, undefined);
    assert.equal(SeedBox.amountOf(low.box, id('Torstol seed')), 1, 'the seed stays in the box');
});
test('bank Empty deposits in slot order and the emptied box keeps no order', t => {
    const f = fixture(t, { stored: [['Irit seed', 1], ['Watermelon seed', 2]], slots: ['Watermelon seed', 'Irit seed'] });
    f.player.setStatus(core.PlayerStatus.BANKING).setInterfaceId(core.Bank.MAIN_INTERFACE_ID);
    f.player.setCurrentBankTab(0);
    const order = [];
    const bank = f.player.getBank(0), add = bank.add.bind(bank);
    t.mock.method(bank, 'add', (item, refresh) => { order.push(name(item.getId())); return add(item, refresh); });
    Guild.bankStorageOp({ player: f.player, slot: 0, op: 9, item: f.box, handled: false });
    assert.deepEqual(order, ['Watermelon seed', 'Irit seed']);
    assert.equal(f.box.getMetaValue('farming:slots'), undefined);
});
