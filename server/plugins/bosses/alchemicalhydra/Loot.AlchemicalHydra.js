/**
 * The brimstone ring's pieces from the Alchemical Hydra (Wiki, Alchemical_Hydra#Drops): "The order
 * in which players receive the items is: Hydra's eye, Hydra's fang and finally Hydra's heart."
 * NpcDrops rolls them as one 1/181 piece roll; whichever piece it picked becomes the player's next
 * in that order here, and the order starts again after the heart. The count of pieces received is
 * persisted. Ours: an account without one starts from its collection log, at the first piece in
 * the order it has fewest of, so pieces looted before this existed are not handed out twice
 * (Brimstone ring: no duplicate "until obtaining each of the other pieces").
 */
const Common = require("./Common.AlchemicalHydra");

/** Player attribute: the brimstone ring pieces received from the Hydra so far. */
const RING_PIECES_ATTRIBUTE = "alchemical-hydra:ring-pieces";

/**
 * The counter an account without one starts from, read from its collection log: the Brimstone ring
 * page's "players cannot receive a duplicate of these until obtaining each of the other pieces", so
 * the next piece is the first in the order it has fewest of (an eye and a heart: the fang).
 */
function seededCount(player) {
  const counts = Common.ids.objs.ringPieces.map((itemId) => {
    const query = { player, itemId, count: 0 };
    Common.api.emitCustomEvent("collection-log:obtained", query);
    return Number.isSafeInteger(query.count) && query.count > 0 ? query.count : 0;
  });
  const fewest = Math.min(...counts);
  return fewest * counts.length + counts.indexOf(fewest);
}

/** The next piece in the order, counted as received. */
function nextPiece(player) {
  const saved = player.getAttribute?.(RING_PIECES_ATTRIBUTE);
  const received = Number.isSafeInteger(saved) && saved >= 0 ? saved : seededCount(player);
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
