"use strict";

/**
 * Elnock's Equipment Storage: his Exchange option (docs/impetuous-impulses.md, "Equipment storage").
 * It holds one insect net (normal or magic), one imp repellent and up to 1,000 impling jars (Wiki
 * Elnock Inquisitor; cache enum 2850 gives the same caps). Quick-withdraw takes everything out
 * without opening it (Wiki).
 *
 * The cache's scripts draw both panels from four varbits, so the server only keeps the stored
 * counts and sends them: ii_stored_net (0 none, 1 butterfly net, 2 magic butterfly net; script
 * 2259), ii_stored_repellent and ii_stored_jars, plus ii_elnock_storage_selectedquantity, which
 * picks each item's first op (scripts 2146/2148: 0 = 1, 1 = 5, 2 = All, 3 = X). The side panel
 * counts the inventory, its banknotes and the worn items (script 2149), and a stored net may come
 * straight off the weapon slot.
 *
 * rsprox capture 20261111T231757 (rev 242, ticks 104-136): Exchange runs script 917 (-1, -1),
 * opens 661 and 681 as modals, sets OP1 on the four quantity buttons and busy to 1. Storing the
 * wielded net clears the weapon slot (synth 2238) and sets ii_stored_net 1; Withdraw puts it back
 * in the inventory; Store-all moves it in silently. With nothing stored, each item says it has
 * none stored and Withdraw-all says "You have no items that can be withdrawn."
 */

const STORAGE_ATTRIBUTE = Object.freeze({
  net: "impetuous-impulses:stored-net",
  repellent: "impetuous-impulses:stored-repellent",
  jars: "impetuous-impulses:stored-jars",
});
const QUANTITY_ATTRIBUTE = "impetuous-impulses:storage-quantity";

const MAIN = 661;
const SIDE = 681;
const MAIN_MODAL = (161 << 16) | 16;
const SIDE_MODAL = (161 << 16) | 74;
const SCRIPT_MODAL_BACKGROUND = 917;
const BUSY_VARBIT = 12393;
const QUANTITY_VARBIT = 11795;
const STORED_VARBIT = Object.freeze({ net: 11767, repellent: 11768, jars: 11770 });
/** ii_stored_net's values (cache script 2259). */
const NET_VALUE = Object.freeze({ NONE: 0, BUTTERFLY: 1, MAGIC: 2 });

/** 661: net, repellent, jar, Withdraw-all, then the quantity buttons and the value each selects. */
const MAIN_SLOT = Object.freeze({ 3: "net", 4: "repellent", 5: "jars" });
const WITHDRAW_ALL = 6;
const QUANTITY_BUTTONS = new Map([[8, 0], [9, 1], [10, 3], [11, 2]]);
/** 681: net, repellent, jar, Store-all. */
const SIDE_SLOT = Object.freeze({ 1: "net", 2: "repellent", 3: "jars" });
const STORE_ALL = 4;

const OP1 = 1 << 1;
const EXAMINE_OP = 10;
const MODE_X = 3;
const QUANTITY_AMOUNTS = new Map([[0, 1], [1, 5], [2, Number.MAX_SAFE_INTEGER]]);
const UNEQUIP_SOUND = 2238;

const KINDS = Object.freeze(["net", "repellent", "jars"]);
const CAPACITY = Object.freeze({ net: 1, repellent: 1, jars: 1000 });

const MESSAGE = Object.freeze({
  /** Captured. */
  NO_NETS: "You haven't got any nets stored in here.",
  /** Captured. */
  NO_REPELLENT: "You haven't got any repellent stored in here.",
  /** Captured. */
  NO_JARS: "You haven't got any impling jars stored in here.",
  /** Captured. */
  NOTHING_TO_WITHDRAW: "You have no items that can be withdrawn.",
  /** Ours (not captured): the line the storage boxes use. */
  NO_SPACE: "You don't have enough inventory space.",
});
const NONE_STORED = Object.freeze({ net: MESSAGE.NO_NETS, repellent: MESSAGE.NO_REPELLENT, jars: MESSAGE.NO_JARS });

let api;
let core;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

/** The items each kind accepts, in the order they are taken (the side panel shows a magic net first). */
function itemsOf(kind) {
  const I = core.ItemIdentifiers;
  if (kind === "net") return [I.MAGIC_BUTTERFLY_NET, I.BUTTERFLY_NET];
  return [kind === "repellent" ? I.IMP_REPELLENT : I.IMPLING_JAR];
}

function stored(player, kind) {
  const value = Math.trunc(Number(player.getAttribute(STORAGE_ATTRIBUTE[kind]) ?? 0)) || 0;
  if (kind === "net") return value === NET_VALUE.MAGIC || value === NET_VALUE.BUTTERFLY ? value : NET_VALUE.NONE;
  return Math.max(0, Math.min(CAPACITY[kind], value));
}

/** How many of a kind are stored (a net is one, whichever it is). */
function count(player, kind) {
  return kind === "net" ? Number(stored(player, kind) !== NET_VALUE.NONE) : stored(player, kind);
}

function sendStored(player, kind) {
  const sender = player.getPacketSender();
  const value = stored(player, kind);
  if (sender.getVarbit(STORED_VARBIT[kind]) !== value) sender.sendVarbit(STORED_VARBIT[kind], value);
}

function setStored(player, kind, value) {
  player.setAttribute(STORAGE_ATTRIBUTE[kind], value);
  sendStored(player, kind);
}

function quantityMode(player) {
  const mode = Number(player.getAttribute(QUANTITY_ATTRIBUTE) ?? 0);
  return QUANTITY_AMOUNTS.has(mode) || mode === MODE_X ? mode : 0;
}

function isOpen(player) {
  return player.getInterfaceId?.() === MAIN;
}

/** Exchange. */
function open({ player }) {
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MODAL_BACKGROUND, [-1, -1]);
  for (const kind of KINDS) sendStored(player, kind);
  const mode = quantityMode(player);
  if (sender.getVarbit(QUANTITY_VARBIT) !== mode) sender.sendVarbit(QUANTITY_VARBIT, mode);
  player.setInterfaceId(MAIN);
  sender.sendSubInterface(MAIN_MODAL, MAIN, 0);
  sender.sendSubInterface(SIDE_MODAL, SIDE, 0);
  for (const button of QUANTITY_BUTTONS.keys()) sender.sendInterfaceFlagsRange((MAIN << 16) | button, -1, -1, OP1);
  sender.sendVarbit(BUSY_VARBIT, 1);
}

function closed({ player, interfaceId }) {
  if (interfaceId === MAIN) player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

/** Unnoted inventory items first, then banknotes, then the worn one (script 2149's three sources). */
function held(player, id) {
  const definition = core.ItemDefinition.forId(id);
  const note = definition?.getNoteId?.() ?? -1;
  const inventory = player.getInventory();
  const usable = (item, want) => item && item.getId() === want && item.getAmount() > 0 && !restricted(item);
  const sources = [];
  inventory.getItems().forEach((item, slot) => {
    if (usable(item, id)) sources.push({ slot, item, worn: false });
  });
  if (note > 0 && note !== id) {
    inventory.getItems().forEach((item, slot) => {
      if (usable(item, note)) sources.push({ slot, item, worn: false });
    });
  }
  const weaponSlot = core.Equipment.WEAPON_SLOT;
  const weapon = player.getEquipment().getItems()[weaponSlot];
  if (usable(weapon, id)) sources.push({ slot: weaponSlot, item: weapon, worn: true });
  return sources;
}

function restricted(item) {
  return item.isPresetItem?.() === true || item.getMetaValue?.(core.Item.UNBANKABLE_META) === true;
}

/** Takes up to `amount` of `id` from the inventory, its notes and the weapon slot; returns how many. */
function takeFromPlayer(player, id, amount) {
  let left = amount;
  let unequipped = false;
  for (const source of held(player, id)) {
    if (left <= 0) break;
    const moved = Math.min(left, source.item.getAmount());
    if (source.worn) {
      player.getEquipment().setItem(source.slot, new core.Item(-1, 0));
      unequipped = true;
    } else {
      player.getInventory().deleteAtSlot(source.slot, moved, false);
    }
    left -= moved;
  }
  if (unequipped) refreshWeapon(player);
  player.getInventory().refreshItems();
  return amount - left;
}

function refreshWeapon(player) {
  player.getEquipment().refreshItems();
  core.WeaponInterfaceManager.assign(player);
  api.getBonusManager?.().update(player);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  player.getPacketSender().sendSound(UNEQUIP_SOUND, 1, 0);
}

/** Stores up to `amount` of a kind; returns how many went in. Ours: nothing is said when none do. */
function store(player, kind, amount) {
  if (kind === "net") {
    if (stored(player, kind) !== NET_VALUE.NONE) return 0;
    const [magic, butterfly] = itemsOf(kind);
    const id = held(player, magic).length ? magic : held(player, butterfly).length ? butterfly : null;
    if (id === null || takeFromPlayer(player, id, 1) < 1) return 0;
    setStored(player, kind, id === magic ? NET_VALUE.MAGIC : NET_VALUE.BUTTERFLY);
    return 1;
  }
  const room = CAPACITY[kind] - stored(player, kind);
  const moved = takeFromPlayer(player, itemsOf(kind)[0], Math.min(amount, room));
  if (moved > 0) setStored(player, kind, stored(player, kind) + moved);
  return moved;
}

/** Withdraws up to `amount` of a kind into the inventory, unnoted; returns how many came out. */
function withdraw(player, kind, amount, { quiet = false } = {}) {
  const have = count(player, kind);
  if (have <= 0) {
    if (!quiet) player.sendMessage(NONE_STORED[kind]);
    return 0;
  }
  const inventory = player.getInventory();
  const id = kind === "net"
    ? itemsOf(kind)[stored(player, kind) === NET_VALUE.MAGIC ? 0 : 1]
    : itemsOf(kind)[0];
  const moved = Math.min(amount, have, inventory.getFreeSlots());
  if (moved <= 0) {
    player.sendMessage(MESSAGE.NO_SPACE);
    return -1;
  }
  inventory.add(new core.Item(id, moved), true);
  setStored(player, kind, kind === "net" ? NET_VALUE.NONE : have - moved);
  return moved;
}

/** Withdraw-all and Quick-withdraw: everything, net first, as far as the inventory has room. */
function withdrawAll({ player }) {
  if (KINDS.every((kind) => count(player, kind) <= 0)) {
    player.sendMessage(MESSAGE.NOTHING_TO_WITHDRAW);
    return;
  }
  for (const kind of KINDS) {
    if (count(player, kind) > 0 && withdraw(player, kind, Number.MAX_SAFE_INTEGER, { quiet: true }) < 0) return;
  }
}

function storeAll(player) {
  for (const kind of KINDS) store(player, kind, CAPACITY[kind]);
}

/** Op 1 is the selected quantity, ops 2-4 the other three (scripts 2146/2148); single items only have op 1. */
function itemOp(player, kind, op, move) {
  if (CAPACITY[kind] === 1) {
    if (op === 1) move(1);
    return;
  }
  const selected = quantityMode(player);
  const order = [selected, ...[0, 1, MODE_X, 2].filter((mode) => mode !== selected)];
  const mode = order[op - 1];
  if (mode === undefined) return;
  if (mode === MODE_X) {
    player.setEnteredAmountAction({ execute: (amount) => amount > 0 && move(amount) });
    player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
    return;
  }
  move(QUANTITY_AMOUNTS.get(mode));
}

function examine(player, id) {
  const definition = core.ItemDefinition.forId(id);
  player.sendMessage(definition?.getExamine?.() || definition?.getName?.() || "Nothing interesting happens.");
}

function click(event) {
  const { player, action } = event;
  const buttonId = Number(event.buttonId ?? 0);
  const groupId = event.groupId ?? (buttonId >>> 16);
  const childId = event.childId ?? (buttonId & 0xffff);
  if ((groupId !== MAIN && groupId !== SIDE) || !isOpen(player)) return;
  event.handled = true;
  const op = Number(action);
  if (groupId === MAIN) {
    const kind = MAIN_SLOT[childId];
    if (kind) {
      if (op === EXAMINE_OP) return examine(player, itemsOf(kind)[kind === "net" && stored(player, kind) === NET_VALUE.BUTTERFLY ? 1 : 0]);
      return itemOp(player, kind, op, (amount) => withdraw(player, kind, amount));
    }
    if (childId === WITHDRAW_ALL) return withdrawAll({ player });
    if (QUANTITY_BUTTONS.has(childId)) {
      player.setAttribute(QUANTITY_ATTRIBUTE, QUANTITY_BUTTONS.get(childId));
      player.getPacketSender().sendVarbit(QUANTITY_VARBIT, QUANTITY_BUTTONS.get(childId));
    }
    return;
  }
  const kind = SIDE_SLOT[childId];
  if (kind) {
    if (op === EXAMINE_OP) return examine(player, itemsOf(kind)[0]);
    return itemOp(player, kind, op, (amount) => store(player, kind, amount));
  }
  if (childId === STORE_ALL) storeAll(player);
}

function register(pluginApi) {
  init(pluginApi);
  for (const key of Object.values(STORAGE_ATTRIBUTE)) pluginApi.persistAttribute(key, 0);
  pluginApi.persistAttribute(QUANTITY_ATTRIBUTE, 0);
  pluginApi.onNpcInteraction("Elnock Inquisitor", { Exchange: open, "Quick-withdraw": withdrawAll });
  pluginApi.onInterfaceActionClick(click);
  pluginApi.onCustomEvent("interface:closed", closed);
}

module.exports = register;
Object.assign(module.exports, {
  init,
  _test: {
    open, closed, click, store, withdraw, withdrawAll, stored, count,
    STORAGE_ATTRIBUTE, QUANTITY_ATTRIBUTE, STORED_VARBIT, QUANTITY_VARBIT, BUSY_VARBIT, NET_VALUE,
    MESSAGE, MAIN, SIDE, CAPACITY,
  },
});
