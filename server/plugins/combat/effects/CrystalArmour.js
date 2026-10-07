/**
 * Crystal armour with a crystal bow or bow of Faerdhinen (Wiki: Crystal equipment;
 * rounding from the Wiki DPS calculator): helm, legs and body count 1, 2 and 3
 * pieces, and the bow's accuracy rises by pieces/20 and its damage by pieces/40 -
 * 30% and 15% for the full set. Applied before other gear bonuses.
 */
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { asPlayer, wornName, weaponName, scale } = require("./GearChecks");

const PIECES = [
  [Equipment.HEAD_SLOT, "crystal helm", 1],
  [Equipment.LEG_SLOT, "crystal legs", 2],
  [Equipment.BODY_SLOT, "crystal body", 3],
];
/** The Gauntlet's crystal gear has the same names with a quality suffix and no set effect. */
const GAUNTLET_OR_INACTIVE = /\((basic|attuned|perfected|inactive)\)/;

function crystalBow(name) {
  if (GAUNTLET_OR_INACTIVE.test(name)) return false;
  return name.startsWith("crystal bow") || name.startsWith("bow of faerdhinen");
}

function pieces(entity) {
  const player = asPlayer(entity);
  if (!player || !crystalBow(weaponName(player))) return 0;
  return PIECES.reduce((total, [slot, name, count]) => (wornName(player, slot) === name ? total + count : total), 0);
}

function accuracy(entity, value) {
  const count = pieces(entity);
  return count > 0 ? scale(value, 20 + count, 20) : value;
}

function damage(entity, value) {
  const count = pieces(entity);
  return count > 0 ? scale(value, 40 + count, 40) : value;
}

module.exports = function registerCrystalArmourEffects(api) {
  api.registerRangedAttackAccuracyModifier(accuracy);
  api.registerRangedHitModifier(damage);
};

module.exports._test = { pieces, accuracy, damage };
