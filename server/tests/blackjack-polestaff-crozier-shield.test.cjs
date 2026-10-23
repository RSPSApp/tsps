// Run after `yarn build`: node --test tests/blackjack-polestaff-crozier-shield.test.cjs
// Blackjacks, polestaves, croziers and shields: melee/magic weapons with no ammunition, no
// charges and no special attack bar; the blackjack combat stun and the Elysian shield passive.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { CombatConstants } = require("../dist/game/content/combat/CombatConstants");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { DamageFormulas } = require("../dist/game/content/combat/formula/DamageFormulas");
const { FightStyle } = require("../dist/game/content/combat/FightStyle");
const { FightType } = require("../dist/game/content/combat/FightType");
const { RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
const { WeaponProfiles } = require("../dist/game/content/combat/WeaponProfile");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const registerBlackjackEffects = require("../plugins/combat/effects/Blackjack.EquipmentEffects");
const { _test: { stunOpponent, stunTicks } } = registerBlackjackEffects;

const BLACKJACKS = {
  1: [ItemIdentifiers.OAK_BLACKJACK, ItemIdentifiers.OAK_BLACKJACK_O_, ItemIdentifiers.OAK_BLACKJACK_D_],
  2: [ItemIdentifiers.WILLOW_BLACKJACK, ItemIdentifiers.WILLOW_BLACKJACK_O_, ItemIdentifiers.WILLOW_BLACKJACK_D_],
  3: [ItemIdentifiers.MAPLE_BLACKJACK, ItemIdentifiers.MAPLE_BLACKJACK_O_, ItemIdentifiers.MAPLE_BLACKJACK_D_],
};
const CROZIERS = [
  ItemIdentifiers.SARADOMIN_CROZIER, ItemIdentifiers.GUTHIX_CROZIER, ItemIdentifiers.ZAMORAK_CROZIER,
  ItemIdentifiers.ANCIENT_CROZIER, ItemIdentifiers.ARMADYL_CROZIER, ItemIdentifiers.BANDOS_CROZIER,
];
const MJOLNIRS = [ItemIdentifiers.GUTHIX_MJOLNIR, ItemIdentifiers.SARADOMIN_MJOLNIR, ItemIdentifiers.ZAMORAK_MJOLNIR];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  registerBlackjackEffects({ core: { CombatType }, onCombatHitResolved() {} });
});

function item(id) {
  return { getId: () => id, getDefinition: () => ItemDefinition.forId(id) };
}

function wielding(weaponId, weaponInterface, fightType = null, shieldId = -1) {
  const items = [];
  items[Equipment.WEAPON_SLOT] = item(weaponId);
  items[Equipment.SHIELD_SLOT] = item(shieldId);
  const calls = { display: [], special: undefined };
  return {
    calls,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment() { return { getItems: () => items, get: (slot) => items[slot] }; },
    getWeapon: () => weaponInterface,
    getFightType: () => fightType,
    getPacketSender: () => ({
      sendInterfaceDisplayState: (id, hidden) => calls.display.push([id, hidden]),
      sendSpecialAttackState() {},
    }),
    setCombatSpecial(value) { calls.special = value; },
    setSpecialActivated() {},
  };
}

function hit(damage, combatType = CombatType.MELEE) {
  return { getTotalDamage: () => damage, getCombatType: () => combatType };
}

function opponent(hitpoints = 10) {
  const delays = [];
  return {
    delays,
    getHitpoints: () => hitpoints,
    getCombat: () => ({ delayAttack: (ticks) => delays.push(ticks) }),
  };
}

function withRandom(value, run) {
  const original = Math.random;
  Math.random = () => value;
  try { return run(); } finally { Math.random = original; }
}

test("blackjacks use the blunt Pound/Pummel/Block styles at 4 ticks and train Attack/Strength/Defence", () => {
  for (const id of Object.values(BLACKJACKS).flat()) {
    assert.equal(WeaponProfiles.attackSpeed(wielding(id, WeaponInterfaces.WARHAMMER), 6), 4, `item ${id} speed`);
  }
  assert.deepEqual(
    WeaponInterfaces.WARHAMMER.getFightType().map((type) => [type.getStyle(), type.getBonusType()]),
    [[FightStyle.ACCURATE, 2], [FightStyle.AGGRESSIVE, 2], [FightStyle.DEFENSIVE, 2]],
    "crush on every style",
  );
  assert.equal(FightType.WARHAMMER_POUND.getStyle(), FightStyle.ACCURATE);
  assert.equal(FightType.WARHAMMER_PUMMEL.getStyle(), FightStyle.AGGRESSIVE);
  assert.equal(FightType.WARHAMMER_BLOCK.getStyle(), FightStyle.DEFENSIVE);
});

test("the blackjack stun delays by 1/2/3 ticks per tier, shared by the (o) and (d) variants", () => {
  for (const [ticks, ids] of Object.entries(BLACKJACKS)) {
    for (const id of ids) {
      assert.equal(stunTicks(wielding(id, WeaponInterfaces.WARHAMMER)), Number(ticks), `item ${id}`);
      const target = opponent(10);
      // roll 0..damage against 0..hitpoints: a 100 hit against 10 hitpoints, rolls fixed high/low.
      withRandom(0.99, () => stunOpponent({ attacker: wielding(id, WeaponInterfaces.WARHAMMER), target, hit: hit(100) }));
      assert.deepEqual(target.delays, [Number(ticks)], `item ${id} stuns`);
    }
  }
});

test("blackjack stuns stack and need a damaging melee hit from a blackjack", () => {
  const maple = wielding(ItemIdentifiers.MAPLE_BLACKJACK, WeaponInterfaces.WARHAMMER);
  const target = opponent(10);
  withRandom(0.99, () => {
    stunOpponent({ attacker: maple, target, hit: hit(100) });
    stunOpponent({ attacker: maple, target, hit: hit(100) });
    assert.deepEqual(target.delays, [3, 3], "each stun delays again");

    const quiet = opponent(10);
    stunOpponent({ attacker: maple, target: quiet, hit: hit(0) });
    stunOpponent({ attacker: maple, target: quiet, hit: hit(100, CombatType.RANGED) });
    stunOpponent({ attacker: wielding(ItemIdentifiers.DRAGON_SCIMITAR, WeaponInterfaces.SCIMITAR), target: quiet, hit: hit(100) });
    assert.deepEqual(quiet.delays, [], "zero hit, ranged hit and other weapons never stun");
  });
  const resilient = opponent(1000);
  withRandom(0, () => stunOpponent({ attacker: maple, target: resilient, hit: hit(1) }));
  assert.deepEqual(resilient.delays, [], "a lower damage roll than the hitpoints roll does not stun");
});

test("no blackjack, polestaff, crozier or mjolnir has a special attack, so the special bar stays hidden", () => {
  const cases = [
    ...Object.values(BLACKJACKS).flat().map((id) => [id, WeaponInterfaces.WARHAMMER]),
    ...CROZIERS.map((id) => [id, WeaponInterfaces.STAFF]),
    ...MJOLNIRS.map((id) => [id, WeaponInterfaces.POLESTAFF]),
    [ItemIdentifiers.DRAMEN_STAFF, WeaponInterfaces.STAFF],
  ];
  for (const [id, weaponInterface] of cases) {
    assert.equal(CombatSpecial.getForWeaponId(id), null, `item ${id} has no special`);
    const player = wielding(id, weaponInterface);
    CombatSpecial.assign(player);
    assert.equal(player.calls.special, null, `item ${id} clears the special`);
    if (weaponInterface.getSpecialBar() !== -1) {
      assert.deepEqual(player.calls.display, [[weaponInterface.getSpecialBar(), true]], `item ${id} hides the special bar`);
    }
  }
});

test("these weapons consume no ammunition and do not degrade", () => {
  const ids = [...Object.values(BLACKJACKS).flat(), ...CROZIERS, ...MJOLNIRS, ItemIdentifiers.DRAMEN_STAFF];
  assert.ok(RangedWeapon.getFor(wielding(ItemIdentifiers.MAGIC_SHORTBOW, WeaponInterfaces.UNARMED)), "control: a bow is a ranged weapon");
  for (const id of ids) {
    assert.equal(RangedWeapon.getSelfAmmo(id) ?? null, null, `item ${id} is not thrown`);
    assert.equal(RangedWeapon.getFor(wielding(id, WeaponInterfaces.UNARMED)) ?? null, null, `item ${id} is not a ranged weapon`);
  }
});

test("the Elysian spirit shield cuts 25% off a hit, 70% of the time, only while worn", () => {
  assert.equal(CombatConstants.ELYSIAN_ACTIVATION_CHANCE, 0.7);
  assert.equal(CombatConstants.ELYSIAN_DAMAGE_REDUCTION, 0.75);
  const originalMax = DamageFormulas.sourceMaxHit;
  const originalRoll = CombatFactory.rollSpecialDamage;
  DamageFormulas.sourceMaxHit = () => 40;
  CombatFactory.rollSpecialDamage = () => 40;
  try {
    const attacker = { isNpc: () => true, isPlayer: () => false, getAsNpc: () => ({ getCurrentDefinition: () => null }) };
    const victim = (shieldId) => {
      const player = wielding(-1, WeaponInterfaces.UNARMED, null, shieldId);
      player.glows = 0;
      player.performGraphic = () => { player.glows++; };
      return player;
    };
    const roll = (shieldId, random) => {
      const player = victim(shieldId);
      const damage = withRandom(random, () => CombatFactory.getHitDamage(attacker, player, CombatType.MELEE, true)).getDamage();
      return { damage, glows: player.glows };
    };
    assert.deepEqual(roll(ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD, 0.5), { damage: 30, glows: 1 });
    assert.deepEqual(roll(ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD, 0.9), { damage: 40, glows: 0 }, "the other 30%");
    assert.deepEqual(roll(ItemIdentifiers.SPIRIT_SHIELD, 0.5), { damage: 40, glows: 0 });
    assert.deepEqual(roll(ItemIdentifiers.ARCANE_SPIRIT_SHIELD, 0.5), { damage: 40, glows: 0 });
  } finally {
    DamageFormulas.sourceMaxHit = originalMax;
    CombatFactory.rollSpecialDamage = originalRoll;
  }
});
