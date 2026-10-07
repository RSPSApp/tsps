// A boat's cargo hold and the account-wide tools compartment, as plain state operations shared
// by the cargo hold, the sidepanel and the shipwright. What the hold accepts comes from
// data/definitions/sailing-cargo.json (OSRS Wiki, Cargo hold); behaviour from live captures
// (docs/sailing-osrs-reference.md).
const { ItemDefinition } = require("../../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { content, boatType } = require("./sailingContent");

const REPAIR_KIT = 31964;
/** The sidepanel counts repair kit uses: 5 per kit in the hold. */
const REPAIR_KIT_USES = 5;
/** Boat slot 0's hold is inventory 963 (`sailing_boat_1_cargohold`), up to 967. */
const FIRST_CARGO_INVENTORY = 963;
/**
 * The hold is sent as an "other" inventory (id + 32768), which the cache scripts read with
 * invother_getobj; live OSRS does the same (its stop-transmit names 33731 = 963 + 32768).
 */
const OTHER_INVENTORY = 32768;

/**
 * Script 9138 shows a tool in the tools compartment once its quest progress varbit is reached
 * (the captain's log always). tsps has none of these quests yet, so only the developer command
 * `::sailingtools` sets them, for the player's own client.
 */
const TOOL_UNLOCK_VARBITS = { 18314: 50, 18282: 40, 18317: 20, 1895: 40 };
const TOOLS_UNLOCKED_ATTRIBUTE = "sailing:tools-unlocked";

const categoryCache = new Map();

/** The storable category of an item (salvage, cargo, fish, supplies, equipment), or null. */
function categoryOf(itemId) {
  if (categoryCache.has(itemId)) return categoryCache.get(itemId);
  const definition = ItemDefinition.forId(itemId);
  const name = definition?.isNoted?.() ? "" : definition?.getName?.() ?? "";
  let found = null;
  for (const [category, rule] of Object.entries(content().cargo.categories)) {
    if (rule.names?.includes(name) || rule.namePrefixes?.some((prefix) => name.startsWith(prefix))) {
      found = category;
      break;
    }
  }
  categoryCache.set(itemId, found);
  return found;
}

/** The tools compartment entry an item belongs to, or undefined. */
function toolFor(itemId) {
  return content().cargo.tools.find((tool) => tool.accept.includes(itemId));
}

function toolAt(slot) {
  return content().cargo.tools.find((tool) => tool.slot === slot);
}

function isStorable(itemId) {
  return toolFor(itemId) !== undefined || categoryOf(itemId) !== null;
}

function isStackable(itemId) {
  return ItemDefinition.forId(itemId)?.isStackable?.() === true;
}

function capacityOf(boat) {
  return boatType(boat.type)?.cargoCapacity ?? 0;
}

function inventoryIdOf(boat) {
  return FIRST_CARGO_INVENTORY + boat.slot;
}

function sentInventoryIdOf(boat) {
  return inventoryIdOf(boat) + OTHER_INVENTORY;
}

function countIn(boat, itemId) {
  return boat.cargo.reduce((total, slot) => total + (slot?.id === itemId ? slot.amount : 0), 0);
}

function repairKitUses(boat) {
  return countIn(boat, REPAIR_KIT) * REPAIR_KIT_USES;
}

/**
 * Stores up to `amount` of an item: a stackable joins its stack (or takes one slot), anything
 * else takes a slot per item. Returns how many were stored.
 */
function store(boat, itemId, amount) {
  const capacity = capacityOf(boat);
  const freeSlot = () => {
    for (let slot = 0; slot < capacity; slot++) if (!boat.cargo[slot]) return slot;
    return -1;
  };
  if (isStackable(itemId)) {
    const stack = boat.cargo.find((slot) => slot?.id === itemId);
    if (stack) {
      stack.amount += amount;
      return amount;
    }
    const slot = freeSlot();
    if (slot < 0) return 0;
    boat.cargo[slot] = { id: itemId, amount };
    return amount;
  }
  let stored = 0;
  while (stored < amount) {
    const slot = freeSlot();
    if (slot < 0) break;
    boat.cargo[slot] = { id: itemId, amount: 1 };
    stored++;
  }
  return stored;
}

/**
 * Takes up to `amount` of the item in `fromSlot`, then from its other slots (a withdraw of 5
 * unstackable items empties five slots). Returns how many were taken.
 */
function take(boat, fromSlot, itemId, amount) {
  const slots = [fromSlot, ...boat.cargo.keys()].filter((slot, index, all) => all.indexOf(slot) === index);
  let taken = 0;
  for (const slot of slots) {
    const entry = boat.cargo[slot];
    if (!entry || entry.id !== itemId || taken >= amount) continue;
    const part = Math.min(entry.amount, amount - taken);
    entry.amount -= part;
    taken += part;
    if (entry.amount <= 0) boat.cargo[slot] = null;
  }
  return taken;
}

/** Sends the tool unlock varbits if the player has turned them on with `::sailingtools`. */
function sendToolUnlocks(player) {
  if (!player.getAttribute?.(TOOLS_UNLOCKED_ATTRIBUTE)) return;
  for (const [varbit, value] of Object.entries(TOOL_UNLOCK_VARBITS)) {
    player.getPacketSender().sendVarbit(Number(varbit), value);
  }
}

/** Drops what a shipwright's recovery loses (salvage, courier crates, fish). */
function dropLostOnRecovery(boat) {
  const categories = content().cargo.categories;
  boat.cargo = boat.cargo.map((slot) =>
    slot && categories[categoryOf(slot.id)]?.lostOnRecovery ? null : slot);
}

module.exports = {
  REPAIR_KIT,
  TOOLS_UNLOCKED_ATTRIBUTE,
  sendToolUnlocks,
  categoryOf,
  toolFor,
  toolAt,
  isStorable,
  isStackable,
  capacityOf,
  inventoryIdOf,
  sentInventoryIdOf,
  countIn,
  repairKitUses,
  store,
  take,
  dropLostOnRecovery,
};
