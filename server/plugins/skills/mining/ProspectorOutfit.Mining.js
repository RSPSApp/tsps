/**
 * Prospector outfit (OSRS Wiki, https://oldschool.runescape.wiki/w/Prospector_outfit): helmet 0.4%,
 * jacket 0.8%, legs 0.6%, boots 0.2% more Mining XP, plus 0.5% for all four, so 2.5%. The golden
 * recolours count the same, and a mix of both still completes the set. Varrock armour 4 "acts as a
 * prospector jacket in terms of XP bonus" (https://oldschool.runescape.wiki/w/Varrock_armour_4).
 * Pieces are matched by cache name, so every id the cache gives a piece counts.
 */
const SET_BONUS = 0.005;
/** The full outfit in the equipment effects panel (enum 3047). */
const SET_TEXT = 18;

let core;
let pieces;
const pieceByItemId = new Map();

function pieceFor(item) {
  if (!item) return null;
  const itemId = item.getId();
  if (!pieceByItemId.has(itemId)) {
    const name = core.ItemDefinition.forId(itemId)?.getName?.()?.toLowerCase().replace(/^golden /, "");
    pieceByItemId.set(itemId, pieces.find((piece) => piece.name === name)?.name ?? null);
  }
  return pieceByItemId.get(itemId);
}

/** The pieces worn, by name: the jacket slot also takes Varrock armour 4. */
function wornPieces(player) {
  const equipment = player.getEquipment().getItems();
  const worn = new Set();
  for (const piece of pieces) {
    const item = equipment[core.Equipment[piece.slot]];
    if (pieceFor(item) === piece.name || (piece.stand && item?.getId() === piece.stand)) worn.add(piece);
  }
  return [...worn];
}

/** The factor on a rock's Mining XP: 1 with nothing worn. */
function xpMultiplier(player) {
  const worn = wornPieces(player);
  const bonus = worn.reduce((sum, piece) => sum + piece.bonus, 0);
  return 1 + bonus + (worn.length === pieces.length ? SET_BONUS : 0);
}

/** "mining:xp-multiplier": Mining XP earned outside a rock session (Motherlode pay-dirt, stardust) asks for the outfit. */
function answerMultiplier(request) {
  request.multiplier *= xpMultiplier(request.player);
}

function addSetText(request) {
  const player = request?.player;
  if (player?.getEquipment && pieces && wornPieces(player).length === pieces.length) request.setTexts?.push(SET_TEXT);
}

function attach(api) {
  core = api.core;
  pieces = [
    { name: "prospector helmet", slot: "HEAD_SLOT", bonus: 0.004 },
    { name: "prospector jacket", slot: "BODY_SLOT", bonus: 0.008, stand: core.ItemIdentifiers.VARROCK_ARMOUR_4 },
    { name: "prospector legs", slot: "LEG_SLOT", bonus: 0.006 },
    { name: "prospector boots", slot: "FEET_SLOT", bonus: 0.002 },
  ];
  pieceByItemId.clear();
  api.onCustomEvent("mining:xp-multiplier", answerMultiplier);
  api.onCustomEvent("equipment:effects", addSetText);
}

module.exports = { attach, xpMultiplier, addSetText };
