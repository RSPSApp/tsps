// Run after `yarn build`: node --test tests/dorgeshuun-specials.test.cjs
// Backstab (bone dagger) and Snipe (Dorgeshuun crossbow), from the Wiki: a guaranteed hit on a
// target nobody, or another player, damaged last, and a Defence drain from its base level only.
// Also the crossbow's ammunition: bronze, blurite, iron and bone bolts.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Combat } = require("../dist/game/content/combat/Combat");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { Ammunition, RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Skill } = require("../dist/game/model/Skill");
const { World } = require("../dist/game/World");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const core = PluginManager.getCoreApi();
for (const file of ["BoneDagger", "DorgeshuunCrossbow"]) {
  require(`../plugins/combat/specials/${file}.SpecialAttack`)({ core, registerCombatSpecial: CombatSpecial.register });
}
const SPECIALS = [["bone_dagger", CombatType.MELEE], ["dorgeshuun_crossbow", CombatType.RANGED]];

let cycle = 0;
World.getProcessCycle = () => cycle;

const player = (name) => ({ name, isPlayer: () => true, isNpc: () => false, isRegistered: () => true });

/** Whether the special's hit lands when every accuracy roll misses and `lastDamager` hit the target last. */
function lands(id, combatType, attacker, lastDamager) {
  const hit = {
    attacker,
    combatType,
    target: { getCombat: () => ({ getLastDamager: () => lastDamager }), getHitpoints: () => 99 },
    method: { accuracyDefenceType: () => 0 },
  };
  return PendingHit.prototype.rollSpecialTraits.call(hit, CombatSpecial.getById(id).getTraits(), false, true, 0).accurate;
}

test("Backstab and Snipe never miss a target nobody, or another player, damaged last", (t) => {
  t.mock.method(AccuracyFormulasDpsCalc, "rollAccuracyCount", () => 0);
  const me = player("me");
  for (const [id, combatType] of SPECIALS) {
    assert.equal(lands(id, combatType, me, null), true, `${id}: undamaged target`);
    assert.equal(lands(id, combatType, me, player("other")), true, `${id}: last damaged by someone else`);
    assert.equal(lands(id, combatType, me, me), false, `${id}: the wielder damaged it last`);
  }
});

test("a target's last damager is the player whose damage was recorded most recently", () => {
  cycle = 0;
  const combat = new Combat({ isPlayer: () => false, isNpc: () => true });
  const [a, b] = [player("a"), player("b")];
  assert.equal(combat.getLastDamager(), null);
  combat.addDamage(a, 5);
  combat.addDamage(b, 3);
  assert.equal(combat.getLastDamager(), b);
  combat.addDamage(a, 0);
  assert.equal(combat.getLastDamager(), b, "a splash of 0 damages nothing");
  combat.addDamage(a, 1);
  assert.equal(combat.getLastDamager(), a, "a returning damager is last again");
  combat.addDamage({ isPlayer: () => false, isNpc: () => true }, 4);
  assert.equal(combat.getLastDamager(), a, "NPC damage is not a player's");
  combat.clearDamageMap();
  assert.equal(combat.getLastDamager(), null, "a disengaged fight forgets its damagers");
});

function npc(defence) {
  const value = Object.create(NPC.prototype);
  value.drainedLevels = new Map();
  value.statRestoreTicks = 100;
  value.getCurrentDefinition = () => ({ getStats: () => [100, 100, defence, 100, 100], getMaxHit: () => 11, hasAttribute: () => false });
  value.isPlayer = () => false;
  value.isNpc = () => true;
  value.getAsNpc = () => value;
  return value;
}

const hit = (target, damage, accurate = true) => ({ getTarget: () => target, getTotalDamage: () => damage, isAccurate: () => accurate });

test("Backstab and Snipe lower an NPC's Defence by the damage, only from its base level", () => {
  cycle = 0;
  for (const [id] of SPECIALS) {
    const method = CombatSpecial.getById(id).getCombatMethod();
    const value = npc(100);
    method.handleAfterHitEffects(hit(value, 30, false));
    assert.equal(value.getDefenceLevel(), 100, `${id}: a miss drains nothing`);
    method.handleAfterHitEffects(hit(value, 30));
    assert.equal(value.getDefenceLevel(), 70, id);
    method.handleAfterHitEffects(hit(value, 30));
    assert.equal(value.getDefenceLevel(), 70, `${id}: no second drain while lowered`);
    const weak = npc(10);
    method.handleAfterHitEffects(hit(weak, 25));
    assert.equal(weak.getDefenceLevel(), 0, `${id}: an NPC's Defence can reach 0`);
  }
});

test("the Dorgeshuun crossbow fires bronze, blurite, iron and bone bolts, and nothing else", () => {
  const fired = RangedWeapon.DORGESHUUN_CROSSBOW.getAmmunitionData().map((ammo) => ammo.getItemId());
  assert.deepEqual(fired, [ItemIdentifiers.BRONZE_BOLTS, ItemIdentifiers.BLURITE_BOLTS, ItemIdentifiers.IRON_BOLTS, ItemIdentifiers.BONE_BOLTS]);
  const bone = Ammunition.getForItem(ItemIdentifiers.BONE_BOLTS);
  assert.equal(bone.getStrength(), 49);
  assert.equal(bone.getProjectileId(), 696, "dttd_bone_crossbowbolt_travel");
  for (const weapon of [RangedWeapon.RUNE_CROSSBOW, RangedWeapon.ARMADYL_CROSSBOW]) {
    assert.equal(weapon.getAmmunitionData().includes(bone), false, "bone bolts fit no other crossbow");
  }
});
