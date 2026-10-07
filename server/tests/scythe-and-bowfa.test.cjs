// Run after `yarn build`: node --test tests/scythe-and-bowfa.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { RangedWeapon } = require('../dist/game/content/combat/ranged/RangedData');
const { BOW_OF_FAERDHINEN_IDS } = require('../dist/game/content/combat/ranged/CrystalBow');
const Scythe = require('../plugins/items/ScytheOfVitur.plugin');
const CrystalArmour = require('../plugins/combat/effects/CrystalArmour');

const NAMES = new Map();
let nextId = 90000;
function item(name) {
    const id = nextId++;
    NAMES.set(id, name);
    return id;
}
ItemDefinition.forId = (id) => ({ getName: () => NAMES.get(id) ?? '' });

function player(worn) {
    const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
    for (const [slot, id] of Object.entries(worn)) items[slot] = { getId: () => id };
    const entity = {
        isPlayer: () => true,
        getAsPlayer: () => entity,
        getEquipment: () => ({ getItems: () => items, get: (slot) => items[slot] }),
    };
    return entity;
}

const npcOfSize = (size) => ({ isNpc: () => true, getAsNpc: () => ({ getSize: () => size }) });

// One registration against a fake core; each swing resets what it records.
let rerolled = [];
let maxHit = 0;
let resolver;
class MeleeCombatMethod {}
class PendingHit {
    constructor() {
        this.damage = 0;
    }
    getTotalDamage() {
        return this.damage;
    }
}
Scythe.register({
    core: {
        Equipment,
        ItemDefinition,
        ItemIdentifiers,
        MeleeCombatMethod,
        PendingHit,
        CombatFactory: { applyStyleDamage: (hit, max) => { rerolled.push(max); hit.damage = max; } },
        DamageFormulas: { calculateMaxMeleeHit: () => maxHit },
    },
    registerCombatMethodResolver: (r) => { resolver = r; },
    onItemAction: () => {},
    onItemOnItem: () => {},
});

function swing(target, max) {
    rerolled = [];
    maxHit = max;
    const attacker = player({ [Equipment.WEAPON_SLOT]: SCYTHE });
    const method = resolver.resolve(attacker);
    assert.ok(method, 'a scythe resolves to the scythe method');
    return { hits: method.hits(attacker, target), rerolled };
}

const SCYTHE = item('Scythe of vitur');
NAMES.set(ItemIdentifiers.SCYTHE_OF_VITUR, 'Scythe of vitur');
NAMES.set(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_, 'Scythe of vitur (uncharged)');

test('the scythe hits once per tile of target width, up to three', () => {
    assert.equal(swing(npcOfSize(1), 47).hits.length, 1);
    assert.equal(swing(npcOfSize(2), 47).hits.length, 2);
    assert.equal(swing(npcOfSize(5), 47).hits.length, 3);
});

test('each scythe hit has half the max of the one before, rounded down', () => {
    assert.deepEqual(swing(npcOfSize(3), 47).rerolled, [23, 11], '47 -> 23 -> 11');
    assert.deepEqual(swing(npcOfSize(3), 48).rerolled, [24, 12]);
});

test('every bow of Faerdhinen fires its own arrows, not the ammo slot', () => {
    assert.ok(BOW_OF_FAERDHINEN_IDS.includes(ItemIdentifiers.BOW_OF_FAERDHINEN));
    for (const id of BOW_OF_FAERDHINEN_IDS) {
        const ammo = RangedWeapon.getSelfAmmo(id);
        assert.ok(ammo, `bow ${id} has self ammo`);
        assert.equal(ammo.getItemId(), id);
    }
    assert.equal(RangedWeapon.getSelfAmmo(ItemIdentifiers.BOW_OF_FAERDHINEN_C_).getProjectileId(), 1922);
});

test('crystal armour boosts a crystal bow or bow of Faerdhinen by its pieces', () => {
    const bowfa = item('Bow of faerdhinen (c)');
    const helm = item('Crystal helm');
    const body = item('Crystal body');
    const legs = item('Crystal legs');
    const full = player({
        [Equipment.WEAPON_SLOT]: bowfa,
        [Equipment.HEAD_SLOT]: helm,
        [Equipment.BODY_SLOT]: body,
        [Equipment.LEG_SLOT]: legs,
    });
    assert.equal(CrystalArmour._test.pieces(full), 6);
    assert.equal(CrystalArmour._test.accuracy(full, 20000), 26000, '+30%');
    assert.equal(CrystalArmour._test.damage(full, 40), 46, '+15%');

    const helmOnly = player({ [Equipment.WEAPON_SLOT]: bowfa, [Equipment.HEAD_SLOT]: helm });
    assert.equal(CrystalArmour._test.damage(helmOnly, 40), 41, '+2.5%');

    const gauntletBow = player({ [Equipment.WEAPON_SLOT]: item('Crystal bow (perfected)'), [Equipment.HEAD_SLOT]: helm });
    assert.equal(CrystalArmour._test.pieces(gauntletBow), 0);
});

// Scythe charges (Wiki: Scythe of Vitur#Charging and degradation).
function chargeableItem(id, amount = 0) {
    let currentId = id;
    const meta = new Map();
    if (amount > 0) meta.set(Scythe._test.CHARGE_META_KEY, amount);
    return {
        getId: () => currentId,
        setId: (next) => { currentId = next; },
        getMetaValue: (key) => meta.get(key),
        setMetaValue: (key, value) => { if (value === undefined) meta.delete(key); else meta.set(key, value); },
    };
}

function chargePlayer(weapon, { runes = 0, vials = 0 } = {}) {
    const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
    items[Equipment.WEAPON_SLOT] = weapon;
    const messages = [];
    const inventory = {
        runes,
        vials,
        getAmount(id) {
            return id === ItemIdentifiers.BLOOD_RUNE ? this.runes : id === ItemIdentifiers.VIAL_OF_BLOOD_2 ? this.vials : 0;
        },
        deleteNumber(id, amount = 1) {
            if (id === ItemIdentifiers.BLOOD_RUNE) this.runes -= amount;
            else if (id === ItemIdentifiers.VIAL_OF_BLOOD_2) this.vials -= amount;
        },
        refreshItems() {},
    };
    const entity = {
        isPlayer: () => true,
        getAsPlayer: () => entity,
        getEquipment: () => ({ get: (slot) => items[slot], getItems: () => items, refreshItems: () => {} }),
        getInventory: () => inventory,
        sendMessage: (message) => messages.push(message),
    };
    return { entity, weapon, inventory, messages };
}

test('a scythe swing spends one charge per attack, and only when a hit deals damage (Wiki)', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR, 5));
    const method = resolver.resolve(loaded.entity);
    assert.ok(method, 'a scythe resolves to the scythe method');
    maxHit = 47;

    method.hits(loaded.entity, npcOfSize(1));
    assert.equal(Scythe._test.charges(loaded.weapon), 5, 'a swing that deals no damage is free');

    const hits = method.hits(loaded.entity, npcOfSize(3));
    assert.equal(hits.length, 3);
    assert.equal(Scythe._test.charges(loaded.weapon), 4, 'three hits still spend one charge');
});

test('the last charge reverts the scythe to its uncharged form', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR, 1));
    const method = resolver.resolve(loaded.entity);
    maxHit = 47;
    method.hits(loaded.entity, npcOfSize(3));
    assert.equal(loaded.weapon.getId(), ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_);
    assert.equal(Scythe._test.charges(loaded.weapon), 0);
    assert.match(loaded.messages.at(-1), /run out of charges/);
});

test('an uncharged scythe still swings, but spends nothing and never changes id', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_));
    const method = resolver.resolve(loaded.entity);
    assert.ok(method, 'the uncharged scythe keeps the multi-hit passive');
    maxHit = 47;
    const hits = method.hits(loaded.entity, npcOfSize(3));
    assert.equal(hits.length, 3);
    assert.equal(loaded.weapon.getId(), ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_);
});

test('one vial of blood and 200 blood runes buy 100 scythe charges (Wiki)', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_), { runes: 450, vials: 2 });
    Scythe._test.chargeScythe({
        player: loaded.entity,
        usedItem: loaded.weapon,
        usedWithItem: { getId: () => ItemIdentifiers.VIAL_OF_BLOOD_2 },
        usedItemId: ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_,
        usedWithItemId: ItemIdentifiers.VIAL_OF_BLOOD_2,
    });
    assert.equal(loaded.weapon.getId(), ItemIdentifiers.SCYTHE_OF_VITUR);
    assert.equal(Scythe._test.charges(loaded.weapon), 200);
    assert.deepEqual([loaded.inventory.runes, loaded.inventory.vials], [50, 0]);
});

test('a partial set of 200 blood runes charges nothing, and a full scythe takes no more', () => {
    const short = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_), { runes: 199, vials: 1 });
    Scythe._test.chargeScythe({
        player: short.entity,
        usedItem: { getId: () => ItemIdentifiers.BLOOD_RUNE },
        usedWithItem: short.weapon,
        usedItemId: ItemIdentifiers.BLOOD_RUNE,
        usedWithItemId: ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_,
    });
    assert.equal(Scythe._test.charges(short.weapon), 0);
    assert.match(short.messages.at(-1), /vial of blood and 200 blood runes/);

    const full = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR, 19950), { runes: 400, vials: 2 });
    Scythe._test.chargeScythe({
        player: full.entity,
        usedItem: full.weapon,
        usedWithItem: { getId: () => ItemIdentifiers.BLOOD_RUNE },
        usedItemId: ItemIdentifiers.SCYTHE_OF_VITUR,
        usedWithItemId: ItemIdentifiers.BLOOD_RUNE,
    });
    assert.equal(Scythe._test.charges(full.weapon), 19950, '50 charges of room is under one whole batch');
    assert.match(full.messages.at(-1), /cannot hold any more charges/);
});

test('Check reports charges and Uncharge clears them without a refund (Wiki)', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR, 125));
    Scythe._test.checkCharges({ player: loaded.entity, item: loaded.weapon });
    assert.match(loaded.messages.at(-1), /125 charges left/);

    Scythe._test.uncharge({ player: loaded.entity, item: loaded.weapon });
    assert.equal(loaded.weapon.getId(), ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_);
    assert.equal(Scythe._test.charges(loaded.weapon), 0);
    assert.deepEqual([loaded.inventory.runes, loaded.inventory.vials], [0, 0], 'the vyre well is not modelled');
});
