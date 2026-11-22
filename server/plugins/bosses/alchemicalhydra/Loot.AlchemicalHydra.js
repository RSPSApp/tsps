/**
 * The brimstone ring's pieces from the Alchemical Hydra (Wiki, Alchemical_Hydra#Drops): "The order
 * in which players receive the items is: Hydra's eye, Hydra's fang and finally Hydra's heart."
 * NpcDrops rolls them as one 1/181 piece roll; whichever piece it picked becomes the player's next
 * in that order here, and the order starts again after the heart. The count of pieces received is
 * persisted. Ours: an account without one starts from the pieces its collection log has, so
 * pieces looted before this existed keep their place in the order.
 */
const Common = require("./Common.AlchemicalHydra");

/** Player attribute: the brimstone ring pieces received from the Hydra so far. */
const RING_PIECES_ATTRIBUTE = "alchemical-hydra:ring-pieces";

/** The pieces the collection log has, for an account whose counter has never run. */
function loggedPieces(player) {
  let total = 0;
  for (const itemId of Common.ids.objs.ringPieces) {
    const query = { player, itemId, count: 0 };
    Common.api.emitCustomEvent("collection-log:obtained", query);
    total += Number.isSafeInteger(query.count) && query.count > 0 ? query.count : 0;
  }
  return total;
}

/** The next piece in the order, counted as received. */
function nextPiece(player) {
  const saved = player.getAttribute?.(RING_PIECES_ATTRIBUTE);
  const received = Number.isSafeInteger(saved) && saved >= 0 ? saved : loggedPieces(player);
  const pieces = Common.ids.objs.ringPieces;
  player.setAttribute?.(RING_PIECES_ATTRIBUTE, received + 1);
  return pieces[received % pieces.length];
}

/** "npc-drops:roll": a ring piece in the Hydra's loot is the player's next one. */
function orderPieces(event) {
  const { player, npc, drops } = event ?? {};
  if (!player || !Array.isArray(drops) || !Common.isHydra(npc)) return;
  const pieces = Common.ids.objs.ringPieces;
  for (const drop of drops) {
    if (pieces.includes(drop?.itemId)) drop.itemId = nextPiece(player);
  }
}

function attach(api) {
  api.persistAttribute(RING_PIECES_ATTRIBUTE);
  api.onCustomEvent("npc-drops:roll", orderPieces);
}

module.exports = { attach, orderPieces, nextPiece, RING_PIECES_ATTRIBUTE };
