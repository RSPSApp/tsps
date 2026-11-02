// Run after `yarn build`: node --test tests/ranged-ammunition.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Ammunition, RangedWeapon } = require('../dist/game/content/combat/ranged/RangedData');
const { ItemIdentifiers: Items } = require('../dist/util/ItemIdentifiers');

test('dragon bolts, plain and gem-tipped, are ammunition for the dragon-tier crossbows only', () => {
  const dragonBolts = [Items.DRAGON_BOLTS_2, Items.RUBY_DRAGON_BOLTS_E_, Items.RUBY_DRAGON_BOLTS, Items.ONYX_DRAGON_BOLTS_E_, Items.OPAL_DRAGON_BOLTS];
  for (const id of dragonBolts) {
    const ammunition = Ammunition.getForItem(id);
    assert.ok(ammunition, `${id} is ammunition`);
    assert.equal(ammunition.getStrength(), 122, 'ranged strength +122 (Wiki)');
    for (const crossbow of [RangedWeapon.ARMADYL_CROSSBOW, RangedWeapon.DRAGON_CROSSBOW, RangedWeapon.ZARYTE_CROSSBOW]) {
      assert.ok(crossbow.getAmmunitionData().includes(ammunition));
    }
    assert.ok(!RangedWeapon.RUNE_CROSSBOW.getAmmunitionData().includes(ammunition), 'not below a dragon crossbow');
  }
});

test('dragon hunter crossbow variants resolve to the dragon crossbow ranged profile', () => {
  const variants = [
    Items.DRAGON_HUNTER_CROSSBOW, Items.DRAGON_HUNTER_CROSSBOW_2, Items.DRAGON_HUNTER_CROSSBOW_3,
    Items.DRAGON_HUNTER_CROSSBOW_T_, Items.DRAGON_HUNTER_CROSSBOW_T__2,
    Items.DRAGON_HUNTER_CROSSBOW_B_, Items.DRAGON_HUNTER_CROSSBOW_B__2,
  ];
  for (const id of variants) {
    const player = { getEquipment: () => ({ getItems: () => Array.from({ length: 14 }, (_, slot) => ({
      getId: () => slot === 3 ? id : slot === 13 ? Items.DRAGONSTONE_BOLTS_E_ : -1,
    })) }) };
    assert.equal(RangedWeapon.getFor(player), RangedWeapon.DRAGON_CROSSBOW, `weapon ${id}`);
    assert.equal(Ammunition.getFor(player), Ammunition.ENCHANTED_DRAGON_BOLT, `ammo ${id}`);
  }
});

test('Blisterwood stakes resolve as stackable self-ammunition with their captured range and projectile', () => {
  const { WeaponProfiles } = require('../dist/game/content/combat/WeaponProfile');
  const { WeaponInterfaces } = require('../dist/game/content/combat/WeaponInterfaces');
  const { FightType } = require('../dist/game/content/combat/FightType');
  const items = Array.from({ length: 14 }, () => ({ getId: () => -1 }));
  const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
  items[3] = { getId: () => Items.BLISTERWOOD_STAKE, getDefinition: () => ItemDefinition.forId(Items.BLISTERWOOD_STAKE) };
  const player = {
    getEquipment: () => ({ getItems: () => items }),
    getWeapon: () => WeaponInterfaces.DART,
    getFightType: () => FightType.DART_LONGRANGE,
  };
  assert.equal(RangedWeapon.getFor(player), RangedWeapon.BLISTERWOOD_STAKE);
  assert.equal(Ammunition.getFor(player), Ammunition.BLISTERWOOD_STAKE);
  assert.equal(RangedWeapon.getSelfAmmo(Items.BLISTERWOOD_STAKE), Ammunition.BLISTERWOOD_STAKE);
  assert.equal(Ammunition.BLISTERWOOD_STAKE.getStrength(), 14);
  assert.equal(Ammunition.BLISTERWOOD_STAKE.getProjectileId(), 3987);
  assert.equal(WeaponProfiles.attackDistance(player, 6), 8, 'longrange extends the stake to 8 tiles');
  assert.equal(WeaponProfiles.get(player).npcAttackAnimation, 7617);
});

test('a shot refreshes the native equipment counter immediately, including the final arrow', () => {
  const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
  const { Equipment } = require('../dist/game/model/container/impl/Equipment');
  const { Item } = require('../dist/game/model/Item');
  let ammo = new Item(Items.BRONZE_ARROW, 2);
  const amounts = [];
  const equipment = {
    get: slot => slot === Equipment.AMMUNITION_SLOT ? ammo : new Item(-1, 0),
    set: (slot, item) => { assert.equal(slot, Equipment.AMMUNITION_SLOT); ammo = item; },
    refreshItems: () => amounts.push(ammo.getAmount()),
  };
  const p = { getEquipment: () => equipment, sendMessage() {},
    getCombat: () => ({ getRangedWeapon: () => RangedWeapon.SHORTBOW, getAmmunition: () => Ammunition.BRONZE_ARROW }) };
  CombatFactory.decrementAmmo(p, null, 1);
  assert.equal(ammo.getAmount(), 1); assert.deepEqual(amounts, [1]);
  CombatFactory.decrementAmmo(p, null, 1);
  assert.equal(ammo.getId(), -1); assert.equal(amounts.length, 2);
});

// --- OSRS floor drops and Ava's devices (Wiki: Ava's device).

const { CombatFactory: Factory } = require('../dist/game/content/combat/CombatFactory');
const { Equipment: Slots } = require('../dist/game/model/container/impl/Equipment');
const { Item: GroundItem } = require('../dist/game/model/Item');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { PluginManager } = require('../dist/plugins/PluginManager');

// The real Ava's plugin, with core standing in for the plugin API. It resolves the
// interfering torsos by cache gameval, so the cache comes up first.
require('../dist/game/cache/CachePipeline').CachePipeline.initialize();
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
let avaRecovery = null;
require('../plugins/items/AvasAccumulator.plugin').register({
  core: { Equipment: Slots, ItemIdentifiers: Items, CacheDefinitions },
  registerRangedAmmoRecovery(resolver) { avaRecovery = resolver; },
  // The Skillcapes plugin answers this; a worn Ranging cape recovers as an accumulator.
  emitCustomEvent(name, request) {
    if (name === 'skillcape:ammo-recovery' && request.player.getEquipment().get(Slots.CAPE_SLOT).getId() === Items.RANGING_CAPE) {
      request.recovery = 72;
    }
  },
});
PluginManager.rangedAmmoRecovery = (player) => avaRecovery.recovery(player) ?? 0;

const drops = [];
ItemOnGroundManager.registerLocation = (player, item, position) => drops.push({ id: item.getId(), amount: item.getAmount(), position });

const POS = { x: 3000, y: 3000, z: 0 };

function ammoHarness({ itemId = Items.BRONZE_ARROW, amount = 5, capeId = -1, bodyId = -1, rangedWeapon = RangedWeapon.SHORTBOW } = {}) {
  let ammo = new GroundItem(itemId, amount);
  const equipment = {
    get: (slot) => slot === Slots.AMMUNITION_SLOT ? ammo
      : slot === Slots.CAPE_SLOT ? new GroundItem(capeId, 1)
      : slot === Slots.BODY_SLOT ? new GroundItem(bodyId, 1) : new GroundItem(-1, 0),
    set: (_slot, item) => { ammo = item; },
    refreshItems() {},
  };
  const player = {
    getEquipment: () => equipment,
    sendMessage() {},
    getCombat: () => ({ getRangedWeapon: () => rangedWeapon, getAmmunition: () => Ammunition.getForItem(itemId) }),
  };
  return { player, ammo: () => ammo };
}

function roll(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = original; }
}

const shot = (harness, rollValue, pos = POS) => roll(rollValue, () => Factory.decrementAmmo(harness.player, pos, 1));

test('bot shots cannot create farmable ammunition, including double shots and plugin-owned ammo', (t) => {
  const { registerBotEvents } = require('../plugins/bots/runtime/RegisterBotEvents.PlayerBots');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  const events = new Map();
  registerBotEvents({
    api: {
      getWorld: () => ({}),
      getItemOnGroundManager: () => ItemOnGroundManager,
      onCustomEvent: (name, handler) => events.set(name, handler),
      onPlayerDisconnect() {},
      onPlayerLogout() {},
      onPlayerDeathItemDrop() {},
      onPlayerAttack() {},
      onObjectInteraction() {},
      onPlayerProcess() {},
      onPlayerDefeated() {},
    },
  });
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => events.get(name)?.(event));
  const scheduled = [];
  t.mock.method(TaskManager, 'submit', task => scheduled.push(task));
  drops.length = 0;
  for (const [itemId, rangedWeapon, amount] of [
    [Items.RUNE_ARROW, RangedWeapon.MAGIC_SHORTBOW, 1],
    [Items.DRAGONSTONE_BOLTS_E_, RangedWeapon.RUNE_CROSSBOW, 1],
    [Items.DRAGON_ARROW, RangedWeapon.DARK_BOW, 2],
  ]) {
    const bot = ammoHarness({ itemId, rangedWeapon });
    bot.player.isPlayerBot = () => true;
    for (const delay of [0, 3]) roll(0.50, () => Factory.decrementAmmo(bot.player, POS, amount, delay));
    assert.deepEqual(drops, [], 'bot shots never drop ammunition for players to collect');
    assert.deepEqual(scheduled, [], 'no delayed bot ammunition drops are queued');
    assert.equal(bot.ammo().getAmount(), 5, 'the bot can keep fighting');
  }

  const human = ammoHarness();
  human.player.isPlayerBot = () => false;
  shot(human, 0.50);
  assert.equal(human.ammo().getAmount(), 4);
  assert.deepEqual(drops, [{ id: Items.BRONZE_ARROW, amount: 1, position: POS }], 'players still recover fired ammo');

  const pluginAmmo = t.mock.method(PluginManager, 'decrementRangedAmmo', () => true);
  const bot = ammoHarness();
  bot.player.isPlayerBot = () => true;
  Factory.decrementAmmo(bot.player, POS, 1);
  assert.equal(pluginAmmo.mock.callCount(), 0, 'bot shots are saved before quiver or other plugin ammo can drop');
  Factory.decrementAmmo(human.player, POS, 1);
  assert.equal(pluginAmmo.mock.callCount(), 1, 'players still reach plugin-owned ammunition handlers');
});

test('fired ammo breaks 20% of the time and otherwise lands where the target stood', () => {
  drops.length = 0;
  const broken = ammoHarness();
  shot(broken, 0.10); // roll 10: break
  assert.equal(broken.ammo().getAmount(), 4);
  assert.equal(drops.length, 0);

  const landed = ammoHarness();
  shot(landed, 0.50); // roll 50: drop
  assert.equal(landed.ammo().getAmount(), 4);
  assert.deepEqual(drops, [{ id: Items.BRONZE_ARROW, amount: 1, position: POS }]);
});

test("Ava's attractor recovers 60% and Ava's accumulator 72%", () => {
  drops.length = 0;

  // Accumulator: drops only on rolls 20-27 (8%), recovers from 28 up.
  const accumulator = ammoHarness({ capeId: Items.AVAS_ACCUMULATOR });
  shot(accumulator, 0.99);
  assert.equal(accumulator.ammo().getAmount(), 5, 'recovered automatically');
  shot(accumulator, 0.25);
  assert.equal(accumulator.ammo().getAmount(), 4, 'dropped to the floor');
  assert.equal(drops.length, 1);

  // Attractor: drops on rolls 20-39 (20%), recovers from 40 up.
  const attractor = ammoHarness({ capeId: Items.AVAS_ATTRACTOR });
  shot(attractor, 0.50);
  assert.equal(attractor.ammo().getAmount(), 5);
  shot(attractor, 0.30);
  assert.equal(attractor.ammo().getAmount(), 4);

  // The assembler recovers 80% itself, so the other 20% breaks and nothing lands.
  const assembler = ammoHarness({ capeId: Items.AVAS_ASSEMBLER });
  assert.equal(avaRecovery.recovery(assembler.player), 80);
  drops.length = 0;
  shot(assembler, 0.50);
  assert.equal(assembler.ammo().getAmount(), 5);
  assert.equal(drops.length, 0);
  shot(assembler, 0.10);
  assert.equal(assembler.ammo().getAmount(), 4);
  assert.equal(drops.length, 0);

  // Unknown capes fall through to core.
  const other = ammoHarness({ capeId: Items.AVAS_DEVICE });
  assert.equal(avaRecovery.recovery(other.player), null);
  drops.length = 0;
  shot(other, 0.50);
  assert.equal(other.ammo().getAmount(), 4);
  assert.equal(drops.length, 1);
});

test("a metal torso stops Ava's devices and the Ranging cape recovering ammo (Wiki: Metallic interference)", () => {
  const obj = (name) => CacheDefinitions.getObjId(name);
  for (const capeId of [Items.AVAS_ATTRACTOR, Items.AVAS_ACCUMULATOR, Items.AVAS_ASSEMBLER, Items.RANGING_CAPE]) {
    for (const body of ['rune_platebody', 'barrows_ahrim_body', 'barrows_verac_body_75', 'dragon_chainbody', 'castlewars_armour_body_3']) {
      assert.equal(avaRecovery.recovery(ammoHarness({ capeId, bodyId: obj(body) }).player), 0, `${body} interferes with cape ${capeId}`);
    }
    // Torsos that look metal but the table marks compatible keep recovering.
    for (const body of ['rune_platebody_h1', 'bronze_platebody', 'dragon_platebody_gold', 'bandos_chestplate', 'barrows_karil_body']) {
      assert.ok(avaRecovery.recovery(ammoHarness({ capeId, bodyId: obj(body) }).player) > 0, `${body} is compatible with cape ${capeId}`);
    }
  }

  // With the device blocked a shot lands or breaks like one with no device at all.
  drops.length = 0;
  const blocked = ammoHarness({ capeId: Items.AVAS_ACCUMULATOR, bodyId: obj('rune_platebody') });
  shot(blocked, 0.99);
  assert.equal(blocked.ammo().getAmount(), 4, 'not recovered');
  assert.deepEqual(drops, [{ id: Items.BRONZE_ARROW, amount: 1, position: POS }], 'it lands where the target stood');

  // A cape slot with no recovering cape still leaves the answer to other plugins (Dizana's quiver).
  assert.equal(avaRecovery.recovery(ammoHarness({ capeId: Items.AVAS_DEVICE, bodyId: obj('rune_platebody') }).player), null);
});

test('javelins drop and are recoverable like other ammunition', () => {
  drops.length = 0;
  const javelin = ammoHarness({ itemId: Items.BRONZE_JAVELIN, rangedWeapon: RangedWeapon.BALLISTA });
  shot(javelin, 0.50);
  assert.equal(javelin.ammo().getAmount(), 4);
  assert.deepEqual(drops, [{ id: Items.BRONZE_JAVELIN, amount: 1, position: POS }]);

  const recovered = ammoHarness({ itemId: Items.BRONZE_JAVELIN, rangedWeapon: RangedWeapon.BALLISTA, capeId: Items.AVAS_ACCUMULATOR });
  shot(recovered, 0.99);
  assert.equal(recovered.ammo().getAmount(), 5);
});

test('training arrows fire the aide arrow visuals, not bronze', () => {
  assert.equal(Ammunition.TRAINING_ARROWS.getProjectileId(), 805);
  assert.equal(Ammunition.TRAINING_ARROWS.getStartGraphic().getId(), 806);
  assert.deepEqual(RangedWeapon.TRAINING_BOW.getAmmunitionData(), [Ammunition.TRAINING_ARROWS]);
});

test('amethyst arrows resolve with their cache visuals and only fit magic-tier bows or better', () => {
  const ammo = Ammunition.getForItem(Items.AMETHYST_ARROW);
  assert.equal(ammo, Ammunition.AMETHYST_ARROW);
  assert.equal(ammo.getStrength(), 55, 'amethyst arrows give +55 Ranged strength (Wiki)');
  assert.equal(ammo.getStartGraphic().getId(), 1385, 'AMETHYST_ARROW_LAUNCH');
  assert.equal(ammo.getProjectileId(), 1384, 'AMETHYST_ARROW_TRAVEL');

  for (const bow of [
    RangedWeapon.MAGIC_LONGBOW, RangedWeapon.MAGIC_SHORTBOW, RangedWeapon.MAGIC_COMP_BOW,
    RangedWeapon.SEERCULL, RangedWeapon.THIRD_AGE_BOW, RangedWeapon.ZARYTE_BOW,
    RangedWeapon.GODBOW, RangedWeapon.TWISTED_BOW, RangedWeapon.SCORCHING_BOW, RangedWeapon.DARK_BOW,
  ]) assert.ok(bow.getAmmunitionData().includes(ammo), 'magic-tier or higher bow can fire amethyst arrows');
  assert.ok(!RangedWeapon.YEW_SHORTBOW.getAmmunitionData().includes(ammo), 'yew bows cannot fire amethyst arrows');
});

test('projectiles use the OSRS projanim flight times', () => {
  const { RangedCombatMethod } = require('../dist/game/content/combat/method/impl/RangedCombatMethod');
  // Client cycles: arrow/bolt end at 46 + 5d, thrown at 32 + 5d, the dark bow's
  // second arrow at 55 + 10d.
  const arrow = { delay: 41, lengthAdjustment: 5, stepMultiplier: 5 };
  const thrown = { delay: 32, lengthAdjustment: 0, stepMultiplier: 5 };
  const doubleArrowTwo = { delay: 41, lengthAdjustment: 14, stepMultiplier: 10 };
  assert.equal(RangedCombatMethod.projectileEnd(arrow, 1), 51);
  assert.equal(RangedCombatMethod.projectileEnd(arrow, 7), 81);
  assert.equal(RangedCombatMethod.projectileEnd(arrow, 10), 96);
  assert.equal(RangedCombatMethod.projectileEnd(thrown, 1), 37);
  assert.equal(RangedCombatMethod.projectileEnd(doubleArrowTwo, 5), 105);
});

test('ammo is consumed when the projectile lands, not at fire', () => {
  const { TaskManager } = require('../dist/game/task/TaskManager');
  const { CombatFactory: CF } = require('../dist/game/content/combat/CombatFactory');
  const harness = ammoHarness({ amount: 5 });
  CF.decrementAmmo(harness.player, POS, 1, 3);
  assert.equal(harness.ammo().getAmount(), 5, 'still in the quiver while the arrow flies');
  TaskManager.process();
  TaskManager.process();
  assert.equal(harness.ammo().getAmount(), 5, 'not before the flight ends');
  TaskManager.process();
  assert.equal(harness.ammo().getAmount(), 4);
});

test('hits on NPCs take the processing-order tick; hits on players leave it to PID', () => {
  const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
  const { CombatType } = require('../dist/game/content/combat/CombatType');
  const hit = (playerAttacker, npcTarget, type) => ({
    getAttacker: () => ({ isPlayer: () => playerAttacker }),
    getTarget: () => ({ isNpc: () => npcTarget }),
    getCombatType: () => type,
  });
  assert.equal(CombatFactory.hitProcessingDelay(hit(true, true, CombatType.RANGED)), 1);
  assert.equal(CombatFactory.hitProcessingDelay(hit(true, true, CombatType.MAGIC)), 1);
  assert.equal(CombatFactory.hitProcessingDelay(hit(true, false, CombatType.RANGED)), 0);
  assert.equal(CombatFactory.hitProcessingDelay(hit(true, false, CombatType.MELEE)), 0, 'Wiki: in PvP, PID decides');
  assert.equal(CombatFactory.hitProcessingDelay(hit(false, false, CombatType.RANGED)), 0, 'NPC attacks on players are unchanged');
  assert.equal(CombatFactory.hitProcessingDelay(hit(false, true, CombatType.RANGED)), 1);
});

test('PvP melee on the same tick: the player processed first lands now, the other next tick (PID)', (t) => {
  const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
  const { CombatType } = require('../dist/game/content/combat/CombatType');
  const { HitQueue } = require('../dist/game/content/combat/hit/HitQueue');
  const landed = [];
  let cycle = 100;
  t.mock.method(CombatFactory, 'executeHit', (pending) => landed.push([pending.name, cycle]));
  const fighter = (name) => {
    // getIncomingHitCycle(): -1, nobody is held by an animation stall, so each hit keeps its own tick.
    const player = { name, isRegistered: () => true, getHitpoints: () => 99, isUntargetable: () => false, isNpc: () => false, isPlayer: () => true, getCombat: () => ({ getIncomingHitCycle: () => -1 }) };
    player.queue = new HitQueue(player);
    return player;
  };
  const first = fighter('first');
  const second = fighter('second');
  const swing = (attacker, target) => {
    const pending = { name: `${attacker.name}->${target.name}`, getAttacker: () => attacker, getTarget: () => target, getCombatType: () => CombatType.MELEE };
    target.queue.addPendingHit(pending, cycle + 0 + CombatFactory.hitProcessingDelay(pending));
  };
  // Tick 100, in PID order: each drains its own queue, then swings.
  first.queue.process(cycle); swing(first, second);
  second.queue.process(cycle); swing(second, first);
  HitQueue.processAll(cycle);
  cycle = 101;
  first.queue.process(cycle); second.queue.process(cycle);
  HitQueue.processAll(cycle);
  assert.deepEqual(landed, [['first->second', 100], ['second->first', 101]]);
});

test("a thrown weapon doesn't get the ammo slot's ranged strength; a bow does", () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { BonusManager } = require('../dist/game/model/equipment/BonusManager');
  const { Equipment } = require('../dist/game/model/container/impl/Equipment');
  const { Item } = require('../dist/game/model/Item');
  CachePipeline.initialize();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  const strengthWith = (weaponId) => {
    const items = Array.from({ length: 14 }, () => new Item(-1, 0));
    items[Equipment.WEAPON_SLOT] = new Item(weaponId, 100);
    items[Equipment.AMMUNITION_SLOT] = new Item(Items.DRAGON_ARROW, 100);
    const bonuses = new BonusManager();
    BonusManager.update({ getEquipment: () => ({ getItems: () => items }), getBonusManager: () => bonuses });
    return bonuses.getOtherBonus()[BonusManager.RANGED_STRENGTH];
  };
  assert.equal(strengthWith(Items.DRAGON_KNIFE), 30, "the knife's +30, not the arrows' +60 on top");
  assert.equal(strengthWith(Items.MAGIC_SHORTBOW), 60, "a bow fires the arrows: their +60");
});

test('scaled damage rounds down: a 17 into a protection prayer in PvP is 10', () => {
  const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
  const { HitMask } = require('../dist/game/content/combat/hit/HitMask');
  const hit = new HitDamage(17, HitMask.RED);
  hit.multiplyDamage(0.6);
  assert.equal(hit.getDamage(), 10);
  const elysian = new HitDamage(13, HitMask.RED);
  elysian.multiplyDamage(0.75);
  assert.equal(elysian.getDamage(), 9);
  assert.equal(new HitDamage(12.9, HitMask.RED).getDamage(), 12, 'whole damage however it was made');
});

test('elite void adds 10% ranged accuracy like void (its 12.5% is damage only)', () => {
  const { AccuracyFormulasDpsCalc } = require('../dist/game/content/combat/formula/AccuracyFormulasDpsCalc');
  const { CombatType } = require('../dist/game/content/combat/CombatType');
  const { FightStyle } = require('../dist/game/content/combat/FightStyle');
  const effects = require('../dist/game/content/combat/EquipmentEffects');
  require('../plugins/items/VoidEquipment.plugin').register({
    core: { Equipment: Slots, ItemIdentifiers: Items, CombatType },
    registerCombatEffectiveLevelModifier: effects.registerCombatEffectiveLevelModifier,
    registerMagicDamageBonusModifier: effects.registerMagicDamageBonusModifier,
  });
  const roll = (top, robe) => {
    const items = Array.from({ length: 14 }, () => new GroundItem(-1, 0));
    items[Slots.HEAD_SLOT] = new GroundItem(Items.VOID_RANGER_HELM);
    items[Slots.BODY_SLOT] = new GroundItem(top);
    items[Slots.LEG_SLOT] = new GroundItem(robe);
    items[Slots.HANDS_SLOT] = new GroundItem(Items.VOID_KNIGHT_GLOVES);
    const player = {
      isNpc: () => false, isPlayer: () => true, getAsPlayer() { return this; },
      getSkillManager: () => ({ getCurrentLevel: () => 99 }),
      getFightType: () => ({ getStyle: () => FightStyle.RAPID }),
      getPrayerActive: () => [],
      getEquipment: () => ({ getItems: () => items }),
    };
    return AccuracyFormulasDpsCalc.effectiveRangedAttack(player);
  };
  assert.equal(roll(-1, -1), 107, 'incomplete set gives no accuracy');
  assert.equal(roll(Items.VOID_KNIGHT_TOP, Items.VOID_KNIGHT_ROBE), 117);
  assert.equal(roll(Items.ELITE_VOID_TOP, Items.ELITE_VOID_ROBE), 117, 'elite accuracy is 10%, not 12.5%');
});

test('the scorching bow is a bow: arrows up to dragon, speed 5, range 10, its stats and 77 Ranged (Wiki)', () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
  const { WeaponInterfaces } = require('../dist/game/content/combat/WeaponInterfaces');
  const { WeaponProfiles } = require('../dist/game/content/combat/WeaponProfile');
  const { Equipment } = require('../dist/game/model/container/impl/Equipment');
  const { Item } = require('../dist/game/model/Item');
  CachePipeline.initialize();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  const items = Array.from({ length: 14 }, () => new Item(-1, 0));
  items[Equipment.WEAPON_SLOT] = new Item(Items.SCORCHING_BOW, 1);
  const archer = { getEquipment: () => ({ getItems: () => items }), getWeapon: () => WeaponInterfaces.LONGBOW };
  const bow = RangedWeapon.getFor(archer);
  assert.equal(bow, RangedWeapon.SCORCHING_BOW, 'a ranged weapon, not a kick');
  assert.ok(bow.getAmmunitionData().includes(Ammunition.DRAGON_ARROW));
  assert.equal(bow.getType().getDefaultDistance?.() ?? 10, 10);
  const profile = WeaponProfiles.get(archer);
  assert.deepEqual([profile.attackAnimation, profile.attackSpeed, profile.attackDistance], [426, 5, 10]);
  const definition = ItemDefinition.forId(Items.SCORCHING_BOW);
  assert.equal(definition.getWeaponInterface(), WeaponInterfaces.LONGBOW);
  assert.equal(definition.isDoubleHanded(), true);
  assert.equal(definition.getBonuses()[4], 124, 'ranged attack');
  assert.equal(definition.getBonuses()[11], 40, 'ranged strength');
  assert.equal(definition.getRequirements()[4], 77, 'Ranged to wield');
});

test("a block on the tick of a swing doesn't replace it (cache interrupt priority: attacks 6, blocks 5)", (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { Animation } = require('../dist/game/model/Animation');
  const player = new Player(null);
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  const WHIP_ATTACK = 1658;
  const WHIP_BLOCK = 1659;
  player.performAnimation(new Animation(WHIP_ATTACK));
  player.performAnimation(new Animation(WHIP_BLOCK));
  assert.equal(player.getAnimation().getId(), WHIP_ATTACK, "the opponent's hit landing this tick keeps the swing");
  player.resetUpdating();
  player.performAnimation(new Animation(WHIP_BLOCK));
  player.performAnimation(new Animation(WHIP_ATTACK));
  assert.equal(player.getAnimation().getId(), WHIP_ATTACK, 'a swing replaces a block');
  player.performAnimation(new Animation(-1));
  assert.equal(player.getAnimation().getId(), -1, 'a reset always applies');
});
