// Run after `yarn build`: node --test tests/ranged-ammunition.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Ammunition, RangedWeapon, RangedData } = require('../dist/game/content/combat/ranged/RangedData');
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

test('an enchanted dragon bolt has its gem effect: ruby (e) is Blood Forfeit', () => {
  assert.equal(Ammunition.effectOf(Ammunition.ENCHANTED_RUBY_DRAGON_BOLT), Ammunition.ENCHANTED_RUBY_BOLT);
  assert.equal(Ammunition.effectOf(Ammunition.ENCHANTED_ONYX_DRAGON_BOLT), Ammunition.ENCHANTED_ONYX_BOLT);
  assert.equal(Ammunition.effectOf(Ammunition.RUBY_BOLT), Ammunition.RUBY_BOLT);

  const selfHits = [];
  const player = {
    getHitpoints: () => 90,
    getCombat: () => ({
      getAmmunition: () => Ammunition.ENCHANTED_RUBY_DRAGON_BOLT,
      getHitQueue: () => ({ addPendingDamage: (hits) => selfHits.push(...hits.map((hit) => hit.getDamage())) }),
    }),
  };
  const target = { getHitpoints: () => 300, performGraphic() {}, isPlayer: () => false };
  const multiplier = RangedData.getSpecialEffectsMultiplier(player, target, 30);
  assert.equal(Math.floor(30 * multiplier), 60, "20% of the target's current hitpoints");
  assert.deepEqual(selfHits, [9], "for 10% of the player's");

  const big = { getHitpoints: () => 2000, performGraphic() {}, isPlayer: () => false };
  assert.equal(Math.floor(40 * RangedData.getSpecialEffectsMultiplier(player, big, 40)), 100, 'capped at 100');

  const weak = { ...player, getHitpoints: () => 9 };
  assert.equal(RangedData.getSpecialEffectsMultiplier(weak, target, 30), 1, "not when the player can't spare it");
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

// The real Ava's plugin, with core standing in for the plugin API.
let avaRecovery = null;
require('../plugins/items/AvasAccumulator.plugin').register({
  core: { Equipment: Slots, ItemIdentifiers: Items },
  registerRangedAmmoRecovery(resolver) { avaRecovery = resolver; },
});
PluginManager.rangedAmmoRecovery = (player) => avaRecovery.recovery(player) ?? 0;

const drops = [];
ItemOnGroundManager.registerLocation = (player, item, position) => drops.push({ id: item.getId(), amount: item.getAmount(), position });

const POS = { x: 3000, y: 3000, z: 0 };

function ammoHarness({ itemId = Items.BRONZE_ARROW, amount = 5, capeId = -1 } = {}) {
  let ammo = new GroundItem(itemId, amount);
  const equipment = {
    get: (slot) => slot === Slots.AMMUNITION_SLOT ? ammo
      : slot === Slots.CAPE_SLOT ? new GroundItem(capeId, 1) : new GroundItem(-1, 0),
    set: (_slot, item) => { ammo = item; },
    refreshItems() {},
  };
  const player = {
    getEquipment: () => equipment,
    sendMessage() {},
    getCombat: () => ({ getRangedWeapon: () => RangedWeapon.SHORTBOW, getAmmunition: () => Ammunition.getForItem(itemId) }),
  };
  return { player, ammo: () => ammo };
}

function roll(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = original; }
}

const shot = (harness, rollValue, pos = POS) => roll(rollValue, () => Factory.decrementAmmo(harness.player, pos, 1));

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

  // The plugin only claims what it knows: other capes fall through to core.
  const assembler = ammoHarness({ capeId: Items.AVAS_ASSEMBLER });
  assert.equal(avaRecovery.recovery(assembler.player), null);
  drops.length = 0;
  shot(assembler, 0.50);
  assert.equal(assembler.ammo().getAmount(), 4);
  assert.equal(drops.length, 1);
});

test('javelins drop and are recoverable like other ammunition', () => {
  drops.length = 0;
  const javelin = ammoHarness({ itemId: Items.BRONZE_JAVELIN });
  shot(javelin, 0.50);
  assert.equal(javelin.ammo().getAmount(), 4);
  assert.deepEqual(drops, [{ id: Items.BRONZE_JAVELIN, amount: 1, position: POS }]);

  const recovered = ammoHarness({ itemId: Items.BRONZE_JAVELIN, capeId: Items.AVAS_ACCUMULATOR });
  shot(recovered, 0.99);
  assert.equal(recovered.ammo().getAmount(), 5);
});

test('training arrows fire the aide arrow visuals, not bronze', () => {
  assert.equal(Ammunition.TRAINING_ARROWS.getProjectileId(), 805);
  assert.equal(Ammunition.TRAINING_ARROWS.getStartGraphic().getId(), 806);
  assert.deepEqual(RangedWeapon.TRAINING_BOW.getAmmunitionData(), [Ammunition.TRAINING_ARROWS]);
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

test('hits on NPCs and player melee take the processing-order tick', () => {
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
  assert.equal(CombatFactory.hitProcessingDelay(hit(true, false, CombatType.MELEE)), 1);
  assert.equal(CombatFactory.hitProcessingDelay(hit(false, false, CombatType.RANGED)), 0, 'NPC attacks on players are unchanged');
  assert.equal(CombatFactory.hitProcessingDelay(hit(false, true, CombatType.RANGED)), 1);
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
  const { CombatEquipment } = require('../dist/game/content/combat/CombatEquipment');
  const { FightStyle } = require('../dist/game/content/combat/FightStyle');
  const original = { elite: CombatEquipment.wearingEliteVoid, plain: CombatEquipment.wearingVoid };
  let elite = false;
  CombatEquipment.wearingEliteVoid = () => elite;
  CombatEquipment.wearingVoid = () => elite;
  try {
    const roll = () => {
      const player = {
        isNpc: () => false, isPlayer: () => true, getAsPlayer() { return this; },
        getSkillManager: () => ({ getCurrentLevel: () => 99 }),
        getFightType: () => ({ getStyle: () => FightStyle.RAPID }),
        getPrayerActive: () => [],
        getEquipment: () => ({ getItems: () => [], get: () => ({ getId: () => -1 }) }),
        getAttribute: () => undefined,
      };
      return AccuracyFormulasDpsCalc.effectiveRangedAttack(player);
    };
    const plain = roll();
    elite = true;
    assert.equal(roll(), Math.floor(plain * 110 / 100));
  } finally {
    CombatEquipment.wearingEliteVoid = original.elite;
    CombatEquipment.wearingVoid = original.plain;
  }
});
