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

const npcOfSize = (size) => ({ getHitpoints: () => 1000, isNpc: () => true, getAsNpc: () => ({ getSize: () => size }) });

// One registration against a fake core; each swing resets what it records.
let rerolled = [];
let maxHit = 0;
let resolver;
let multi = false;
let worldNpcs = [];
let itemOnObject;
let wellActions;
let loginHook;
class Item {
    constructor(id, amount = 1) {
        this.id = id;
        this.amount = amount;
    }
    getId() { return this.id; }
    getAmount() { return this.amount; }
    getMeta() { return undefined; }
}
class MeleeCombatMethod {}
class PendingHit {
    constructor() {
        this.damage = 0;
    }
    getTotalDamage() {
        return this.damage;
    }
    setTotalDamage(value) { this.damage = value; }
}
Scythe.register({
    emitCustomEvent: () => {},
    core: {
        Equipment,
        Item,
        ItemDefinition,
        ItemIdentifiers,
        ObjectDefinition: { forPlayer: () => ({ getName: () => "Vyre well" }) },
        MeleeCombatMethod,
        PendingHit,
        CombatFactory: {
            applyStyleDamage: (hit, max) => { rerolled.push(max); hit.damage = max; },
            canAttackSecondaryTarget: () => true,
        },
        DamageFormulas: { calculateMaxMeleeHit: () => maxHit },
        World: { getNpcs: () => worldNpcs, getPlayers: () => [] },
    },
    getAreaManager: () => ({ inMulti: () => multi }),
    registerCombatMethodResolver: (r) => { resolver = r; },
    emitCustomEvent: () => {},
    onServerStartup: (handler) => handler(),
    persistAttribute: () => {},
    onItemAction: () => {},
    onItemOnItem: () => {},
    onItemOnObject: (handler) => { itemOnObject = handler; },
    onObjectInteraction: (name, actions) => { wellActions = actions; },
    onPlayerLogin: (handler) => { loginHook = handler; },
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

test('the cleave reads multicombat from the area manager: a swing with located targets never throws', () => {
    const at = (x, y) => ({ getX: () => x, getY: () => y, getZ: () => 0 });
    const located = (x, y) => ({ ...npcOfSize(1), getLocation: () => at(x, y), getAsNpc: () => ({ getSize: () => 1 }) });
    const target = located(10, 11);
    const beside = located(11, 11);
    worldNpcs = [target, beside];
    const attacker = { ...player({ [Equipment.WEAPON_SLOT]: SCYTHE }), getLocation: () => at(10, 10) };
    const method = resolver.resolve(attacker);
    maxHit = 40;
    multi = false;
    assert.deepEqual(method.hits(attacker, target).length, 1, 'single-way: the target alone');
    assert.deepEqual(Scythe._test.cleaveTargets(attacker, target), []);
    multi = true;
    assert.deepEqual(Scythe._test.cleaveTargets(attacker, target), [beside], 'multi: the next tile of the arc');
    assert.equal(method.hits(attacker, target).length, 2);
    multi = false;
    worldNpcs = [];
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

function chargePlayer(weapon, { runes = 0, vials = 0, notedVials = 0, vialId = ItemIdentifiers.VIAL_OF_BLOOD_2, occupied = 0 } = {}) {
    const equipment = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
    equipment[Equipment.WEAPON_SLOT] = weapon;
    const counts = new Map([
        [ItemIdentifiers.BLOOD_RUNE, runes],
        [vialId, vials],
        [ItemIdentifiers.VIAL_OF_BLOOD_3, notedVials],
    ]);
    const amountOf = (id) => counts.get(id) ?? 0;
    // Each stack a player holds takes one inventory slot; `occupied` models items the test does not.
    const heldStacks = new Set([...counts].filter(([, amount]) => amount > 0).map(([id]) => id));
    const freeSlots = () => 28 - heldStacks.size - occupied;
    const messages = [];
    const varbits = new Map();
    let enteredAmount = null;
    const inventory = {
        get runes() { return amountOf(ItemIdentifiers.BLOOD_RUNE); },
        get vials() { return amountOf(ItemIdentifiers.VIAL_OF_BLOOD_2); },
        getAmount: amountOf,
        deleteNumber(id, amount = 1) {
            const left = Math.max(0, amountOf(id) - amount);
            counts.set(id, left);
            if (left < 1) heldStacks.delete(id);
        },
        getItems: () => [...heldStacks].map((id) => ({ getId: () => id, getMeta: () => undefined })),
        getFreeSlots: freeSlots,
        getAddableAmount: (item) => heldStacks.has(item.getId()) || freeSlots() > 0 ? item.getAmount() : 0,
        add(item) {
            counts.set(item.getId(), amountOf(item.getId()) + item.getAmount());
            heldStacks.add(item.getId());
        },
        refreshItems() {},
    };
    const attributes = new Map();
    const entity = {
        isPlayer: () => true,
        getAsPlayer: () => entity,
        getEquipment: () => ({ get: (slot) => equipment[slot], getItems: () => equipment, refreshItems: () => {} }),
        getInventory: () => inventory,
        getAttribute: (key) => attributes.get(key),
        setAttribute: (key, value) => attributes.set(key, value),
        setEnteredAmountAction: (action) => { enteredAmount = action; },
        getPacketSender: () => ({
            sendVarbit: (id, value) => { varbits.set(id, value); },
            sendEnterAmountPrompt: () => {},
        }),
        sendMessage: (message) => messages.push(message),
    };
    return { entity, weapon, inventory, messages, varbits, enteredAmount: () => enteredAmount };
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
    assert.deepEqual([loaded.inventory.runes, loaded.inventory.vials], [0, 0], 'uncharging away from the well returns nothing');
});

// Vyre well (Wiki: Vyre well#Charging).
test('Fill stores sets of 100 charges in the well, using vials and blood runes (Wiki)', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_), { runes: 450, vials: 2 });
    assert.equal(Scythe._test.fillWell({ player: loaded.entity }), true);
    assert.match(loaded.messages[0], /Mixing 1 vial of blood with the power of 200 blood runes/);
    assert.ok(loaded.enteredAmount(), 'Fill opens the amount prompt');
    loaded.enteredAmount().execute(2);

    assert.equal(Scythe._test.wellCharges(loaded.entity), 200);
    assert.deepEqual([loaded.inventory.runes, loaded.inventory.vials], [50, 0]);
    assert.equal(loaded.varbits.get(Scythe._test.WELL_VARBIT), 2, 'the well varbit is its whole sets');
    assert.match(loaded.messages.at(-1), /You fill the well with 2 charges/);

    Scythe._test.checkWell({ player: loaded.entity });
    assert.match(loaded.messages.at(-1), /2 sets of 100 charges/);
});

test('Fill accepts noted vials of blood (Wiki)', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_), { runes: 200, notedVials: 1 });
    Scythe._test.fillWell({ player: loaded.entity });
    loaded.enteredAmount().execute(1);
    assert.equal(Scythe._test.wellCharges(loaded.entity), 100);
    assert.equal(loaded.inventory.getAmount(ItemIdentifiers.VIAL_OF_BLOOD_3), 0);
});

test('Fill refuses without a vial or a full set of runes (Wiki)', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_), { runes: 199, vials: 0 });
    assert.equal(Scythe._test.fillWell({ player: loaded.entity }), true);
    assert.match(loaded.messages.at(-1), /need at least 200 blood runes and 1 vial of blood/);
    assert.equal(Scythe._test.wellCharges(loaded.entity), 0);
});

test('Charge-at moves well charges into the scythe, capped by its 20,000 room (Wiki)', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_));
    loaded.entity.setAttribute(Scythe._test.WELL_ATTRIBUTE, 300);
    assert.equal(Scythe._test.chargeAtWell({ player: loaded.entity }), true);
    loaded.enteredAmount().execute(500);

    assert.equal(loaded.weapon.getId(), ItemIdentifiers.SCYTHE_OF_VITUR);
    assert.equal(Scythe._test.charges(loaded.weapon), 300, 'the well had 300');
    assert.equal(Scythe._test.wellCharges(loaded.entity), 0);
    assert.equal(loaded.varbits.get(Scythe._test.WELL_VARBIT), 0, 'an emptied well goes back to its empty form');

    const bare = chargePlayer({ getId: () => -1 });
    bare.entity.setAttribute(Scythe._test.WELL_ATTRIBUTE, 100);
    Scythe._test.chargeAtWell({ player: bare.entity });
    assert.match(bare.messages.at(-1), /nothing that can be charged here/);
});

test('Using a charged scythe on the well deposits whole sets and empties it (Wiki)', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR, 1235));
    const deposit = {
        player: loaded.entity,
        itemId: ItemIdentifiers.SCYTHE_OF_VITUR,
        item: loaded.weapon,
        objectId: 33085,
        handled: false,
    };
    assert.equal(Scythe._test.depositScythe(deposit), true);
    assert.equal(deposit.handled, true, 'generic item-on-object hooks mark the event themselves');

    assert.equal(loaded.weapon.getId(), ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_);
    assert.equal(Scythe._test.charges(loaded.weapon), 0, 'draining empties the scythe');
    assert.equal(Scythe._test.wellCharges(loaded.entity), 1200, '1,235 rounds down to 1,200');
    assert.match(loaded.messages.at(-1), /deposit 1,200 charges/);

    const uncharged = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_));
    Scythe._test.depositScythe({
        player: uncharged.entity,
        itemId: ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_,
        item: uncharged.weapon,
        objectId: 33085,
    });
    assert.match(uncharged.messages.at(-1), /not have enough charges to deposit/);
    assert.equal(Scythe._test.wellCharges(uncharged.entity), 0);
});

test('Empty returns whole sets as blood runes and noted vials of blood (Wiki)', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_));
    loaded.entity.setAttribute(Scythe._test.WELL_ATTRIBUTE, 250);
    assert.equal(Scythe._test.emptyWell({ player: loaded.entity }), true);

    assert.equal(Scythe._test.wellCharges(loaded.entity), 0);
    assert.equal(loaded.inventory.getAmount(ItemIdentifiers.BLOOD_RUNE), 400);
    assert.equal(loaded.inventory.getAmount(ItemIdentifiers.VIAL_OF_BLOOD_3), 2);
    assert.match(loaded.messages.at(-1), /You take 400 blood runes and 2 vials of blood out of the well/);
});

test('Empty refuses when both payouts would share the last free slot, and keeps the well', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_), { occupied: 27 });
    loaded.entity.setAttribute(Scythe._test.WELL_ATTRIBUTE, 100);
    assert.equal(Scythe._test.emptyWell({ player: loaded.entity }), true);

    assert.equal(Scythe._test.wellCharges(loaded.entity), 100, 'the well keeps its charges');
    assert.equal(loaded.inventory.getAmount(ItemIdentifiers.BLOOD_RUNE), 0);
    assert.equal(loaded.inventory.getAmount(ItemIdentifiers.VIAL_OF_BLOOD_3), 0);
    assert.match(loaded.messages.at(-1), /enough inventory space/);
    assert.doesNotMatch(loaded.messages.at(-1), /You take/);
});

test('Empty fits one payout into the last free slot when the other merges into a held stack', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_), { runes: 15, occupied: 26 });
    loaded.entity.setAttribute(Scythe._test.WELL_ATTRIBUTE, 250);
    assert.equal(Scythe._test.emptyWell({ player: loaded.entity }), true);

    assert.equal(Scythe._test.wellCharges(loaded.entity), 0);
    assert.equal(loaded.inventory.getAmount(ItemIdentifiers.BLOOD_RUNE), 415, 'the runes join the held stack');
    assert.equal(loaded.inventory.getAmount(ItemIdentifiers.VIAL_OF_BLOOD_3), 2, 'the noted vials take the free slot');
});

test('login restores the well varbit so the placed loc shows its filled form', () => {
    const loaded = chargePlayer(chargeableItem(ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_));
    loaded.entity.setAttribute(Scythe._test.WELL_ATTRIBUTE, 500);
    loginHook({ player: loaded.entity });
    assert.equal(loaded.varbits.get(Scythe._test.WELL_VARBIT), 5);
});
