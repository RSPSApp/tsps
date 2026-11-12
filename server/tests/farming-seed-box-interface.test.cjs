// Run after `yarn build`: node --test tests/farming-seed-box-interface.test.cjs
//
// Seed box, from rsprox captures 960, 966, 982, 1022, 1029, 3883, 3906, 4222, 4293, 4295 (rev 235/238): Fill and a seed
// used on the box reply "Stored N x Seed in your seed box."; Empty "Emptied N x Seed to your inventory."; the native bank
// Empty "Your seed box is now empty." / "...already empty."; Check opens hosidius_seedbox (Withdraw 1/3/4/X/All, op 10
// examines), and Close lists "The seed box contains:" then "N x Seed." lines. Native fixture: a real Player and the
// plugin handlers called directly (no packet decode, no client).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Guild, SeedBox, handlers;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Guild = require('../plugins/skills/farming/Guild.Farming');
    SeedBox = require('../plugins/skills/farming/SeedBox.Farming');
    Data.initializeFarmingData();
});
const STORED = 'farming:stored';
function fixture(t, { box = 'Open seed box', stored = {}, seeds = {}, fillers = 0 } = {}) {
    const player = new Player(null), calls = [], messages = [];
    // Spam lines (sendTypedMessage SPAM) are listed as "spam:<text>", game messages as they are.
    const sender = new Proxy({}, { get: (_, name) => (...args) => {
        calls.push([name, ...args]);
        if (name === 'sendTypedMessage') messages.push(args[0] === core.ChatType.SPAM ? `spam:${args[1]}` : args[1]);
        return sender;
    } });
    sender.isSubInterfaceOpen = () => calls.some(call => call[0] === 'sendSubInterface');
    player.getPacketSender = () => sender;
    player.sendMessage = text => messages.push(text);
    t.mock.method(core.PluginManager, 'emitCustomEvent', (name, event) => { if (name === 'interface:closed') SeedBox.closed(event); });
    const inventory = player.getInventory(), id = Data.itemId(box);
    const meta = Object.fromEntries(Object.entries(stored).map(([name, n]) => [Data.itemId(name), n]));
    inventory.add(new core.Item(id, 1, { [STORED]: meta }), false);
    for (const [name, n] of Object.entries(seeds)) inventory.add(new core.Item(Data.itemId(name), n), false);
    for (let i = 0; i < fillers; i++) inventory.add(new core.Item(Data.itemId('Spade')), false);
    const container = inventory.forSlot(0);
    return { player, inventory, calls, messages, container, id,
        contents: () => Object.fromEntries(Object.entries(container.getMetaValue(STORED) ?? {}).map(([k, n]) => [core.CacheDefinitions.getItem(+k).name, n])),
        action: option => Guild.storageAction({ player, slot: 0, itemId: id, option }),
        click: (op, slot, itemName, component = 'seed_layer') => SeedBox.click({ player, op, action: op, slot, itemId: itemName ? Data.itemId(itemName) : undefined,
            buttonId: core.CacheDefinitions.getComponentId('hosidius_seedbox:' + component), handled: false }),
    };
}
test('Fill stores each seed kind with a "Stored N x Seed in your seed box." line', t => {
    const f = fixture(t, { seeds: { 'Irit seed': 3, 'Kwuarm seed': 2 } });
    f.action('Fill');
    assert.deepEqual(f.messages, ['spam:Stored 3 x Irit seed in your seed box.', 'spam:Stored 2 x Kwuarm seed in your seed box.']);
    assert.deepEqual(f.contents(), { 'Irit seed': 3, 'Kwuarm seed': 2 });
});
test('Fill with no seed to store says so, and with every kind slot taken says there is no space', t => {
    const none = fixture(t, { seeds: { Spade: 1 } });
    none.action('Fill');
    assert.deepEqual(none.messages, ['You have no seeds that will fit in the seed box.']);
    const full = fixture(t, { stored: { 'Irit seed': 1, 'Kwuarm seed': 1, 'Toadflax seed': 1, 'Avantoe seed': 1, 'Snapdragon seed': 1, 'Cadantine seed': 1 }, seeds: { 'Torstol seed': 4 } });
    full.action('Fill');
    assert.deepEqual(full.messages, ["You don't have space in your seed box for that."]);
});
test('Empty returns each kind with an "Emptied N x Seed to your inventory." line', t => {
    const f = fixture(t, { stored: { 'Irit seed': 3 } });
    f.action('Empty');
    assert.deepEqual(f.messages, ['spam:Emptied 3 x Irit seed to your inventory.']);
    assert.equal(f.inventory.getAmount(Data.itemId('Irit seed')), 3);
});
test('a seed used on the box says what was stored, or that there is no space', t => {
    const f = fixture(t, { seeds: { 'Snapdragon seed': 2 } });
    const used = f.inventory.forSlot(1);
    Guild.storagePair({ player: f.player, usedItemId: f.id, usedItemSlot: 0, usedWithItemId: used.getId(), usedWithItemSlot: 1 });
    assert.deepEqual(f.messages, ['spam:Stored 2 x Snapdragon seed in your seed box.']);
    const full = fixture(t, { stored: { 'Irit seed': 1, 'Kwuarm seed': 1, 'Toadflax seed': 1, 'Avantoe seed': 1, 'Snapdragon seed': 1, 'Cadantine seed': 1 }, seeds: { 'Torstol seed': 1 } });
    Guild.storagePair({ player: full.player, usedItemId: full.id, usedItemSlot: 0, usedWithItemId: full.inventory.forSlot(1).getId(), usedWithItemSlot: 1 });
    assert.deepEqual(full.messages, ["You don't have space in your seed box for that."]);
});
test('Check opens the seed box window over its six slots and marks the player busy', t => {
    const f = fixture(t, { stored: { 'Irit seed': 3, 'Kwuarm seed': 2 } });
    f.action('Check');
    const names = f.calls.map(call => call[0]);
    assert.ok(names.includes('sendSubInterface'), 'the window is mounted');
    const inventory = f.calls.find(call => call[0] === 'sendInventory');
    assert.equal(inventory[1], core.CacheDefinitions.getInventoryId('seed_box'));
    assert.deepEqual(inventory[3].filter(Boolean).map(i => [i.id, i.amount]), [[Data.itemId('Irit seed'), 3], [Data.itemId('Kwuarm seed'), 2]]);
    const script = f.calls.find(call => call[0] === 'sendInterfaceScript');
    assert.deepEqual(script[2].slice(6), ['Withdraw 1', 'Withdraw 3', 'Withdraw 4', 'Withdraw X', 'Withdraw All']);
    assert.deepEqual(f.calls.find(call => call[0] === 'sendVarbit').slice(1), [core.CacheDefinitions.getVarbitId('busy'), 1]);
    assert.deepEqual(f.messages, [], 'nothing is printed until it closes');
});
test('the window withdraws 1, 3, 4 or all of a kind, examines on op 10 and Close lists what is left', t => {
    const f = fixture(t, { stored: { 'Irit seed': 20, 'Kwuarm seed': 5 } });
    f.action('Check');
    f.click(1, 0, 'Irit seed');
    f.click(2, 0, 'Irit seed');
    f.click(3, 0, 'Irit seed');
    assert.equal(f.inventory.getAmount(Data.itemId('Irit seed')), 8);
    f.click(5, 1, 'Kwuarm seed');
    assert.equal(f.inventory.getAmount(Data.itemId('Kwuarm seed')), 5);
    f.click(10, 0, 'Irit seed');
    assert.deepEqual(f.messages, ['spam:Emptied 1 x Irit seed to your inventory.', 'spam:Emptied 3 x Irit seed to your inventory.', 'spam:Emptied 4 x Irit seed to your inventory.',
        'spam:Emptied 5 x Kwuarm seed to your inventory.', core.CacheDefinitions.getItem(Data.itemId('Irit seed')).examine]);
    assert.deepEqual(f.contents(), { 'Irit seed': 12 });
    f.messages.length = 0;
    f.click(1, undefined, undefined, 'close_button');
    assert.ok(f.calls.some(call => call[0] === 'sendInterfaceRemoval'));
    core.PluginManager.emitCustomEvent('interface:closed', { player: f.player, interfaceId: core.CacheDefinitions.getInterfaceId('hosidius_seedbox') });
    assert.deepEqual(f.messages, ['spam:The seed box contains:', 'spam:12 x Irit seed.']);
});
test('native bank Empty reports the box empty, or that it already was', t => {
    const f = fixture(t, { stored: { 'Irit seed': 3 } });
    f.player.setStatus(core.PlayerStatus.BANKING).setInterfaceId(core.Bank.MAIN_INTERFACE_ID);
    f.player.setCurrentBankTab(0);
    const empty = () => Guild.bankStorageOp({ player: f.player, slot: 0, op: 9, item: f.container, handled: false });
    empty();
    assert.deepEqual(f.messages, ['spam:Your seed box is now empty.']);
    f.messages.length = 0;
    empty();
    assert.deepEqual(f.messages, ['Your seed box is already empty.']);
});
