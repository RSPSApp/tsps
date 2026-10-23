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

// The item used to land in the pack on the cast tick, before the projectile reached it.
test('Telekinetic Grab takes the item when its projectile lands, not on the cast', (t) => {
    const listener = new MagicOnItemPacketListener();
    let onGround = true;
    const groundItem = { getItem: () => ({ clone: () => ({ id: 995 }) }) };
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
    const sender = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : () => sender) });
    const player = {
        getHitpoints: () => 10, isRegistered: () => true, getLocation: () => new Location(3200, 3200, 0),
        getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
        getSkillManager: () => ({ getCurrentLevel: () => 99, stopSkillable() {}, addExperiences() {} }),
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
    run();
    assert.equal(added.length, 1, 'taken once the projectile lands');
    assert.equal(onGround, false);

    // Someone else picks it up mid-flight.
    onGround = true;
    listener.castGroundItem(player, 995, 3205, 3200, 1168);
    onGround = false;
    run();
    assert.equal(added.length, 1);
    assert.deepEqual(messages.slice(-1), ["Too late - it's gone!"]);
});
