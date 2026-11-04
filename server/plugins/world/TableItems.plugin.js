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
 * Fallback: content that gives a table its own item use runs first and keeps the item. A removal is
 * reported as an item discard, so a valuable item is saved before the table copy can be taken.
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
  // The walk to the table can outlast the inventory state that was clicked: a slot switch can put
  // a different item of the same id in the slot. Only the exact item that was clicked is removed
  // and placed; the replacement stays where it is.
  const current = player.getInventory().getItems()[itemSlot];
  if (current !== item || current.getId() !== itemId) return;
  // Tradeability can change while walking (a preset marks its items untradeable).
  if (!current.isTradeable() || !current.isDropable()) return;

  const location = object.getLocation().clone();
  if (isSpotTaken(player, location)) {
    player.sendMessage("There is already an item on the table.");
    return;
  }

  // Placing on a table removes the item from the inventory just like dropping it, so the shared
  // drop policy runs first: a plugin can refuse the removal (bonds), consume the item itself
  // (Wintertodt supplies, gnomeballs) or apply its drop-side changes (barrows durability).
  const policy = {
    player,
    interfaceId: core.Inventory.INTERFACE_ID,
    item: current,
    itemId,
    slot: itemSlot,
    dropToGround: true,
    handled: false,
  };
  // Native drop copies the item before the policy, so a handler that takes it can still report
  // the loss. One unit is the part of the stack this use would remove.
  const discarded = current.clone().setAmount(1);
  const carried = current.getAmount();
  core.PluginManager.emitItemDropPolicy(policy);
  // The policy may refuse, replace or consume the item. Whatever it did, a slot that no longer
  // holds the clicked stack means the item left the inventory, and like native drop that has to
  // be reported for the durable save: otherwise a crash before the next autosave restores it.
  if (policy.handled || policy.dropToGround === false
      || player.getInventory().getItems()[itemSlot] !== current) {
    const remaining = player.getInventory().getItems()[itemSlot];
    if (remaining?.getId?.() !== itemId || (remaining?.getAmount?.() ?? 0) < carried) {
      core.PluginManager.emitCustomEvent("item:discarded", { player, item: discarded });
    }
    return;
  }

  // Clone after the policy so its drop-side changes (barrows durability) are what goes on the
  // table, and before the removal so the discard reports what left the inventory.
  const placed = current.clone().setAmount(1);
  player.getInventory().deleteAtSlot(itemSlot, 1);
  core.ItemOnGroundManager.registerLocation(player, placed, location, player.getPrivateArea(), {
    despawnDelay: TABLE_DESPAWN_TICKS,
  });
  core.PluginManager.emitCustomEvent("item:discarded", { player, item: placed });
}

module.exports = {
  name: "TableItems",
  register(api) {
    core = api.core;
    api.onItemOnObject(putOnTable, { fallback: true });
  },
};
