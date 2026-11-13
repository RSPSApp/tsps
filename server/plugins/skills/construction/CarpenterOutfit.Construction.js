/**
 * Carpenter's outfit (https://oldschool.runescape.wiki/w/Carpenter%27s_outfit): helmet +0.4%,
 * shirt +0.8%, trousers +0.6%, boots +0.2% Construction experience, and +0.5% more when all four
 * are worn (2.5% in all). Each piece counts on its own. Wiki: the bonus applies to Construction
 * training (furniture and flatpacks, Mahogany Homes contracts since 19 June 2024, the shipwrights'
 * workbench since 26 November 2025) and not to the experience Barlak pays for long and curved bones.
 *
 * Plugins outside Construction ask for the multiplier with the `construction:outfit-multiplier`
 * event: `{ player, multiplier }`, the multiplier starting at 1.
 */
const { Equipment } = require("./Core.Construction");
const Ids = require("./Ids.Construction");

const OUTFIT_PIECES = [
  { slot: "HEAD_SLOT", item: "construction_hat", bonus: 0.004 },
  { slot: "BODY_SLOT", item: "construction_shirt", bonus: 0.008 },
  { slot: "LEG_SLOT", item: "construction_trousers", bonus: 0.006 },
  { slot: "FEET_SLOT", item: "construction_boots", bonus: 0.002 },
];
const SET_BONUS = 0.005;
/** The full outfit in the equipment effects panel (enum 3047). */
const SET_TEXT = 23;
const OUTFIT_MULTIPLIER_EVENT = "construction:outfit-multiplier";

function wornPieces(player) {
  const items = player.getEquipment().getItems();
  return OUTFIT_PIECES.filter(piece => items[Equipment[piece.slot]]?.getId?.() === Ids.obj(piece.item));
}

/** The multiplier on Construction experience from the outfit pieces the player wears. */
function xpMultiplier(player) {
  const worn = wornPieces(player);
  const bonus = worn.reduce((sum, piece) => sum + piece.bonus, 0);
  return 1 + bonus + (worn.length === OUTFIT_PIECES.length ? SET_BONUS : 0);
}

/** Construction experience for a piece of work, with the outfit's bonus. */
function withBonus(player, experience) {
  return experience * xpMultiplier(player);
}

function answerMultiplier(request) {
  request.multiplier *= xpMultiplier(request.player);
}

function addSetText(request) {
  const player = request?.player;
  if (player?.getEquipment && wornPieces(player).length === OUTFIT_PIECES.length) request.setTexts?.push(SET_TEXT);
}

function attachCarpenterOutfit(api) {
  api.onCustomEvent(OUTFIT_MULTIPLIER_EVENT, answerMultiplier);
  api.onCustomEvent("equipment:effects", addSetText);
}

module.exports = { attachCarpenterOutfit, addSetText, xpMultiplier, withBonus, OUTFIT_MULTIPLIER_EVENT };
