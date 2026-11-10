/**
 * Tackle box (https://oldschool.runescape.wiki/w/Tackle_box; docs/storage-items.md): up to 35
 * kinds of Fishing gear, bait and potions. View opens its interface (683 with side panel 684)
 * over inventory 651; Fill and Empty move everything it takes. Fishing uses bait straight from
 * it. On death its contents go where the box goes.
 *
 * Captured (rsprox, rev 227): View sends inv 651, runs script 917 (-1, -1), opens 683 and 684
 * as modals and sets OP1-5, OP10, DEPTH1 and DRAGTARGET on both grids. Fill moves the items
 * without a message; Empty says "The tackle box is now empty."
 */
const Storage = require("./Common.StorageItems");

const NAME = "Tackle box";
const INVENTORY = 651;
const CAPACITY = 35;
const MAIN = 683;
const SIDE = 684;
const MAIN_ITEMS = 11;
const FILL_BUTTON = 8;
const EMPTY_BUTTON = 9;
const SIDE_ITEMS = 0;
const MAIN_MODAL = (161 << 16) | 16;
const SIDE_MODAL = (161 << 16) | 74;
const SCRIPT_MODAL_BACKGROUND = 917;
/** OP1-OP5, OP10, DEPTH1, DRAGTARGET (captured). */
const SLOT_FLAGS = 0b111110 | (1 << 10) | (1 << 17) | (1 << 20);
const INVENTORY_SLOTS = 28;
/** `ii_elnock_storage_selectedquantity`, which the box's scripts share: 0 = 1, 1 = 5, 2 = All, 3 = X. */
const QUANTITY_VARBIT = 11795;
/** The 1 / 5 / X / All buttons (683:4-7) and the value each selects (cache script 4051). */
const QUANTITY_BUTTONS = new Map([[4, 0], [5, 1], [6, 3], [7, 2]]);
const QUANTITY_AMOUNTS = new Map([[0, 1], [1, 5], [2, Number.MAX_SAFE_INTEGER]]);
const MODE_X = 3;
const QUANTITY_ATTRIBUTE = "storage-items:tackle-box-quantity";
const EXAMINE_OP = 10;

const MESSAGE = {
  /** Captured. */
  EMPTIED: "The tackle box is now empty.",
  /** Wiki. */
  ITSELF: "The tackle box cannot hold itself! How weird would that be?",
  /** Ours (not captured). */
  CANT_HOLD: "The tackle box cannot hold that.",
  /** Ours (not captured). */
  NO_SPACE: "You don't have enough inventory space.",
};

let tackle = null;
let bait = null;

/**
 * Tackle by name, plus the lit lanterns by gameval: lit and unlit lanterns share a name
 * ("Oil lantern"), and only the lit white candle lantern goes in (Wiki).
 */
function tackleIds() {
  if (tackle) return tackle;
  tackle = Storage.idsOf(Storage.DATA.tackle);
  for (const name of Storage.DATA.tackleGamevals) {
    const id = Storage.core.CacheDefinitions.getObjId(name);
    if (id !== null) tackle.add(id);
  }
  return tackle;
}

function baitIds() {
  bait ??= Storage.idsOf(Storage.DATA.tackleBait);
  return bait;
}

const family = {
  key: "tackle-box",
  names: [NAME],
  pairs: [],
  followsOnDeath: true,
  /** A PvP death empties it even when the death keeps it. */
  emptiedOnPvpDeath: true,
  /** Only bait is used from the box (Wiki); gear has to come out first. */
  usable: (id) => baitIds().has(id),
  accepts: (id) => tackleIds().has(id) && !Storage.isNoted(id),
  room: (_player, id, held) => (held.some((entry) => entry.id === id) || held.length < CAPACITY ? Number.MAX_SAFE_INTEGER : 0),
  changed: (player) => {
    if (isOpen(player)) sendContents(player);
  },
  bankEmpty: bankUse,
};

function isOpen(player) {
  return player.getInterfaceId?.() === MAIN;
}

function sendContents(player) {
  player.getPacketSender().sendInventory(INVENTORY, CAPACITY, Storage.contents(player, family));
}

function quantityMode(player) {
  const mode = Number(player.getAttribute(QUANTITY_ATTRIBUTE) ?? 0);
  return QUANTITY_AMOUNTS.has(mode) || mode === MODE_X ? mode : 0;
}

function view({ player }) {
  const sender = player.getPacketSender();
  sendContents(player);
  sender.sendInterfaceScript(SCRIPT_MODAL_BACKGROUND, [-1, -1]);
  player.setInterfaceId(MAIN);
  sender.sendSubInterface(MAIN_MODAL, MAIN, 0);
  sender.sendSubInterface(SIDE_MODAL, SIDE, 3);
  sender.sendInterfaceFlagsRange((MAIN << 16) | MAIN_ITEMS, 0, CAPACITY - 1, SLOT_FLAGS);
  sender.sendInterfaceFlagsRange((SIDE << 16) | SIDE_ITEMS, 0, INVENTORY_SLOTS - 1, SLOT_FLAGS);
  if (sender.getVarbit(QUANTITY_VARBIT) !== quantityMode(player)) sender.sendVarbit(QUANTITY_VARBIT, quantityMode(player));
}

/** Moves up to `amount` of `id` into the box; returns how many went in. */
function deposit(player, id, amount) {
  if (Storage.nameOf(new Storage.core.Item(id, 1)) === NAME) {
    player.sendMessage(MESSAGE.ITSELF);
    return 0;
  }
  if (!family.accepts(id)) {
    player.sendMessage(MESSAGE.CANT_HOLD);
    return 0;
  }
  const inventory = player.getInventory();
  const moved = Storage.store(player, family, id, Math.min(amount, inventory.getAmount(id)));
  if (moved > 0) inventory.deleteNumber(id, moved);
  return moved;
}

function withdraw(player, slot, amount) {
  const entry = Storage.contents(player, family)[slot];
  if (!entry) return;
  const moved = Math.min(amount, entry.amount, Storage.inventoryRoom(player, entry.id));
  if (moved <= 0) {
    player.sendMessage(MESSAGE.NO_SPACE);
    return;
  }
  Storage.take(player, family, entry.id, moved);
  player.getInventory().add(new Storage.core.Item(entry.id, moved), true);
}

/** Captured: Fill moves every storable item in, silently. */
function fill({ player }) {
  for (const id of Storage.inventoryIds(player).filter(family.accepts)) {
    deposit(player, id, player.getInventory().getAmount(id));
  }
}

function empty({ player }) {
  if (Storage.core.Bank.isOpen(player)) {
    Storage.emptyToBank(player, family);
    return;
  }
  const { moved, left } = Storage.emptyToInventory(player, family);
  if (left === 0 && moved > 0) player.sendMessage(MESSAGE.EMPTIED);
  else if (left > 0) player.sendMessage(MESSAGE.NO_SPACE);
}

/** Wiki: the box's bank op ("Use") deposits every unnoted item it takes from the inventory. */
function bankUse(player) {
  fill({ player });
  Storage.refreshBank(player);
}

/** An item op on either grid: op 1 is the selected quantity, ops 2-5 are 1, 5, X and All (cache scripts 4052/4053). */
function itemOp(player, op, move) {
  if (op === EXAMINE_OP) return;
  const mode = op === 1 ? quantityMode(player) : [0, 1, MODE_X, 2][op - 2];
  if (mode === undefined) return;
  if (mode === MODE_X) {
    player.setEnteredAmountAction({ execute: (amount) => amount > 0 && move(amount) });
    player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
    return;
  }
  move(QUANTITY_AMOUNTS.get(mode));
}

function examine(player, id) {
  const definition = Storage.core.ItemDefinition.forId(id);
  player.sendMessage(definition?.getExamine?.() || definition?.getName?.() || "Nothing interesting happens.");
}

function click(event) {
  const { player, groupId, childId, slot, action } = event;
  if ((groupId !== MAIN && groupId !== SIDE) || !isOpen(player)) return;
  event.handled = true;
  if (groupId === MAIN && childId === MAIN_ITEMS) {
    const entry = Storage.contents(player, family)[slot];
    if (!entry) return;
    if (action === EXAMINE_OP) return examine(player, entry.id);
    return itemOp(player, action, (amount) => withdraw(player, slot, amount));
  }
  if (groupId === SIDE && childId === SIDE_ITEMS) {
    const item = player.getInventory().getItems()[slot];
    if (!item || item.getId() < 0) return;
    if (action === EXAMINE_OP) return examine(player, item.getId());
    return itemOp(player, action, (amount) => deposit(player, item.getId(), amount));
  }
  if (groupId !== MAIN) return;
  if (QUANTITY_BUTTONS.has(childId)) {
    player.setAttribute(QUANTITY_ATTRIBUTE, QUANTITY_BUTTONS.get(childId));
    player.getPacketSender().sendVarbit(QUANTITY_VARBIT, QUANTITY_BUTTONS.get(childId));
  } else if (childId === FILL_BUTTON) fill({ player });
  else if (childId === EMPTY_BUTTON) empty({ player });
}

/**
 * Dragging within the box's grid (DRAGTARGET, cache script 4056): the client redraws the two
 * slots swapped, so the box swaps them. The box keeps its items packed, so a drop on an empty
 * slot moves the item to the end.
 */
function drag(event) {
  const { player, packet } = event;
  const grid = (MAIN << 16) | MAIN_ITEMS;
  if (packet?.sourceWidgetId !== grid || packet?.targetWidgetId !== grid || !isOpen(player)) return;
  event.handled = true;
  const held = Storage.contents(player, family);
  const from = Number(packet.sourceSlot);
  const to = Number(packet.targetSlot);
  if (!held[from] || from === to || !(to >= 0 && to < CAPACITY)) return sendContents(player);
  if (held[to]) [held[from], held[to]] = [held[to], held[from]];
  else held.push(...held.splice(from, 1));
  Storage.setContents(player, family, held);
}

function useOnBox(event) {
  const { player, usedItem, usedWithItem } = event;
  const usedIsBox = Storage.nameOf(usedItem) === NAME;
  const withIsBox = Storage.nameOf(usedWithItem) === NAME;
  if (!usedIsBox && !withIsBox) return;
  event.handled = true;
  const other = usedIsBox ? usedWithItem : usedItem;
  deposit(player, other.getId(), other.getAmount());
}

module.exports = (api) => {
  Storage.register(family);
  api.persistAttribute(QUANTITY_ATTRIBUTE, 0);
  api.onItemAction(NAME, { View: view, Fill: fill, Empty: empty });
  api.onItemOnItem(useOnBox);
  api.onInterfaceActionClick(click);
  api.onCustomEvent("player:widget-action", drag);
};

Object.assign(module.exports, { NAME, CAPACITY, MESSAGE, baitIds, tackleIds });
