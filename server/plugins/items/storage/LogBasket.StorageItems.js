/**
 * Log basket and forestry basket (https://oldschool.runescape.wiki/w/Log_basket;
 * docs/storage-items.md): 28 logs of any kind between them, carried or worn. Open, it takes the
 * logs a player chops. The forestry basket's Forestry kit sub-options are the kit's
 * (ForestryKit.StorageItems); Dismantle takes it apart into its log basket, Forestry kit and
 * sturdy harness (Wiki: Forestry basket), each keeping its contents.
 */
const Storage = require("./Common.StorageItems");

const BASKET = ["Log basket", "Open log basket"];
const FORESTRY = ["Forestry basket", "Open forestry basket"];
const CAPACITY = 28;
/** Lines client plugins parse for the basket's count. */
const MESSAGE = {
  FULL: "The basket is full.",
  EMPTY: "Your basket is empty.",
  CHECKED_EMPTY: "The basket is empty.",
  EMPTIED: "You empty your basket.",
  EMPTIED_SOME: "You empty as many logs as you can carry.",
  EMPTIED_TO_BANK: "You empty your basket into the bank.",
  /** Ours (not captured). */
  NO_LOGS: "You have no logs to put in the basket.",
  /** Ours (not captured). */
  NO_ROOM_TO_DISMANTLE: "You need two free inventory spaces to dismantle the basket.",
};
/** Sub-option ids, in the cache's order. */
const BASKET_CHECK_EMPTY = 1;
const FORESTRY_KIT = 1;
const FORESTRY_EMPTY = 2;
const FORESTRY_OPEN_CLOSE = 1;
const FORESTRY_DISMANTLE = 2;
/** What a forestry basket comes apart into, by gameval: the basket (as open or closed as it was), the kit and the harness. */
const DISMANTLED = {
  forestry_basket_closed: "log_basket_closed",
  forestry_basket_open: "log_basket_open",
};
const DISMANTLE_PARTS = ["forestry_kit", "forestry_sturdy_harness"];

let logs = null;

function logIds() {
  logs ??= Storage.idsOf(Storage.DATA.logs);
  return logs;
}

const family = {
  key: "log-basket",
  names: [...BASKET, ...FORESTRY],
  pairs: [["log_basket_closed", "log_basket_open"], ["forestry_basket_closed", "forestry_basket_open"]],
  openNames: [BASKET[1], FORESTRY[1]],
  worn: true,
  accepts: (id) => logIds().has(id),
  room: (_player, _id, held) => CAPACITY - held.reduce((sum, entry) => sum + entry.amount, 0),
  gathers: (player) => Storage.hasOpen(player, family),
  gathered: (player) => {
    if (Storage.total(player, family) >= CAPACITY) player.sendMessage(MESSAGE.FULL);
  },
  bankEmpty: emptyToBank,
};

function fill({ player }) {
  if (Storage.total(player, family) >= CAPACITY) {
    player.sendMessage(MESSAGE.FULL);
    return;
  }
  const held = Storage.inventoryIds(player).filter(family.accepts);
  if (!held.length) {
    player.sendMessage(MESSAGE.NO_LOGS);
    return;
  }
  for (const id of held) Storage.fillFrom(player, family, id);
}

/** The Check box: "The basket contains:" and "N x Logs" per kind. */
function check({ player }) {
  const held = Storage.contents(player, family);
  if (!held.length) {
    player.sendMessage(MESSAGE.CHECKED_EMPTY);
    return;
  }
  Storage.showBox(player, ["The basket contains:", Storage.describe(held).join(", ")]);
}

function empty({ player }) {
  if (Storage.core.Bank.isOpen(player)) return emptyToBank(player);
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  const { moved, left } = Storage.emptyToInventory(player, family);
  if (moved > 0) player.sendMessage(left > 0 ? MESSAGE.EMPTIED_SOME : MESSAGE.EMPTIED);
}

function emptyToBank(player) {
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  Storage.emptyToBank(player, family);
  player.sendMessage(MESSAGE.EMPTIED_TO_BANK);
}

function toggle({ player, item }) {
  Storage.toggle(player, family, item);
}

/** Log basket Check, worn or carried: its one sub-option empties. */
function basketCheck(event) {
  if (event.subOpId === BASKET_CHECK_EMPTY) empty(event);
  else check(event);
}

/** Forestry basket Fill: the Log basket sub-option (or a plain click); the Forestry kit one is not ours. */
function forestryFill(event) {
  if (event.subOpId === FORESTRY_KIT) return false;
  fill(event);
}

/** Forestry basket View: the Empty basket sub-option empties; a plain click checks the logs. */
function forestryView(event) {
  if (event.subOpId === FORESTRY_KIT) return false;
  if (event.subOpId === FORESTRY_EMPTY) empty(event);
  else check(event);
}

/** Forestry basket Configure: Open/close, or Dismantle. */
function forestryConfigure(event) {
  if (event.subOpId === FORESTRY_DISMANTLE) return dismantle(event);
  if (event.subOpId !== FORESTRY_OPEN_CLOSE) return false;
  toggle(event);
}

/** The basket becomes its log basket in place; the kit and harness need two free slots. */
function dismantle({ player, item }) {
  const { CacheDefinitions, Item } = Storage.core;
  const into = Object.entries(DISMANTLED).find(([basket]) => CacheDefinitions.getObjId(basket) === item.getId())?.[1];
  if (!into || !player.getInventory().getValidItems().includes(item)) return;
  if (player.getInventory().getFreeSlots() < DISMANTLE_PARTS.length) {
    player.sendMessage(MESSAGE.NO_ROOM_TO_DISMANTLE);
    return;
  }
  item.setId(CacheDefinitions.getObjId(into));
  for (const part of DISMANTLE_PARTS) player.getInventory().add(new Item(CacheDefinitions.getObjId(part), 1), false);
  player.getInventory().refreshItems();
}

function useOnBasket(event) {
  const { player, usedItem, usedWithItem } = event;
  const basket = family.names.includes(Storage.nameOf(usedItem)) ? usedItem : family.names.includes(Storage.nameOf(usedWithItem)) ? usedWithItem : null;
  const other = basket === usedItem ? usedWithItem : usedItem;
  if (!basket || !family.accepts(other?.getId?.())) return;
  event.handled = true;
  fill({ player });
}

const BASKET_ACTIONS = { Fill: fill, Check: basketCheck, Empty: empty, Open: toggle, Close: toggle };
const FORESTRY_ACTIONS = { Fill: forestryFill, View: forestryView, Configure: forestryConfigure, Open: toggle, Close: toggle };

module.exports = (api) => {
  Storage.register(family);
  for (const name of BASKET) api.onItemAction(name, BASKET_ACTIONS);
  for (const name of FORESTRY) api.onItemAction(name, FORESTRY_ACTIONS);
  api.onItemOnItem(useOnBasket);
};

Object.assign(module.exports, { CAPACITY, MESSAGE });
