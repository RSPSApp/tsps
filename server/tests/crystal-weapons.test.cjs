// Run after `yarn build`: node --test tests/crystal-weapons.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { Item } = require('../dist/game/model/Item');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');

const Bow = require('../plugins/items/BowOfFaerdhinen.plugin');
const Blade = require('../plugins/items/BladeOfSaeldor.plugin');

const core = PluginManager.getCoreApi();
const itemActions = new Map();
const itemOnItem = [];
const customEvents = new Map();
const ammoHandlers = [];
const finishedHandlers = [];
const events = [];
/** A test's stand-in for another plugin answering the weapon's events. */
let onEmit = null;

function api() {
    return {
        core: { ...core, BonusManager: { update() {} }, WeaponInterfaceManager: { assign() {} } },
        emitCustomEvent: (name, payload) => { events.push([name, payload]); onEmit?.(name, payload); },
        onItemAction: (name, actions) => itemActions.set(name, actions),
        onItemOnItem: (a, b, handler) => itemOnItem.push({ a, b, handler }),
        onCustomEvent: (name, handler) => {
            if (name === 'combat:attack-finished') finishedHandlers.push(handler);
            else customEvents.set(name, handler);
        },
        registerRangedAmmoHandler: (handler) => ammoHandlers.push(handler),
    };
}
Bow.register(api());
Blade.register(api());

function wielder(weaponId, meta) {
    const weapon = new Item(weaponId, 1);
    if (meta !== undefined) weapon.setMetaValue(meta.key, meta.value);
    const equipment = new Array(14).fill(null);
    equipment[Equipment.WEAPON_SLOT] = weapon;
    const inventory = { shards: 0, items: [weapon] };
    const messages = [];
    const prompts = [];
    const player = {
        weapon,
        messages,
        inventory,
        prompts,
        amountAction: null,
        setEnteredAmountAction(action) { player.amountAction = action; },
        getPacketSender: () => ({ sendEnterAmountPrompt: (text) => prompts.push(text) }),
        sendMessage: (m) => messages.push(m),
        isPlayer: () => true,
        getAsPlayer() { return this; },
        getEquipment: () => ({ getItems: () => equipment, refreshItems() {} }),
        getInventory: () => ({
            refreshItems() {},
            getAmount: () => inventory.shards,
            deleteNumber: (_id, n) => { inventory.shards -= n; },
            getItems: () => inventory.items,
        }),
        getUpdateFlag: () => ({ flag() {} }),
        getCombat: () => ({ getRangedWeapon: () => core.RangedWeapon.BOW_OF_FAERDHINEN[0] }),
    };
    return player;
}

const BOW_KEY = 'bow-of-faerdhinen:charges';
const BLADE_KEY = 'blade-of-saeldor:charges';

test('a bow of Faerdhinen with no saved count is new: 10,000 charges, one per shot', () => {
    const player = wielder(I.BOW_OF_FAERDHINEN);
    ammoHandlers[0].decrementAmmo(player, null, 1);
    assert.deepEqual(player.weapon.getMetaValue(BOW_KEY), { charges: 9999, used: 1 });
    assert.equal(player.weapon.getId(), I.BOW_OF_FAERDHINEN);
});

test('the last charge turns the bow into the inactive bow', () => {
    const player = wielder(I.BOW_OF_FAERDHINEN, { key: BOW_KEY, value: { charges: 1, used: 5 } });
    ammoHandlers[0].decrementAmmo(player, null, 1);
    assert.equal(player.weapon.getId(), I.BOW_OF_FAERDHINEN, 'still charged while the last shot is rolled');
    finishedHandlers.forEach((handler) => handler({ attacker: player }));
    assert.equal(player.weapon.getId(), I.BOW_OF_FAERDHINEN_INACTIVE_);
    assert.equal(player.weapon.getMetaValue(BOW_KEY).charges, 0);
});

test('Check gives the captured message with corruption progress (2,000 charges used is 1%)', () => {
    const player = wielder(I.BOW_OF_FAERDHINEN, { key: BOW_KEY, value: { charges: 8000, used: 4000 } });
    itemActions.get('Bow of Faerdhinen').Check({ player, item: player.weapon });
    assert.deepEqual(player.messages, ['Your bow of Faerdhinen has 8,000 charges remaining, and 2% progress towards corruption.']);
});

function useShards(player, inactive = false) {
    const name = inactive ? 'Bow of Faerdhinen (inactive)' : 'Bow of Faerdhinen';
    const event = { player, usedItem: new Item(I.CRYSTAL_SHARD, 1), usedItemId: I.CRYSTAL_SHARD, usedWithItem: player.weapon, usedWithItemId: player.weapon.getId(), handled: false };
    itemOnItem.find((entry) => entry.b === name).handler(event);
    return event;
}

test('shards ask how many to add, the most being those that reach 20,000 rounded up', () => {
    const player = wielder(I.BOW_OF_FAERDHINEN, { key: BOW_KEY, value: { charges: 3689, used: 0 } });
    player.inventory.shards = 350;
    const event = useShards(player);
    assert.equal(event.handled, true);
    assert.deepEqual(player.prompts, ['How many shards do you wish to add? (0 - 164)']);
    assert.equal(player.inventory.shards, 350, 'nothing is taken before the answer');
    player.amountAction.execute(164);
    assert.equal(player.inventory.shards, 186);
    assert.equal(player.weapon.getMetaValue(BOW_KEY).charges, 20000, 'the overshoot is lost');
    assert.deepEqual(player.messages, [], 'no chat line');
});

test('a smaller count adds that many; more than held or allowed is cut down; 0 adds nothing', () => {
    const player = wielder(I.BOW_OF_FAERDHINEN, { key: BOW_KEY, value: { charges: 10000, used: 0 } });
    player.inventory.shards = 30;
    useShards(player);
    player.amountAction.execute(0);
    assert.equal(player.inventory.shards, 30);
    useShards(player);
    player.amountAction.execute(10);
    assert.equal(player.weapon.getMetaValue(BOW_KEY).charges, 11000);
    useShards(player);
    player.amountAction.execute(500);
    assert.equal(player.inventory.shards, 0);
    assert.equal(player.weapon.getMetaValue(BOW_KEY).charges, 13000);
});

test('shards revive an inactive bow', () => {
    const player = wielder(I.BOW_OF_FAERDHINEN_INACTIVE_, { key: BOW_KEY, value: { charges: 0, used: 10000 } });
    player.inventory.shards = 500;
    useShards(player, true);
    assert.deepEqual(player.prompts, ['How many shards do you wish to add? (0 - 200)']);
    player.amountAction.execute(200);
    assert.equal(player.weapon.getId(), I.BOW_OF_FAERDHINEN);
    assert.equal(player.weapon.getMetaValue(BOW_KEY).charges, 20000);
    assert.equal(player.inventory.shards, 300);
});

test('a bow moved out of the inventory before the answer takes no shards', () => {
    const player = wielder(I.BOW_OF_FAERDHINEN, { key: BOW_KEY, value: { charges: 100, used: 0 } });
    player.inventory.shards = 10;
    useShards(player);
    player.inventory.items = [];
    player.amountAction.execute(10);
    assert.equal(player.inventory.shards, 10);
    assert.equal(player.weapon.getMetaValue(BOW_KEY).charges, 100);
});

test('a shot that leaves a multiple of 500 charges sends the red reminder, without a separator', () => {
    const player = wielder(I.BOW_OF_FAERDHINEN, { key: BOW_KEY, value: { charges: 4002, used: 0 } });
    ammoHandlers[0].decrementAmmo(player, null, 1);
    assert.deepEqual(player.messages, []);
    ammoHandlers[0].decrementAmmo(player, null, 1);
    assert.deepEqual(player.messages, ['<col=ff0000>Your bow of Faerdhinen has 4000 charges remaining.</col>']);
    ammoHandlers[0].decrementAmmo(player, null, 1);
    assert.equal(player.messages.length, 1);
});

test('a blade of Saeldor spends a charge on every melee swing and not on other attacks', () => {
    const player = wielder(I.BLADE_OF_SAELDOR, { key: BLADE_KEY, value: { charges: 2, used: 0 } });
    const attack = customEvents.get('combat:attack-started');
    attack({ attacker: player, method: { type: () => core.CombatType.RANGED } });
    assert.equal(player.weapon.getMetaValue(BLADE_KEY).charges, 2);
    attack({ attacker: player, method: { type: () => core.CombatType.MELEE } });
    attack({ attacker: player, method: { type: () => core.CombatType.MELEE } });
    assert.equal(player.weapon.getId(), I.BLADE_OF_SAELDOR, 'last swing is rolled with the charged blade');
    assert.equal(player.weapon.getMetaValue(BLADE_KEY).charges, 0);
    finishedHandlers.forEach((handler) => handler({ attacker: player }));
    assert.equal(player.weapon.getId(), I.BLADE_OF_SAELDOR_INACTIVE_);
});

test('1,000 blade charges used is 1% progress', () => {
    const player = wielder(I.BLADE_OF_SAELDOR, { key: BLADE_KEY, value: { charges: 9000, used: 1000 } });
    itemActions.get('Blade of Saeldor').Check({ player, item: player.weapon });
    assert.match(player.messages[0], /9,000 charges remaining, and 1% progress/);
});

test('a kept charge with extra charges given back (combat:consume-charge extra) adds them, up to 20,000', () => {
    onEmit = (name, payload) => { if (name === 'combat:consume-charge') { payload.skip = true; payload.extra = 2; } };
    try {
        const player = wielder(I.BOW_OF_FAERDHINEN, { key: BOW_KEY, value: { charges: 100, used: 5 } });
        ammoHandlers[0].decrementAmmo(player, null, 1);
        assert.deepEqual(player.weapon.getMetaValue(BOW_KEY), { charges: 102, used: 5 });
        player.weapon.setMetaValue(BOW_KEY, { charges: 19999, used: 5 });
        ammoHandlers[0].decrementAmmo(player, null, 1);
        assert.equal(player.weapon.getMetaValue(BOW_KEY).charges, 20000);
    } finally {
        onEmit = null;
    }
});
