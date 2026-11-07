/**
 * Osmumten's fang passive (Wiki: Osmumten's fang).
 * - Accuracy: with a stab-bonus style, outside the Tombs of Amascut the fang rolls the player's
 *   accuracy a second time against the same defence roll and hits if either beats it. Inside the
 *   raid the whole check (defence included) is repeated.
 * - Damage: a normal successful hit deals 15% to 85% of the max hit, not 0 to max. Eviscerate
 *   keeps its own 15% to 100% range (OsmumtensFang.SpecialAttack.js).
 */
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { BonusManager } = require("../../../src/main/typescript/elvarg/game/model/equipment/BonusManager");
const { CombatSpecial } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatSpecial");
const { CombatType } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { asPlayer, wornName } = require("./GearChecks.EquipmentEffects");

const FANG_NAME = "osmumten's fang";
const FANG_OR_NAME = "osmumten's fang (or)";
const RAID_AREA = "Tombs of Amascut";
const MINIMUM_DAMAGE = 0.15;
const MAXIMUM_DAMAGE = 0.85;

function fangWielder(entity) {
  const player = asPlayer(entity);
  const weapon = player ? wornName(player, Equipment.WEAPON_SLOT) : "";
  return weapon === FANG_NAME || weapon === FANG_OR_NAME ? player : null;
}

function rollUpTo(max) {
  return Math.floor(Math.random() * (Math.max(0, Math.floor(max)) + 1));
}

function secondAccuracyRoll(rolled) {
  const player = fangWielder(rolled.attacker);
  if (!player || rolled.accurate || rolled.combatType !== CombatType.MELEE) return;
  if (player.getFightType?.()?.getBonusType?.() !== BonusManager.ATTACK_STAB) return;
  const defence = player.getArea?.()?.getName?.() === RAID_AREA ? rollUpTo(rolled.defence) : rolled.defenceRolled;
  rolled.accurate = rollUpTo(rolled.attack) > defence;
}

function narrowedDamage(rolled) {
  if (!fangWielder(rolled.attacker) || rolled.combatType !== CombatType.MELEE) return;
  if (CombatSpecial.activeTraitsFor(rolled.attacker)) return;
  const minimum = Math.floor(rolled.maximum * MINIMUM_DAMAGE);
  const maximum = Math.floor(rolled.maximum * MAXIMUM_DAMAGE);
  rolled.damage = minimum + rollUpTo(maximum - minimum);
}

module.exports = function registerOsmumtensFangEffects(api) {
  api.onCustomEvent("combat:accuracy-rolled", secondAccuracyRoll);
  api.onCustomEvent("combat:hit-rolled", narrowedDamage);
};
