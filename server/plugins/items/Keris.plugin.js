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
const SUN_PARTISANS = new Set([
  ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN,
  ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN_2,
]);
/**
 * Keris partisan of the sun (https://oldschool.runescape.wiki/w/Keris_partisan_of_the_sun), both only in
 * the Tombs of Amascut: "a 25% increase to accuracy for targets with less than 25% health", and on a kill it
 * heals "12 Hitpoints ... at the cost of 5 prayer points", overhealing "up to 12 Hitpoints above their base
 * Hitpoints level". Since 13 May 2026 the heal works on every Kephri scarab too, so any kill counts.
 */
const SUN_HEAL = 12;
const SUN_HEAL_PRAYER_COST = 5;
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
let pluginApi;

/** The core API; target checks judge an area hit against its own victim (core.hitTargetOf). */
function init(api) {
  core = api.core;
  pluginApi = api;
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

function inTombs(player) {
  const query = { player, inside: false };
  pluginApi.emitCustomEvent("toa:in-tombs", query);
  return query.inside === true;
}

/** Below 25% of its hitpoints: the sun partisan's accuracy threshold. */
function belowQuarterHealth(target) {
  if (!target?.isNpc?.()) return false;
  const npc = target.getAsNpc();
  const max = Number(npc.getMaxHitpoints?.() ?? 0);
  return max > 0 && npc.getHitpoints() * 4 < max;
}

function applySunAccuracy(attacker, attackRoll) {
  const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
  if (!player || !SUN_PARTISANS.has(weaponId(player))) return attackRoll;
  if (!belowQuarterHealth(core?.hitTargetOf(attacker)) || !inTombs(player)) return attackRoll;
  return Math.floor(attackRoll * 5 / 4);
}

/**
 * The sun partisan's kill heal goes to the player who landed the killing hit, judged by the weapon they held
 * as the NPC began dying. Ours: with fewer than 5 prayer
 * points left it neither heals nor drains (the Wiki gives only the cost), and a player already at the
 * 12-over cap keeps both their hitpoints and their prayer.
 */
function sunKillHeal(event) {
  const player = event?.lastDamager;
  // The weapon that killed it, as the death began: a swap during the death animation doesn't count.
  const weapon = Number(event.lastDamagerWeaponId ?? weaponId(player));
  if (!player?.isRegistered?.() || !SUN_PARTISANS.has(weapon) || !inTombs(player)) return;
  const { Skill } = core;
  const skills = player.getSkillManager();
  const prayer = skills.getCurrentLevel(Skill.PRAYER);
  if (prayer < SUN_HEAL_PRAYER_COST) return;
  const hitpoints = skills.getCurrentLevel(Skill.HITPOINTS);
  const healed = Math.min(hitpoints + SUN_HEAL, skills.getMaxLevel(Skill.HITPOINTS) + SUN_HEAL);
  if (healed <= hitpoints) return;
  skills.setCurrentLevels(Skill.PRAYER, prayer - SUN_HEAL_PRAYER_COST);
  player.setHitpoints(healed);
}

module.exports = {
  name: "Keris",
  description: "Gives the keris family extra damage against Kalphites and Scabarites, with a rare triple-damage hit, and Amascut's partisan its own boost, and the sun partisan's Tombs of Amascut accuracy and kill heal.",
  members: true,
  register(api) {
    init(api);
    api.registerMeleeHitModifier(applyKerisDamage);
    api.registerMeleeAttackAccuracyModifier(applyBreachingAccuracy);
    api.registerMeleeAttackAccuracyModifier(applySunAccuracy);
    api.onNpcDeath(sunKillHeal);
  },
};
