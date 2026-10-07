/**
 * Salve amulets against undead (Wiki: Salve amulet; order and rounding from the
 * Wiki DPS calculator):
 * - salve amulet and (i): melee accuracy and damage x7/6; (e) and (ei): x6/5.
 * - (i) also ranged x7/6, and magic +15% accuracy and +15% magic damage; (ei) 20%.
 * The salve wins over a black mask or slayer helmet for any style it boosts; the
 * slayer helmet asks through "salve:applies".
 */
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { asPlayer, wornName, targetHasAttribute, scale } = require("./GearChecks");

const SALVES = new Map([
  ["salve amulet", { melee: [7, 6] }],
  ["salve amulet (e)", { melee: [6, 5] }],
  ["salve amulet(i)", { melee: [7, 6], ranged: [7, 6], magicPercent: 15 }],
  ["salve amulet(ei)", { melee: [6, 5], ranged: [6, 5], magicPercent: 20 }],
]);

/** The worn salve's bonuses when it boosts `style` against the entity's target. */
function activeSalve(entity, style) {
  const player = asPlayer(entity);
  if (!player) return null;
  const salve = SALVES.get(wornName(player, Equipment.AMULET_SLOT));
  if (!salve) return null;
  const boosts = style === "magic" ? salve.magicPercent != null : salve[style] != null;
  return boosts && targetHasAttribute(entity, "undead") ? salve : null;
}

function meleeBoost(entity, value) {
  const salve = activeSalve(entity, "melee");
  return salve ? scale(value, ...salve.melee) : value;
}

function rangedBoost(entity, value) {
  const salve = activeSalve(entity, "ranged");
  return salve ? scale(value, ...salve.ranged) : value;
}

function magicAccuracyBoost(entity, value) {
  const salve = activeSalve(entity, "magic");
  return salve ? scale(value, 100 + salve.magicPercent, 100) : value;
}

/** Magic damage in permille: the salve adds to the magic damage bonus. */
function magicDamageBonus(entity, permille) {
  const salve = activeSalve(entity, "magic");
  return salve ? permille + salve.magicPercent * 10 : permille;
}

/** "salve:applies": { player, style } -> applies = true when a salve boosts that style. */
function salveApplies(payload) {
  if (activeSalve(payload?.player, payload?.style)) payload.applies = true;
}

module.exports = function registerSalveAmuletEffects(api) {
  api.registerMeleeAttackAccuracyModifier(meleeBoost);
  api.registerMeleeHitModifier(meleeBoost);
  api.registerRangedAttackAccuracyModifier(rangedBoost);
  api.registerRangedHitModifier(rangedBoost);
  api.registerMagicAttackAccuracyModifier(magicAccuracyBoost);
  api.registerMagicDamageBonusModifier(magicDamageBonus);
  api.onCustomEvent("salve:applies", salveApplies);
};

module.exports._test = { activeSalve, meleeBoost, rangedBoost, magicAccuracyBoost, magicDamageBonus };
