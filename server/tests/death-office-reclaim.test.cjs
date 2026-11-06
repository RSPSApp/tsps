const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const Events = require('../plugins/world/gravestones/Events.Gravestones');
const GraveCommon = require('../plugins/world/gravestones/Common.Gravestones');
const Retrieval = require('../plugins/areas/deathsoffice/Retrieval.DeathsOffice');
const OfficeCommon = require('../plugins/areas/deathsoffice/Common.DeathsOffice');
const MAX = 2147483647;
const COINS = 995;
const WHIP_NOTE = 4152;
const RUNE_SCIMITAR = 1333;
let core;

before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
});

function fixture(t) {
    const custom = new Map();
    const buttons = new Map();
    const configs = new Map();
    const messages = [];
    const p = new Player(null);
    p.setUsername('reclaim-regression');
    const sender = new Proxy({}, { get: (_, key) => {
        if (key === 'isSubInterfaceOpen') return () => true;
        if (key === 'getVarp') return id => configs.get(id) ?? -1;
        if (key === 'sendConfig') return (id, value) => { configs.set(id, value); return sender; };
        return () => sender;
    } });
    p.getPacketSender = () => sender;
    p.sendMessage = text => messages.push(text);
    const api = {
        core,
        onCustomEvent: (name, fn) => custom.set(name, fn),
        emitCustomEvent: (name, event) => custom.get(name)?.(event),
        onInterfaceActionButton: (id, fn) => buttons.set(id, fn),
    };
    Events.attach(api);
    Retrieval.attach(api);
    // The tests accept Take-All's confirmation; dialogue rendering is unrelated.
    t.mock.method(OfficeCommon, 'choose', (_p, _question, accept) => accept[1]());
    const store = records => p.setAttribute('gravestones:office', records);
    const held = () => p.getAttribute('gravestones:office') || [];
    const add = (id, amount, meta) => p.getInventory().add(new core.Item(id, amount, meta), false);
    const withdraw = (slot, count) => {
        const query = { player: p, slot, count, taken: 0 };
        api.emitCustomEvent('gravestones:office-take', query);
        return query.taken;
    };
    const click = name => buttons.get(OfficeCommon.COMPONENT[name])({ player: p });
    return { p, add, store, held, withdraw, click, configs, messages };
}

test('Office transfer keeps overflow stored and a second withdrawal cannot erase it', t => {
    const f = fixture(t);
    f.add(COINS, MAX - 7);
    f.store([{ id: COINS, amount: 100, meta: null }]);
    assert.equal(f.withdraw(0, 100), 7);
    assert.equal(f.p.getInventory().getAmount(COINS), MAX);
    assert.equal(f.held()[0].amount, 93);
    assert.equal(f.withdraw(0, 100), 0);
    assert.equal(f.held()[0].amount, 93);
});

test('same ID with different metadata needs its own inventory slot', t => {
    const f = fixture(t);
    f.add(COINS, 5, { variant: 'held' });
    f.add(RUNE_SCIMITAR, 27);
    f.store([{ id: COINS, amount: 10, meta: { variant: 'stored' } }]);
    assert.equal(f.withdraw(0, 10), 0);
    assert.equal(f.held()[0].amount, 10);
    assert.equal(f.p.getInventory().getAmount(COINS), 5);
});

test('selected paid stack charges for headroom only and leaves remainder stored', t => {
    const f = fixture(t);
    assert.ok(core.ItemDefinition.forId(WHIP_NOTE).isStackable());
    f.add(WHIP_NOTE, MAX - 2);
    f.store([{ id: WHIP_NOTE, amount: 10, meta: null }]);
    f.p.setAttribute('gravestones:coffer', 1000000);
    const query = { player: f.p };
    OfficeCommon.api().emitCustomEvent('gravestones:state', query);
    const each = query.office[0].fee;
    assert.ok(each > 0, 'real cache item belongs to a paid band');
    f.configs.set(OfficeCommon.VARP.if2, 0);
    f.click('officeTakeAll');
    assert.equal(f.p.getInventory().getAmount(WHIP_NOTE), MAX);
    assert.equal(f.held()[0]?.amount, 8);
    assert.equal(f.p.getAttribute('gravestones:coffer'), 1000000 - each * 2);
    f.click('officeTakeAll');
    assert.equal(f.held()[0].amount, 8);
    assert.equal(f.p.getAttribute('gravestones:coffer'), 1000000 - each * 2);
});

test('Take-All reserves stack headroom and charges only what fits', t => {
    const f = fixture(t);
    f.add(WHIP_NOTE, MAX - 1);
    f.add(COINS, MAX);
    f.add(RUNE_SCIMITAR, 25);
    f.store([
        { id: WHIP_NOTE, amount: 10, meta: null },
        { id: COINS, amount: 100, meta: null },
        { id: COINS, amount: 7, meta: { variant: 'new' } },
        { id: RUNE_SCIMITAR, amount: 2, meta: null },
    ]);
    f.p.setAttribute('gravestones:coffer', 1000000);
    const state = OfficeCommon.state(f.p);
    const each = state.office[0].fee;
    f.click('officeTakeEverything');
    assert.equal(f.p.getInventory().getAmount(WHIP_NOTE), MAX);
    assert.equal(f.held()[0]?.amount, 9);
    assert.equal(f.held()[1]?.amount, 100);
    assert.equal(f.held()[2], null, 'metadata-distinct coins used the sole empty slot');
    assert.equal(f.held()[3].amount, 2, 'later nonstackable item remains stored');
    assert.equal(f.p.getAttribute('gravestones:coffer'), 1000000 - each);
});

test('grave whole-entry capacity rejects overflow and incompatible metadata', t => {
    const f = fixture(t);
    f.add(COINS, MAX - 1);
    assert.equal(GraveCommon.fits(f.p, { id: COINS, amount: 2, meta: null }), false);
    assert.equal(GraveCommon.fits(f.p, { id: COINS, amount: 1, meta: null }), true);
    f.add(RUNE_SCIMITAR, 27);
    assert.equal(GraveCommon.fits(f.p, { id: COINS, amount: 1, meta: { variant: 'other' } }), false);
});

test('capacity queries are read-only and match metadata, nonstackable and bank stacking rules', t => {
    const f = fixture(t);
    f.add(COINS, MAX - 3, { kind: 'first' });
    f.add(RUNE_SCIMITAR, 26);
    const inventory = f.p.getInventory();
    const before = inventory.getCopiedItems();
    assert.equal(inventory.getAddableAmount(new core.Item(COINS, 10, { kind: 'first' })), 3);
    assert.equal(inventory.getAddableAmount(new core.Item(COINS, 10, { kind: 'other' })), 10);
    assert.equal(inventory.getAddableAmount(new core.Item(RUNE_SCIMITAR, 5)), 1);
    assert.equal(inventory.getAddableAmount(new core.Item(COINS, 0)), 0);
    assert.equal(inventory.getAddableAmount(new core.Item(-1, 5)), 0);
    assert.deepEqual(inventory.getItems(), before, 'planning does not mutate the container');
    const bank = f.p.getBank(0);
    bank.add(new core.Item(RUNE_SCIMITAR, MAX - 2), false);
    assert.equal(bank.getAddableAmount(new core.Item(RUNE_SCIMITAR, 10)), 2,
        'nonstackable items use the same stack limit in a bank');
});


test('Office retrieval charges the loaded GE quote for each noted whip taken', t => {
    const definitions = core.ItemDefinition.definitions;
    const previous = new Map([...definitions.values()].map(def => [def, [def.grandExchangeValue, def.grandExchangeSellValue]]));
    t.after(() => {
        for (const def of definitions.values()) {
            const prices = previous.get(def) ?? [undefined, undefined];
            [def.grandExchangeValue, def.grandExchangeSellValue] = prices;
        }
    });
    const loaded = require('../plugins/items/ItemDefinitionLoader.plugin')._test.loadItemPrices();
    assert.ok(loaded.loaded > 0, 'the canonical snapshot loader loaded prices');
    const whip = core.ItemDefinition.forId(WHIP_NOTE);
    assert.equal(whip.isNoted(), true);
    assert.equal(whip.isTradeable(), true, 'the loaded noted whip is tradeable in the active cache');
    assert.equal(whip.hasGrandExchangeValue(), true);
    assert.equal(whip.getGrandExchangeValue(), 751282, 'the loader propagated the base whip quote');
    const f = fixture(t);
    f.store([{ id: WHIP_NOTE, amount: 2, meta: null }]);
    f.p.setAttribute('gravestones:coffer', 100000);
    const query = { player: f.p };
    OfficeCommon.api().emitCustomEvent('gravestones:state', query);
    assert.equal(query.office[0].fee, 37564, 'each Office item uses the loaded quote');
    f.configs.set(OfficeCommon.VARP.if2, 0);
    f.click('officeTakeAll');
    assert.equal(f.p.getInventory().getAmount(WHIP_NOTE), 2);
    assert.equal(f.p.getAttribute('gravestones:coffer'), 24872);
    assert.deepEqual(f.held(), []);
});
