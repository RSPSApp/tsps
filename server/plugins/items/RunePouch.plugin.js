"use strict";

/**
 * Rune pouch: holds up to 16,000 of each of three rune types, four for the divine
 * variant (Wiki: Rune pouch / Divine rune pouch), stored in the pouch item's meta so
 * banks and trades carry them. Runes in the pouch are spent automatically when a spell
 * needs more than the inventory holds.
 *
 * The cache gives the pouches Open, Empty, Destroy (and Revert on the divine): Open
 * reports the stored runes here because the storage interface is not implemented.
 */

const RUNE_POUCH_META_KEY = "rune-pouch";
const MAX_RUNE_TYPES = 3;
const MAX_DIVINE_RUNE_TYPES = 4;
const MAX_RUNE_AMOUNT = 16000;
const RUNE_POUCH_NAME = "Rune pouch";
const DIVINE_RUNE_POUCH_NAME = "Divine rune pouch";

/** Every storable rune in the cache (item names, never bare ids). */
const RUNE_NAMES = new Set([
  "Air rune", "Water rune", "Earth rune", "Fire rune",
  "Mind rune", "Body rune", "Cosmic rune", "Chaos rune", "Nature rune",
  "Law rune", "Death rune", "Astral rune", "Blood rune", "Soul rune",
  "Mist rune", "Dust rune", "Mud rune", "Smoke rune", "Steam rune", "Lava rune",
  "Wrath rune", "Sunfire rune", "Aether rune",
]);

const POUCH_NAMES = new Set([
  RUNE_POUCH_NAME, `${RUNE_POUCH_NAME} (l)`,
  DIVINE_RUNE_POUCH_NAME, `${DIVINE_RUNE_POUCH_NAME} (l)`,
]);

let pluginApi = null;

function core() {
  return pluginApi.core;
}

function itemName(item) {
  return item?.getDefinition?.()?.getName?.() ?? "";
}

function isPouchItem(item) {
  return POUCH_NAMES.has(itemName(item));
}

function isDivinePouch(item) {
  return itemName(item).startsWith(DIVINE_RUNE_POUCH_NAME);
}

function isRuneItem(item) {
  return RUNE_NAMES.has(itemName(item));
}

function pouchTypeLimit(pouch) {
  return isDivinePouch(pouch) ? MAX_DIVINE_RUNE_TYPES : MAX_RUNE_TYPES;
}

function runeName(runeId) {
  return core().ItemDefinition.forId(runeId).getName();
}

// ------------------------------------------------------------------ stored runes

/** `{ [runeItemId]: amount }` for the pouch's meta, numeric and positive only. */
function storedRunes(pouch) {
  const raw = pouch?.getMetaValue?.(RUNE_POUCH_META_KEY);
  const runes = {};
  if (!raw || typeof raw !== "object") {
    return runes;
  }
  for (const [id, amount] of Object.entries(raw)) {
    const runeId = Number(id);
    if (Number.isInteger(runeId) && runeId > 0 && Number.isInteger(amount) && amount > 0) {
      runes[runeId] = amount;
    }
  }
  return runes;
}

function setStoredRunes(pouch, runes) {
  const kept = Object.fromEntries(Object.entries(runes).filter(([, amount]) => amount > 0));
  pouch.setMetaValue(RUNE_POUCH_META_KEY, Object.keys(kept).length > 0 ? kept : undefined);
}

/** Adds up to the type and 16,000-per-type caps; returns how many were stored. */
function storeRune(pouch, runeId, amount) {
  const runes = storedRunes(pouch);
  const current = runes[runeId] ?? 0;
  if (current <= 0 && Object.keys(runes).length >= pouchTypeLimit(pouch)) {
    return 0;
  }
  const moved = Math.min(Math.floor(amount), MAX_RUNE_AMOUNT - current);
  if (!(moved > 0)) {
    return 0;
  }
  runes[runeId] = current + moved;
  setStoredRunes(pouch, runes);
  return moved;
}

// ------------------------------------------------------------------ item on item

function depositRunes(player, pouch, runeId, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return 0;
  }
  if (!player.getInventory().getValidItems().includes(pouch)) {
    return 0;
  }
  const runes = storedRunes(pouch);
  if ((runes[runeId] ?? 0) <= 0 && Object.keys(runes).length >= pouchTypeLimit(pouch)) {
    player.sendMessage(`Your ${itemName(pouch).toLowerCase()} can only hold ${pouchTypeLimit(pouch)} types of rune.`);
    return 0;
  }
  const moved = storeRune(pouch, runeId, amount);
  if (moved <= 0) {
    player.sendMessage("Your rune pouch cannot hold any more of that rune.");
    return 0;
  }
  player.getInventory().deleteNumber(runeId, moved);
  player.sendMessage(`You put ${moved} x ${runeName(runeId)} in your rune pouch.`);
  return moved;
}

function handleItemOnItem(event) {
  const { player, usedItem, usedWithItem } = event;
  const pouch = isPouchItem(usedItem) ? usedItem : isPouchItem(usedWithItem) ? usedWithItem : null;
  if (!pouch) {
    return;
  }
  const rune = pouch === usedItem ? usedWithItem : usedItem;
  if (!isRuneItem(rune) || rune.getDefinition?.().isNoted?.()) {
    return;
  }
  event.handled = true;
  const runeId = rune.getId();
  const amount = player.getInventory().getAmount(runeId);
  if (amount <= 1) {
    depositRunes(player, pouch, runeId, amount);
    return;
  }
  player.setEnteredAmountAction({ execute: (value) => depositRunes(player, pouch, runeId, value) });
  player.getPacketSender().sendEnterAmountPrompt("How many would you like to store?");
}

// ------------------------------------------------------------------ pouch options

/** Cache "Open": the storage interface is not implemented, so report the contents. */
function openPouch({ player, item }) {
  const runes = storedRunes(item);
  const ids = Object.keys(runes);
  if (ids.length === 0) {
    player.sendMessage("Your rune pouch is empty.");
    return true;
  }
  const contents = ids.map((id) => `${runes[id]} x ${runeName(Number(id))}`).join(", ");
  player.sendMessage(`Your rune pouch contains ${contents}.`);
  return true;
}

/** Returns the runes that fit; anything with no room is left in the pouch. */
function emptyPouch({ player, item }) {
  const runes = storedRunes(item);
  if (Object.keys(runes).length === 0) {
    player.sendMessage("Your rune pouch is empty.");
    return true;
  }
  const inventory = player.getInventory();
  const { Item } = core();
  let moved = 0;
  for (const [id, amount] of Object.entries(runes)) {
    const runeId = Number(id);
    if (!inventory.contains(runeId) && inventory.getFreeSlots() <= 0) {
      continue;
    }
    inventory.add(new Item(runeId, amount), false);
    delete runes[id];
    moved += amount;
  }
  setStoredRunes(item, runes);
  inventory.refreshItems();
  if (moved <= 0) {
    player.sendMessage("You don't have enough inventory space.");
  } else if (Object.keys(runes).length > 0) {
    player.sendMessage("You empty some of the runes from your rune pouch.");
  } else {
    player.sendMessage("You empty your rune pouch.");
  }
  return true;
}

// ------------------------------------------------------------------ spell casting

function findPouch(player) {
  const items = player?.getInventory?.()?.getValidItems?.() ?? [];
  return items.find(isPouchItem) ?? null;
}

/** True when the carried pouch holds the whole shortfall the inventory could not cover. */
function checkSpellRunes(player, missingItems) {
  const pouch = findPouch(player);
  if (!pouch) {
    return false;
  }
  const runes = storedRunes(pouch);
  return missingItems.every((item) => (runes[item.getId()] ?? 0) >= item.getAmount());
}

function consumeSpellRunes(player, missingItems) {
  if (!checkSpellRunes(player, missingItems)) {
    return;
  }
  const pouch = findPouch(player);
  const runes = storedRunes(pouch);
  for (const item of missingItems) {
    runes[item.getId()] -= item.getAmount();
    if (runes[item.getId()] <= 0) {
      delete runes[item.getId()];
    }
  }
  setStoredRunes(pouch, runes);
}

module.exports = {
  name: "RunePouch",
  members: true,
  register(api) {
    pluginApi = api;
    api.onItemOnItem(handleItemOnItem);
    for (const pouchName of POUCH_NAMES) {
      api.onItemAction(pouchName, { Open: openPouch, Empty: emptyPouch });
    }
    api.registerSpellRuneSource({ check: checkSpellRunes, consume: consumeSpellRunes });
  },
  _test: {
    RUNE_POUCH_META_KEY,
    MAX_RUNE_AMOUNT,
    MAX_RUNE_TYPES,
    MAX_DIVINE_RUNE_TYPES,
    storedRunes,
    setStoredRunes,
    storeRune,
    depositRunes,
    handleItemOnItem,
    openPouch,
    emptyPouch,
    findPouch,
    checkSpellRunes,
    consumeSpellRunes,
  },
};
