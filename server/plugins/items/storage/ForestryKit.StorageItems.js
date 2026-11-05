/**
 * Forestry kit (https://oldschool.runescape.wiki/w/Forestry_kit; docs/storage-items.md): the
 * Forestry items the cache's enum 817 lists - Anima-infused bark, nature offerings, Forester's
 * rations, the secateurs attachment and the six kinds of leaves - carried, worn, or inside a
 * forestry basket. Carried or worn, it takes the leaves and bark a player earns. Every copy
 * shares one store, and the forestry basket's "Forestry kit" sub-options reach it too.
 *
 * Captured (rsprox 1704, rev 227; 1104, rev 237): View sends inv 814, runs script 917 (-1, -3),
 * opens 823 (main modal) and 822 (side modal) and sets events 1150 (ops 1-6, op 10) on 823:21
 * slots 0-252 and 1180734 (ops 1-5, op 10, DEPTH1, DRAGTARGET) on 822:0 slots 0-27. Fill with
 * nothing to store says "You have nothing that can be stored in the forestry kit."; bark
 * awarded during an event goes into the worn kit without touching the inventory.
 *
 * The side panel's ops come from cache script 1768: op 1 is the quantity selected with 823:11-14
 * (varbit 14985: 0 = 1, 1 = 5, 2 = All, 3 = X), ops 2-5 are 1, 5, X and All. The main grid is
 * taken to follow the same scheme (not captured).
 *
 * Not done: the clothes and cape pouches (the Lumberjack and Forestry outfits and the
 * Woodcutting cape the cache also lists need one installed), and the rations' run energy.
 */
const Storage = require("./Common.StorageItems");

const NAME = "Forestry kit";
/** A forestry basket carries a kit: its contents are the kit's. */
const HOLDERS = ["Forestry basket", "Open forestry basket"];
const STORABLE_ENUM = 817;
const INVENTORY = 814;
const MAIN = 823;
const SIDE = 822;
const MAIN_ITEMS = 21;
const SIDE_ITEMS = 0;
const FILL_BUTTON = 15;
const EMPTY_BUTTON = 16;
const MAIN_MODAL = (161 << 16) | 16;
const SIDE_MODAL = (161 << 16) | 74;
const SCRIPT_MODAL_BACKGROUND = 917;
const MAIN_SLOTS = 253;
const INVENTORY_SLOTS = 28;
/** Captured: ops 1-6 and op 10. */
const MAIN_FLAGS = 1150;
/** Captured: ops 1-5, op 10, DEPTH1 and DRAGTARGET. */
const SIDE_FLAGS = 1180734;
/** `forestry_kit_selectedquantity`: 0 = 1, 1 = 5, 2 = All, 3 = X. */
const QUANTITY_VARBIT = 14985;
/** The Withdraw 1 / 5 / X / All buttons (823:11-14) and the value each selects. */
const QUANTITY_BUTTONS = new Map([[11, 0], [12, 1], [13, 3], [14, 2]]);
const QUANTITY_AMOUNTS = new Map([[0, 1], [1, 5], [2, Number.MAX_SAFE_INTEGER]]);
const MODE_X = 3;
const QUANTITY_ATTRIBUTE = "storage-items:forestry-kit-quantity";
const EXAMINE_OP = 10;
/** The forestry basket's "Forestry kit" sub-option on Fill and View (LogBasket.StorageItems). */
const BASKET_KIT_SUB_OP = 1;

const MESSAGE = {
  /** Captured. */
  NOTHING: "You have nothing that can be stored in the forestry kit.",
  /** Ours (not captured). */
  CANT_HOLD: "The forestry kit cannot hold that.",
  /** Ours (not captured). */
  EMPTIED: "You empty the forestry kit.",
  /** Ours (not captured). */
  EMPTY: "The forestry kit is empty.",
  /** Ours (not captured). */
  NO_SPACE: "You don't have enough inventory space.",
};

let storable = null;

/** Enum 817's items, less the ones only a pouch lets in. */
function storableIds() {
  if (storable) return storable;
  const pouchOnly = new Set(Storage.DATA.forestryKitPouchItems
    .map((name) => Storage.core.CacheDefinitions.getObjId(name))
    .filter((id) => id !== null));
  storable = new Set([...Storage.core.CacheDefinitions.getEnumValues(STORABLE_ENUM).values()]
    .filter((id) => Number(id) >= 0 && !pouchOnly.has(Number(id))).map(Number));
  return storable;
}

const family = {
  key: "forestry-kit",
  names: [NAME, ...HOLDERS],
  pairs: [],
  worn: true,
  accepts: (id) => storableIds().has(id) && !Storage.isNoted(id),
  room: () => Number.MAX_SAFE_INTEGER,
  /** Carried or worn, it takes what the player earns (Wiki: leaves; captured: bark). */
  gathers: (player) => Storage.carried(player, family).length > 0,
  /** Bark pays at the Forestry Shop; rations power a felling axe from a carried or worn kit. */
  usable: (id) => id === Storage.core.CacheDefinitions.getObjId("forestry_currency") || id === Storage.core.ItemIdentifiers.FORESTERS_RATION,
  changed: (player) => {
    if (isOpen(player)) sendContents(player);
  },
  bankEmpty: bankUse,
};

function isOpen(player) {
  return player.getInterfaceId?.() === MAIN;
}

function sendContents(player) {
  player.getPacketSender().sendInventory(INVENTORY, storableIds().size, Storage.contents(player, family));
}

function quantityMode(player) {
  const mode = Number(player.getAttribute(QUANTITY_ATTRIBUTE) ?? 0);
  return QUANTITY_AMOUNTS.has(mode) || mode === MODE_X ? mode : 0;
}

function view({ player }) {
  const sender = player.getPacketSender();
  sendContents(player);
  sender.sendInterfaceScript(SCRIPT_MODAL_BACKGROUND, [-1, -3]);
  player.setInterfaceId(MAIN);
  sender.sendSubInterface(MAIN_MODAL, MAIN, 0);
  sender.sendSubInterface(SIDE_MODAL, SIDE, 0);
  sender.sendInterfaceFlagsRange((MAIN << 16) | MAIN_ITEMS, 0, MAIN_SLOTS - 1, MAIN_FLAGS);
  sender.sendInterfaceFlagsRange((SIDE << 16) | SIDE_ITEMS, 0, INVENTORY_SLOTS - 1, SIDE_FLAGS);
  if (sender.getVarbit(QUANTITY_VARBIT) !== quantityMode(player)) sender.sendVarbit(QUANTITY_VARBIT, quantityMode(player));
}

/** Moves up to `amount` of `id` into the kit; returns how many went in. */
function deposit(player, id, amount) {
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

/** Every storable item in the inventory goes in; with none, the captured line. */
function fill({ player }) {
  const held = Storage.inventoryIds(player).filter(family.accepts);
  if (!held.length) {
    player.sendMessage(MESSAGE.NOTHING);
    return;
  }
  for (const id of held) Storage.fillFrom(player, family, id);
}

function empty({ player }) {
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  const { moved, left } = Storage.emptyToInventory(player, family);
  if (left > 0) player.sendMessage(MESSAGE.NO_SPACE);
  else if (moved > 0) player.sendMessage(MESSAGE.EMPTIED);
}

/** Wiki: the kit's bank op ("Use") empties it into the inventory, to be deposited from there. */
function bankUse(player) {
  empty({ player });
  Storage.refreshBank(player);
}

/** The forestry basket's "Forestry kit" sub-options; its other sub-options stay the log basket's. */
function basketFill(event) {
  if (event.subOpId !== BASKET_KIT_SUB_OP) return false;
  fill(event);
}

function basketView(event) {
  if (event.subOpId !== BASKET_KIT_SUB_OP) return false;
  view(event);
}

/** An item op on either grid: op 1 is the selected quantity, ops 2-5 are 1, 5, X and All (cache script 1768). */
function itemOp(player, op, move) {
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

function useOnKit(event) {
  const { player, usedItem, usedWithItem } = event;
  const usedIsKit = Storage.nameOf(usedItem) === NAME;
  const withIsKit = Storage.nameOf(usedWithItem) === NAME;
  if (!usedIsKit && !withIsKit) return;
  const other = usedIsKit ? usedWithItem : usedItem;
  if (!family.accepts(other?.getId?.())) return;
  event.handled = true;
  deposit(player, other.getId(), other.getAmount());
}

/**
 * Destroy (Wiki): the contents go with the last kit; with another kit or a forestry basket
 * still owned, they stay with it. A forestry basket's Destroy counts the same way.
 */
function destroyed({ player, itemId }) {
  const name = Storage.itemName(itemId);
  if (family.names.includes(name) && !Storage.owns(player, family)) Storage.setContents(player, family, []);
}

module.exports = (api) => {
  Storage.register(family);
  api.persistAttribute(QUANTITY_ATTRIBUTE, 0);
  api.onItemAction(NAME, { View: view, Fill: fill });
  for (const name of HOLDERS) api.onItemAction(name, { Fill: basketFill, View: basketView });
  api.onItemOnItem(useOnKit);
  api.onInterfaceActionClick(click);
  api.onCustomEvent("destroy-item:destroyed", destroyed);
};

Object.assign(module.exports, { NAME, MESSAGE, storableIds, family });
