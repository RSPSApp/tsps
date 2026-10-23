// Run after `yarn build`: node --test tests/bow-specials.test.cjs
// Magic shortbow Snapshot, Dark bow Descent and Ballista Concentrated Shot.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { Ammunition, RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");

// Real core, with the pieces that touch a live world replaced by recorders.
const drains = [];
let rolledBounds = [];
let sourceMax = 0;
const hitDamageHandlers = [];
const core = {
  ...PluginManager.getCoreApi(),
  CombatSpecial: Object.assign(Object.create(CombatSpecial), { drain: (_, amount) => drains.push(amount) }),
  CombatFactory: {
    checkAmmo: () => true,
    decrementAmmo: () => {},
    // Stands in for the roll: always the top of the bounds.
    getHitDamage: (_a, _t, _type, _bypass, bounds) => {
      rolledBounds.push(bounds);
      return new HitDamage(bounds.maximumBonus, HitMask.RED);
    },
  },
  DamageFormulas: { sourceMaxHit: () => sourceMax },
  PluginManager: { modifyRangedMaxHit: (_a, _t, maxHit) => maxHit },
  Projectile: { createProjectile: () => ({ sendProjectile() {} }) },
  Sounds: { sendSound() {} },
};
const api = {
  core,
  registerCombatSpecial: CombatSpecial.register,
  onCombatHitDamage: (handler) => hitDamageHandlers.push(handler),
};
require("../plugins/combat/specials/MagicShortbow.SpecialAttack")(api);
require("../plugins/combat/specials/DarkBow.SpecialAttack")(api);
require("../plugins/combat/specials/Ballista.SpecialAttack")(api);

function fakePlayer({ weapon, ammo = Ammunition.RUNE_ARROW, rangedWeapon, special, ammoStrength = 0, rangedLevel = 99, activated = true }) {
  const state = { activated, special: CombatSpecial.getById(special), animations: 0 };
  const player = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    isSpecialActivated: () => state.activated,
    getCombatSpecial: () => state.special,
    getCombat: () => ({ getAmmunition: () => ammo, getRangedWeapon: () => rangedWeapon }),
    getEquipment: () => ({
      get: (slot) => slot === Equipment.WEAPON_SLOT
        ? { getId: () => weapon }
        : { getId: () => 0, getDefinition: () => ({ getBonuses: () => ({ 11: ammoStrength }) }) },
    }),
    getSkillManager: () => ({ getCurrentLevel: () => rangedLevel }),
    performAnimation: () => { state.animations++; },
    performGraphic: () => {},
    state,
  };
  return player;
}

const target = { getLocation: () => ({}) };

function shoot(attacker, accurate, startingDamage = 0) {
  rolledBounds = [];
  const damage = new HitDamage(startingDamage, HitMask.BLUE);
  const event = { attacker, target, combatType: 1, hit: {}, damage, accurate };
  for (const handler of hitDamageHandlers) handler(event);
  return { damage: damage.getDamage(), bounds: rolledBounds };
}

test("each special is registered for every wieldable variant", () => {
  for (const id of [I.MAGIC_SHORTBOW, I.MAGIC_SHORTBOW_I_, I.MAGIC_SHORTBOW_3]) {
    assert.equal(CombatSpecial.getForWeaponId(id).getId(), "magic_shortbow");
  }
  for (const id of [I.DARK_BOW, I.DARK_BOW_3, I.DARK_BOW_4, I.DARK_BOW_5, I.DARK_BOW_6, I.DARK_BOW_7, I.DARK_BOW_BH_, I.CORRUPTED_DARK_BOW, I.DARK_BOW_DEADMAN_]) {
    assert.equal(CombatSpecial.getForWeaponId(id).getId(), "dark_bow", `special for ${id}`);
    assert.equal(RangedWeapon.rangedWeapons.get(id), RangedWeapon.DARK_BOW, `painted bows fire as the dark bow: ${id}`);
  }
  for (const id of [I.LIGHT_BALLISTA, I.HEAVY_BALLISTA, I.LIGHT_BALLISTA_4, I.HEAVY_BALLISTA_OR_]) {
    assert.equal(CombatSpecial.getForWeaponId(id).getId(), "ballista", `special for ${id}`);
    assert.equal(RangedWeapon.rangedWeapons.get(id), RangedWeapon.BALLISTA, `ballista fires javelins: ${id}`);
  }
});

test("Snapshot costs 55%, or 50% on the imbued bow, drained once per shot", () => {
  const snapshot = CombatSpecial.getById("magic_shortbow");
  assert.equal(snapshot.getDrainAmountForWeaponId(I.MAGIC_SHORTBOW), 55);
  assert.equal(snapshot.getDrainAmountForWeaponId(I.MAGIC_SHORTBOW_I_), 50);
  assert.equal(snapshot.getTraits().hitCount, 1, "each PendingHit rolls one arrow");
  assert.ok(Math.abs(snapshot.getAccuracyMultiplier() - 10 / 7) < 1e-9);
  for (const [weapon, cost] of [[I.MAGIC_SHORTBOW, 55], [I.MAGIC_SHORTBOW_I_, 50]]) {
    drains.length = 0;
    const attacker = fakePlayer({ weapon, rangedWeapon: RangedWeapon.MAGIC_SHORTBOW, special: "magic_shortbow" });
    const method = snapshot.getCombatMethod();
    assert.equal(method.canAttack(attacker, target), true);
    assert.deepEqual(drains, [], "checking the attack drains nothing");
    method.start(attacker, target);
    assert.deepEqual(drains, [cost]);
  }
});

test("Snapshot cannot fire from another bow and drains nothing", () => {
  drains.length = 0;
  const attacker = fakePlayer({ weapon: I.MAGIC_SHORTBOW, rangedWeapon: RangedWeapon.RUNE_CROSSBOW ?? null, special: "magic_shortbow" });
  assert.equal(CombatSpecial.getById("magic_shortbow").getCombatMethod().canAttack(attacker, target), false);
  assert.deepEqual(drains, []);
});

test("Snapshot's max hit counts only the visible Ranged level and the arrow's strength", () => {
  sourceMax = 40; // gear, prayers and Void would give this - Snapshot ignores it
  const attacker = fakePlayer({ weapon: I.MAGIC_SHORTBOW, special: "magic_shortbow", ammoStrength: 49 });
  // floor(0.5 + (99 + 10) * (49 + 64) / 640) = 19
  const hit = shoot(attacker, true);
  assert.equal(hit.bounds.length, 1);
  assert.equal(hit.bounds[0].maximumBonus, 19);
  assert.equal(hit.damage, 19);
  assert.equal(shoot(fakePlayer({ weapon: I.MAGIC_SHORTBOW, special: "magic_shortbow", ammoStrength: 49, rangedLevel: 70 }), true).damage, Math.floor(0.5 + (80 * 113) / 640));
  assert.equal(shoot(attacker, false, 0).damage, 0, "a missed arrow stays a miss");
});

test("Snapshot's roll applies only while the special is switched on", () => {
  const attacker = fakePlayer({ weapon: I.MAGIC_SHORTBOW, special: "magic_shortbow", ammoStrength: 49, activated: false });
  const hit = shoot(attacker, true, 7);
  assert.equal(hit.bounds.length, 0);
  assert.equal(hit.damage, 7);
});

test("Descent of Dragons: dragon arrows hit up to 1.5x, at least 8, at most 48", () => {
  const attacker = fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.DRAGON_ARROW, special: "dark_bow" });
  sourceMax = 20;
  assert.equal(shoot(attacker, true).damage, 30);
  assert.deepEqual(rolledBounds[0].minimumBonus, 0);
  sourceMax = 40; // 1.5x would be 60
  assert.equal(shoot(attacker, true).damage, 48);
  sourceMax = 3; // a tiny max hit still gets the minimum
  const small = shoot(attacker, true);
  assert.equal(small.bounds[0].minimumBonus, 0);
  assert.equal(small.damage, 8);
});

test("Descent of Darkness: other arrows hit up to 1.3x, at least 5, uncapped", () => {
  const attacker = fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.RUNE_ARROW, special: "dark_bow" });
  sourceMax = 50;
  const hit = shoot(attacker, true);
  assert.equal(hit.damage, 65);
  assert.equal(hit.bounds[0].minimumBonus, 0);
});

test("a dark bow arrow that misses still deals the minimum", () => {
  const dragon = fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.DRAGON_ARROW, special: "dark_bow" });
  sourceMax = 40;
  const miss = shoot(dragon, false);
  assert.deepEqual(miss.bounds[0], { minimumMultiplier: 0, maximumMultiplier: 0, minimumBonus: 0, maximumBonus: 8 });
  assert.equal(miss.damage, 8);
  const rune = fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.RUNE_ARROW, special: "dark_bow" });
  assert.equal(shoot(rune, false).damage, 5);
});

test("Descent leaves ordinary dark bow shots alone and drains 55% once per shot", () => {
  const off = fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.DRAGON_ARROW, special: "dark_bow", activated: false });
  assert.equal(shoot(off, false, 0).bounds.length, 0);
  drains.length = 0;
  const attacker = fakePlayer({ weapon: I.DARK_BOW_4, ammo: Ammunition.DRAGON_ARROW, rangedWeapon: RangedWeapon.DARK_BOW, special: "dark_bow" });
  const method = CombatSpecial.getById("dark_bow").getCombatMethod();
  assert.equal(method.canAttack(attacker, target), true);
  method.start(attacker, target);
  assert.deepEqual(drains, [55]);
});

test("Concentrated Shot costs 65%, drained once, with 25% more accuracy and damage", () => {
  const shot = CombatSpecial.getById("ballista");
  assert.equal(shot.getDrainAmount(), 65);
  assert.equal(shot.getAccuracyMultiplier(), 1.25);
  assert.equal(shot.getStrengthMultiplier(), 1.25);
  assert.equal(shot.getTraits(), undefined, "the flat multipliers drive the roll");
  drains.length = 0;
  const attacker = fakePlayer({ weapon: I.HEAVY_BALLISTA, rangedWeapon: RangedWeapon.BALLISTA, special: "ballista" });
  assert.equal(shot.getCombatMethod().canAttack(attacker, target), true);
  assert.deepEqual(drains, []);
  shot.getCombatMethod().start(attacker, target);
  assert.deepEqual(drains, [65]);
  assert.equal(attacker.state.animations, 1);
});

test("Concentrated Shot from a non-ballista drains nothing", () => {
  drains.length = 0;
  const attacker = fakePlayer({ weapon: I.HEAVY_BALLISTA, rangedWeapon: RangedWeapon.MAGIC_SHORTBOW, special: "ballista" });
  assert.equal(CombatSpecial.getById("ballista").getCombatMethod().canAttack(attacker, target), false);
  assert.deepEqual(drains, []);
});

test("toggling the special off cancels it without draining", () => {
  for (const special of ["magic_shortbow", "dark_bow", "ballista"]) {
    drains.length = 0;
    const sent = [];
    const player = fakePlayer({ weapon: I.DARK_BOW, special });
    player.getDueling = () => ({ inDuel: () => false });
    player.getWeapon = () => null;
    player.setSpecialActivated = (value) => { player.state.activated = value; };
    player.setCombatSpecial = (value) => { player.state.special = value; };
    player.getPacketSender = () => ({
      updateSpecialAttackOrb: () => sent.push("orb"),
      sendSpecialAttackState: (on) => sent.push(on),
    });
    CombatSpecial.activate(player);
    assert.equal(player.state.activated, false, `${special} is off after the second press`);
    assert.deepEqual(drains, []);
    assert.ok(sent.includes("orb"), "the bar is refreshed");
  }
});

test("Snapshot and Descent each launch two independently delayed hits", (t) => {
  const { PendingHit } = core;
  const rolledAmounts = [];
  t.mock.method(PendingHit.prototype, "prepareHits", (amount) => { rolledAmounts.push(amount); return []; });
  const { WeaponInterfaces } = core;
  for (const [special, weapon, profile, expected] of [
    ["magic_shortbow", I.MAGIC_SHORTBOW, WeaponInterfaces.SHORTBOW, [2, 3]],
    ["dark_bow", I.DARK_BOW, WeaponInterfaces.DARK_BOW, [2, 3]],
  ]) {
    const player = fakePlayer({ weapon, special });
    const items = [];
    items[Equipment.WEAPON_SLOT] = { getId: () => weapon };
    player.getEquipment = () => ({ getItems: () => items });
    player.getWeapon = () => profile;
    player.getFightType = () => null;
    player.getLocation = () => ({ getDistance: () => 6 });
    const hits = CombatSpecial.getById(special).getCombatMethod().hits(player, target);
    assert.deepEqual(hits.map((hit) => hit.getDelay()), expected);
    assert.equal(hits.length, 2);
  }
  assert.deepEqual(rolledAmounts, [1, 1, 1, 1], "one accuracy and damage roll per arrow");
});

test("seeking dragon arrows use Descent of Dragons, and BH increases each minimum by two", () => {
  sourceMax = 40;
  for (const ammo of [Ammunition.DRAGON_ARROW, Ammunition.SEEKING_DRAGON_ARROW]) {
    assert.equal(shoot(fakePlayer({ weapon: I.DARK_BOW, ammo, special: "dark_bow" }), false).damage, 8);
    const bh = fakePlayer({ weapon: I.DARK_BOW_BH_, ammo, special: "dark_bow" });
    assert.equal(shoot(bh, false).damage, 10);
    assert.equal(shoot(bh, true).damage, 48);
    assert.equal(rolledBounds[0].minimumBonus, 10);
  }
  assert.equal(shoot(fakePlayer({ weapon: I.DARK_BOW_BH_, ammo: Ammunition.RUNE_ARROW, special: "dark_bow" }), false).damage, 7);
});

test("ordinary Descent rolls before clamping so over-cap rolls keep their probability", () => {
  sourceMax = 40;
  const shot = shoot(fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.DRAGON_ARROW, special: "dark_bow" }), true);
  assert.equal(shot.bounds[0].maximumBonus, 60);
  assert.equal(shot.bounds[0].minimumBonus, 0);
  assert.equal(shot.damage, 48);
});
