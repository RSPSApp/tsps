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
const { World } = require('../dist/game/World');
const { PluginManager } = require('../dist/plugins/PluginManager');

// The item used to land in the pack on the cast tick, before the projectile reached it.
test('Telekinetic Grab takes the item when its projectile lands, not on the cast', (t) => {
    const listener = new MagicOnItemPacketListener();
    let onGround = true;
    let targetLocation = new Location(3205, 3200, 0);
    const groundItem = { getItem: () => ({ clone: () => ({ id: 995 }) }), getPosition: () => targetLocation };
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
    const sender = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : () => sender) });
    const player = {
        getHitpoints: () => 10, isRegistered: () => true, getLocation: () => currentLocation,
        getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
        getSkillManager: () => ({ getCurrentLevel: () => 99, stopSkillable() {}, addExperiences: (_skill, xp) => experiences.push(xp) }),
        getInventory: () => ({ addItem: (item) => added.push(item), full() {} }),
        getPacketSender: () => sender, getPrivateArea: () => null,
        setPositionToFace() {}, performAnimation() {}, performGraphic() {},
        sendMessage: (message) => messages.push(message),
    };
    const run = () => tasks.shift().execute();

    listener.castGroundItem(player, 995, 3205, 3200, 1168);
    assert.equal(added.length, 0, 'nothing is taken on the cast tick');
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

    const visibility = process.env.CROSS_FLOOR_VISIBILITY;
    const legacy = process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT;
    t.after(() => {
        if (visibility === undefined) delete process.env.CROSS_FLOOR_VISIBILITY; else process.env.CROSS_FLOOR_VISIBILITY = visibility;
        if (legacy === undefined) delete process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT; else process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT = legacy;
    });
    delete process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT;
    process.env.CROSS_FLOOR_VISIBILITY = '1';
    currentLocation = new Location(3200, 3200, 1);
    targetLocation = new Location(3205, 3200, 0);
    onGround = true;
    listener.castGroundItem(player, 995, 3205, 3200, 1168);
    run();
    assert.equal(added.length, 2, 'opt-in telegrab can take a visible item from a lower floor');
    assert.equal(experiences.length, 3);
});

test('Telekinetic Grab takes the stack from its captured floor when another floor matches', (t) => {
    const listener = new MagicOnItemPacketListener();
    const previous = Object.fromEntries(['CROSS_FLOOR_VISIBILITY_AND_COMBAT', 'CROSS_FLOOR_VISIBILITY', 'CROSS_FLOOR_COMBAT'].map(key => [key, process.env[key]]));
    t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    delete process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT;
    process.env.CROSS_FLOOR_VISIBILITY = '1';
    process.env.CROSS_FLOOR_COMBAT = '0';
    t.mock.method(PluginManager, 'getPluginConfig', () => undefined);
    t.mock.method(PluginManager, 'emitCustomEvent', () => {});

    const makePile = (position) => ({
        getItem: () => ({ getId: () => 995, getAmount: () => 10 }),
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
