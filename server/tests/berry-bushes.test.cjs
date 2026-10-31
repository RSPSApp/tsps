// node --test tests/berry-bushes.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const BerryBushes = require('../plugins/objects/BerryBushes.plugin');

const REDBERRY = [23628, 23629, 23630];
const REDBERRIES = 1951;
const log = [];
const tasks = [];
const hooks = {};

class Task {
    constructor(delay) { this.delay = delay; this.running = true; }
    stop() { this.running = false; }
}
class GameObject {
    constructor(id, location) { this.id = id; this.location = location; }
    getId() { return this.id; }
    getLocation() { return this.location; }
    getType() { return 10; }
    getFace() { return 3; }
    getPrivateArea() { return null; }
}
const location = { getX: () => 3272, getY: () => 3375, getZ: () => 0, clone() { return this; } };

BerryBushes.register({
    core: {
        Task, GameObject,
        ObjectManager: { register: (o) => log.push(`add ${o.getId()}`), deregister: (o) => log.push(`remove ${o.getId()}`) },
        ObjectIdentifiers: { REDBERRY_BUSH_12: 23628, REDBERRY_BUSH_13: 23629, REDBERRY_BUSH_14: 23630, CADAVA_BUSH: 23625, CADAVA_BUSH_2: 23626, CADAVA_BUSH_3: 23627 },
        ItemIdentifiers: { REDBERRIES, CADAVA_BERRIES: 753 },
        Sounds: { sendSound: (_p, sound) => log.push(`sound ${sound}`) },
        Sound: { PICK: 2581 },
        Animation: class { constructor(id) { this.id = id; } },
        CacheDefinitions: { getSeqId: (name) => (name === 'picking_low' ? 2282 : null) },
    },
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
});

let freeSlots = 10;
const player = {
    isRegistered: () => true,
    getInventory: () => ({ getFreeSlots: () => freeSlots, adds: (id, n) => log.push(`item ${id} x${n}`) }),
    setPositionToFace: () => {},
    performAnimation: (a) => log.push(`anim ${a.id}`),
    sendMessage: (m) => log.push(m),
};
const definition = { getName: () => 'Redberry bush' };

function click(object) {
    log.length = 0;
    hooks['Redberry bush']['Pick-from']({ player, object, definition });
    const first = [...log];
    log.length = 0;
    return first;
}
function runTask(expectedDelay) {
    const task = tasks.shift();
    assert.equal(task.delay, expectedDelay);
    log.length = 0;
    task.execute();
    return [...log];
}

test('two picks empty the bush; berries grow back one at a time, 200 ticks apart', () => {
    const full = new GameObject(REDBERRY[0], location);
    assert.deepEqual(click(full), ['anim 2282']);
    assert.deepEqual(click(full), [], 'one pick at a time per bush');
    assert.deepEqual(runTask(1), [`item ${REDBERRIES} x1`, 'sound 2581', `remove ${REDBERRY[0]}`, `add ${REDBERRY[1]}`]);

    const one = new GameObject(REDBERRY[1], location);
    click(one);
    tasks.shift(); // the first pick's regrow, superseded by this pick
    assert.deepEqual(runTask(1), [`item ${REDBERRIES} x1`, 'sound 2581', `remove ${REDBERRY[1]}`, `add ${REDBERRY[2]}`]);

    assert.deepEqual(click(new GameObject(REDBERRY[2], location)), ['There are no berries on this bush at the moment.']);
    assert.equal(tasks.length, 1);
    assert.deepEqual(runTask(200), [`remove ${REDBERRY[2]}`, `add ${REDBERRY[1]}`]);
    assert.deepEqual(runTask(200), [`remove ${REDBERRY[1]}`, `add ${REDBERRY[0]}`]);
    assert.equal(tasks.length, 0);
    assert.equal(BerryBushes._test.bushStates.size, 0);
});

test('a full inventory gets the captured message and no animation', () => {
    freeSlots = 0;
    assert.deepEqual(click(new GameObject(REDBERRY[0], location)), ['Your inventory is too full to pick the berries from the bush.']);
    freeSlots = 10;
});

test('farming-patch bushes of the same name fall through', () => {
    assert.equal(hooks['Redberry bush']['Pick-from']({ player, object: new GameObject(7702, location), definition }), false);
});
