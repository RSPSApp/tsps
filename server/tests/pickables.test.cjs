// Run after `yarn build`: node --test tests/pickables.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Location } = require('../dist/game/model/Location');
const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
const { Sounds } = require('../dist/game/Sounds');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const Pickable = require('../plugins/objects/Pickable.plugin');

const log = [];
const tasks = [];
Pickable.register({
    getTaskManager: () => ({ submit: (task) => { task.setRunning(true); tasks.push(task); } }),
    onObjectInteraction: () => {},
});
Sounds.sendSound = (_player, sound) => log.push(`sound ${sound.getId?.() ?? sound.id}`);
ObjectManager.deregister = (object) => log.push(`remove ${object.getId()}`);
ObjectManager.register = (object) => log.push(`add ${object.getId()}`);

function plant(id, name, x = 3200) {
    const location = new Location(x, 3200, 0);
    return { getId: () => id, getLocation: () => location, getType: () => 10, getFace: () => 1, getPrivateArea: () => null, getDefinition: () => ({ getName: () => name }) };
}

function player({ gloves = -1 } = {}) {
    return {
        isRegistered: () => true,
        getInventory: () => ({ getFreeSlots: () => 10, adds: (id, n) => log.push(`item ${id} x${n}`) }),
        getEquipment: () => ({ get: (slot) => (slot === Equipment.HANDS_SLOT && gloves > 0 ? { getId: () => gloves } : null) }),
        setPositionToFace: () => {},
        performAnimation: (animation) => log.push(`anim ${animation.getId()}`),
        sendMessage: (message) => log.push(message),
        getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: ([hit]) => log.push(`hit ${hit.getDamage()}`) }) }),
    };
}

/** One pick: what its first tick logs, then what the next tick logs. */
function pickOnce(object, who = player(), random = 0) {
    const original = Math.random;
    Math.random = () => random;
    try {
        log.length = 0;
        tasks.length = 0;
        Pickable._test.pick({ player: who, object, definition: object.getDefinition() });
        const first = [...log];
        log.length = 0;
        const pickTask = tasks.shift();
        pickTask?.execute();
        return { first, next: [...log], respawn: tasks.find((task) => task.isRunning()) };
    } finally {
        Math.random = original;
    }
}

test('the data file names items as the cache does, and sweetcorn empties into its empty versions', async () => {
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    for (const entry of Pickable._test.PICKABLES) {
        assert.equal(CacheDefinitions.getItem(entry.item).name, entry.itemName, entry.name);
        for (const [pickId, emptyId] of Object.entries(entry.empty ?? {})) {
            assert.deepEqual((CacheDefinitions.getObject(Number(pickId)).actions ?? []).filter(Boolean), ['Pick']);
            assert.equal(CacheDefinitions.getObject(emptyId).name, entry.name);
            assert.deepEqual((CacheDefinitions.getObject(emptyId).actions ?? []).filter(Boolean), [], 'the empty plant has no Pick');
        }
    }
});

test('as captured (potatoes): the animation first, then a tick later the message, the item, the sound and the plant gone', () => {
    const potato = plant(312, 'Potato');
    const { first, next, respawn } = pickOnce(potato);
    assert.deepEqual(first, ['anim 827']);
    assert.deepEqual(next, ['item 1942 x1', 'You pick a potato.', 'sound 2581', 'remove 312']);
    assert.equal(respawn.getDelay(), 49, 'back 50 ticks after the pick started');
    assert.deepEqual(pickOnce(potato).first, [], 'a picked plant cannot be picked again before it is back');
    log.length = 0;
    respawn.execute();
    assert.deepEqual(log, ['add 312']);
    assert.deepEqual(pickOnce(potato).first, ['anim 827'], 'and can be once it is');
});

test('as captured (wheat): grain, and the wheat is back 20 ticks after the pick started', () => {
    const { next, respawn } = pickOnce(plant(15507, 'Wheat', 3300));
    assert.deepEqual(next, ['item 1947 x1', 'You pick some grain.', 'sound 2581', 'remove 15507']);
    assert.equal(respawn.getDelay(), 19);
});

test('flax disappears 3 times in 16 (Wiki), and sweetcorn turns into its empty version', () => {
    assert.ok(!pickOnce(plant(14896, 'Flax', 3400), player(), 0.5).next.some((line) => line.startsWith('remove')), 'mostly it stays');
    assert.ok(pickOnce(plant(14896, 'Flax', 3401), player(), 0.1).next.includes('remove 14896'));
    const { next } = pickOnce(plant(51829, 'Sweetcorn', 3500));
    assert.deepEqual(next.slice(-2), ['remove 51829', 'add 51831']);
});

test('nettles need gloves (Wiki): bare-handed they sting and give nothing; beekeeper\'s gloves do not count', () => {
    ItemDefinition.forId = (id) => ({ getName: () => (id === 1 ? 'Leather gloves' : id === 2 ? "Beekeeper's gloves" : '') });
    const bare = pickOnce(plant(5253, 'Nettles', 3600), player(), 0.5);
    assert.deepEqual(bare.next, ['You have been stung by the nettles!', 'hit 2']);
    assert.deepEqual(pickOnce(plant(5253, 'Nettles', 3601), player({ gloves: 2 }), 0.5).next.slice(0, 1), ['You have been stung by the nettles!']);
    assert.deepEqual(pickOnce(plant(5253, 'Nettles', 3602), player({ gloves: 1 }), 0.5).next, ['item 4241 x1', 'You pick the nettles.', 'sound 2581']);
});

test('cabbage respawns after 40 to 80 ticks (Wiki)', () => {
    const cabbage = Pickable._test.PICKABLES.find((entry) => entry.name === 'Cabbage');
    assert.equal(Pickable._test.respawnTicks(cabbage, () => 0), 40);
    assert.equal(Pickable._test.respawnTicks(cabbage, () => 0.9999), 80);
});
