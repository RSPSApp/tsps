// Run after yarn build: node --test tests/thieving-stalls.test.cjs
const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const Thieving = require('../plugins/skills/Thieving.plugin');
const { handleStealFromStall: steal, STALLS, PORT_ROBERTS_STALLS, depleted, emptyStallId } = Thieving._test;
const core = PluginManager.getCoreApi();
const O = core.ObjectIdentifiers;
const I = core.ItemIdentifiers;
const hooks = new Map();
let tick, tasks, npcs, objects, events, realObjects = false;
const npcHooks = new Map(), lifecycle = {};
const bits = { cake: 158, silk: 159, fur: 160, silver: 161, spice: 162, gem: 163, tea: 170, seed: 594, wine: 2050, keldabread: 589, keldagem: 590, keldasilver: 592, vikingfur: 165, silk_prif: 8422, silver_prif: 8424, gem_prif: 8423, spice_prif: 8425 };
const itemNames = new Map([[I.CUP_OF_TEA, 'Cup of tea'], [I.BANANA, 'Banana'], [I.UNCUT_SAPPHIRE, 'Uncut sapphire'], [I.BREAD, 'Bread']]);
core.ItemDefinition.forId = (id) => ({ getName: () => itemNames.get(id) ?? `item ${id}` });
const testApi = {
    core: {
        ...core,
        CacheDefinitions: { getLocNames: () => new Map([
            [O.BAKERY_STALL_2, 'dwarf_market_bakery'], [O.SILK_STALL_5, 'prif_marketstall_silk'],
            [O.VEG_STALL_4, 'port_roberts_market_stall_veg'], [O.SILK_STALL_8, 'port_roberts_market_stall_silk'],
            [O.FUR_STALL_9, 'port_roberts_market_stall_fur'], [O.FISH_STALL_9, 'port_roberts_market_stall_fish'],
            [O.SILVER_STALL_7, 'port_roberts_market_stall_silver'], [O.SPICE_STALL_7, 'port_roberts_market_stall_spice'],
            [O.GEM_STALL_11, 'port_roberts_market_stall_gems'], [O.ORE_STALL_2, 'port_roberts_market_stall_ore'],
            [O.CANNONBALL_STALL, 'port_roberts_market_stall_cball'],
        ]), getVarbitId: (name) => bits[name.replace("marketthief_", "")], getSeqId: (name) => { assert.equal(name, "human_pickuptable"); return 832; } },
        World: { getProcessCycle: () => tick, getNpcsNear: (at, radius, area) => npcs.filter((npc) => npc.getLocation().getDistance(at) <= radius && npc.area === area) },
        RegionManager: { canProjectileAttackBounds: (at) => npcs.find((npc) => npc.getLocation() === at).visible },
        TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } },
        ObjectManager: {
            register: (object) => { objects.push(['add', object]); if (realObjects) core.ObjectManager.register(object, false); },
            deregister: (object) => { objects.push(['remove', object]); if (realObjects) core.ObjectManager.deregister(object, false); },
        },
    },
    onCustomEvent() {}, onNpcInteraction() {}, onItemAction() {}, log() {}, persistAttribute() {},
    onNpcsInteraction: (names, actions) => { for (const name of names) npcHooks.set(name, actions); },
    onPlayerLogin: (handler) => lifecycle.login = handler,
    onPlayerLogout: (handler) => lifecycle.logout = handler,
    onObjectInteraction: (name, actions) => hooks.set(name, actions),
    emitCustomEvent: (name, request) => events.push([name, request]),
};
Thieving.register(testApi);
beforeEach(() => { tick = 100; tasks = []; npcs = []; objects = []; events = []; });
function advance(count = 1) {
    for (let i = 0; i < count; i++) {
        tick++;
        for (const task of [...tasks]) if (task.isRunning()) task.tick();
    }
}
function player({ level = 99, full = false, area = null } = {}) {
    const items = [], xp = [], messages = [], spam = [], varbits = [], sounds = [], animations = [], attributes = new Map();
    return {
        items, xp, messages, spam, varbits, sounds, animations,
        getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
        getPacketSender: () => ({ sendVarbit: (id, value) => varbits.push([id, value]), sendSound: (...args) => sounds.push(args), sendTypedMessage: (type, message) => { messages.push(message); if (type === core.ChatType.SPAM) spam.push(message); } }),
        getSkillManager: () => ({ getCurrentLevel: () => level, addExperiences: (_skill, amount) => xp.push(amount) }),
        getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
        getInventory: () => ({ isFull: () => full, full: () => messages.push('full'), addItem: (item) => items.push(item) }),
        getLocation: () => new core.Location(3200, 3200), getPrivateArea: () => area,
        setPositionToFace() {}, performAnimation: (animation) => animations.push(animation), sendMessage: (message) => messages.push(message),
    };
}
function object(id = O.SPICE_STALL_3, area = null) {
    return new core.GameObject(id, new core.Location(3200, 3201), 10, 2, area);
}
function click(who, stallObject, name = 'Spice stall') {
    const event = { player: who, object: stallObject, definition: { getName: () => name } };
    steal(event);
    return event;
}
function npc(name, { visible = true, attackable = false, hp = 10, area = null, x = 3201, target = null } = {}) {
    const at = new core.Location(x, 3200);
    const lookout = {
        visible, area, chats: [], attacks: [],
        getDefinition: () => ({ getName: () => name, isAttackable: () => attackable, getActions: () => ["Talk-to", null, "Trade"] }),
        getLocation: () => at, getSize: () => 1, getHitpoints: () => hp,
        forceChat: (line) => lookout.chats.push(line),
        getCombat: () => ({ getTarget: () => target, attack: (who) => lookout.attacks.push(who) }),
    };
    npcs.push(lookout);
    return lookout;
}

test('registers the cache names/options and resolves every reward symbol', () => {
    for (const [name, option] of [
        ['Silver stall', 'Steal-from'], ['Spice stall', 'Steal-from'], ['Market stall', 'Steal-From'],
        ['Bakery stall', 'Steal-from'], ['Silk stall', 'Steal-from'], ['Tea stall', 'Steal-from'],
        ['Fur stall', 'Steal-from'], ['Gem stall', 'Steal-from'], ['Gem Stall', 'Steal-from'],
        ["Baker's stall", 'Steal-from'], ["Baker's Stall", 'Steal-from'], ['Seed Stall', 'Steal from'],
        ['Fruit Stall', 'Steal-from'], ['Veg stall', 'Steal-from'], ['Fish stall', 'Steal-from'],
        ['Ore stall', 'Steal-from'], ['Cannonball stall', 'Steal-from'],
    ]) assert.equal(hooks.get(name)?.[option], steal, `${name} ${option}`);
    for (const stall of [...STALLS.values(), ...PORT_ROBERTS_STALLS.values()]) for (const [name] of stall.rewards) assert.ok(I[name] > 0, name);
});

test('silver, spice and wine grant loot/XP and restock at their Wiki intervals', () => {
    for (const [name, id, xp, ticks] of [
        ['Silver stall', O.SILVER_STALL_3, 205, 32],
        ['Spice stall', O.SPICE_STALL_3, 92, 10],
        ['Market stall', O.MARKET_STALL_14, 27, 8],
    ]) {
        const who = player(), stallObject = object(id);
        assert.equal(click(who, stallObject, name).handled, true);
        assert.equal(who.items.length, 0);
        advance();
        assert.equal(who.items.length, 1);
        assert.deepEqual(who.xp, [xp]);
        assert.deepEqual(events.slice(-3).map((event) => event[0]), ['thieving:success', 'thieving:deplete-stall', 'thieving:done']);
        assert.equal(objects.at(-1)[1].getId(), emptyStallId(stallObject));
        assert.equal(objects.at(-1)[1].getFace(), stallObject.getFace());
        click(who, stallObject, name); // Stale queued clicks cannot bypass depletion.
        assert.equal(who.items.length, 1);
        advance(ticks - 1);
        assert.ok(depleted.has(stallObject));
        advance();
        assert.ok(!depleted.has(stallObject));
        assert.equal(objects.at(-1)[1], stallObject);
        click(who, stallObject, name);
        advance();
        assert.equal(who.items.length, 2);
    }
});

test('depletion is shared, permits simultaneous thieves and leaves other stalls alone', () => {
    const a = player(), b = player(), stall = object(), other = object();
    click(a, stall);
    click(b, stall);
    assert.equal(a.items.length, 0);
    advance();
    assert.equal(a.items.length, 1);
    assert.equal(b.items.length, 1);
    assert.equal(objects.length, 2, 'one replacement for both thieves');
    click(b, stall);
    assert.equal(b.items.length, 1);
    click(b, other);
    advance();
    assert.equal(b.items.length, 2);
});

test('the empty wine stall and unrelated market stalls never grant loot', () => {
    for (const id of [O.MARKET_STALL_15, O.MARKET_STALL]) {
        const who = player();
        click(who, object(id), 'Market stall');
        assert.equal(who.items.length, 0);
        assert.equal(tasks.length, 0);
    }
});

test('visible guards catch and attack thieves, preventing loot, XP, pets and depletion', () => {
    const who = player(), stall = object();
    const guard = npc('Guard', { attackable: true });
    click(who, stall);
    assert.deepEqual(guard.attacks, [who]);
    assert.deepEqual(guard.chats, ["Hey! Get your hands off there!"]);
    assert.ok(!who.messages.includes("You've been caught stealing!"));
    assert.equal(who.items.length, 0);
    assert.equal(who.xp.length, 0);
    assert.equal(events.length, 0);
    assert.ok(!depleted.has(stall));
});

test('the owner calls a nearby guard even if that guard cannot see the thief', () => {
    const who = player();
    const guard = npc('Guard', { attackable: true, visible: false });
    const owner = npc('Spice seller');
    click(who, object());
    assert.equal(owner.chats.length, 1);
    assert.deepEqual(guard.attacks, [who]);
    assert.equal(who.items.length, 0);
});

test('blocked, dead, distant, other-instance guards and unrelated owners cannot catch thieves', () => {
    npc('Guard', { attackable: true, visible: false });
    npc('Guard', { attackable: true, hp: 0 });
    npc('Guard', { attackable: true, x: 3210 });
    npc('Guard', { attackable: true, area: {} });
    npc('Silver merchant');
    npc(undefined);
    npc('Guard', { attackable: true, target: player() });
    const who = player();
    click(who, object());
    advance();
    assert.equal(who.items.length, 1);
});

test('level and inventory checks prevent theft and depletion', () => {
    for (const who of [player({ level: 64 }), player({ full: true })]) {
        const stall = object();
        assert.equal(click(who, stall).handled, true);
        assert.equal(who.items.length, 0);
        assert.ok(!depleted.has(stall));
    }
    assert.equal(tasks.length, 0);
});

test('existing stalls use current restock times and market-specific empty models', () => {
    for (const [name, id, ticks, empty] of [
        ["Baker's stall", O.BAKERS_STALL, 4, O.MARKET_STALL],
        ['Bakery stall', O.BAKERY_STALL_2, 16, O.MARKET_STALL_12],
        ["Baker's Stall", O.BAKERS_STALL_2, 4, O.EMPTY_STALL],
        ['Silk stall', O.SILK_STALL_5, 8, O.MARKET_STALL_25],
        ['Gem stall', O.GEM_STALL_6, 100, O.MARKET_STALL_25],
        ['Fur stall', O.FUR_STALL_7, 12, O.MARKET_STALL_28],
        ['Tea stall', O.TEA_STALL, 4, O.MARKET_STALL],
        ['Seed Stall', O.SEED_STALL, 4, O.MARKET_STALL],
    ]) {
        tasks = [];
        const stall = object(id);
        click(player(), stall, name);
        advance();
        assert.equal(tasks.at(-1).getDelay(), ticks, name);
        assert.equal(emptyStallId(stall), empty, name);
    }
});

test('destroying a private area before restock never resurrects its objects', () => {
    let destroyed = false;
    const area = { add: (entity) => entity.setArea(area), getObjects: () => [], isDestroyed: () => destroyed };
    const stall = object(O.SPICE_STALL_3, area);
    click(player({ area }), stall);
    advance();
    objects = [];
    destroyed = true;
    advance(10);
    assert.equal(objects.length, 0);
    assert.ok(!depleted.has(stall));
});

test('a depleted private stall remains resolvable and is removed when its instance is destroyed', () => {
    const area = new core.PrivateArea();
    const stall = object(O.SPICE_STALL_3, area);
    area.add(stall);
    core.ObjectManager.register(stall, false);
    realObjects = true;
    try {
        click(player({ area }), stall);
        advance();
        const empty = area.getObjects()[0];
        assert.ok(empty, 'the replacement belongs to the instance');
        assert.equal(empty.getId(), emptyStallId(stall));
        assert.equal(core.MapObjects.get(empty.getId(), empty.getLocation(), area), empty);
        area.destroy();
        advance(10);
        assert.equal(core.ObjectManager.objectsAt(stall.getLocation()).some((o) => o.getPrivateArea() === area), false);
        assert.equal(core.World.getRemovedObjects().some((o) => o.getPrivateArea() === area), false);
        assert.equal(area.getObjects().length, 0);
    } finally {
        area.destroy();
        realObjects = false;
    }
});

// Wiki: Port Roberts#Marketplace thieving and each stall's page. Nine stalls that reuse the
// mainland names, so four of them (veg, fish, ore, cannonball) had no handler at all.
test('every Port Roberts stall grants its own level, XP and stock without depleting', () => {
    for (const [name, id, level, xp, item] of [
        ['Veg stall', O.VEG_STALL_4, 2, 5, I.POTATO],
        ['Silk stall', O.SILK_STALL_8, 20, 24, I.SILK],
        ['Fur stall', O.FUR_STALL_9, 35, 38.5, I.BEAR_FUR],
        ['Fish stall', O.FISH_STALL_9, 42, 49.5, I.RAW_SALMON],
        ['Silver stall', O.SILVER_STALL_7, 50, 80, I.SILVER_ORE],
        ['Spice stall', O.SPICE_STALL_7, 65, 110, I.SPICE],
        ['Gem stall', O.GEM_STALL_11, 75, 129.5, I.UNCUT_SAPPHIRE],
        ['Ore stall', O.ORE_STALL_2, 82, 191, I.IRON_ORE],
        ['Cannonball stall', O.CANNONBALL_STALL, 87, 223, I.BRONZE_CANNONBALL],
    ]) {
        const who = player({ level }), stall = object(id);
        const random = Math.random;
        Math.random = () => 0; // The first listed reward.
        try {
            assert.equal(click(who, stall, name).handled, true, name);
            assert.equal(who.items.length, 0, name + ': no immediate item');
            advance();
            assert.deepEqual(who.items.map((reward) => reward.getId()), [item], name);
            assert.deepEqual(who.xp, [xp], name);
            assert.deepEqual(who.varbits, [], name + ': no mainland theft bit');
            assert.equal(objects.length, 0, name + ': keeps its stock');
            assert.ok(!depleted.has(stall), name);
            assert.equal(who.getAttribute('thieving:stall-thefts'), undefined, name + ': shops stay open');
        } finally { Math.random = random; }
    }
});

test('Port Roberts stalls need their own Thieving level', () => {
    for (const [name, id, level] of [['Veg stall', O.VEG_STALL_4, 2], ['Ore stall', O.ORE_STALL_2, 82],
        ['Cannonball stall', O.CANNONBALL_STALL, 87]]) {
        const who = player({ level: level - 1 });
        assert.equal(click(who, object(id), name).handled, true, name);
        assert.deepEqual(who.messages, [`You need a Thieving level of at least ${level} to do this.`], name);
        assert.equal(tasks.length, 0, name);
    }
});

test('Port Roberts stalls allow one theft every five ticks, mainland stalls every two', () => {
    for (const [name, id, ticks] of [['Ore stall', O.ORE_STALL_2, 5], ['Spice stall', O.SPICE_STALL_3, 2]]) {
        const who = player();
        let last = -Infinity;
        who.getClickDelay = () => ({ elapsedTime: (ms) => tick * 600 - last >= ms, reset: () => { last = tick * 600; } });
        const stall = object(id);
        click(who, stall, name);
        advance();
        assert.equal(who.items.length, 1, name);
        for (let waited = 1; waited < ticks; waited++) {
            click(who, stall, name);
            advance();
            assert.equal(who.items.length, 1, `${name}: blocked ${waited} tick(s) after the theft`);
        }
        // A fresh stall: a mainland one is already depleted, which is not what is being measured here.
        click(who, object(id), name);
        advance();
        assert.equal(who.items.length, 2, name);
    }
});

test('standing under the baker remains a safe spot', () => {
    const baker = npc('Baker', { x: 3200 });
    const who = player();
    click(who, object(O.BAKERS_STALL), "Baker's stall");
    advance();
    assert.equal(who.items.length, 1);
    assert.equal(baker.chats.length, 0);
});

test('a character on the thief\'s tile blocks a nearby guard\'s clear line of sight', () => {
    const who = player();
    const guard = npc('Guard', { attackable: true });
    npc('Baker', { x: 3200 });
    click(who, object());
    advance();
    assert.deepEqual(guard.attacks, []);
    assert.deepEqual(guard.chats, []);
    assert.equal(who.items.length, 1);
    assert.deepEqual(who.xp, [92]);
});

test('a dead or distant character does not hide the thief from a guard', () => {
    for (const options of [{ x: 3200, hp: 0 }, { x: 3204 }]) {
        npcs = [];
        npc('Baker', options);
        const who = player(), guard = npc('Guard', { attackable: true });
        click(who, object());
        assert.deepEqual(guard.attacks, [who]);
        assert.deepEqual(guard.chats, ["Hey! Get your hands off there!"]);
        assert.equal(who.items.length, 0);
    }
});

// rsprox recordings 3220 (tea) and 1554 (bread, silver, gem):
// the reward and empty stall arrive one tick after the attempt animation.
test('recorded stall theft rewards follow the attempt by one tick', () => {
    for (const [name, id, attempt, success, roll = 0] of [
        ['Tea stall', O.TEA_STALL, 'You attempt to steal a cup of tea...', 'You steal a cup of tea.'],
        ["Baker's stall", O.BAKERS_STALL, null, 'You steal some bread.', 0.65],
        ['Silver stall', O.SILVER_STALL_3, 'You attempt to steal some silver from the silver stall.', 'You steal a piece of silver.'],
        ['Gem stall', O.GEM_STALL_3, 'You attempt to steal a gem from the gem stall.', 'You steal an uncut sapphire.'],
    ]) {
        const who = player(), stall = object(id);
        const random = Math.random;
        Math.random = () => roll;
        try {
            click(who, stall, name);
            assert.deepEqual(who.items, [], name + ': no immediate item');
            assert.deepEqual(who.xp, [], name + ': no immediate XP');
            if (attempt) assert.ok(who.messages.includes(attempt), name);
            assert.equal(who.animations[0].getId(), 832);
            assert.deepEqual(who.sounds, [[2581, 10, 0]]);
            advance();
            assert.equal(who.items.length, 1, name);
            assert.ok(who.messages.includes(success), name);
            assert.equal(objects.at(-1)[1].getId(), emptyStallId(stall), name);
        } finally { Math.random = random; }
    }
});

test('captured theft varbits change only with the reward, then clear when the wait expires', () => {
    for (const [name, id, key, ticks] of [
        ['Tea stall', O.TEA_STALL, 'tea', 1000], ["Baker's stall", O.BAKERS_STALL, 'cake', 1500],
        ['Silver stall', O.SILVER_STALL_3, 'silver', 1000], ['Gem stall', O.GEM_STALL_3, 'gem', 1000],
        ['Spice stall', O.SPICE_STALL_3, 'spice', 600],
    ]) {
        const who = player();
        click(who, object(id), name);
        assert.deepEqual(who.varbits, []);
        advance();
        assert.deepEqual(who.varbits, [[bits[key], 1]]);
        advance(ticks - 1);
        assert.equal(who.varbits.at(-1)[1], 1);
        advance();
        assert.deepEqual(who.varbits.at(-1), [bits[key], 0]);
    }
});
function merchant(who, name, option = 'Trade') {
    const owner = npc(name);
    const event = { player: who, npc: owner, definition: owner.getDefinition() };
    const handler = npcHooks.get(name)?.[option];
    assert.ok(handler, `registered ${name} ${option}`);
    const result = handler(event);
    return { owner, event, result };
}
test('recent thieves cannot talk or trade with the recorded stall owners', () => {
    for (const [name, id, owner] of [
        ['Tea stall', O.TEA_STALL, 'Tea Seller'], ["Baker's stall", O.BAKERS_STALL, 'Baker'],
        ['Silk stall', O.SILK_STALL_3, 'Silk merchant'], ['Spice stall', O.SPICE_STALL_3, 'Spice seller'],
        ['Seed Stall', O.SEED_STALL, 'Olivia'], ['Market stall', O.MARKET_STALL_14, 'Fortunato'],
    ]) {
        npcs = [];
        const who = player();
        assert.equal(merchant(who, owner).result, false, 'ordinary trade falls through');
        npcs = [];
        click(who, object(id), name);
        advance();
        for (const option of ['Trade', 'Talk-to']) {
            const refusal = merchant(who, owner, option);
            assert.equal(refusal.event.handled, true, owner);
            assert.deepEqual(refusal.owner.chats, [owner === 'Fortunato' ? "You're the thief who stole from me!" : "You're the one who stole something from me!"]);
            advance();
            assert.equal(refusal.owner.chats.length, 1);
            advance();
            assert.equal(refusal.owner.chats.at(-1), 'Guards guards!');
        }
        assert.equal(merchant(who, 'Gem merchant').result, false, 'unrelated stall remains available');
    }
});
test('repeated theft and relog restart the consecutive online wait', () => {
    const who = player(), stall = object(O.TEA_STALL);
    click(who, stall, 'Tea stall');
    advance(901);
    click(who, stall, 'Tea stall');
    advance(101);
    assert.equal(merchant(who, 'Tea Seller').event.handled, true);
    lifecycle.logout({ player: who });
    advance(2000);
    lifecycle.login({ player: who });
    advance(999);
    assert.equal(merchant(who, 'Tea Seller').event.handled, true);
    advance();
    assert.equal(merchant(who, 'Tea Seller').result, false);
});
test('a merchant summons an idle nearby guard', () => {
    const who = player();
    click(who, object(O.TEA_STALL), 'Tea stall');
    advance();
    const guard = npc('Guard', { attackable: true });
    assert.equal(merchant(who, 'Tea Seller').event.handled, true);
    assert.deepEqual(guard.attacks, [who]);
    assert.equal(who.items.length, 1);
});
test('caught attempts warn without success animation, sound, loot or theft flag', () => {
    const who = player(), owner = npc('Spice seller');
    click(who, object());
    advance();
    assert.deepEqual(owner.chats, ['Hey! Get your hands off there!']);
    for (const values of [who.animations, who.sounds, who.varbits, who.items]) assert.deepEqual(values, []);
    assert.equal(merchant(who, 'Spice seller').result, false);
});
test('a bag filled during the attempt cannot swallow a reward', () => {
    const who = player(), inventory = who.getInventory(), stall = object(O.TEA_STALL);
    let full = false;
    who.getInventory = () => ({ ...inventory, isFull: () => full });
    click(who, stall, 'Tea stall');
    full = true;
    advance();
    for (const values of [who.items, who.xp, who.varbits]) assert.deepEqual(values, []);
    assert.ok(!depleted.has(stall));
});

test('regional stalls send their own cache theft bits and preserve both until expiry', () => {
    const who = player();
    click(who, object(O.BAKERY_STALL_2), 'Bakery stall');
    advance();
    assert.deepEqual(who.varbits, [[bits.keldabread, 1]]);
    click(who, object(O.BAKERS_STALL), "Baker's stall");
    advance();
    assert.ok(who.varbits.some(([id, value]) => id === bits.cake && value === 1));
    lifecycle.logout({ player: who });
    lifecycle.login({ player: who });
    advance(1500);
    assert.ok(who.varbits.some(([id, value]) => id === bits.keldabread && value === 0));
    assert.ok(who.varbits.some(([id, value]) => id === bits.cake && value === 0));
    click(who, object(O.SILK_STALL_5), 'Silk stall');
    advance();
    assert.deepEqual(who.varbits.at(-1), [bits.silk_prif, 1]);
});

test('real named dispatch blocks recent thieves before generic dialogue and shop handlers', () => {
    const who = player(), owner = npc('Tea Seller');
    let opened = 0;
    PluginManager.createApi('StallGenericFallback').onAnyNpcInteraction({
        'Talk-to': () => { opened++; }, Trade: () => { opened++; },
    });
    Thieving.register({ ...PluginManager.createApi('StallDispatch'), core: testApi.core });
    const dispatch = (clickType) => PluginManager.emitNpcInteraction({
        player: who, npc: owner, definition: owner.getDefinition(), clickType, handled: false,
    });
    assert.equal(dispatch(3), true);
    assert.equal(opened, 1, 'ordinary trader reaches the existing shop fallback');
    npcs = [];
    click(who, object(O.TEA_STALL), 'Tea stall');
    advance();
    dispatch(1);
    dispatch(3);
    assert.equal(opened, 1, 'recent thief reaches neither dialogue nor shop');
    advance(1000);
    dispatch(3);
    assert.equal(opened, 2, 'expiry releases the existing interaction');
});

// Recording 1554: caught gem attempts at 869/871/875 and caught silver
// attempts at 1128/1129 precede the successful attempt at 1130.
test('owners can catch same-tile thieves outside bakery safe spots', () => {
    const who = player(), owner = npc('Gem merchant', { x: 3200 });
    click(who, object(O.GEM_STALL_3), 'Gem stall');
    advance();
    assert.deepEqual(owner.chats, ['Hey! Get your hands off there!']);
    assert.deepEqual(who.items, []);
    assert.deepEqual(who.xp, []);
    assert.deepEqual(who.varbits, []);
    assert.deepEqual(who.messages, ['You attempt to steal a gem from the gem stall.']);
});
test('caught thefts can be attempted again on the next tick', () => {
    const who = player(), stall = object(O.SILVER_STALL_3);
    let lastSuccess = -Infinity;
    who.getClickDelay = () => ({ elapsedTime: () => tick - lastSuccess >= 2, reset: () => lastSuccess = tick });
    npc('Silver merchant');
    click(who, stall, 'Silver stall');
    advance();
    click(who, stall, 'Silver stall');
    assert.equal(who.messages.filter((message) => message.startsWith('You attempt')).length, 2);
    npcs = [];
    advance();
    click(who, stall, 'Silver stall');
    advance();
    assert.equal(who.items.length, 1);
    assert.deepEqual(who.xp, [205]);
});

// rsprox recordings 1554, 3220 (main game), 1098, 1104, 1105, 3275 (Leagues, Grid Master):
// every line is spam, and an item without its own line is "You steal a cake.".
test('stall lines are spam; a stolen item is named with its article; silk and the fruit stall as captured', () => {
    const { stealLine } = Thieving._test;
    const named = (name) => stealLine({ getDefinition: () => ({ getName: () => name }) });
    assert.equal(named('Cake'), 'You steal a cake.');
    assert.equal(named('Uncut emerald'), 'You steal an uncut emerald.');
    assert.equal(named('Silver bar'), 'You steal a silver bar.');
    assert.equal(named('Jangerberries'), 'You steal some jangerberries.');
    for (const [name, id, attempt, success, roll = 0] of [
        ['Silk stall', O.SILK_STALL, 'You attempt to steal some silk from the silk stall.', 'You steal a piece of silk.'],
        ['Fruit Stall', O.FRUIT_STALL_3, null, 'You steal a banana.', 0.45],
        ['Gem stall', O.GEM_STALL_3, 'You attempt to steal a gem from the gem stall.', 'You steal an uncut sapphire.'],
    ]) {
        const who = player(), stall = object(id);
        const random = Math.random;
        Math.random = () => roll;
        try {
            click(who, stall, name);
            assert.deepEqual(who.spam, attempt ? [attempt] : [], name);
            advance();
            assert.deepEqual(who.spam, attempt ? [attempt, success] : [success], name);
            assert.equal(who.messages.length, who.spam.length, name + ': nothing in the game channel');
        } finally { Math.random = random; }
    }
    const fruit = STALLS.get('Fruit Stall');
    assert.equal(fruit.level, 25); assert.equal(fruit.xp, 28.5);
    assert.equal(emptyStallId(object(O.FRUIT_STALL_3)), O.FRUIT_STALL);
});
