/**
 * Putting items on tables (https://oldschool.runescape.wiki/w/Table).
 *
 * Using a tradeable item on a table places it on the table instead of saying "Nothing interesting
 * happens.". A placed item becomes visible to other players after 60 seconds and despawns after
 * 10 minutes in total (https://oldschool.runescape.wiki/w/Drop), rather than the ordinary floor
 * timers. Only tables take items: a chair, crate or other scenery still says nothing interesting
 * happens. A table tile holds one item stack, so a second item cannot be put on the same spot
 * until the first is taken or despawns.
 *
 * Fallback: content that gives a table its own item use runs first and keeps the item.
 */

const TABLE_NAME = /\btable\b/i;
// Table-shaped scenery that is not a table you can put things on: player-owned-house build
// spaces, the workshop's fixed saw, a barricade made from tables and the Fossil Island bench's
// unbuilt parts. "Tablet" never matches because of the whole-word TABLE_NAME.
const NOT_A_TABLE = new Set([
  "charred remains of a table",
  "table blockade",
  "table hotspot",
  "table parts",
  "table saw",
  "table space",
]);

// 10 minutes at 0.6 s a tick. ItemOnGroundManager reveals it to everyone after 100 ticks (60 s).
const TABLE_DESPAWN_TICKS = 1000;

let core;

function isTable(definition) {
  const name = definition?.getName?.()?.replace(/<[^>]+>/g, "").trim().toLowerCase() ?? "";
  return TABLE_NAME.test(name) && !NOT_A_TABLE.has(name);
}

/** A stack already placed on the table tile, in the same private area. */
function isSpotTaken(player, location) {
  return core.World.getItems().some((ground) =>
    ground &&
    !ground.isPendingRemoval() &&
    ground.getPrivateArea() === player.getPrivateArea() &&
    core.Location.isSameTile(ground.getPosition(), location));
}

function putOnTable(event) {
  const { player, object, item, itemId, itemSlot } = event;
  if (!isTable(object.getDefinition())) return;
  // Only tradeable items are placed; anything else keeps "Nothing interesting happens.".
  if (!item?.isTradeable?.() || !item?.isDropable?.()) return;

  event.handled = true;
  // The walk to the table can outlast the inventory state that was clicked.
  const current = player.getInventory().getItems()[itemSlot];
  if (!current || current.getId() !== itemId) return;

  const location = object.getLocation().clone();
  if (isSpotTaken(player, location)) {
    player.sendMessage("There is already an item on the table.");
    return;
  }

  const placed = item.clone().setAmount(1);
  player.getInventory().deleteAtSlot(itemSlot, 1);
  core.ItemOnGroundManager.registerLocation(player, placed, location, player.getPrivateArea(), {
    despawnDelay: TABLE_DESPAWN_TICKS,
  });
}

module.exports = {
  name: "TableItems",
  register(api) {
    core = api.core;
    api.onItemOnObject(putOnTable, { fallback: true });
  },
};
