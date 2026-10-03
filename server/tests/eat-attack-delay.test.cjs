// Run after `yarn build`: node --test tests/eat-attack-delay.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { World } = require('../dist/game/World');
const { Combat } = require('../dist/game/content/combat/Combat');
const { TimerRepository } = require('../dist/util/timers/TimerRepository');
const { ItemIds } = require('../dist/util/IdEnums');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const Food = require('../plugins/items/Food.plugin');

// The eat message reads the item name; no cache is loaded here.
ItemDefinition.forId = () => ({ getName: () => 'Food' });

function setCycle(cycle) {
    World.processCycle = cycle;
}

function registerFood() {
    let eat = null;
    Food.register({
        onItemFirstAction: (handler) => { eat = handler; },
        emitCanEat: () => true,
        emitCustomEvent: () => {},
        log: () => {},
    });
    return eat;
}

function buildPlayer() {
    const combat = new Combat({ isPlayer: () => true, isNpc: () => false });
    const timers = new TimerRepository();
    const items = [];
    const inventory = {
        capacity: () => 28,
        getItems: () => items,
        deleteAtSlot: (slot) => { items[slot] = null; },
        setItem: () => {},
        refreshItems: () => {},
    };
    const player = {
        getCombat: () => combat,
        getTimers: () => timers,
        getInventory: () => inventory,
        getPacketSender: () => ({ sendInterfaceRemoval: () => {}, sendSoundEffect: () => {} }),
        getSkillManager: () => ({ stopSkillable: () => {}, getCurrentLevel: () => 50, getMaxLevel: () => 99 }),
        isPlayerBot: () => false,
        performAnimation: () => {},
        setHitpoints: () => {},
        sendMessage: () => {},
    };
    const give = (slot, id) => { items[slot] = { getId: () => id }; };
    return { player, combat, timers, give };
}

test('eating adds 3 ticks to the attack timer, a karambwan 2 (Wiki: Food)', () => {
    const eat = registerFood();
    const { player, combat, give } = buildPlayer();
    setCycle(1000);

    combat.setAttackDelay(4);
    give(0, ItemIds.SHARK);
    eat({ player, itemId: ItemIds.SHARK, slot: 0 });
    assert.equal(combat.getAttackDelay(), 7, 'shark right after a 4-tick attack');

    give(1, ItemIds.COOKED_KARAMBWAN);
    eat({ player, itemId: ItemIds.COOKED_KARAMBWAN, slot: 1 });
    assert.equal(combat.getAttackDelay(), 9, 'combo karambwan adds 2 more');
});

test('eating while idle does not delay the next attack', () => {
    const eat = registerFood();
    const { player, combat, give } = buildPlayer();
    setCycle(1000);
    combat.setAttackDelay(4);

    setCycle(1010);
    give(0, ItemIds.SHARK);
    eat({ player, itemId: ItemIds.SHARK, slot: 0 });
    assert.equal(combat.getAttackDelay(), 0, 'timer ran 6 ticks past zero, +3 still ready');

    const late = buildPlayer();
    setCycle(1012);
    late.combat.setAttackDelay(4);
    setCycle(1014);
    late.give(0, ItemIds.SHARK);
    eat({ player: late.player, itemId: ItemIds.SHARK, slot: 0 });
    assert.equal(late.combat.getAttackDelay(), 5, 'two ticks left plus 3');
});
