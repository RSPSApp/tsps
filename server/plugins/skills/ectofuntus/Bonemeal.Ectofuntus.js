/**
 * Empty on a pot of bonemeal tips the crushed bones out and leaves the empty pot in its slot. As
 * captured (rsprox recording 377, rev 231, tick 1161, Empty on Big bonemeal): on the click, synth
 * 2584, the spam line "You empty the pot of crushed big bones." and the bonemeal becomes a pot.
 *
 * Ours: only Big bonemeal is captured. The other pots name their bones the same way from their
 * own cache name ("Dragon bonemeal" -> "dragon bones", "Bonemeal" -> "bones"), as their Wiki
 * examines ("A pot of crushed dragon bones.") do.
 */
const Common = require("./Common.Ectofuntus");

const EMPTY_SOUND = 2584;

/** "big bones" for Big bonemeal: the bones a pot's cache name says it holds. */
function crushedBones(name) {
  const kind = name.replace(/\s*bonemeal$/i, "").trim().toLowerCase();
  return kind ? `${kind} bones` : "bones";
}

function empty({ player, itemId, slot }) {
  const inventory = player.getInventory();
  if (inventory.getItems()[slot]?.getId() !== itemId) return false;
  const { core } = Common;
  const name = core.CacheDefinitions.getItem(itemId)?.name ?? "Bonemeal";
  inventory.setItem(slot, new core.Item(core.ItemIdentifiers.POT, 1)).refreshItems();
  Common.sound(player, EMPTY_SOUND);
  Common.spam(player, `You empty the pot of crushed ${crushedBones(name)}.`);
  return true;
}

module.exports = function attachBonemeal(api) {
  const { CacheDefinitions } = api.core;
  const names = new Set(Common.bonemealObjs().map((obj) => CacheDefinitions.getItem(Common.gameval("obj", obj))?.name));
  for (const name of names) if (name) api.onItemAction(name, { Empty: empty });
};
module.exports.crushedBones = crushedBones;
