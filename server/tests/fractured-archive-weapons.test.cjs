// Run after `yarn build`: node --test tests/fractured-archive-weapons.test.cjs
// The Ascension crossbows and the Obligator (The Fractured Archive rewards).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { Item } = require('../dist/game/model/Item');
const { MAX_STACK_AMOUNT } = require('../dist/game/model/container/StackType');
const { WeaponInterfaces } = require('../dist/game/content/combat/WeaponInterfaces');
const { Ammunition, RangedWeapon } = require('../dist/game/content/combat/ranged/RangedData');
const Crossbows = require('../plugins/items/AscensionCrossbows.plugin');
const Obligator = require('../plugins/items/Obligator.plugin');
const items = require('../data/definitions/item-gameplay.json');

class RangedCombatMethod {
    start() {}
}
class MeleeCombatMethod {
    start() {}
    hits() { return ['plain']; }
    attackSpeed() { return 5; }
}
const pendingHits = [];
class PendingHit {
    constructor(attacker, target, method, config) { this.config = config; pendingHits.push(this); }
    getTotalDamage() { return 0; }
}
class Animation { constructor(id) { this.id = id; } }
let resolvers = [];
const registered = {};
// Everything standing in the world, as the thrust sees it; tests fill it and clear it.
let world = [];
let secondaryAllowed = () => true;
let multiBetween = () => true;
const core = {
    World: { getNpcs: () => ({ forEach: (f) => world.filter((m) => m.isNpc?.()).forEach(f) }), getPlayers: () => ({ forEach: (f) => world.filter((m) => !m.isNpc?.()).forEach(f) }) },
    CombatFactory: { multiCombatBetween: () => multiBetween(), canAttackSecondaryTarget: (attacker, target, candidate) => secondaryAllowed(candidate) },
    Equipment, ItemIdentifiers, WeaponInterfaces, RangedCombatMethod, MeleeCombatMethod, PendingHit, Animation,
    Graphic: class { constructor(id) { this.id = id; } },
    Flag: { APPEARANCE: 1 },
    Item: class { constructor(id, amount) { this.id = id; this.amount = amount; } getId() { return this.id; } getAmount() { return this.amount; } getMeta() { return null; } },
};
for (const plugin of [Crossbows, Obligator]) {
    plugin.register({
        core,
        registerCombatMethodResolver: (r) => resolvers.push(r),
        onServerStartup: (handler) => handler(),
        onItemAction: (name, options) => { registered[name] = options; },
        onItemOnItem: () => {},
    });
}
const [crossbowResolver, obligatorResolver] = resolvers;

function weapon(id, meta = {}) {
    return { getId: () => id, setId(v) { id = v; }, getMetaValue: (k) => meta[k], setMetaValue: (k, v) => { meta[k] = v; } };
}
function player(worn, extra = {}) {
    const attributes = new Map();
    const messages = [];
    const stacks = extra.stacks ?? {};
    const entity = {
        isPlayer: () => true,
        getAsPlayer: () => entity,
        getEquipment: () => ({ get: () => worn, refreshItems() {} }),
        getInventory: () => ({
            getAmount: (id) => stacks[id] ?? 0,
            deleteNumber: (id, n) => { stacks[id] -= n; },
            // Charging takes by slot (PoweredStaff.takePlain); the slots follow getItems' order.
            deleteAtSlot: (slot, n) => { stacks[Object.keys(stacks)[slot]] -= n; },
            getItems: () => Object.entries(stacks).map(([id, amount]) => new core.Item(Number(id), amount)),
            getAddableAmount: (item) => item.getAmount(),
            addItem: (item) => { stacks[item.getId()] = (stacks[item.getId()] ?? 0) + item.getAmount(); },
            contains: (id) => (stacks[id] ?? 0) > 0,
            getFreeSlots: () => 28,
            refreshItems() {},
        }),
        getUpdateFlag: () => ({ flag() {} }),
        getFightType: () => extra.fightType,
        getAppearance: () => ({ isMale: () => extra.male !== false }),
        getAttribute: (k) => attributes.get(k),
        setAttribute: (k, v) => attributes.set(k, v),
        performAnimation: (a) => messages.push(['anim', a.id]),
        performGraphic: (g) => messages.push(['gfx', g.id]),
        sendMessage: (m) => messages.push(['msg', m]),
        messages,
        stacks,
    };
    return entity;
}
const npc = (size, defence = [0, 0, 0]) => ({
    isNpc: () => true,
    getAsNpc: () => ({ getSize: () => size, getDefenceBonus: (i) => defence[i] }),
});

const at = (x, y) => ({ getX: () => x, getY: () => y, getZ: () => 0, getDistance: (o) => Math.max(Math.abs(x - o.getX()), Math.abs(y - o.getY())) });
const placed = (x, y, size = 1, npcMob = true, defence = [0, 0, 0]) => ({
    isNpc: () => npcMob,
    getAsNpc: () => ({ getSize: () => size, getDefenceBonus: (i) => defence[i] }),
    getLocation: () => at(x, y),
});

test('ascension crossbows fire only ascension bolts, and nothing else fires them', () => {
    const crossbow = RangedWeapon.ASCENSION_CROSSBOWS;
    const ammo = crossbow.getAmmunitionData();
    assert.ok(ammo.includes(Ammunition.ASCENSION_BOLT) && ammo.includes(Ammunition.ONYX_ASCENSION_BOLT));
    assert.ok(!ammo.includes(Ammunition.RUNITE_BOLT) && !ammo.includes(Ammunition.DRAGON_BOLTS));
    assert.ok(!RangedWeapon.ZARYTE_CROSSBOW.getAmmunitionData().includes(Ammunition.ASCENSION_BOLT));
    assert.equal(crossbow.getType().getDefaultDistance(), 6);
    assert.equal(crossbow.getType().getLongRangeDistance(), 8);
    assert.deepEqual([Ammunition.ASCENSION_BOLT, Ammunition.ONYX_ASCENSION_BOLT, Ammunition.DIAMOND_ASCENSION_BOLT].map((a) => a.getProjectileId()), [4437, 4438, 4439]);
});

test('the crossbows alternate sides every shot and keep the side across targets', () => {
    const user = player(weapon(ItemIdentifiers.ASCENSION_CROSSBOWS));
    const method = crossbowResolver.resolve(user);
    assert.ok(method);
    assert.equal(crossbowResolver.resolve(player(weapon(ItemIdentifiers.ARMADYL_CROSSBOW))), null);
    const shots = [npc(1), npc(1), npc(1), npc(1)].map((target) => {
        user.messages.length = 0;
        method.start(user, target);
        return user.messages[0]?.[1];
    });
    // right, left (nothing replaces the profile's), right, left
    assert.deepEqual(shots, [15116, undefined, 15116, undefined]);
});

test('the obligator and the crossbows have their cache weapon types and stances', () => {
    const row = (id) => items.find((r) => r.id === id);
    assert.equal(row(ItemIdentifiers.OBLIGATOR).weaponInterface, 'EXTENDING_CHAINMACE');
    assert.equal(row(ItemIdentifiers.OBLIGATOR_UNCHARGED_).weaponInterface, 'EXTENDING_CHAINMACE');
    assert.equal(row(ItemIdentifiers.OBLIGATOR).standAnim, 15118);
    assert.equal(row(ItemIdentifiers.ASCENSION_CROSSBOWS).standAnim, 15110);
    const chain = WeaponInterfaces.EXTENDING_CHAINMACE;
    assert.equal(chain.getCategory(), 36);
    assert.deepEqual(chain.getFightType().map((f) => f.getAnimation()), [15123, 15123, 15122]);
});

test('thrust adds a roll for each melee defence above crush; sizes add 20% and 40%', () => {
    assert.equal(Obligator._test.rollCount(npc(1, [0, 0, 0])), 2);
    assert.equal(Obligator._test.rollCount(npc(1, [10, 0, 5])), 3);
    assert.equal(Obligator._test.rollCount(npc(1, [0, 10, 5])), 3);
    assert.equal(Obligator._test.rollCount(npc(1, [10, 10, 5])), 4, 'stab and slash each add a roll');
    assert.deepEqual([1, 2, 3, 5].map((s) => Obligator._test.sizeMultiplier(npc(s))), [1, 1.2, 1.4, 1.4]);
});

test('a charged thrust is one PendingHit that rolls best-of-N with the size bonus (so hooks and the HP cap run once), and spends a charge', () => {
    const thrust = WeaponInterfaces.EXTENDING_CHAINMACE.getFightType()[0];
    const smash = WeaponInterfaces.EXTENDING_CHAINMACE.getFightType()[2];
    const mace = weapon(ItemIdentifiers.OBLIGATOR, { [Obligator._test.CHARGES_META_KEY]: 2 });
    const user = player(mace, { fightType: thrust });
    const method = obligatorResolver.resolve(user);
    pendingHits.length = 0;
    const hits = method.hits(user, npc(3, [0, 5, 0])); // slash beats crush: three rolls
    assert.equal(pendingHits.length, 1, 'one hit goes through the pipeline, however many rolls');
    assert.deepEqual(hits, pendingHits);
    assert.deepEqual(pendingHits[0].config, { bestOf: 3, damageMultiplier: 1.4 }, 'the multiplier is applied inside the hit, before the cap');
    assert.equal(Obligator._test.charges(mace), 1);
    assert.equal(method.attackSpeed(user), 5);
    const flags = [];
    user.getUpdateFlag = () => ({ flag: () => flags.push('appearance') });
    method.hits(user, npc(1));
    assert.equal(mace.getId(), ItemIdentifiers.OBLIGATOR_UNCHARGED_, 'the last charge makes it uncharged');
    assert.equal(flags.length, 1, 'only the 1 to 0 swap refreshes the appearance');
    assert.deepEqual(method.hits(user, npc(1)), ['plain'], 'uncharged: no passive');

    const smashing = player(weapon(ItemIdentifiers.OBLIGATOR, { [Obligator._test.CHARGES_META_KEY]: 5 }), { fightType: smash });
    assert.deepEqual(method.hits(smashing, npc(3)), ['plain']);
    assert.equal(method.attackSpeed(smashing), 3);
});

test('a thrust reaches up to two more targets on or behind the main one, charged or not; a smash reaches none', () => {
    const thrust = WeaponInterfaces.EXTENDING_CHAINMACE.getFightType()[0];
    const smash = WeaponInterfaces.EXTENDING_CHAINMACE.getFightType()[2];
    const charged = weapon(ItemIdentifiers.OBLIGATOR, { [Obligator._test.CHARGES_META_KEY]: 5 });
    const user = player(charged, { fightType: thrust });
    user.getLocation = () => at(10, 10);
    const method = obligatorResolver.resolve(user);
    const main = placed(10, 12);
    const onTop = placed(10, 12);
    const behind1 = placed(10, 13), behind2 = placed(10, 14), behind3 = placed(10, 15);
    const beside = placed(11, 12), inFront = placed(10, 11), diagonal = placed(11, 13);
    world = [main, onTop, behind1, behind2, behind3, beside, inFront, diagonal, user];
    try {
        const reached = Obligator._test.reachedTargets(user, main);
        assert.deepEqual(reached, [onTop, behind1], 'the target tile first, then nearer tiles; two at most');
        world = [main, behind2, behind3, beside, inFront];
        assert.deepEqual(Obligator._test.reachedTargets(user, main), [behind2], 'two tiles behind is in reach, three is not, the sides and the front are not');
        // West-east and diagonal directions follow the attacker.
        const east = placed(14, 10);
        world = [east, placed(15, 10), placed(16, 10), placed(17, 10)];
        assert.equal(Obligator._test.reachedTargets(user, east).length, 2);
        const diag = placed(12, 12);
        world = [diag, placed(13, 13), placed(14, 14), placed(14, 13)];
        assert.deepEqual(Obligator._test.reachedTargets(user, diag).map((m) => m.getLocation().getX()), [13, 14]);
        // A large target covers its whole footprint: 3x3 at 10..12, the player south of it.
        const boss = placed(10, 12, 3);
        const behindBoss = placed(11, 15), farBehind = placed(11, 17), onBoss = placed(12, 14, 1);
        world = [boss, behindBoss, farBehind, onBoss];
        assert.deepEqual(Obligator._test.reachedTargets(user, boss), [onBoss, behindBoss].sort((a, b) => a.getLocation().getDistance(boss.getLocation()) - b.getLocation().getDistance(boss.getLocation())));
        // Secondary-target rules (multicombat, attackable) still decide who is hit.
        world = [main, behind1];
        secondaryAllowed = () => false;
        assert.deepEqual(Obligator._test.reachedTargets(user, main), []);
        secondaryAllowed = () => true;
        // The attacker and main target must both be in multicombat; behind targets alone are not enough.
        multiBetween = () => false;
        assert.deepEqual(Obligator._test.reachedTargets(user, main), []);
        multiBetween = () => true;

        world = [main, behind1, behind2];
        pendingHits.length = 0;
        const hits = method.hits(user, main);
        assert.equal(hits.length, 3, 'charged thrust: main target and two more');
        assert.ok(pendingHits.every((h) => h.config.bestOf === 2), 'each takes the passive rolls');
        assert.equal(Obligator._test.charges(charged), 4, 'one charge for the whole thrust');

        const bare = player(weapon(ItemIdentifiers.OBLIGATOR_UNCHARGED_), { fightType: thrust });
        bare.getLocation = () => at(10, 10);
        pendingHits.length = 0;
        const bareHits = obligatorResolver.resolve(bare).hits(bare, main);
        assert.equal(bareHits.length, 3, 'uncharged keeps the reach');
        assert.equal(bareHits[0], 'plain');
        assert.ok(pendingHits.every((h) => h.config === undefined), 'but not the rolls');

        const smashing = player(weapon(ItemIdentifiers.OBLIGATOR, { [Obligator._test.CHARGES_META_KEY]: 5 }), { fightType: smash });
        smashing.getLocation = () => at(10, 10);
        assert.deepEqual(obligatorResolver.resolve(smashing).hits(smashing, main), ['plain'], 'smash hits one target');
    } finally {
        world = [];
        secondaryAllowed = () => true;
        multiBetween = () => true;
    }
});

test('the boss defences in the monster data give the Wiki roll counts (Phosani 4, Graardor 2)', () => {
    const monsters = require('../data/definitions/monsters-complete.json');
    const list = Array.isArray(monsters) ? monsters : Object.values(monsters);
    const rolls = (name) => {
        const m = list.find((e) => e.name === name);
        return Obligator._test.rollCount(npc(m.size, [m.defence_stab, m.defence_slash, m.defence_crush]));
    };
    assert.equal(rolls("Phosani's Nightmare"), 4);
    assert.equal(rolls('General Graardor'), 2);
});

test('charging takes a shard, 60 nature and 60 death runes per 30 charges (Wiki, 11 Nov 2026); uncharging gives them back', () => {
    const { ASCENSION_SHARDS, NATURE_RUNE, DEATH_RUNE } = ItemIdentifiers;
    const mace = weapon(ItemIdentifiers.OBLIGATOR_UNCHARGED_);
    const user = player(mace, { stacks: { [ASCENSION_SHARDS]: 3, [NATURE_RUNE]: 300, [DEATH_RUNE]: 150 } });
    const event = { player: user, usedItem: mace, usedWithItem: {}, usedItemId: mace.getId(), usedWithItemId: ASCENSION_SHARDS };
    Obligator._test.chargeObligator(event);
    assert.equal(event.handled, true);
    assert.equal(Obligator._test.charges(mace), 60, 'death runes allow two batches');
    assert.equal(mace.getId(), ItemIdentifiers.OBLIGATOR, 'charging makes it the charged item');
    assert.deepEqual([user.stacks[ASCENSION_SHARDS], user.stacks[NATURE_RUNE], user.stacks[DEATH_RUNE]], [1, 180, 30]);
    Obligator._test.uncharge({ player: user, item: mace });
    assert.equal(Obligator._test.charges(mace), 0);
    assert.equal(mace.getId(), ItemIdentifiers.OBLIGATOR_UNCHARGED_);
    assert.deepEqual([user.stacks[ASCENSION_SHARDS], user.stacks[NATURE_RUNE], user.stacks[DEATH_RUNE]], [3, 300, 150]);
    assert.ok(registered.Obligator.Check && registered.Obligator.Uncharge && registered['Obligator (uncharged)'].Charge);
});

test('a real PendingHit keeps the best of N rolls, scales it before the hitpoints cap, and fires the hooks once', () => {
    const { PendingHit: RealHit } = require('../dist/game/content/combat/hit/PendingHit');
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const { CombatSpecial } = require('../dist/game/content/combat/CombatSpecial');
    const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
    const { HitMask } = require('../dist/game/content/combat/hit/HitMask');
    const { PluginManager } = require('../dist/plugins/PluginManager');
    const realGetHitDamage = CombatFactory.getHitDamage;
    const realRollHitDamage = CombatFactory.rollHitDamage;
    const realTraits = CombatSpecial.activeTraitsFor;
    const realRoll = PluginManager.emitCombatHitRoll;
    const realDamage = PluginManager.emitCombatHitDamage;
    const realTraitsRoll = RealHit.prototype.rollSpecialTraits;
    RealHit.prototype.rollSpecialTraits = () => ({ accurate: true });
    const rolls = [10, 30, 20];
    let hooks = 0;
    CombatFactory.getHitDamage = CombatFactory.rollHitDamage = () => new HitDamage(rolls.shift(), HitMask.RED);
    CombatSpecial.activeTraitsFor = () => null;
    PluginManager.emitCombatHitRoll = () => { hooks++; };
    PluginManager.emitCombatHitDamage = () => { hooks++; };
    const attacker = { isPlayer: () => true, isNpc: () => false, getAsPlayer: () => attacker };
    const target = (hp) => ({ isPlayer: () => false, isNpc: () => true, getHitpoints: () => hp });
    const method = { type: () => 0 };
    try {
        const kept = new RealHit(attacker, target(1000), method, { bestOf: 3, damageMultiplier: 1.4 });
        assert.equal(kept.getTotalDamage(), 42, 'best roll 30 x 1.4');
        assert.equal(hooks, 2, 'one roll hook and one damage hook, not three of each');
        rolls.push(30);
        const capped = new RealHit(attacker, target(35), method, { damageMultiplier: 1.4 });
        assert.equal(capped.getTotalDamage(), 35, 'the bonus cannot overkill the target');
    } finally {
        Object.assign(CombatFactory, { getHitDamage: realGetHitDamage, rollHitDamage: realRollHitDamage });
        CombatSpecial.activeTraitsFor = realTraits;
        PluginManager.emitCombatHitRoll = realRoll;
        PluginManager.emitCombatHitDamage = realDamage;
        RealHit.prototype.rollSpecialTraits = realTraitsRoll;
    }
});


test('real Obligator thrust applies incoming equipment reactions only to the selected roll', async () => {
    const { PluginManager } = require('../dist/plugins/PluginManager');
    const { Player } = require('../dist/game/entity/impl/player/Player');
    const api = PluginManager.createApi('ObligatorIncomingRegression');
    const c = api.core;
    await c.CachePipeline.initialize();
    require('../plugins/items/ItemDefinitionLoader.plugin').register(api);
    // Earlier unit cases cache a method built with doubles; load an independent real plugin instance.
    const pluginPath = require.resolve('../plugins/items/Obligator.plugin');
    const cached = require.cache[pluginPath];
    delete require.cache[pluginPath];
    const realObligator = require(pluginPath);
    require.cache[pluginPath] = cached;
    realObligator.register(api);
    PluginManager.emitServerStartup({});
    const rondache = require('../plugins/combat/effects/Rondache.EquipmentEffects');
    rondache(api);
    function realPlayer(name) {
        const p = new Player(null);
        p.setUsername(name);
        p.getSession = () => ({ sendClientPacket: () => true, write() {} });
        p.sendMessage = () => {};
        for (const skill of [c.Skill.HITPOINTS, c.Skill.ATTACK, c.Skill.STRENGTH, c.Skill.DEFENCE]) {
            p.getSkillManager().setMaxLevel(skill, 99);
            p.getSkillManager().setCurrentLevel(skill, 99, false);
        }
        return p;
    }
    const attacker = realPlayer('obligator-incoming'), victim = realPlayer('rondache-incoming');
    const mace = new c.Item(c.ItemIdentifiers.OBLIGATOR);
    mace.setMetaValue(Obligator._test.CHARGES_META_KEY, 10);
    attacker.getEquipment().set(c.Equipment.WEAPON_SLOT, mace);
    attacker.setFightType(c.WeaponInterfaces.EXTENDING_CHAINMACE.getFightType()[0]);
    victim.getEquipment().set(c.Equipment.SHIELD_SLOT, new c.Item(c.ItemIdentifiers.RONDACHE));
    victim.getSkillManager().setCurrentLevel(c.Skill.DEFENCE, 1, false);
    const method = c.CombatFactory.getMethod(attacker);
    let incomingCalls = 0;
    api.registerIncomingDamageModifier((entity) => { if (entity === victim) incomingCalls++; });
    const random = Math.random;
    Math.random = () => 0.8;
    try {
        const [hit] = method.hits(attacker, victim);
        assert.equal(hit.isAccurate(), true);
        assert.equal(hit.getTotalDamage(), 9, 'the roll is not mitigated until the hit lands');
        assert.equal(Obligator._test.charges(mace), 9, 'one weapon charge for the one thrust');
        assert.equal(rondache.charges(victim), 0, 'an in-flight hit has not charged the shield yet');
        assert.equal(incomingCalls, 0, 'defensive reactions wait for impact');
        c.CombatFactory.applyHitTimeDefences(hit);
        assert.equal(hit.getTotalDamage(), 7, 'Rondache takes its flat 2 when the hit lands');
        assert.equal(rondache.charges(victim), 2);
        assert.equal(incomingCalls, 1, 'the real incoming pipeline runs once');
        rondache.setCharges(victim, 0);
        const scaled = new c.PendingHit(attacker, victim, method, { bestOf: 3, damageMultiplier: 1.4, rollAccuracy: false });
        assert.equal(scaled.getTotalDamage(), 12, 'the roll is capped, then the per-hit multiplier applies');
        assert.equal(incomingCalls, 1);
        assert.equal(rondache.charges(victim), 0);
        c.CombatFactory.applyHitTimeDefences(scaled);
        assert.equal(scaled.getTotalDamage(), 10, 'Rondache then takes its flat 2 at impact');
        assert.equal(rondache.charges(victim), 2);
        assert.equal(incomingCalls, 2);
        rondache.setCharges(victim, 0);
        victim.getSkillManager().setCurrentLevel(c.Skill.HITPOINTS, 5, false);
        const capped = new c.PendingHit(attacker, victim, method, { bestOf: 3, damageMultiplier: 1.4, rollAccuracy: false });
        assert.equal(capped.getTotalDamage(), 5, 'the roll is capped to HP before and after the multiplier');
        assert.equal(incomingCalls, 2);
        c.CombatFactory.applyHitTimeDefences(capped);
        assert.equal(capped.getTotalDamage(), 3);
        assert.equal(rondache.charges(victim), 2);
        assert.equal(incomingCalls, 3);
        const rollAccuracy = c.AccuracyFormulasDpsCalc.rollAccuracy;
        c.AccuracyFormulasDpsCalc.rollAccuracy = () => false;
        try {
            const miss = new c.PendingHit(attacker, victim, method, { bestOf: 3 });
            assert.equal(miss.isAccurate(), false);
            assert.equal(miss.getTotalDamage(), 0);
            c.CombatFactory.applyHitTimeDefences(miss);
            assert.equal(incomingCalls, 3, 'a miss does not react');
            assert.equal(rondache.charges(victim), 2);
        } finally { c.AccuracyFormulasDpsCalc.rollAccuracy = rollAccuracy; }
        victim.getEquipment().set(c.Equipment.SHIELD_SLOT, new c.Item(c.ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD));
        let graphics = 0;
        victim.performGraphic = () => { graphics++; };
        Math.random = () => 0.5;
        const elysian = new c.PendingHit(attacker, victim, method, { bestOf: 4, rollAccuracy: false });
        assert.equal(graphics, 0, 'Elysian waits for impact');
        c.CombatFactory.applyHitTimeDefences(elysian);
        assert.equal(graphics, 1, 'Elysian reacts to the winner once, not each candidate');
        assert.equal(incomingCalls, 4);
    } finally { Math.random = random; }
});

test("real cache-backed inventory refuses capped refunds and accepts exact headroom", async () => {
    const path = require('node:path');
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    const { PluginManager } = require('../dist/plugins/PluginManager');
    const { Player } = require('../dist/game/entity/impl/player/Player');
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    const api = PluginManager.createApi('ObligatorRefundCapacityTest');
    require('../plugins/items/ItemDefinitionLoader.plugin').register(api);
    Obligator.register(api);
    Obligator._test.initializeIds();

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
        const mace = new Item(ItemIdentifiers.OBLIGATOR, 1);
        mace.setMetaValue(Obligator._test.CHARGES_META_KEY, 30);
        inv.setItem(0, mace);
        const refunds = [
            [ItemIdentifiers.ASCENSION_SHARDS, 1],
            [ItemIdentifiers.NATURE_RUNE, 60],
            [ItemIdentifiers.DEATH_RUNE, 60],
        ];
        refunds.forEach(([id, amount], index) => inv.setItem(index + 1,
            new Item(id, headroom ? MAX_STACK_AMOUNT - amount : MAX_STACK_AMOUNT)));
        for (let slot = 4; slot < 28; slot++) inv.setItem(slot, new Item(ItemIdentifiers.COINS, 1));
        return { inv, mace, refunds };
    }
    const blocked = actualPlayer('obligator-capped-refund');
    const capped = fill(blocked, false);
    const before = JSON.stringify(capped.inv.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]));
    Obligator._test.uncharge({ player: blocked, item: capped.mace });
    assert.equal(Obligator._test.charges(capped.mace), 30);
    assert.equal(capped.mace.getId(), ItemIdentifiers.OBLIGATOR);
    assert.equal(JSON.stringify(capped.inv.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()])), before);

    const available = actualPlayer('obligator-exact-refund-headroom');
    const exact = fill(available, true);
    assert.equal(exact.inv.getFreeSlots(), 0);
    Obligator._test.uncharge({ player: available, item: exact.mace });
    assert.equal(Obligator._test.charges(exact.mace), 0);
    for (const [id] of exact.refunds) assert.equal(exact.inv.getAmount(id), MAX_STACK_AMOUNT);
});
