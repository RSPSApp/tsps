"use strict";

/**
 * Master scroll book (members, https://oldschool.runescape.wiki/w/Master_scroll_book).
 * docs/master-scroll-book.md has the rsprox captures this follows.
 *
 * The book stores up to 1000 of each of 20 teleport scrolls. The counts belong to the player (the
 * Wiki: a book swapped with Watson keeps them for the next one), in the varbits interface 597's
 * cache script draws from. Using a scroll on the book stores the stack; Open shows interface 597,
 * whose entries Activate (read one stored scroll), Set as default (asked first) and Remove (the
 * stored scrolls back to the inventory). Teleport reads the default scroll and Remove default
 * clears it, asked first. A stored scroll is read by the plugin that reads that scroll from the
 * inventory ("teleport-scroll:read"), so its destination, quest lock and Wilderness rules stay in
 * one place.
 */

const SCROLLS_ATTRIBUTE = "master-scroll-book:scrolls";
const DEFAULT_ATTRIBUTE = "master-scroll-book:default";

/** Wiki: up to 1000 of each scroll. */
const MAX_PER_SCROLL = 1000;

const BOOK = "Master scroll book";
const EMPTY_BOOK = "Master scroll book (empty)";
const INTERFACE = "bookofscrolls";
const BUSY_VARBIT = "busy";
/** toplevel_mainmodal_open, sent before the book opens (rsprox captures). */
const SCRIPT_MAINMODAL_OPEN = 2524;

/**
 * Interface 597's entries in the order its cache script numbers them for the default teleport
 * (script 5157: selected_teleport_highbits * 15 + lowbits; 1 is Nardah). Each key is the scroll's
 * obj gameval after "teleportscroll_", its entry component after "bookofscrolls:teleportscroll_"
 * and its count varbit after "bookofscrolls_" (Watson's is split in two: script 2832).
 */
const SCROLL_KEYS = Object.freeze([
  "nardah", "digsite", "feldip", "lunarisle", "mortton", "pestcontrol", "piscatoris", "taibwo",
  "elf", "mosles", "lumberyard", "zulandra", "cerberus", "revenants", "watson", "guthixian_temple",
  "spidercave", "colossal_wyrm", "chasmoffire", "ardeaglais",
]);
const SPLIT_KEY = "watson";
const DEFAULT_LOW_SPAN = 15;
const SPLIT_LOW_SPAN = 256;

/** Interface 597's entry ops (cache: Activate, Set as default, Remove; Revenant caves adds Config). */
const OP_ACTIVATE = 1;
const OP_SET_DEFAULT = 2;
const OP_REMOVE = 3;
const OP_CONFIG = 4;

const MESSAGE = Object.freeze({
  STORED: (count, name) => `Your Master Scroll Book is now storing ${count} ${name} scrolls`,
  SET_DEFAULT_TITLE: (name) => `Set ${name} as your default teleport?`,
  DEFAULT_SET: (name) => `Your default Master Scroll Book teleport has been set to ${name}.`,
  REMOVE_DEFAULT_TITLE: "Remove your default teleport?",
  DEFAULT_REMOVED: "You remove your default Master Scroll book teleport.",
  NO_SPACE: "You don't have enough inventory space.",
});

let api = null;
let core = null;
let scrolls = null;

function varbit(name) {
  return core.CacheDefinitions.getVarbitId(name);
}

/** The 20 entries, resolved from the cache once: { key, index, itemId, component }. */
function scrollTable() {
  if (scrolls) return scrolls;
  const cache = core.CacheDefinitions;
  scrolls = SCROLL_KEYS.map((key, i) => ({
    key,
    index: i + 1,
    itemId: cache.getObjId(`teleportscroll_${key}`),
    component: cache.getComponentId(`${INTERFACE}:teleportscroll_${key}`),
  }));
  return scrolls;
}

function scrollByItem(itemId) {
  return scrollTable().find((entry) => entry.itemId === itemId) ?? null;
}

function scrollByIndex(index) {
  return scrollTable()[index - 1] ?? null;
}

function scrollName(entry) {
  return core.ItemDefinition.forId(entry.itemId)?.getName?.() ?? "";
}

function isBook(item) {
  const name = item?.getDefinition?.()?.getName?.();
  return name === BOOK || name === EMPTY_BOOK;
}

// ------------------------------------------------------------------ stored counts

function countOf(player, key) {
  const value = Number(player.getAttribute(SCROLLS_ATTRIBUTE)?.[key]);
  return Number.isInteger(value) && value > 0 ? Math.min(value, MAX_PER_SCROLL) : 0;
}

function setCount(player, key, count) {
  const saved = { ...(player.getAttribute(SCROLLS_ATTRIBUTE) ?? {}) };
  if (count > 0) saved[key] = count;
  else delete saved[key];
  player.setAttribute(SCROLLS_ATTRIBUTE, Object.keys(saved).length > 0 ? saved : null);
  sendCount(player, key, count);
}

function defaultIndex(player) {
  const value = Number(player.getAttribute(DEFAULT_ATTRIBUTE));
  return Number.isInteger(value) && scrollByIndex(value) ? value : 0;
}

function setDefault(player, index) {
  player.setAttribute(DEFAULT_ATTRIBUTE, index);
  sendDefault(player, index);
}

function sendVarbit(player, name, value, force) {
  const id = varbit(name);
  const sender = player.getPacketSender();
  if (id !== null && (force || sender.getVarbit(id) !== value)) sender.sendVarbit(id, value);
}

function sendCount(player, key, count, force = false) {
  if (key === SPLIT_KEY) {
    sendVarbit(player, `bookofscrolls_${key}_highbits`, Math.floor(count / SPLIT_LOW_SPAN), force);
    sendVarbit(player, `bookofscrolls_${key}_lowbits`, count % SPLIT_LOW_SPAN, force);
  } else {
    sendVarbit(player, `bookofscrolls_${key}`, count, force);
  }
}

function sendDefault(player, index, force = false) {
  sendVarbit(player, "bookofscrolls_selected_teleport_highbits", Math.floor(index / DEFAULT_LOW_SPAN), force);
  sendVarbit(player, "bookofscrolls_selected_teleport_lowbits", index % DEFAULT_LOW_SPAN, force);
}

function login({ player }) {
  for (const entry of scrollTable()) {
    const count = countOf(player, entry.key);
    if (count > 0) sendCount(player, entry.key, count);
  }
  const index = defaultIndex(player);
  if (index > 0) sendDefault(player, index);
}

// ------------------------------------------------------------------ storing

/** A scroll used on the book (either way round): the whole stack goes in, up to 1000 stored. */
function useOnBook(event) {
  const { player, usedItem, usedWithItem } = event;
  const scroll = isBook(usedWithItem) ? usedItem : isBook(usedItem) ? usedWithItem : null;
  const book = scroll === usedItem ? usedWithItem : usedItem;
  const entry = scroll ? scrollByItem(scroll.getId()) : null;
  if (!entry || !isBook(book)) return;
  event.handled = true;
  const inventory = player.getInventory();
  const stored = countOf(player, entry.key);
  // Ours: a full entry takes nothing, and says nothing (no capture of a full book).
  const moved = Math.min(scroll.getAmount(), MAX_PER_SCROLL - stored);
  if (moved <= 0) return;
  inventory.deleteAtSlot(inventory.getItems().indexOf(scroll), moved, false);
  // Ours: the empty book becomes the book with scrolls in it (the empty one has no Teleport).
  if (book.getDefinition().getName() === EMPTY_BOOK) {
    const at = inventory.getItems().indexOf(book);
    if (at >= 0) inventory.setItem(at, new core.Item(core.CacheDefinitions.getObjId("bookofscrolls_charged"), 1));
  }
  inventory.refreshItems();
  setCount(player, entry.key, stored + moved);
  player.sendMessage(MESSAGE.STORED(stored + moved, scrollName(entry)));
}

// ------------------------------------------------------------------ reading

/**
 * One stored scroll, spent when the reading plugin's checks pass (it may still be refused). Its
 * `item` is the book the player holds (either one): a warning's yes (the boat-at-sea one) checks
 * they still carry it.
 */
function storedSource(player, entry) {
  return {
    item: player.getInventory().getValidItems().find(isBook)?.getId() ?? core.CacheDefinitions.getObjId("bookofscrolls_charged"),
    has: () => countOf(player, entry.key) > 0,
    spend: () => {
      const count = countOf(player, entry.key);
      if (count <= 0) return false;
      setCount(player, entry.key, count - 1);
      return true;
    },
  };
}

function readStored(player, entry, subOpId) {
  if (countOf(player, entry.key) <= 0) return;
  const request = { player, itemId: entry.itemId, subOpId, source: storedSource(player, entry), handled: false };
  api.emitCustomEvent("teleport-scroll:read", request);
}

/** Teleport: the default scroll. Ours: with no default, or none of it left, the book opens instead. */
function teleport(event) {
  const { player } = event;
  event.handled = true;
  const entry = scrollByIndex(defaultIndex(player));
  if (!entry || countOf(player, entry.key) <= 0) {
    open(event);
    return;
  }
  readStored(player, entry);
}

function removeDefault(event) {
  const { player } = event;
  event.handled = true;
  api.sendMultiChatboxPrompt(player, MESSAGE.REMOVE_DEFAULT_TITLE,
    "Yes", () => {
      setDefault(player, 0);
      player.sendMessage(MESSAGE.DEFAULT_REMOVED);
    },
    "No", () => {});
}

// ------------------------------------------------------------------ interface 597

function interfaceId() {
  return core.CacheDefinitions.getInterfaceId(INTERFACE);
}

function open(event) {
  const { player } = event;
  event.handled = true;
  const sender = player.getPacketSender();
  sendVarbit(player, BUSY_VARBIT, 1, true);
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(interfaceId());
}

function isOpen(player) {
  return player.getInterfaceId?.() === interfaceId();
}

function hasBook(player) {
  return player.getInventory().getValidItems().some(isBook);
}

function askDefault(player, entry) {
  const name = scrollName(entry);
  api.sendMultiChatboxPrompt(player, MESSAGE.SET_DEFAULT_TITLE(name),
    "Yes", () => {
      setDefault(player, entry.index);
      player.sendMessage(MESSAGE.DEFAULT_SET(name));
      // The book opens again after the answer (rsprox captures).
      if (hasBook(player)) open({ player });
    },
    "No", () => {});
}

/** Remove: every stored scroll of the entry goes back to the inventory, when it fits. */
function withdraw(player, entry) {
  const count = countOf(player, entry.key);
  if (count <= 0) return;
  const inventory = player.getInventory();
  const item = new core.Item(entry.itemId, count);
  if (inventory.getAddableAmount(item) < count) {
    player.sendMessage(MESSAGE.NO_SPACE);
    return;
  }
  setCount(player, entry.key, 0);
  inventory.add(item, true);
}

function click(event) {
  const uid = (event.groupId << 16) | event.childId;
  const entry = event.groupId === interfaceId() ? scrollTable().find((scroll) => scroll.component === uid) : null;
  if (!entry) return;
  event.handled = true;
  const { player } = event;
  if (!isOpen(player) || !hasBook(player)) return;
  const op = Number(event.opId ?? event.action);
  if (op === OP_ACTIVATE) {
    player.getPacketSender().sendInterfaceRemoval();
    // Revenant caves' Activate has the scroll's three entrance submenus (script bookofscrolls_populate).
    readStored(player, entry, event.subOpId > 0 ? event.subOpId : undefined);
  } else if (op === OP_SET_DEFAULT) {
    askDefault(player, entry);
  } else if (op === OP_REMOVE) {
    withdraw(player, entry);
  } else if (op === OP_CONFIG) {
    api.emitCustomEvent("teleport-scroll:configure", { player, itemId: entry.itemId, handled: false });
  }
}

// ------------------------------------------------------------------ death

/**
 * Wiki: a dangerous PvP death with the book on them loses every stored scroll to the killer. The
 * storage death hook (Events.StorageItems) empties a container only on a PvP death (no
 * keptInPvp), so other deaths keep the counts; a second book carried finds them already gone.
 */
const deathContainer = {
  holds: isBook,
  empty(player) {
    const contents = [];
    for (const entry of scrollTable()) {
      const count = countOf(player, entry.key);
      if (count <= 0) continue;
      contents.push({ id: entry.itemId, amount: count });
      setCount(player, entry.key, 0);
    }
    return contents;
  },
};

function closed({ player, interfaceId: closedId }) {
  if (closedId === interfaceId()) sendVarbit(player, BUSY_VARBIT, 0, true);
}

module.exports = {
  name: "MasterScrollBook",
  description: "Adds the Master scroll book: stores 20 kinds of teleport scroll (up to 1000 each), reads them from interface 597 or as the default Teleport.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(SCROLLS_ATTRIBUTE, null);
    api.persistAttribute(DEFAULT_ATTRIBUTE, 0);
    api.onPlayerLogin(login);
    api.onItemOnItem(useOnBook);
    api.onItemAction(BOOK, { Teleport: teleport, Open: open, "Remove default": removeDefault });
    api.onItemAction(EMPTY_BOOK, { Open: open });
    api.onInterfaceActionClick(click);
    api.onCustomEvent("interface:closed", closed);
    api.onCustomEvent("storage:death-containers", (query) => query.containers.push(deathContainer));
  },
  _test: { deathContainer, useOnBook, teleport, removeDefault, open, click, countOf, defaultIndex, scrollTable, MESSAGE },
};
