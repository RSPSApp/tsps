// Run after `yarn build`: node --test tests/sanguinesti-staff.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { Item } = require('../dist/game/model/Item');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { FightType } = require('../dist/game/content/combat/FightType');

const Sanguinesti = require('../plugins/items/SanguinestiStaff.plugin');

const {
    CHARGES_META_KEY,
    HEAL_CHANCE,
    LIFE_LEECH_DAMAGE,
    MAX_CHARGES,
    BLOOD_RUNES_PER_CHARGE,
} = Sanguinesti._test;

const resolvers = [];
const itemActions = new Map();
const hitResolved = [];
Sanguinesti.register({
    core: PluginManager.getCoreApi(),
    registerCombatMethodResolver: (resolver) => resolvers.push(resolver),
    onItemAction: (name, actions) => itemActions.set(name, actions),
    onItemOnItem: () => {},
    onCombatHitResolved: (handler) => hitResolved.push(handler),
});

const NPC = { isPlayer: () => false };

function playerWithStaff({ staffId = I.SANGUINESTI_STAFF, charges = 0, magic = 99 } = {}) {
    const staff = new Item(staffId, 1);
    if (charges > 0) staff.setMetaValue(CHARGES_META_KEY, charges);
    const equipment = new Array(14).fill(null);
    equipment[Equipment.WEAPON_SLOT] = staff;
    let castSpell = null;
    let reset = false;
    let healed = 0;
    const messages = [];
    const player = {
        isPlayer: () => true,
        getAsPlayer: () => player,
        getEquipment: () => ({ getItems: () => equipment, refreshItems: () => {} }),
        getSkillManager: () => ({ getCurrentLevel: () => magic }),
        getCombat: () => ({ setCastSpell: (spell) => { castSpell = spell; }, reset: () => { reset = true; } }),
        getUpdateFlag: () => ({ flag: () => {} }),
        heal: (amount) => { healed += amount; },
        sendMessage: (message) => messages.push(message),
    };
    return {
        player, staff, messages,
        get castSpell() { return castSpell; },
        get reset() { return reset; },
        get healed() { return healed; },
    };
}

function chargeInventory({ runes = 0, freeSlots = 28 } = {}) {
    const inventory = {
        runes,
        added: [],
        getAmount: (id) => (id === I.BLOOD_RUNE ? inventory.runes : 0),
        deleteNumber: (id, amount = 1) => { if (id === I.BLOOD_RUNE) inventory.runes -= amount; },
        refreshItems: () => {},
        contains: (id) => id === I.BLOOD_RUNE && inventory.runes > 0,
        getFreeSlots: () => freeSlots,
        addItem: (item) => inventory.added.push(item),
    };
    return inventory;
}

function chargingPlayer(inventory) {
    const messages = [];
    return { getInventory: () => inventory, sendMessage: (message) => messages.push(message), messages };
}

test('the built-in spell is floor(Magic / 3), never below 6, at 4 ticks (Wiki)', () => {
    assert.equal(HEAL_CHANCE, 1 / 5, 'the Wiki passive is 1/5, not the beta 1/6');
    assert.equal(LIFE_LEECH_DAMAGE, 8);
    assert.equal(MAX_CHARGES, 20000);
    assert.equal(BLOOD_RUNES_PER_CHARGE, 2);

    const built = playerWithStaff({ charges: 5, magic: 99 });
    const method = resolvers[0].resolve(built.player);
    assert.ok(method, "the staff attacks with its own method, not a staff melee");
    assert.equal(method.attackSpeed(built.player), 4);
    assert.equal(method.attackDistance(built.player), 7);
    built.player.getFightType = () => FightType.POWERED_STAFF_LONGRANGE;
    assert.equal(method.attackDistance(built.player), 9, 'Longrange reaches 2 tiles further');

    assert.equal(method.canAttack(built.player, NPC), true);
    assert.equal(built.castSpell.maximumHit(), 33, '99 Magic');
    assert.equal(Sanguinesti._test.baseMaxHit(playerWithStaff({ magic: 82 }).player), 27);
    assert.equal(Sanguinesti._test.baseMaxHit(playerWithStaff({ magic: 0 }).player), 6, 'the floor is 6');
});

test('every cast spends a charge; the last one reverts the staff and it then refuses to cast', () => {
    const built = playerWithStaff({ charges: 2 });
    const method = resolvers[0].resolve(built.player);
    assert.equal(method.canAttack(built.player, NPC), true);
    assert.equal(Sanguinesti._test.chargesOf(built.staff), 1);
    assert.equal(method.canAttack(built.player, NPC), true);
    assert.equal(Sanguinesti._test.chargesOf(built.staff), 0);
    assert.equal(built.staff.getId(), I.SANGUINESTI_STAFF_UNCHARGED_, 'the last charge leaves it uncharged');
    assert.equal(method.canAttack(built.player, NPC), false);
    assert.match(built.messages.at(-1), /no charges/);
    assert.equal(built.reset, true);
});

test('an uncharged staff still resolves, but cannot cast', () => {
    const built = playerWithStaff({ staffId: I.SANGUINESTI_STAFF_UNCHARGED_ });
    const method = resolvers[0].resolve(built.player);
    assert.ok(method, 'uncharged must resolve so the refusal message is shown');
    assert.equal(method.canAttack(built.player, NPC), false);
    assert.match(built.messages.at(-1), /no charges/);
});

test('a successful hit has a 1/5 chance to deal 8 more and heal half the damage dealt (Wiki)', () => {
    const built = playerWithStaff();
    const hit = {
        damage: 10,
        isAccurate: () => true,
        getTotalDamage() { return this.damage; },
        setTotalDamage(value) { this.damage = value; },
    };
    const original = Math.random;
    try {
        Math.random = () => 0.99;
        assert.equal(Sanguinesti._test.applyLifeLeech(hit), false, 'outside the roll');
        assert.equal(hit.damage, 10);

        Math.random = () => 0.1;
        assert.equal(Sanguinesti._test.applyLifeLeech(hit), true);
        assert.equal(hit.damage, 18, '10 + 8 additional damage');
        hitResolved[0]({ attacker: built.player, hit });
        assert.equal(built.healed, 9, 'half of the 18 dealt');
        hitResolved[0]({ attacker: built.player, hit });
        assert.equal(built.healed, 9, 'each hit heals once');
    } finally {
        Math.random = original;
    }
});

test('the life leech never procs on a splash', () => {
    const built = playerWithStaff();
    const hit = {
        damage: 10,
        isAccurate: () => false,
        getTotalDamage() { return this.damage; },
        setTotalDamage(value) { this.damage = value; },
    };
    const original = Math.random;
    try {
        Math.random = () => 0;
        assert.equal(Sanguinesti._test.applyLifeLeech(hit), false);
        assert.equal(hit.damage, 10);
    } finally {
        Math.random = original;
    }
});

test('two blood runes a charge up to 20,000; checking and uncharging return every rune (Wiki)', () => {
    const staff = new Item(I.SANGUINESTI_STAFF_UNCHARGED_, 1);
    const inventory = chargeInventory({ runes: 5 });
    Sanguinesti._test.chargeStaff({
        player: chargingPlayer(inventory),
        usedItem: staff,
        usedWithItem: new Item(I.BLOOD_RUNE, 5),
        usedItemId: I.SANGUINESTI_STAFF_UNCHARGED_,
        usedWithItemId: I.BLOOD_RUNE,
    });
    assert.equal(staff.getId(), I.SANGUINESTI_STAFF);
    assert.equal(Sanguinesti._test.chargesOf(staff), 2);
    assert.equal(inventory.runes, 1, 'two runes a charge');

    const full = new Item(I.SANGUINESTI_STAFF, 1);
    full.setMetaValue(CHARGES_META_KEY, MAX_CHARGES - 1);
    const fullInventory = chargeInventory({ runes: 10 });
    const fullPlayer = chargingPlayer(fullInventory);
    Sanguinesti._test.chargeStaff({
        player: fullPlayer,
        usedItem: full,
        usedWithItem: new Item(I.BLOOD_RUNE, 10),
        usedItemId: I.SANGUINESTI_STAFF,
        usedWithItemId: I.BLOOD_RUNE,
    });
    assert.equal(Sanguinesti._test.chargesOf(full), MAX_CHARGES);
    assert.equal(fullInventory.runes, 8, 'only one charge of room');

    Sanguinesti._test.checkCharges({ player: fullPlayer, item: full });
    assert.match(fullPlayer.messages.at(-1), /20,000 charges left/);

    const unchargeInventory = chargeInventory({ runes: 0, freeSlots: 5 });
    const unchargePlayer = chargingPlayer(unchargeInventory);
    Sanguinesti._test.uncharge({ player: unchargePlayer, item: full });
    assert.equal(full.getId(), I.SANGUINESTI_STAFF_UNCHARGED_);
    assert.equal(Sanguinesti._test.chargesOf(full), 0);
    assert.equal(unchargeInventory.added.length, 1);
    assert.equal(unchargeInventory.added[0].getId(), I.BLOOD_RUNE);
    assert.equal(unchargeInventory.added[0].getAmount(), MAX_CHARGES * BLOOD_RUNES_PER_CHARGE);
});

test('magic lands 1 + (1 + distance) / 3 ticks after the cast, edge to edge; barrages to the south-west tile (Wiki: Hit delay)', () => {
    const { MagicCombatMethod } = require('../dist/game/content/combat/method/impl/MagicCombatMethod');
    const { Location } = require('../dist/game/model/Location');
    const caster = (x, y) => ({ isPlayer: () => true, getLocation: () => new Location(x, y, 0) });
    const npc = (x, y, size = 1) => ({ getLocation: () => new Location(x, y, 0), getSize: () => size });
    const delay = (from, to, spell) => MagicCombatMethod.hitDelay(from, to, spell);
    // The Wiki's table: 1 tile 1 tick, 2-4 tiles 2, 5-7 3, 8-10 4.
    assert.deepEqual([1, 2, 4, 5, 7, 8, 10].map((d) => delay(caster(3200 + d, 3200), npc(3200, 3200))), [1, 2, 2, 3, 3, 4, 4]);
    // A 5x5 NPC on (3200, 3200) seen from the east, 3 tiles past its edge: 2 ticks, not 3.
    assert.equal(delay(caster(3207, 3200), npc(3200, 3200, 5)), 2);
    const barrage = { spellRadius: () => 1, levelRequired: () => 94 };
    assert.equal(delay(caster(3207, 3200), npc(3200, 3200, 5), barrage), 3, 'a barrage measures to the south-west tile (7)');
    const burst = { spellRadius: () => 1, levelRequired: () => 70 };
    assert.equal(delay(caster(3207, 3200), npc(3200, 3200, 5), burst), 2, 'a burst measures edge to edge');
    assert.equal(delay(caster(3209, 3200), npc(3200, 3200), { hitDelay: () => 1 }), 1, 'a spell with its own delay keeps it');
    const npcCaster = { isPlayer: () => false, getLocation: () => new Location(3201, 3200, 0) };
    assert.equal(delay(npcCaster, npc(3200, 3200)), 3, 'NPC casters keep their fixed delay');
});
