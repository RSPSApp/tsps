/**
 * Obsidian weapon bonuses (Wiki: Obsidian armour, Berserker necklace; order and
 * rounding from the Wiki DPS calculator), melee with a TzHaar weapon only:
 * - Helmet, platebody and platelegs together: +10% melee accuracy and damage.
 * - Berserker necklace or (or): damage x6/5.
 */
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { asPlayer, wearing, weaponName, scale } = require("./GearChecks");

const TZHAAR_WEAPONS = new Set([
  "tzhaar-ket-em",
  "tzhaar-ket-om",
  "tzhaar-ket-om (t)",
  "toktz-xil-ak",
  "toktz-xil-ek",
  "toktz-mej-tal",
]);
const ARMOUR = [
  [Equipment.HEAD_SLOT, new Set(["obsidian helmet"])],
  [Equipment.BODY_SLOT, new Set(["obsidian platebody"])],
  [Equipment.LEG_SLOT, new Set(["obsidian platelegs"])],
];
const BERSERKER_NECKLACES = new Set(["berserker necklace", "berserker necklace (or)"]);

function tzhaarWielder(entity) {
  const player = asPlayer(entity);
  return player && TZHAAR_WEAPONS.has(weaponName(player)) ? player : null;
}

function wearingSet(player) {
  return ARMOUR.every(([slot, names]) => wearing(player, slot, names));
}

function setBonus(entity, value) {
  const player = tzhaarWielder(entity);
  return player && wearingSet(player) ? value + Math.floor(value / 10) : value;
}

function damage(entity, value) {
  const player = tzhaarWielder(entity);
  if (!player) return value;
  let boosted = wearingSet(player) ? value + Math.floor(value / 10) : value;
  if (wearing(player, Equipment.AMULET_SLOT, BERSERKER_NECKLACES)) boosted = scale(boosted, 6, 5);
  return boosted;
}

module.exports = function registerObsidianEffects(api) {
  api.registerMeleeAttackAccuracyModifier(setBonus);
  api.registerMeleeHitModifier(damage);
};

module.exports._test = { setBonus, damage };
