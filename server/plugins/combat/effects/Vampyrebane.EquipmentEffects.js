/**
 * Vampyrebane weapons and the vampyre damage tiers, against NPCs tagged with the Wiki's `vampyre` attribute.
 * Source: OSRS Wiki, Vampyre, Vampyrebane weapons, Silver weaponry and Efaritay's aid.
 * - Tier 1 (feral vampyres, vampyre juveniles): every weapon deals full damage; Silverlight and Darklight add 10%.
 * - Tier 2 (vampyre juvinates): only silver weapons, silver bolts and the tier 3 weapons deal damage; anything
 *   else deals nothing, or half with Efaritay's aid.
 * - Tier 3 (Vyrewatch, Vyrewatch Sentinels, venators, ancient feral vyres): only the vampyrebane table below deals damage.
 * - Efaritay's aid: +10% damage to every weapon on tier 1, +15% accuracy to silver weapons on tier 1 and 2, and +15%
 *   accuracy and +10% damage to the weapons that can hurt the tier on tiers 2 and 3.
 * Spells are left alone: the Wiki says nothing about them.
 */
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { asPlayer, weaponName, wornName, targetNpc, scale, addPercent } = require("./GearChecks.EquipmentEffects");

const EFARITAYS_AID = "efaritay's aid";
const SILVER_BOLTS = "silver bolts";
const TIER_ONE_NPCS = new Set(["feral vampyre", "vampyre juvenile"]);
const TIER_TWO_NPCS = new Set(["vampyre juvinate"]);
const TIER_THREE_NPCS = new Set(["vyrewatch", "vyrewatch sentinel", "ancient feral vyre", "venator", "blood-starved venator"]);
/** Weapons that deal full damage to juvinates but cannot hurt tier 3 (Wiki, Silver weaponry). */
const SILVER_WEAPONS = new Set([
  "blessed axe", "rod of ivandis", "silver sickle", "silver sickle (b)", "emerald sickle (b)",
  "enchanted emerald sickle (b)", "ruby sickle (b)", "enchanted ruby sickle (b)", "diamond sickle (b)",
  "enchanted diamond sickle (b)", "blisterwood sickle (e)", "silverlight", "silverlight (dyed)", "darklight",
  "arclight", "emberlight", "wolfbane",
]);
/** In the vampyrebane table for its bonus, but the Wiki lists it among the tier 2 weapons only. */
const TIER_TWO_ONLY = new Set(["blisterwood sickle (e)"]);
const TIER_ONE_SILVER_BONUS = new Set(["silverlight", "silverlight (dyed)", "darklight"]);

const MELEE = new Map([
  ["ivandis flail", { damage: 20, accuracy: 0 }],
  ["blisterwood sickle", { damage: 15, accuracy: 5 }],
  ["blisterwood sickle (e)", { damage: 15, accuracy: 5 }],
  ["blisterwood flail", { damage: 25, accuracy: 5 }],
  ["hallowed flail", { damage: 25, accuracy: 25 }],
  ["sunspear", { damage: 50, accuracy: 25 }],
]);
const RANGED = new Map([["blisterwood stake", { damage: 25, accuracy: 25 }]]);

/** 0 for anything that is not a vampyre, else the Wiki tier 1-3 of the NPC the entity is fighting. */
function vampyreTier(entity) {
  const definition = targetNpc(entity)?.getCurrentDefinition?.();
  if (definition?.hasAttribute?.("vampyre") !== true) return 0;
  const name = String(definition.getName?.() ?? "").toLowerCase();
  if (TIER_THREE_NPCS.has(name)) return 3;
  if (TIER_TWO_NPCS.has(name)) return 2;
  return 1;
}

function wearsEfaritaysAid(player) {
  return wornName(player, Equipment.RING_SLOT) === EFARITAYS_AID;
}

/** Silver in hand for a tier 2 vampyre: a silver weapon, or silver bolts fired from a crossbow. */
function isSilver(player, table) {
  return SILVER_WEAPONS.has(weaponName(player)) || (table === RANGED && wornName(player, Equipment.AMMUNITION_SLOT).startsWith(SILVER_BOLTS));
}

/** Whether the attack is made with a weapon the tier lets through. */
function canHurt(player, tier, table) {
  const weapon = weaponName(player);
  if (table.has(weapon)) return tier === 2 || !TIER_TWO_ONLY.has(weapon);
  return tier === 2 && isSilver(player, table);
}

function damage(entity, value, table) {
  const player = asPlayer(entity);
  const tier = player ? vampyreTier(entity) : 0;
  if (tier === 0) return value;
  const bonus = table.get(weaponName(player));
  const efaritay = wearsEfaritaysAid(player);
  let result = bonus ? scale(value, 100 + bonus.damage, 100) : value;
  if (tier === 1) {
    if (TIER_ONE_SILVER_BONUS.has(weaponName(player))) result = addPercent(result, 10);
    return efaritay ? addPercent(result, 10) : result;
  }
  if (!canHurt(player, tier, table)) return tier === 2 && efaritay ? Math.floor(result / 2) : 0;
  return efaritay ? addPercent(result, 10) : result;
}

function accuracy(entity, value, table) {
  const player = asPlayer(entity);
  const tier = player ? vampyreTier(entity) : 0;
  if (tier === 0) return value;
  const bonus = table.get(weaponName(player));
  let result = bonus ? scale(value, 100 + bonus.accuracy, 100) : value;
  const silver = tier < 3 && isSilver(player, table);
  if (wearsEfaritaysAid(player) && (tier === 3 ? bonus : silver || (tier === 2 && bonus))) result = addPercent(result, 15);
  return result;
}

function meleeDamage(entity, value) { return damage(entity, value, MELEE); }
function meleeAccuracy(entity, value) { return accuracy(entity, value, MELEE); }
function rangedDamage(entity, value) { return damage(entity, value, RANGED); }
function rangedAccuracy(entity, value) { return accuracy(entity, value, RANGED); }

module.exports = function registerVampyrebaneEffects(api) {
  api.registerMeleeHitModifier(meleeDamage);
  api.registerMeleeAttackAccuracyModifier(meleeAccuracy);
  api.registerRangedHitModifier(rangedDamage);
  api.registerRangedAttackAccuracyModifier(rangedAccuracy);
};

module.exports._test = { meleeDamage, meleeAccuracy, rangedDamage, rangedAccuracy };
