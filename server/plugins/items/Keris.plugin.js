const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");

const KERIS_WEAPONS = new Set([
  ItemIdentifiers.KERIS,
  ItemIdentifiers.KERIS_P_,
  ItemIdentifiers.KERIS_P_PLUS_,
  ItemIdentifiers.KERIS_P_PLUS_PLUS_,
  ItemIdentifiers.KERIS_2,
  ItemIdentifiers.KERIS_P__2,
  ItemIdentifiers.KERIS_P_PLUS__2,
  ItemIdentifiers.KERIS_P_PLUS_PLUS__2,
  ItemIdentifiers.KERIS_PARTISAN,
  ItemIdentifiers.KERIS_PARTISAN_2,
  ItemIdentifiers.KERIS_PARTISAN_OF_BREACHING,
  ItemIdentifiers.KERIS_PARTISAN_OF_BREACHING_2,
  ItemIdentifiers.KERIS_PARTISAN_OF_CORRUPTION,
  ItemIdentifiers.KERIS_PARTISAN_OF_CORRUPTION_2,
  ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN,
  ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN_2,
]);
const AMASCUT_PARTISANS = new Set([
  ItemIdentifiers.KERIS_PARTISAN_OF_AMASCUT,
  ItemIdentifiers.KERIS_PARTISAN_OF_AMASCUT_2,
]);
const BREACHING_PARTISANS = new Set([
  ItemIdentifiers.KERIS_PARTISAN_OF_BREACHING,
  ItemIdentifiers.KERIS_PARTISAN_OF_BREACHING_2,
]);

function weaponId(player) {
  return Number(player?.getEquipment?.()?.get?.(Equipment.WEAPON_SLOT)?.getId?.() ?? -1);
}

function isKeris(player) {
  const id = weaponId(player);
  return KERIS_WEAPONS.has(id) || AMASCUT_PARTISANS.has(id);
}

function isKalphiteOrScabarite(target) {
  if (!target?.isNpc?.()) {
    return false;
  }
  // The monster data's kalphite attribute covers the scarabs too (Scarab Mage, Locust rider, Kephri, the Tombs of Amascut
  // swarms), whose names say neither; the name is the fallback for definitions without attributes.
  const definition = target.getAsNpc()?.getCurrentDefinition?.();
  if (definition?.hasAttribute?.("kalphite") === true) return true;
  return /kalphite|scabarite/i.test(definition?.getName?.() ?? "");
}

let core;

/** The core API; target checks judge an area hit against its own victim (core.hitTargetOf). */
function init(api) {
  core = api.core;
}

function applyKerisDamage(attacker, maxHit) {
  const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
  const target = core?.hitTargetOf(attacker);
  if (!player || !isKeris(player) || !isKalphiteOrScabarite(target)) {
    return maxHit;
  }
  // Integer ratios: floating 1.15 turns a max hit of 100 into 114.
  const [numerator, denominator] = AMASCUT_PARTISANS.has(weaponId(player)) ? [23, 20] : [4, 3];
  const criticalMultiplier = Misc.randomInclusive(1, 51) === 1 ? 3 : 1;
  return Math.floor((maxHit * numerator * criticalMultiplier) / denominator);
}

function applyBreachingAccuracy(attacker, attackRoll) {
  const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
  const target = core?.hitTargetOf(attacker);
  if (!player || !BREACHING_PARTISANS.has(weaponId(player)) || !isKalphiteOrScabarite(target)) {
    return attackRoll;
  }
  return Math.floor(attackRoll * 4 / 3);
}

module.exports = {
  name: "Keris",
  description: "Gives the keris family extra damage against Kalphites and Scabarites, with a rare triple-damage hit, and Amascut's partisan its own boost.",
  members: true,
  register(api) {
    init(api);
    api.registerMeleeHitModifier(applyKerisDamage);
    api.registerMeleeAttackAccuracyModifier(applyBreachingAccuracy);
  },
};
