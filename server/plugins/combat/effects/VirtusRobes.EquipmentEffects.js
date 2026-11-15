/**
 * Virtus robes (Wiki: Virtus robes): "Each piece of Virtus robes gives a 2% magic damage bonus
 * for a total of 6%. When using combat spells from Ancient Magicks, an additional 3% magic
 * damage is given per piece", so 15% with the mask, robe top and robe bottom. The 2% is each
 * piece's cache magic damage bonus; this adds the 3%.
 *
 * As the Wiki DPS calculator applies it: 30 permille per worn piece whose name contains
 * "Virtus" (the Echo virtus ornamented pieces too), added to the magic damage bonus when the
 * spell cast is an Ancient Magicks one. Powered staves cast no spellbook spell, so get none.
 * Not shown on the equipment stats, which know no spell.
 *
 * The full set also reports its Equipment effects text (enum 3047 id 29), for the plain
 * pieces as the cache names them (the same rule the stats panel's data file used).
 */
const { asPlayer, wornName } = require("./GearChecks.EquipmentEffects");

const PERMILLE_PER_PIECE = 30;
/** The Virtus robes in the equipment effects panel (enum 3047). */
const VIRTUS_SET_TEXT = 29;
const SET_NAMES = ["virtus mask", "virtus robe top", "virtus robe bottom"];
let core;

function slots() {
  const E = core.Equipment;
  return [E.HEAD_SLOT, E.BODY_SLOT, E.LEG_SLOT];
}

/** Worn head, body and leg pieces named Virtus. */
function virtusPieces(player) {
  return slots().filter((slot) => wornName(player, slot).includes("virtus")).length;
}

function ancientSpell(spell) {
  return spell?.getSpellbook != null && spell.getSpellbook() === core.MagicSpellbook.ANCIENT;
}

function magicDamageBonus(entity, permille, spell) {
  const player = asPlayer(entity);
  if (!player || !ancientSpell(spell)) return permille;
  return permille + PERMILLE_PER_PIECE * virtusPieces(player);
}

function addSetText(request) {
  const player = request?.player;
  if (!player || !Array.isArray(request.setTexts)) return;
  if (slots().every((slot, i) => wornName(player, slot) === SET_NAMES[i])) request.setTexts.push(VIRTUS_SET_TEXT);
}

module.exports = function registerVirtusRobeEffects(api) {
  core = api.core;
  api.registerMagicDamageBonusModifier(magicDamageBonus);
  api.onCustomEvent?.("equipment:effects", addSetText);
};

module.exports._test = { magicDamageBonus, virtusPieces, addSetText };
