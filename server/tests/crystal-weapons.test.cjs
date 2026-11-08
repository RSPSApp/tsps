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

function api() {
    return {
        core: { ...core, BonusManager: { update() {} }, WeaponInterfaceManager: { assign() {} } },
        emitCustomEvent: (name, payload) => events.push([name, payload]),
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
    const inventory = { shards: 0 };
    const messages = [];
    const player = {
        weapon,
        messages,
        inventory,
        sendMessage: (m) => messages.push(m),
        isPlayer: () => true,
        getAsPlayer() { return this; },
        getEquipment: () => ({ getItems: () => equipment, refreshItems() {} }),
        getInventory: () => ({
            refreshItems() {},
            getAmount: () => inventory.shards,
            deleteNumber: (_id, n) => { inventory.shards -= n; },
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

test('shards add 100 charges each up to 20,000 and revive an inactive bow', () => {
    const player = wielder(I.BOW_OF_FAERDHINEN_INACTIVE_, { key: BOW_KEY, value: { charges: 0, used: 10000 } });
    player.inventory.shards = 500;
    const event = { player, usedItem: player.weapon, usedItemId: player.weapon.getId(), usedWithItem: new Item(I.CRYSTAL_SHARD, 500), usedWithItemId: I.CRYSTAL_SHARD, handled: false };
    itemOnItem.find((entry) => entry.b === 'Bow of Faerdhinen (inactive)').handler(event);
    assert.equal(player.weapon.getId(), I.BOW_OF_FAERDHINEN);
    assert.equal(player.weapon.getMetaValue(BOW_KEY).charges, 20000);
    assert.equal(player.inventory.shards, 300);
    assert.equal(event.handled, true);
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
