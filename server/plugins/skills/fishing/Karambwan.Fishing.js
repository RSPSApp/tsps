/**
 * Karambwan vessels (OSRS Wiki: Karambwan vessel, Raw karambwan, Raw karambwanji). A baited
 * vessel holds one raw karambwanji, and every attempt uses it up whether a karambwan bites or
 * not; the vessel then reloads itself from the inventory. An empty vessel loads itself when the
 * player starts fishing (rsprox captures 75 and 792: the vessel turns baited on the click's tick).
 */
let core = null;

const ids = () => {
  const { ItemIdentifiers: I } = core;
  return { empty: I.KARAMBWAN_VESSEL, baited: I.KARAMBWAN_VESSEL_3, bait: I.RAW_KARAMBWANJI };
};

/** Whether the player can fish: a baited vessel, or an empty one and a karambwanji to load. */
function ready(player) {
  const { empty, baited, bait } = ids();
  const inventory = player.getInventory();
  return inventory.contains(baited) || (inventory.contains(empty) && inventory.contains(bait));
}

/** Loads an empty vessel in its own slot with one raw karambwanji; false when it can't. */
function load(player) {
  const { empty, baited, bait } = ids();
  const inventory = player.getInventory();
  if (inventory.contains(baited)) return true;
  if (!inventory.contains(empty) || !inventory.contains(bait)) return false;
  inventory.deleteNumber(bait, 1);
  inventory.setItem(inventory.getSlotForItemId(empty), new core.Item(baited, 1));
  inventory.refreshItems();
  return true;
}

/** One attempt's bait: the vessel empties, then reloads if karambwanji are left. */
function useBait(player) {
  const { empty, baited, bait } = ids();
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(baited);
  if (slot < 0) return;
  const refill = inventory.contains(bait);
  if (refill) inventory.deleteNumber(bait, 1);
  inventory.setItem(slot, new core.Item(refill ? baited : empty, 1));
  inventory.refreshItems();
}

function attach(api) {
  core = api.core;
}

module.exports = { attach, ready, onStart: load, useBait };
