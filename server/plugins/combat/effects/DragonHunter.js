/**
 * Dragonbane weapons against draconic targets (Wiki: Dragon hunter lance,
 * crossbow and wand; order and rounding from the Wiki DPS calculator). Elvarg
 * and revenant dragons have no "dragon" attribute, so they get nothing.
 * - Lance: melee accuracy and damage x6/5.
 * - Wand: accuracy x7/4 and damage x7/5, cast or bashed.
 * - Crossbow: ranged accuracy x13/10 and damage x5/4. With an imbued slayer
 *   helmet on task the damage is additive with it instead: the helmet's 23/20
 *   becomes 28/20, through "slayer:imbued-ranged-bonus".
 */
const { asPlayer, weaponName, targetHasAttribute, scale } = require("./GearChecks");

const LANCE = new Set(["dragon hunter lance"]);
const WAND = new Set(["dragon hunter wand"]);
const CROSSBOW = new Set(["dragon hunter crossbow", "dragon hunter crossbow (t)", "dragon hunter crossbow (b)"]);

let pluginApi;

function usingVsDragon(entity, weapons) {
  const player = asPlayer(entity);
  return player != null && weapons.has(weaponName(player)) && targetHasAttribute(entity, "dragon");
}

function meleeAccuracy(entity, value) {
  if (usingVsDragon(entity, LANCE)) return scale(value, 6, 5);
  if (usingVsDragon(entity, WAND)) return scale(value, 7, 4);
  return value;
}

function meleeDamage(entity, value) {
  if (usingVsDragon(entity, LANCE)) return scale(value, 6, 5);
  if (usingVsDragon(entity, WAND)) return scale(value, 7, 5);
  return value;
}

function magicAccuracy(entity, value) {
  return usingVsDragon(entity, WAND) ? scale(value, 7, 4) : value;
}

function magicDamage(entity, value) {
  return usingVsDragon(entity, WAND) ? scale(value, 7, 5) : value;
}

function rangedAccuracy(entity, value) {
  return usingVsDragon(entity, CROSSBOW) ? scale(value, 13, 10) : value;
}

function imbuedSlayerActive(entity) {
  const query = { player: asPlayer(entity), style: "ranged", active: false };
  pluginApi.emitCustomEvent("slayer:imbued-active", query);
  return query.active === true;
}

function rangedDamage(entity, value) {
  if (!usingVsDragon(entity, CROSSBOW) || imbuedSlayerActive(entity)) return value;
  return scale(value, 5, 4);
}

/** "slayer:imbued-ranged-bonus": { player, numerator } -> +5/20 with the crossbow vs a dragon. */
function addToSlayerBonus(payload) {
  if (usingVsDragon(payload?.player, CROSSBOW)) payload.numerator += 5;
}

module.exports = function registerDragonHunterEffects(api) {
  pluginApi = api;
  api.registerMeleeAttackAccuracyModifier(meleeAccuracy);
  api.registerMeleeHitModifier(meleeDamage);
  api.registerMagicAttackAccuracyModifier(magicAccuracy);
  api.registerMagicHitModifier(magicDamage);
  api.registerRangedAttackAccuracyModifier(rangedAccuracy);
  api.registerRangedHitModifier(rangedDamage);
  api.onCustomEvent("slayer:imbued-ranged-bonus", addToSlayerBonus);
};

module.exports._test = { meleeAccuracy, meleeDamage, magicAccuracy, magicDamage, rangedAccuracy, rangedDamage };
