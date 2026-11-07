// Run after `yarn build`: node --test tests/vampyrebane.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const registerVampyrebane = require("../plugins/combat/effects/Vampyrebane.EquipmentEffects");

const NAMES = new Map([
  [22398, "Ivandis flail"],
  [24697, "Blisterwood sickle"],
  [33713, "Blisterwood sickle (e)"],
  [24699, "Blisterwood flail"],
  [33718, "Hallowed flail"],
  [33716, "Blisterwood stake"],
  [33722, "Sunspear"],
  [2402, "Silverlight"],
  [1333, "Rune scimitar"],
  [2952, "Wolfbane"],
  [21140, "Efaritay's aid"],
  [9145, "Silver bolts"],
  [9292, "Silver bolts (p)"],
]);
ItemDefinition.forId = (id) => ({ getName: () => NAMES.get(id) ?? "" });

function target(attribute, name = "") {
  return {
    isNpc: () => true,
    getAsNpc: () => ({
      getCurrentDefinition: () => ({ hasAttribute: (value) => value === attribute, getName: () => name }),
    }),
  };
}

function createPlayer(weaponId, attribute = "vampyre", npcName = "", { ring = -1, ammo = -1 } = {}) {
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  items[Equipment.WEAPON_SLOT] = { getId: () => weaponId };
  items[Equipment.RING_SLOT] = { getId: () => ring };
  items[Equipment.AMMUNITION_SLOT] = { getId: () => ammo };
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => items }),
    getCombat: () => ({ getTarget: () => target(attribute, npcName) }),
  };
}

function modifiers() {
  const result = {};
  const api = {
    registerMeleeHitModifier: (fn) => { result.meleeDamage = fn; },
    registerMeleeAttackAccuracyModifier: (fn) => { result.meleeAccuracy = fn; },
    registerRangedHitModifier: (fn) => { result.rangedDamage = fn; },
    registerRangedAttackAccuracyModifier: (fn) => { result.rangedAccuracy = fn; },
  };
  registerVampyrebane(api);
  return result;
}

test("vampyrebane weapons apply their Wiki accuracy and damage bonuses only to vampyres", () => {
  const effect = modifiers();
  const cases = [
    [22398, 20, 0],
    [24697, 15, 5],
    [33713, 15, 5],
    [24699, 25, 5],
    [33718, 25, 25],
    [33722, 50, 25],
  ];
  for (const [id, damagePercent, accuracyPercent] of cases) {
    const player = createPlayer(id);
    assert.equal(effect.meleeDamage(player, 101), Math.floor(101 * (100 + damagePercent) / 100), `melee damage for ${NAMES.get(id)}`);
    assert.equal(effect.meleeAccuracy(player, 101), Math.floor(101 * (100 + accuracyPercent) / 100), `melee accuracy for ${NAMES.get(id)}`);
  }

  const stake = createPlayer(33716);
  assert.equal(effect.rangedDamage(stake, 101), 126);
  assert.equal(effect.rangedAccuracy(stake, 101), 126);
  assert.equal(effect.meleeDamage(stake, 101), 101, "stakes boost ranged attacks only");

  const human = createPlayer(33718, "undead");
  assert.equal(effect.meleeDamage(human, 101), 101, "other attributes do not receive the bonus");
  assert.equal(effect.meleeAccuracy(human, 101), 101);
  assert.equal(effect.rangedDamage(createPlayer(33716, ""), 101), 101);
  assert.equal(effect.meleeDamage({ isPlayer: () => false }, 101), 101);
});

const RUNE_SCIMITAR = 1333, SILVERLIGHT = 2402, WOLFBANE = 2952, EFARITAYS_AID = 21140, SILVER_BOLTS = 9145, POISONED_SILVER_BOLTS = 9292;

test("tier 1 vampyres take full damage from every weapon, and 10% more from Silverlight", () => {
  const effect = modifiers();
  for (const name of ["Feral Vampyre", "Vampyre Juvenile"]) {
    assert.equal(effect.meleeDamage(createPlayer(RUNE_SCIMITAR, "vampyre", name), 100), 100);
    assert.equal(effect.meleeDamage(createPlayer(SILVERLIGHT, "vampyre", name), 100), 110);
    assert.equal(effect.meleeDamage(createPlayer(RUNE_SCIMITAR, "vampyre", name, { ring: EFARITAYS_AID }), 100), 110);
    assert.equal(effect.meleeAccuracy(createPlayer(WOLFBANE, "vampyre", name, { ring: EFARITAYS_AID }), 100), 115);
    assert.equal(effect.meleeAccuracy(createPlayer(RUNE_SCIMITAR, "vampyre", name, { ring: EFARITAYS_AID }), 100), 100);
  }
});

test("tier 2 vampyre juvinates take damage from silver only, half from other weapons with Efaritay's aid", () => {
  const effect = modifiers();
  const juvinate = "Vampyre Juvinate";
  assert.equal(effect.meleeDamage(createPlayer(RUNE_SCIMITAR, "vampyre", juvinate), 100), 0);
  assert.equal(effect.meleeDamage(createPlayer(WOLFBANE, "vampyre", juvinate), 100), 100);
  assert.equal(effect.meleeDamage(createPlayer(22398, "vampyre", juvinate), 100), 120, "an ivandis flail still gets its bonus");
  assert.equal(effect.meleeDamage(createPlayer(RUNE_SCIMITAR, "vampyre", juvinate, { ring: EFARITAYS_AID }), 100), 50);
  assert.equal(effect.meleeDamage(createPlayer(WOLFBANE, "vampyre", juvinate, { ring: EFARITAYS_AID }), 100), 110);
  assert.equal(effect.meleeAccuracy(createPlayer(WOLFBANE, "vampyre", juvinate, { ring: EFARITAYS_AID }), 100), 115);
  assert.equal(effect.meleeAccuracy(createPlayer(WOLFBANE, "vampyre", juvinate), 100), 100);
  assert.equal(effect.rangedDamage(createPlayer(RUNE_SCIMITAR, "vampyre", juvinate), 100), 0);
  assert.equal(effect.rangedDamage(createPlayer(RUNE_SCIMITAR, "vampyre", juvinate, { ammo: SILVER_BOLTS }), 100), 100);
  assert.equal(effect.rangedDamage(createPlayer(RUNE_SCIMITAR, "vampyre", juvinate, { ammo: POISONED_SILVER_BOLTS }), 100), 100);
  assert.equal(effect.rangedDamage(createPlayer(RUNE_SCIMITAR, "vampyre", juvinate, { ring: EFARITAYS_AID }), 100), 50);
  assert.equal(effect.meleeDamage(createPlayer(WOLFBANE, "undead", juvinate), 100), 100, "other attributes are untouched");
});

test("tier 3 vampyres take damage from the vampyrebane table only, silver included", () => {
  const effect = modifiers();
  for (const name of ["Vyrewatch", "Vyrewatch Sentinel", "Ancient feral vyre", "Venator", "Blood-starved venator"]) {
    assert.equal(effect.meleeDamage(createPlayer(RUNE_SCIMITAR, "vampyre", name), 100), 0, name);
    assert.equal(effect.meleeDamage(createPlayer(WOLFBANE, "vampyre", name), 100), 0, name);
    assert.equal(effect.meleeDamage(createPlayer(RUNE_SCIMITAR, "vampyre", name, { ring: EFARITAYS_AID }), 100), 0, name);
    assert.equal(effect.meleeDamage(createPlayer(33713, "vampyre", name), 100), 0, "blisterwood sickle (e) is a tier 2 weapon");
    assert.equal(effect.meleeDamage(createPlayer(22398, "vampyre", name), 100), 120, name);
    assert.equal(effect.meleeDamage(createPlayer(22398, "vampyre", name, { ring: EFARITAYS_AID }), 100), 132, name);
    assert.equal(effect.meleeAccuracy(createPlayer(24699, "vampyre", name, { ring: EFARITAYS_AID }), 100), 120, name);
    assert.equal(effect.rangedDamage(createPlayer(RUNE_SCIMITAR, "vampyre", name, { ammo: SILVER_BOLTS }), 100), 0, name);
    assert.equal(effect.rangedDamage(createPlayer(33716, "vampyre", name), 100), 125, name);
  }
});
