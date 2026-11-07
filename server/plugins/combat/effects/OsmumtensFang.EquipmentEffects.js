/**
 * Osmumten's fang passive (Wiki: Osmumten's fang).
 * - Accuracy: with a stab-bonus style, outside the Tombs of Amascut (toa:in-tombs) the fang rolls the player's
 *   accuracy a second time against the same defence roll and hits if either beats it. Inside the
 *   raid the whole check (defence included) is repeated.
 * - Damage: a normal successful hit deals 15% to 85% of the max hit, not 0 to max. Eviscerate
 *   keeps its own 15% to 100% range (OsmumtensFang.SpecialAttack.js).
 */
const { asPlayer, weaponName } = require("./GearChecks.EquipmentEffects");

const FANG_NAME = "osmumten's fang";
const FANG_OR_NAME = "osmumten's fang (or)";
const MINIMUM_SHARE = 3 / 20;

let core;
let pluginApi;

function fangWielder(entity) {
  const player = asPlayer(entity);
  const weapon = player ? weaponName(player) : "";
  return weapon === FANG_NAME || weapon === FANG_OR_NAME ? player : null;
}

function inTombs(player) {
  const query = { player, inside: false };
  pluginApi.emitCustomEvent("toa:in-tombs", query);
  return query.inside === true;
}

function rollUpTo(max) {
  return Math.floor(Math.random() * (Math.max(0, Math.floor(max)) + 1));
}

function secondAccuracyRoll(rolled) {
  const player = fangWielder(rolled.attacker);
  if (!player || rolled.accurate || rolled.combatType !== core.CombatType.MELEE) return;
  if (player.getFightType?.()?.getBonusType?.() !== core.BonusManager.ATTACK_STAB) return;
  const defence = inTombs(player) ? rollUpTo(rolled.defence) : rolled.defenceRolled;
  rolled.accurate = rollUpTo(rolled.attack) > defence;
}

/** The Wiki calculator's range: shrink = trunc(max * 3 / 20), damage from shrink to max - shrink. */
function narrowedDamage(rolled) {
  if (!fangWielder(rolled.attacker) || rolled.combatType !== core.CombatType.MELEE) return;
  if (core.CombatSpecial.activeTraitsFor(rolled.attacker)) return;
  if (rolled.minimum >= rolled.maximum) return;
  const shrink = Math.floor(rolled.maximum * MINIMUM_SHARE);
  rolled.minimum = shrink;
  rolled.maximum = rolled.maximum - shrink;
  rolled.damage = shrink + rollUpTo(rolled.maximum - shrink);
}

module.exports = function registerOsmumtensFangEffects(api) {
  core = api.core;
  pluginApi = api;
  api.onCustomEvent("combat:accuracy-rolled", secondAccuracyRoll);
  api.onCustomEvent("combat:hit-rolled", narrowedDamage);
};
