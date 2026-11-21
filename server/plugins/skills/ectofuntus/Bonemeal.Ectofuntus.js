/**
 * Empty on a pot of bonemeal tips the crushed bones out and leaves the empty pot in its slot. As
 * captured (rsprox recording 377, rev 231, tick 1161, Empty on Big bonemeal): on the click, synth
 * 2584, the spam line "You empty the pot of crushed big bones." and the bonemeal becomes a pot.
 *
 * Ours: only Big bonemeal is captured. Its line is "You empty the " and its Wiki examine ("A pot of
 * crushed big bones.") without the "A ", so the other pots say what their examine says they hold:
 * bones.json's `contents` where the cache name doesn't give it, otherwise "crushed <name> bones"
 * from the cache name ("Dragon bonemeal" -> "crushed dragon bones", "Bonemeal" -> "crushed bones").
 */
const Common = require("./Common.Ectofuntus");

const EMPTY_SOUND = 2584;

/** "crushed big bones" for Big bonemeal: what the pot holds, by its bones.json row or cache name. */
function contents(itemId) {
  const row = Common.worshipFor(itemId);
  if (row?.contents) return row.contents;
  const name = Common.core.CacheDefinitions.getItem(itemId)?.name ?? "Bonemeal";
  const kind = name.replace(/\s*bonemeal$/i, "").trim().toLowerCase();
  return kind ? `crushed ${kind} bones` : "crushed bones";
}

function empty({ player, itemId, slot }) {
  const inventory = player.getInventory();
  const pot = inventory.getItems()[slot];
  if (pot?.getId() !== itemId) return false;
  const { core } = Common;
  // The pot keeps the bonemeal's meta, as EmptyContainers does: a preset copy stays a preset copy.
  const meta = pot.getMeta?.();
  inventory.setItem(slot, new core.Item(core.ItemIdentifiers.POT, 1, meta ? structuredClone(meta) : undefined)).refreshItems();
  Common.sound(player, EMPTY_SOUND);
  Common.spam(player, `You empty the pot of ${contents(itemId)}.`);
  return true;
}

module.exports = function attachBonemeal(api) {
  const { CacheDefinitions } = api.core;
  const names = new Set(Common.bonemealObjs().map((obj) => CacheDefinitions.getItem(Common.gameval("obj", obj))?.name));
  for (const name of names) if (name) api.onItemAction(name, { Empty: empty });
};
module.exports.contents = contents;
