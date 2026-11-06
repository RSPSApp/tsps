// Run after `yarn build`: node --test tests/zoryas-tome.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { Item } = require('../dist/game/model/Item');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { MAX_STACK_AMOUNT } = require('../dist/game/model/container/StackType');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');

const Zorya = require('../plugins/items/ZoryasTome.plugin');
const { CHARGES_META_KEY, MAX_CHARGES, buffs, onMaxHit, onAttackRoll, onHitResolved } = Zorya._test;

const resolvers = [];
const itemActions = new Map();
const specials = [];
const core = PluginManager.getCoreApi();
Zorya.register({
    core,
    registerCombatMethodResolver: (resolver) => resolvers.push(resolver),
    registerCombatSpecial: (definition) => specials.push(definition),
    onItemAction: (name, actions) => itemActions.set(name, actions),
    onItemOnItem: () => {},
    onCombatHitResolved: () => {},
    onCustomEvent: () => {},
});

const NPC = { isPlayer: () => false, getLocation: () => ({ getX: () => 1, getY: () => 0 }), getSize: () => 1 };

function playerWithTome({ id = I.ZORYAS_TOME, charges = 0, special = 0 } = {}) {
    const tome = new Item(id, 1);
    if (charges > 0) tome.setMetaValue(CHARGES_META_KEY, charges);
    const equipment = new Array(14).fill(null);
    equipment[Equipment.WEAPON_SLOT] = tome;
    let castSpell = null;
    const messages = [];
    const player = {
        isPlayer: () => true,
        getAsPlayer: () => player,
        getLocation: () => ({ getX: () => 0, getY: () => 0 }),
        getEquipment: () => ({ getItems: () => equipment, refreshItems: () => {} }),
        getCombat: () => ({ setCastSpell: (spell) => { castSpell = spell; }, reset: () => {} }),
        getUpdateFlag: () => ({ flag: () => {} }),
        isSpecialActivated: () => special > 0,
        getSpecialPercentage: () => special,
        sendMessage: (message) => messages.push(message),
    };
    return { player, tome, messages, get castSpell() { return castSpell; } };
}

function inventory({ astral = 0, nature = 0 } = {}) {
    const inv = {
        astral, nature, added: [],
        getAmount: (id) => (id === I.ASTRAL_RUNE ? inv.astral : id === I.NATURE_RUNE ? inv.nature : 0),
        // The rune stacks first, then what was refunded; charging takes runes by slot (PoweredStaff.takePlain).
        getItems: () => [
            ...(inv.astral > 0 ? [new Item(I.ASTRAL_RUNE, inv.astral)] : []),
            ...(inv.nature > 0 ? [new Item(I.NATURE_RUNE, inv.nature)] : []),
            ...inv.added,
        ],
        getAddableAmount: (item) => item.getAmount(),
        deleteNumber: (id, n) => { if (id === I.ASTRAL_RUNE) inv.astral -= n; else inv.nature -= n; },
        deleteAtSlot: (slot, n) => inv.deleteNumber(inv.getItems()[slot].getId(), n),
        refreshItems: () => {}, contains: () => true, getFreeSlots: () => 28,
        addItem: (item) => inv.added.push(item),
    };
    return inv;
}

test('charging spends 3 astral and 2 nature a charge, uncharging returns them, and the tome swaps ids', () => {
    const tome = new Item(I.ZORYAS_TOME_UNCHARGED_, 1);
    const inv = inventory({ astral: 10, nature: 10 });
    const messages = [];
    const player = { getInventory: () => inv, sendMessage: (m) => messages.push(m) };
    const event = { player, usedItem: tome, usedWithItem: new Item(I.ASTRAL_RUNE, 10), usedItemId: tome.getId(), usedWithItemId: I.ASTRAL_RUNE };
    Zorya._test.chargeTome(event);
    assert.equal(Zorya._test.chargesOf(tome), 3, 'min(10/3, 10/2)');
    assert.equal(tome.getId(), I.ZORYAS_TOME);
    assert.deepEqual([inv.astral, inv.nature], [1, 4]);
    assert.equal(MAX_CHARGES, 20000);

    Zorya._test.checkCharges({ player, item: tome });
    assert.match(messages.at(-1), /3 charges/);
    Zorya._test.uncharge({ player, item: tome });
    assert.deepEqual(inv.added.map((i) => [i.getId(), i.getAmount()]), [[I.ASTRAL_RUNE, 9], [I.NATURE_RUNE, 6]]);
    assert.equal(tome.getId(), I.ZORYAS_TOME_UNCHARGED_);
});

test("each delayed tome hit retains its cast spell and impact graphic", () => {
    const PendingHit = core.PendingHit;
    const originalPrepareHits = PendingHit.prototype.prepareHits;
    const originalDrain = core.CombatSpecial.drain;
    PendingHit.prototype.prepareHits = () => [];
    core.CombatSpecial.drain = () => {};
    try {
        const built = playerWithTome({ charges: 5 });
        const method = resolvers[0].resolve(built.player);
        method.canAttack(built.player, NPC);
        const normalHit = method.hits(built.player, NPC)[0];
        const normalSpell = built.castSpell;
        assert.equal(normalHit.getSpell(), normalSpell);
        assert.equal(normalSpell.endGraphic().id, 4429);

        built.player.isSpecialActivated = () => true;
        built.player.getSpecialPercentage = () => 100;
        method.canAttack(built.player, NPC);
        const specialHit = method.hits(built.player, NPC)[0];
        const specialSpell = built.castSpell;
        assert.equal(specialHit.getSpell(), specialSpell);
        assert.notEqual(specialSpell, normalSpell, "the second cast has its own spell state");
        assert.equal(normalHit.getSpell().endGraphic().id, 4429, "a later special cast cannot rewrite the earlier impact");
        assert.equal(specialHit.getSpell().endGraphic().id, 4430);
    } finally {
        PendingHit.prototype.prepareHits = originalPrepareHits;
        core.CombatSpecial.drain = originalDrain;
    }
});

test('every cast spends a charge, base max hit is 18 at 3 ticks, and the last charge degrades it', () => {
    const built = playerWithTome({ charges: 1 });
    const method = resolvers[0].resolve(built.player);
    assert.equal(method.attackSpeed(built.player), 3);
    assert.equal(method.attackDistance(built.player), 7);
    assert.equal(method.canAttack(built.player, NPC), true);
    assert.equal(built.castSpell.maximumHit(), 18);
    assert.equal(built.tome.getId(), I.ZORYAS_TOME_UNCHARGED_);
    assert.equal(method.canAttack(built.player, NPC), false);
    assert.match(built.messages.at(-1), /no charges/);
    assert.equal(specials[0].drainAmount, 50);
});

test("Zorya's flow: the special buffs accuracy and damage, a landed hit buffs the next three attacks at 2 ticks", (t) => {
    const built = playerWithTome({ charges: 10, special: 100 });
    const drained = [];
    t.mock.method(core.CombatSpecial, 'drain', (_, amount) => drained.push(amount));
    const method = resolvers[0].resolve(built.player);
    assert.equal(method.canAttack(built.player, NPC), true);
    assert.deepEqual(drained, [50]);
    const request = () => ({ attacker: built.player, spell: built.castSpell, maxHit: 20, attackRoll: 1000 });
    const r = request(); onMaxHit(r); onAttackRoll(r);
    assert.deepEqual([r.maxHit, r.attackRoll], [32, 2500], '+60% damage, +150% accuracy');
    assert.equal(method.attackSpeed(built.player), 3, 'the special itself is a normal-speed cast');

    const hit = { isAccurate: () => true };
    Zorya._test.specialHits.add(hit);
    onHitResolved({ attacker: built.player, hit });
    assert.equal(Zorya._test.buffAttacks(built.player), 3);

    built.player.isSpecialActivated = () => false;
    assert.equal(method.canAttack(built.player, NPC), true);
    assert.equal(method.attackSpeed(built.player), 2, 'buffed attacks come every 2 ticks');
    assert.equal(Zorya._test.buffAttacks(built.player), 2);
    const buffed = request(); onMaxHit(buffed);
    assert.equal(buffed.maxHit, 32);

    buffs.get(built.player).expires = Date.now() - 1;
    method.canAttack(built.player, NPC);
    const plain = request(); onMaxHit(plain);
    assert.equal(plain.maxHit, 20, 'the buff ends after 30 seconds');
});


test("real cache-backed inventory refuses capped refunds and accepts exact headroom", async () => {
    const path = require('node:path');
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    const { Player } = require('../dist/game/entity/impl/player/Player');
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    require('../plugins/items/ItemDefinitionLoader.plugin').register(PluginManager.createApi('ZoryaRefundCapacityTest'));

    function actualPlayer(name) {
        const player = new Player(null);
        player.setUsername(name);
        player.setSession?.({ sendClientPacket: () => true, write() {} });
        player.getSession = () => ({ sendClientPacket: () => true, write() {} });
        player.sendMessage = () => {};
        player.getInventory().refreshItems = () => player.getInventory();
        player.getEquipment().refreshItems = () => player.getEquipment();
        return player;
    }
    function fill(player, headroom) {
        const inv = player.getInventory();
        const tome = new Item(I.ZORYAS_TOME, 1);
        tome.setMetaValue(CHARGES_META_KEY, 1);
        inv.setItem(0, tome);
        const astral = new Item(I.ASTRAL_RUNE, headroom ? MAX_STACK_AMOUNT - 3 : MAX_STACK_AMOUNT);
        const nature = new Item(I.NATURE_RUNE, headroom ? MAX_STACK_AMOUNT - 2 : MAX_STACK_AMOUNT);
        inv.setItem(1, astral);
        inv.setItem(2, nature);
        for (let slot = 3; slot < 28; slot++) inv.setItem(slot, new Item(I.COINS, 1));
        return { inv, tome };
    }
    const blocked = actualPlayer('zorya-capped-refund');
    const capped = fill(blocked, false);
    const before = JSON.stringify(capped.inv.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]));
    Zorya._test.uncharge({ player: blocked, item: capped.tome });
    assert.equal(Zorya._test.chargesOf(capped.tome), 1);
    assert.equal(capped.tome.getId(), I.ZORYAS_TOME);
    assert.equal(JSON.stringify(capped.inv.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()])), before);

    const available = actualPlayer('zorya-exact-refund-headroom');
    const exact = fill(available, true);
    assert.equal(exact.inv.getFreeSlots(), 0);
    Zorya._test.uncharge({ player: available, item: exact.tome });
    assert.equal(Zorya._test.chargesOf(exact.tome), 0);
    assert.equal(exact.inv.getAmount(I.ASTRAL_RUNE), MAX_STACK_AMOUNT);
    assert.equal(exact.inv.getAmount(I.NATURE_RUNE), MAX_STACK_AMOUNT);
});
