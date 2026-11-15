// Run after `yarn build`: node --test tests/telekinetic-grab-timing.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { MagicOnItemPacketListener } = require('../dist/net/packet/impl/MagicOnItemPacketListener');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { CombatRange } = require('../dist/game/content/combat/CombatRange');
const { Projectile } = require('../dist/game/model/Projectile');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { Sounds } = require('../dist/game/Sounds');
const { MagicSpellbook } = require('../dist/game/model/MagicSpellbook');
const { World } = require('../dist/game/World');
const { PluginManager } = require('../dist/plugins/PluginManager');

// The item used to land in the pack on the cast tick, before the projectile reached it.
test('Telekinetic Grab takes the item when its projectile lands, not on the cast', (t) => {
    const listener = new MagicOnItemPacketListener();
    let onGround = true;
    let targetLocation = new Location(3205, 3200, 0);
    const item = { getId: () => 995, clone: () => ({ id: 995 }) };
    const groundItem = { getItem: () => item, getPickupItem: () => item, getPosition: () => targetLocation };
    const tasks = [];
    t.mock.method(TaskManager, 'submit', (task) => tasks.push(task));
    t.mock.method(Projectile.prototype, 'sendProjectile', () => {});
    t.mock.method(Sounds, 'sendSound', () => {});
    t.mock.method(CombatRange, 'withinApproachDistance', () => true);
    for (const name of ['hasRunes', 'canReceiveGroundItem']) t.mock.method(listener, name, () => true);
    t.mock.method(listener, 'runeCosts', () => []);
    t.mock.method(listener, 'consumeRunes', () => {});
    t.mock.method(listener, 'findVisibleGroundItem', () => (onGround ? groundItem : null));

    const added = [];
    t.mock.method(ItemOnGroundManager, 'transferToInventory', (_player, item) => {
        onGround = false;
        added.push(item.getItem().clone());
        return 1;
    });
    const messages = [];
    const experiences = [];
    let currentLocation = new Location(3200, 3200, 0);
    let spellbook = MagicSpellbook.NORMAL;
    const sender = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : () => sender) });
    const player = {
        getHitpoints: () => 10, isRegistered: () => true, getLocation: () => currentLocation, getSpellbook: () => spellbook,
        getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
        getSkillManager: () => ({ getCurrentLevel: () => 99, stopSkillable() {}, addExperiences: (_skill, xp) => experiences.push(xp) }),
        getInventory: () => ({ addItem: (item) => added.push(item), full() {} }),
        getPacketSender: () => sender, getPrivateArea: () => null,
        setPositionToFace() {}, performAnimation() {}, performGraphic() {},
        sendMessage: (message) => messages.push(message),
    };
    const run = () => tasks.shift().execute();
    const casts = [];
    const emit = PluginManager.emitCustomEvent;
    t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
        if (name === 'magic:telekinetic-grab-cast') casts.push(event);
        return emit.call(PluginManager, name, event);
    });

    listener.castGroundItem(player, 995, 3205, 3200, 1168);
    assert.equal(added.length, 0, 'nothing is taken on the cast tick');
    assert.equal(casts.length, 1, 'the cast is announced on the cast tick');
    assert.equal(casts[0].groundItem, groundItem);
    assert.equal(casts[0].itemId, 995);
    assert.ok(casts[0].position.equals(targetLocation));
    assert.equal(onGround, true);
    assert.equal(tasks[0].delay, 3, 'lands 80 cycles later, on the third tick');
    currentLocation = new Location(3216, 3200, 0);
    run();
    assert.equal(added.length, 1, 'taken once the projectile lands');
    assert.equal(onGround, false);
    assert.equal(experiences.length, 1, 'same-floor casts do not fizzle after moving beyond the approach range');

    // Someone else picks it up mid-flight.
    onGround = true;
    currentLocation = new Location(3200, 3200, 0);
    listener.castGroundItem(player, 995, 3205, 3200, 1168);
    onGround = false;
    run();
    assert.equal(added.length, 1);
    assert.deepEqual(messages.slice(-1), ["Too late - it's gone!"]);
    assert.equal(experiences.length, 2, 'the cast still grants XP when the item is gone on arrival');

    const { CrossFloor } = require('../dist/game/CrossFloor');
    t.mock.method(CrossFloor, 'visibleOnPlane', (viewer, target) => target <= viewer);
    currentLocation = new Location(3200, 3200, 1);
    targetLocation = new Location(3205, 3200, 0);
    onGround = true;
    listener.castGroundItem(player, 995, 3205, 3200, 1168);
    run();
    assert.equal(added.length, 2, 'opt-in telegrab can take a visible item from a lower floor');
    assert.equal(experiences.length, 3);

    // A standard-book spell: a grab packet from another book casts nothing (as alchemy).
    spellbook = MagicSpellbook.ANCIENT;
    onGround = true;
    const queued = tasks.length;
    listener.castGroundItem(player, 995, 3205, 3200, 1168);
    assert.equal(tasks.length, queued, 'no projectile on the Ancient book');
    assert.equal(added.length, 2);
    assert.equal(experiences.length, 3);
});

test('Telekinetic Grab takes the stack from its captured floor when another floor matches', (t) => {
    const listener = new MagicOnItemPacketListener();
    const { CrossFloor } = require('../dist/game/CrossFloor');
    t.mock.method(CrossFloor, 'visibleOnPlane', (viewer, target) => target <= viewer);
    t.mock.method(PluginManager, 'getPluginConfig', () => undefined);
    t.mock.method(PluginManager, 'emitCustomEvent', () => {});

    const makePile = (position) => ({
        getItem: () => ({ getId: () => 995, getAmount: () => 10 }),
        getPickupItem() { return this.getItem(); },
        getPosition: () => position,
        getPrivateArea: () => null,
        getState: () => undefined,
        isPendingRemoval: () => false,
    });
    const lowerPile = makePile(new Location(3205, 3200, 0));
    const middlePile = makePile(new Location(3205, 3200, 1));
    let groundItems = [lowerPile];
    t.mock.method(World, 'getItems', () => groundItems);
    t.mock.method(ItemOnGroundManager, 'canSee', () => true);
    t.mock.method(listener, 'canGrabGroundItem', () => true);
    for (const name of ['hasRunes', 'canReceiveGroundItem']) t.mock.method(listener, name, () => true);
    t.mock.method(listener, 'runeCosts', () => []);
    t.mock.method(listener, 'consumeRunes', () => {});
    const taken = [];
    t.mock.method(ItemOnGroundManager, 'transferToInventory', (_player, item) => { taken.push(item); return 1; });
    const tasks = [];
    t.mock.method(TaskManager, 'submit', task => tasks.push(task));
    t.mock.method(Projectile.prototype, 'sendProjectile', () => {});
    t.mock.method(Sounds, 'sendSound', () => {});
    const sender = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : () => sender) });

    const player = {
        isRegistered: () => true,
        getHitpoints: () => 10,
        getSpellbook: () => MagicSpellbook.NORMAL,
        getLocation: () => new Location(3200, 3200, 2),
        getPrivateArea: () => null,
        getUsername: () => 'tester',
        getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
        getSkillManager: () => ({ getCurrentLevel: () => 99, stopSkillable() {}, addExperiences() {} }),
        getPacketSender: () => sender,
        setPositionToFace() {}, performAnimation() {}, performGraphic() {},
    };
    listener.castGroundItem(player, 995, 3205, 3200, 1168);
    assert.equal(tasks.length, 1, 'the lower-floor target starts a delayed grab');

    // A matching pile appears on an intermediate floor before the projectile lands.
    groundItems = [lowerPile, middlePile];
    tasks[0].execute();

    assert.deepEqual(taken, [lowerPile], 'a matching stack on the intermediate floor is not substituted');
});

// new Graphic(144, 80, GraphicHeight.LOW) read LOW (0) as a Priority, so the landing splash went out with
// delay 0 and height 80: it showed at the cast instead of when the projectile lands. Recorded (rsprox
// 227/00075, 226/01698): map_anim telegrab_impact (144), delay=90, height=20.
test("the Telekinetic Grab landing graphic goes out as recorded: delay 90, height 20", (t) => {
    const listener = new MagicOnItemPacketListener();
    const target = new Location(3205, 3200, 0);
    const item = { getId: () => 995, clone: () => ({ id: 995 }) };
    const groundItem = { getItem: () => item, getPickupItem: () => item, getPosition: () => target };
    t.mock.method(TaskManager, 'submit', () => {});
    t.mock.method(Projectile.prototype, 'sendProjectile', () => {});
    t.mock.method(Sounds, 'sendSound', () => {});
    t.mock.method(CombatRange, 'withinApproachDistance', () => true);
    for (const name of ['hasRunes', 'canReceiveGroundItem']) t.mock.method(listener, name, () => true);
    t.mock.method(listener, 'runeCosts', () => []);
    t.mock.method(listener, 'consumeRunes', () => {});
    t.mock.method(listener, 'findVisibleGroundItem', () => groundItem);
    const graphics = [];
    const sender = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined
        : name === 'sendGlobalGraphic' ? (graphic, at) => { graphics.push({ graphic, at }); return sender; } : () => sender) });
    const player = {
        getHitpoints: () => 10, isRegistered: () => true, getLocation: () => new Location(3200, 3200, 0), getSpellbook: () => MagicSpellbook.NORMAL,
        getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
        getSkillManager: () => ({ getCurrentLevel: () => 99, stopSkillable() {}, addExperiences() {} }),
        getInventory: () => ({ addItem() {}, full() {} }),
        getPacketSender: () => sender, getPrivateArea: () => null,
        setPositionToFace() {}, performAnimation() {}, performGraphic() {}, sendMessage() {},
    };
    listener.castGroundItem(player, 995, 3205, 3200, 1168);
    assert.equal(graphics.length, 1);
    const { graphic, at } = graphics[0];
    assert.deepEqual([graphic.getId(), graphic.getDelay(), graphic.getHeight()], [144, 90, 20]);
    assert.ok(at.equals(target));
});

// Items on tables were recorded landing higher: rsprox 234/03270 (the table at 2930,3515) and 237/01108
// (1736,3168) send telegrab_impact (144) at delay=90, height=100; floor items stay at 20 (227/00075, 2124,9301).
test("the landing graphic stands on a table at height 100, and on the floor at 20", async (t) => {
    const path = require('node:path');
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    const { RegionManager } = require('../dist/game/collision/RegionManager');
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    RegionManager.init();
    t.mock.method(TaskManager, 'submit', () => {});
    t.mock.method(Projectile.prototype, 'sendProjectile', () => {});
    t.mock.method(Sounds, 'sendSound', () => {});
    t.mock.method(CombatRange, 'withinApproachDistance', () => true);
    const land = (x, y) => {
        const listener = new MagicOnItemPacketListener();
        const target = new Location(x, y, 0);
        const item = { getId: () => 245, clone: () => ({ id: 245 }) };
        const groundItem = { getItem: () => item, getPickupItem: () => item, getPosition: () => target };
        for (const name of ['hasRunes', 'canReceiveGroundItem']) t.mock.method(listener, name, () => true);
        t.mock.method(listener, 'runeCosts', () => []);
        t.mock.method(listener, 'consumeRunes', () => {});
        t.mock.method(listener, 'findVisibleGroundItem', () => groundItem);
        const graphics = [];
        const sender = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined
            : name === 'sendGlobalGraphic' ? (graphic) => { graphics.push(graphic); return sender; } : () => sender) });
        const player = {
            getHitpoints: () => 10, isRegistered: () => true, getLocation: () => new Location(x + 3, y, 0), getSpellbook: () => MagicSpellbook.NORMAL,
            getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
            getSkillManager: () => ({ getCurrentLevel: () => 99, stopSkillable() {}, addExperiences() {} }),
            getInventory: () => ({ addItem() {}, full() {} }),
            getPacketSender: () => sender, getPrivateArea: () => null,
            setPositionToFace() {}, performAnimation() {}, performGraphic() {}, sendMessage() {},
        };
        listener.castGroundItem(player, 245, x, y, 1168);
        assert.equal(graphics.length, 1);
        return [graphics[0].getId(), graphics[0].getDelay(), graphics[0].getHeight()];
    };
    assert.deepEqual(land(2930, 3515), [144, 90, 100], "the Zamorak temple table (its south-west tile)");
    assert.deepEqual(land(2930, 3516), [144, 90, 100], "the same 2x1 table's other tile (turned north-south on face 1)");
    assert.deepEqual(land(1736, 3168), [144, 90, 100], "a 2x2 table");
    assert.deepEqual(land(2124, 9301), [144, 90, 20], "floor");
    assert.deepEqual(land(2931, 3515), [144, 90, 20], "the floor beside the turned table");
});
