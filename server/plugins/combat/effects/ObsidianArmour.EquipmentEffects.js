/**
 * Obsidian weapon bonuses (Wiki: Obsidian armour, Berserker necklace; order and
 * rounding from the Wiki DPS calculator), melee with a TzHaar weapon only:
 * - Helmet, platebody and platelegs together: +10% melee accuracy and damage.
 * - Berserker necklace or (or): damage x6/5.
 */
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { asPlayer, wearing, weaponName, scale } = require("./GearChecks.EquipmentEffects");

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

let coreApi;
const lastLoadouts = new WeakMap();

function effectLines(request) {
  const player = asPlayer(request?.player);
  if (!player || !coreApi || !tzhaarWielder(player)) return;
  if (wearingSet(player)) request.lines.push("Obsidian armour: +10% melee accuracy and damage");
  if (wearing(player, Equipment.AMULET_SLOT, BERSERKER_NECKLACES)) {
    request.lines.push("Berserker necklace: +20% melee damage");
  }
}

function loadoutSignature(player) {
  const items = player.getEquipment().getItems();
  return [Equipment.WEAPON_SLOT, Equipment.AMULET_SLOT, Equipment.HEAD_SLOT, Equipment.BODY_SLOT, Equipment.LEG_SLOT]
    .map((slot) => items[slot]?.getId?.() ?? -1)
    .join(",");
}

/** A weapon, necklace or armour change changes the melee loadout, so redraw the combat tab. */
function refreshCombatTab({ player }) {
  if (!player || !coreApi) return;
  const signature = loadoutSignature(player);
  const previous = lastLoadouts.get(player);
  lastLoadouts.set(player, signature);
  if (previous === signature) return;
  coreApi.WeaponInterfaceManager.assign(player);
  player.getUpdateFlag()?.flag?.(coreApi.Flag.APPEARANCE);
}

function rememberLoadout({ player }) {
  if (player) lastLoadouts.set(player, loadoutSignature(player));
}

module.exports = function registerObsidianEffects(api) {
  coreApi = api.core;
  api.registerMeleeAttackAccuracyModifier(setBonus);
  api.registerMeleeHitModifier(damage);
  api.onCustomEvent?.("equipment:effects", effectLines);
  api.onCustomEvent?.("equipment:changed", refreshCombatTab);
  api.onPlayerLogin?.(rememberLoadout);
};

module.exports._test = { setBonus, damage, effectLines };
