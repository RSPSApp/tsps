/**
 * Demonbane melee and ranged weapons against demons (Wiki: Demonbane weapons;
 * order and rounding from the Wiki DPS calculator): accuracy and damage each gain
 * a percentage of themselves, rounded down.
 * - Arclight and Emberlight 70%, Silverlight and Darklight 60%, bone and burning claws 5%.
 * - Scorching bow 30% (ranged). Its damage bonus is additive with an imbued slayer helmet's on
 *   task (Wiki: 45% in total): the helmet's 23/20 becomes 29/20, through "slayer:imbued-ranged-bonus".
 * Not modelled: bosses with reduced demonbane effectiveness (Duke Sucellus takes 70% of it).
 */
const { asPlayer, weaponName, targetHasAttribute, addPercent } = require("./GearChecks");

const MELEE_PERCENT = new Map([
  ["arclight", 70],
  ["emberlight", 70],
  ["silverlight", 60],
  ["silverlight (dyed)", 60],
  ["darklight", 60],
  ["bone claws", 5],
  ["burning claws", 5],
]);
const RANGED_PERCENT = new Map([["scorching bow", 30]]);

let pluginApi;

function percentFor(entity, table) {
  const player = asPlayer(entity);
  if (!player) return 0;
  const percent = table.get(weaponName(player)) ?? 0;
  return percent > 0 && targetHasAttribute(entity, "demon") ? percent : 0;
}

function meleeDemonbane(entity, value) {
  const percent = percentFor(entity, MELEE_PERCENT);
  return percent > 0 ? addPercent(value, percent) : value;
}

function rangedDemonbane(entity, value) {
  const percent = percentFor(entity, RANGED_PERCENT);
  return percent > 0 ? addPercent(value, percent) : value;
}

function imbuedSlayerActive(entity) {
  const query = { player: asPlayer(entity), style: "ranged", active: false };
  pluginApi?.emitCustomEvent("slayer:imbued-active", query);
  return query.active === true;
}

/** Ranged damage: the bow's 30%, unless an imbued slayer helmet takes it in additively. */
function rangedDemonbaneDamage(entity, value) {
  if (percentFor(entity, RANGED_PERCENT) > 0 && imbuedSlayerActive(entity)) return value;
  return rangedDemonbane(entity, value);
}

/** "slayer:imbued-ranged-bonus": { player, numerator } -> +6/20 (30%) with the bow vs a demon. */
function addToSlayerBonus(payload) {
  if (payload?.player && percentFor(payload.player, RANGED_PERCENT) > 0) payload.numerator += 6;
}

module.exports = function registerDemonbaneEffects(api) {
  pluginApi = api;
  api.registerMeleeAttackAccuracyModifier(meleeDemonbane);
  api.registerMeleeHitModifier(meleeDemonbane);
  api.registerRangedAttackAccuracyModifier(rangedDemonbane);
  api.registerRangedHitModifier(rangedDemonbaneDamage);
  api.onCustomEvent("slayer:imbued-ranged-bonus", addToSlayerBonus);
};

module.exports._test = { meleeDemonbane, rangedDemonbane, rangedDemonbaneDamage, addToSlayerBonus };
