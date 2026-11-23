const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
let core, Data, Patches, Services, hooks;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Services = require('../plugins/skills/farming/Services.Farming');
    Data.initializeFarmingData();
    hooks = {};
    Patches.attach(new Proxy({}, { get: (_, name) => (...args) => {
        if (name === 'onItemOnObject') hooks.use = args[0];
        if (name === 'onObjectRoute') hooks.route = args[0];
        if (name === 'onCustomEvent' && args[0] === 'player:world-input') hooks.cancel = args[1];
        if (name === 'onCustomEvent' && args[0] === 'level-up:popup-opened') hooks.levelUp = args[1];
        if (name === 'onPlayerLogout') hooks.logout ??= args[0];
        if (name === 'onInterfaceActionClick' && args[0].name === 'farmingOptionClick') hooks.choose = args[0];
    } }));
});
function prepare(t, type = 'COMPOST', realChoice = false) {
    const transport = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
        close() {}, onData() {}, onError() {}, onClose() {} };
    const player = new Player(realChoice ? new PlayerSession(transport) : null), animations = [], sounds = [], varbits = [];
    const realSender = player.getPacketSender();
    const sender = new Proxy({
        sendSound: (...args) => { sounds.push(args); return sender; },
        sendVarbit: (...args) => { varbits.push(args); return sender; },
    }, { get: (target, key) => target[key] ?? (() => sender) });
    player.performAnimation = animation => animations.push(animation);
    player.busy = () => false;
    player.getClickDelay = () => ({ elapsedTime: () => true, reset() {} });
    t.mock.method(core.MapObjects, 'get', () => null);
    t.after(() => hooks.cancel({ player }));
    player.getPacketSender = () => realChoice ? realSender : sender; player.sendMessage = () => {};
    const patch = Data.CACHE.patches.find(p => p.type === type);
    if (realChoice) {
        player.setRegistered(true);
        player.setLocation(new core.Location(patch.x - 1, patch.y, patch.z));
        t.after(() => player.setRegistered(false));
    }
    const state = Patches.stateFor(player, patch), inventory = player.getInventory();
    let cycle = 1000;
    t.mock.method(core.World, 'getProcessCycle', () => cycle);
    const tick = (count = 1) => { for (let i = 0; i < count; i++) { cycle++; Patches.tick(); } };
    const stock = (name, count) => {
        const id = Data.itemId(name);
        for (let i = 0; i < count; i++) inventory.add(new core.Item(id), false);
        return id;
    };
    const use = id => {
        const event = { player, itemId: id, itemSlot: inventory.getSlotForItemId(id), object: { getId: () => patch.id },
            location: { x: patch.x, y: patch.y, z: patch.z } };
        hooks.use(event);
        assert.equal(event.handled, true);
    };
    // A click from where the player stands: its route event and the use land on one cycle.
    const useHere = id => { hooks.route({ player, objectId: patch.id }); use(id); };
    const takeHere = () => { hooks.route({ player, objectId: patch.id }); Services.binAction(player, patch, '', Data.itemId('Bucket')); };
    const add = (name, noted = false) => {
        let id = Data.itemId(name); assert.ok(id > 0, name);
        if (noted) { id = core.CacheDefinitions.getItem(id).note; assert.ok(id > 0, `${name} note`); }
        inventory.add(new core.Item(id), false);
        Services.binAction(player, patch, '', id, inventory.getSlotForItemId(id));
        tick(3);
        return id;
    };
    const choose = option => {
        const event = { player, buttonId: core.OptionDialogue.OPTIONS_WIDGET_ID, action: option, handled: false };
        hooks.choose(event);
        assert.equal(event.handled, true);
    };
    return { player, patch, state, inventory, add, tick, stock, use, useHere, takeHere, choose, animations, sounds, varbits, bin: () => state.bin };
}
test('cotton bolls produce regular compost in both bin sizes', t => {
    for (const [type, capacity] of [['COMPOST', 15], ['BIG_COMPOST', 30]]) {
        const f = prepare(t, type);
        for (let i = 0; i < capacity; i++) f.add('Cotton boll');
        assert.equal(f.bin().count, capacity, type);
        assert.equal(f.bin().tier, 1, type);
        assert.equal(f.inventory.getAmount(Data.itemId('Cotton boll')), 0, type);
    }
});
test('half coconuts produce supercompost in both bin sizes', t => {
    for (const [type, capacity] of [['COMPOST', 15], ['BIG_COMPOST', 30]]) {
        const f = prepare(t, type);
        for (let i = 0; i < capacity; i++) f.add('Half coconut');
        assert.equal(f.bin().count, capacity, type);
        assert.equal(f.bin().super, capacity, type);
        assert.equal(f.bin().tier, 2, type);
    }
});
test('mixing a cotton boll into otherwise supercompostable contents produces regular compost', t => {
    const f = prepare(t, 'COMPOST', true);
    for (let i = 0; i < 14; i++) f.add('Half coconut');
    f.add('Cotton boll');
    assert.equal(f.bin().count, 14);
    assert.equal(f.inventory.getAmount(Data.itemId('Cotton boll')), 1);
    assert.ok(f.player.getDialogueManager().getCurrent() instanceof core.OptionDialogue);
    f.choose(1);
    f.tick(3);
    assert.equal(f.bin().count, 15);
    assert.equal(f.bin().super, 14);
    assert.equal(f.bin().tier, 1);
});
test('noted produce remains untouched and never increments either bin', t => {
    for (const type of ['COMPOST', 'BIG_COMPOST']) {
        const f = prepare(t, type);
        for (const name of ['Potato', 'Watermelon', 'Cotton boll', 'Half coconut', 'Guam leaf']) {
            const id = f.add(name, true);
            assert.equal(f.inventory.getAmount(id), 1, `${type}: ${name}`);
            assert.equal(f.bin().count, 0, `${type}: ${name}`);
        }
    }
});
test('a noted compost potion cannot upgrade a finished bin or turn into an unnoted dose', t => {
    const f = prepare(t);
    Services.binAction(f.player, f.patch, '');
    Object.assign(f.bin(), { count: 15, open: true, closedAt: Date.now() - 100 * 60_000 });
    const id = f.add('Compost potion(4)', true);
    assert.equal(f.bin().tier, 1);
    assert.equal(f.inventory.getAmount(id), 1);
    assert.equal(f.inventory.getAmount(Data.itemId('Compost potion(3)')), 0);
});
test('existing ingredient tiers, excluded items and full-bin capacity remain effective', t => {
    for (const [name, tier] of [['Potato', 1], ['Watermelon', 2], ['Tomato', 4]]) {
        const f = prepare(t);
        f.add(name); assert.equal(f.bin().tier, tier, name);
    }
    const f = prepare(t);
    for (const name of ['Cactus spine', 'Magic logs', 'Nightshade']) {
        const id = f.add(name); assert.equal(f.inventory.getAmount(id), 1, name);
        assert.equal(f.bin().count, 0, name);
    }
    for (let i = 0; i < 16; i++) f.add('Potato');
    assert.equal(f.bin().count, 15);
    assert.equal(f.inventory.getAmount(Data.itemId('Potato')), 1);
});

test('one item use fills either bin automatically at the captured two-tick cadence', t => {
    for (const [type, initial, capacity] of [['COMPOST', 0, 15], ['BIG_COMPOST', 16, 30]]) {
        const f = prepare(t, type), id = f.stock('Orange', 20);
        Services.binAction(f.player, f.patch, '');
        f.bin().count = initial;
        f.use(id);
        f.tick();
        assert.equal(f.animations.length, 0);
        assert.equal(f.bin().count, initial);
        f.tick();
        assert.equal(f.animations.length, 1);
        assert.deepEqual(f.sounds[0], [2441, 1, 0]);
        assert.equal(f.bin().count, initial);
        f.tick();
        assert.equal(f.bin().count, initial + 1);
        f.tick();
        assert.equal(f.bin().count, initial + 1);
        f.tick();
        assert.equal(f.bin().count, initial + 2);
        f.tick(60);
        assert.equal(f.bin().count, capacity);
        assert.equal(f.inventory.getAmount(id), 20 - (capacity - initial));
        assert.equal(f.bin().tier, 1);
        assert.equal(f.varbits.at(-1)[1], Services.binValue(f.patch, f.state));
    }
});
test('filling stops when the selected ingredient runs out and leaves other produce alone', t => {
    const f = prepare(t), id = f.stock('Pineapple', 3), other = f.stock('Orange', 1);
    f.use(id); f.tick(20);
    assert.equal(f.bin().count, 3);
    assert.equal(f.bin().super, 3);
    assert.equal(f.bin().tier, 2);
    assert.equal(f.inventory.getAmount(id), 0);
    assert.equal(f.inventory.getAmount(other), 1);
});
test('movement, world input, logout, busy state and death cancel pending deposits', t => {
    for (const interrupt of [
        f => f.player.moveTo(new core.Location(3000, 3000, 0)),
        f => hooks.cancel({ player: f.player }),
        f => hooks.logout({ player: f.player }),
        f => { f.player.busy = () => true; },
        f => { f.player.getHitpoints = () => 0; },
    ]) {
        const f = prepare(t), id = f.stock('Orange', 3);
        f.use(id); f.tick(3);
        assert.equal(f.bin().count, 1);
        interrupt(f); f.tick(20);
        assert.equal(f.bin().count, 1);
        assert.equal(f.inventory.getAmount(id), 2);
    }
});
test('removed ingredients and closed or replaced bins cannot receive a queued deposit', t => {
    for (const interrupt of [
        f => f.inventory.deleteNumber(Data.itemId('Orange'), 3),
        f => { f.bin().closedAt = Date.now(); },
        f => { f.bin().open = true; },
        f => { f.state.bin = { ...f.bin() }; },
    ]) {
        const f = prepare(t), id = f.stock('Orange', 3);
        f.use(id); f.tick(2);
        interrupt(f); f.tick(20);
        assert.equal(f.bin().count, 0);
    }
});

test('bin phases count game ticks even with early, delayed or catch-up ticks', t => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const f = prepare(t), id = f.stock('Orange', 4);
    f.use(id);
    for (const [index, elapsed] of [599, 1, 1400, 0, 599, 1, 2000, 0, 1].entries()) {
        now += elapsed;
        f.tick();
        const tick = index + 1;
        assert.equal(f.bin().count, Math.min(4, Math.floor((tick - 1) / 2)), `deposit tick ${tick}`);
        assert.equal(f.animations.length, Math.min(4, Math.floor(tick / 2)), `animation tick ${tick}`);
    }
    assert.equal(f.inventory.getAmount(id), 0);
});

// #6539: rsprox captures local 1000451 t409, 1000448 t8592, 1000444 t22038, 1000324 t6782.
test('using an ingredient while standing at the bin animates at once and deposits a tick later', t => {
    const f = prepare(t), id = f.stock('Orange', 4);
    f.useHere(id);
    assert.equal(f.animations.length, 1);
    assert.deepEqual(f.sounds[0], [2441, 1, 0]);
    assert.equal(f.bin().count, 0);
    f.tick();
    assert.equal(f.bin().count, 1);
    f.tick();
    assert.equal(f.animations.length, 2);
    assert.equal(f.bin().count, 1);
    f.tick();
    assert.equal(f.bin().count, 2);
    f.tick(10);
    assert.equal(f.bin().count, 4);
    assert.equal(f.inventory.getAmount(id), 0);
});
test('a click from another cycle (the player walked there) keeps the two-tick start', t => {
    const f = prepare(t), id = f.stock('Orange', 2);
    hooks.route({ player: f.player, objectId: f.patch.id });
    f.tick();
    f.use(id);
    f.tick();
    assert.equal(f.animations.length, 0);
    f.tick();
    assert.equal(f.animations.length, 1);
    f.tick();
    assert.equal(f.bin().count, 1);
});
// rsprox captures local 1000103 t712-716 and 1000324 t2035-2042, t6786-6788; Wiki, Weeds.
test('weeds all go in at once, two ticks after the animation, up to the space left', t => {
    for (const [type, initial, expected] of [['COMPOST', 0, 15], ['COMPOST', 14, 15], ['BIG_COMPOST', 0, 20]]) {
        const f = prepare(t, type), id = f.stock('Weeds', 20);
        Services.binAction(f.player, f.patch, '');
        f.bin().count = initial;
        f.useHere(id);
        assert.equal(f.animations.length, 1);
        assert.deepEqual(f.sounds[0], [2441, 1, 0]);
        f.tick();
        assert.equal(f.bin().count, initial);
        f.tick();
        assert.equal(f.bin().count, expected, `${type} from ${initial}`);
        assert.equal(f.inventory.getAmount(id), 20 - (expected - initial));
        assert.equal(f.varbits.at(-1)[1], Services.binValue(f.patch, f.state));
        f.tick(10);
        assert.equal(f.animations.length, 1);
        assert.equal(f.bin().count, expected);
    }
});
test('walking to the bin with weeds animates two ticks after arriving and deposits two later', t => {
    const f = prepare(t), id = f.stock('Weeds', 15);
    f.use(id);
    f.tick(2);
    assert.equal(f.animations.length, 1);
    f.tick();
    assert.equal(f.bin().count, 0);
    f.tick();
    assert.equal(f.bin().count, 15);
    assert.equal(f.inventory.getAmount(id), 0);
});
function openBin(f, count) {
    f.state.bin = { count, super: 0, tomatoes: 0, tier: 1, closedAt: 1, open: true };
    return f.state.bin;
}
// rsprox captures local 1000451 t317, t385 and 1000105 t441: scoop a tick after the click.
test('taking compost while standing at the bin scoops a tick later, then every four ticks', t => {
    const f = prepare(t), bucket = f.stock('Bucket', 3);
    openBin(f, 15);
    f.takeHere();
    assert.equal(f.animations.length, 0);
    f.tick();
    assert.equal(f.animations.length, 1);
    assert.deepEqual(f.sounds[0], [2436, 1, 0]);
    f.tick();
    assert.equal(f.inventory.getAmount(Data.itemId('Compost')), 1);
    assert.equal(f.bin().count, 14);
    f.tick(2);
    assert.equal(f.animations.length, 1);
    f.tick();
    assert.equal(f.animations.length, 2);
    f.tick();
    assert.equal(f.inventory.getAmount(Data.itemId('Compost')), 2);
    assert.equal(f.inventory.getAmount(bucket), 1);
});
test('clicking the bin again every tick never slows a running fill or take', t => {
    const f = prepare(t), id = f.stock('Orange', 6);
    f.useHere(id);
    for (let i = 0; i < 6; i++) { f.tick(); hooks.cancel({ player: f.player }); f.useHere(id); }
    assert.equal(f.bin().count, 3);
    assert.equal(f.animations.length, 4);
    const g = prepare(t);
    g.stock('Bucket', 3);
    openBin(g, 15);
    g.takeHere();
    for (let i = 0; i < 6; i++) { g.tick(); hooks.cancel({ player: g.player }); g.takeHere(); }
    assert.equal(g.inventory.getAmount(Data.itemId('Compost')), 2);
    assert.equal(g.bin().count, 13);
});
test('a click on the same bin after its loop ended or with another item starts afresh', t => {
    const f = prepare(t), orange = f.stock('Orange', 1), apple = f.stock('Cooking apple', 3);
    f.useHere(orange);
    f.tick();
    assert.equal(f.bin().count, 1);
    f.tick(3);
    f.useHere(apple);
    assert.equal(f.animations.length, 2);
    f.tick();
    assert.equal(f.bin().count, 2);
    // Another item while the apples' loop still has a step due: it starts at that step.
    hooks.cancel({ player: f.player });
    f.useHere(f.stock('Orange', 1));
    assert.equal(f.animations.length, 2);
    f.tick();
    assert.equal(f.animations.length, 3);
    f.tick();
    assert.equal(f.bin().count, 3);
    assert.equal(f.inventory.getAmount(apple), 2);
});
test('switching items on a running fill every tick never beats the two-tick pace', t => {
    const f = prepare(t), orange = f.stock('Orange', 6), apple = f.stock('Cooking apple', 6);
    f.useHere(orange);
    for (let i = 0; i < 6; i++) { f.tick(); hooks.cancel({ player: f.player }); f.useHere(i % 2 ? orange : apple); }
    assert.ok(f.bin().count <= 3, `${f.bin().count} items in 6 ticks`);
    assert.equal(f.inventory.getAmount(orange) + f.inventory.getAmount(apple), 12 - f.bin().count);
});
test('a click after a level-up pop-up paused the take starts a fresh loop', t => {
    const f = prepare(t);
    f.stock('Bucket', 3);
    openBin(f, 15);
    f.takeHere();
    f.tick(2);
    assert.equal(f.inventory.getAmount(Data.itemId('Compost')), 1);
    hooks.levelUp({ player: f.player, pause: () => {} });
    hooks.cancel({ player: f.player });
    f.takeHere();
    f.tick(2);
    assert.equal(f.animations.length, 2);
    assert.equal(f.inventory.getAmount(Data.itemId('Compost')), 2);
});
