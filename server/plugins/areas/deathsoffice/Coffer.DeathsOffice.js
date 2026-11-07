"use strict";

/**
 * Death's Coffer: items sacrificed to it are credited at 105% of their value, and the credit pays
 * death fees (Wiki: Death's Coffer). As captured (rsprox recordings 1106 and 4266):
 * - Sacrifice opens death_coffer with death_coffer_side over the inventory (interface_inv_init,
 *   "Select"), the display blank;
 * - selecting an item shows it and sets if2 (its slot), if3 (how many, 1) and if4 (the credit for
 *   one);
 * - Confirm credits the Coffer (if1 is its balance), clears the selection and the item, plays the
 *   sacrifice sound (1595) and Death's payment sound 10 cycles on, and the portal shrinks.
 * Items worth less than 10,000 coins each, untradeables and bonds are refused (the Wiki).
 * UNVERIFIED (no capture): the refusal messages, 5/X/All, and the portal loop three ticks after.
 */
const Common = require("./Common.DeathsOffice");

const CREDIT_PERCENT = 105;
const MIN_CREDIT = 10000;
const MAX_CREDIT = 2100000000;
const MAX_COFFER = 2147483647;
const BLANK_OBJ = 6512;
const DISPLAY_ZOOM = 400;
const INVENTORY = 93;
const INVENTORY_SLOTS = 28;
const EXAMINE_OP = 10;
const SACRIFICE_SOUND = 1595;
const PORTAL_SHRINK = "poh_portal_shrinkunshrinkloop";
const PORTAL_LOOP = "poh_portal_loop";
const PORTAL_LOOP_DELAY = 3;
const BONDS = ["osrs_bond", "osrs_bond_untradeable"];

const MESSAGE = {
  ultimate: "Ultimate Iron Men do not use gravestones like other players do, by the way, so they are not invited to sacrifice items to Death's Coffer to pay the fees.",
  untradeable: "You cannot trade that item to Death.",
  cheap: "Death will not accept items worth less than 10,000 coins per <col=ef1020>individual item</col>.",
  full: "The coffer is too full to accommodate that.",
};

let bondIds = null;

/** A preset or meta-untradeable copy (Presets.PvpMode tags them) was never paid for, so it buys no credit. */
function restricted(item) {
  return item.isPresetItem?.() === true || item.isUntradeable?.() === true || item.isUnbankable?.() === true;
}

/** How many plain copies of `itemId` the inventory holds. */
function plainCount(inventory, itemId) {
  return inventory.getItems().reduce((total, held) =>
    (held?.getId() === itemId && !restricted(held) ? total + held.getAmount() : total), 0);
}

/** Takes `count` plain copies, the selected slot first, leaving restricted copies alone. */
function takePlain(inventory, itemId, count, firstSlot) {
  const items = inventory.getItems();
  const slots = [firstSlot, ...items.map((_, slot) => slot).filter((slot) => slot !== firstSlot)];
  let left = count;
  for (const slot of slots) {
    const held = items[slot];
    if (left <= 0) break;
    if (held?.getId() !== itemId || restricted(held)) continue;
    const taken = Math.min(left, held.getAmount());
    inventory.deleteAtSlot(slot, taken, false);
    left -= taken;
  }
}

function isOpen(player) {
  return player.getPacketSender().isSubInterfaceOpen(Common.ID.cofferInterface);
}

function varp(player, key) {
  return player.getPacketSender().getVarp?.(Common.VARP[key]) ?? 0;
}

function setVarp(player, key, value) {
  player.getPacketSender().sendConfig(Common.VARP[key], value);
}

function display(player, itemId) {
  player.getPacketSender().sendItemOnInterfaces(Common.COMPONENT.cofferDisplay, itemId, DISPLAY_ZOOM);
}

/** The item a coffer credit is for: the unnoted one. */
function baseDefinition(itemId) {
  const { ItemDefinition } = Common.core();
  return ItemDefinition.forId(ItemDefinition.forId(itemId).unNote());
}

/** 105% of one item's value, rounded down, at most 2,100,000,000. */
function credit(itemId) {
  return Math.min(MAX_CREDIT, Math.floor((baseDefinition(itemId).getValue() * CREDIT_PERCENT) / 100));
}

function isBond(itemId) {
  if (!bondIds) {
    const { CacheDefinitions } = Common.core();
    bondIds = new Set(BONDS.map((name) => CacheDefinitions.getObjId(name)));
  }
  return bondIds.has(baseDefinition(itemId).getId());
}

function clearSelection(player) {
  setVarp(player, "if4", 0);
  setVarp(player, "if3", 0);
  setVarp(player, "if2", -1);
  display(player, BLANK_OBJ);
}

function openCoffer({ player }) {
  const state = Common.state(player);
  if (state.ironman === "ultimate") {
    player.sendMessage(MESSAGE.ultimate);
    return true;
  }
  const { COMPONENT, SCRIPT, MODAL, OP1, OP10 } = Common;
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  setVarp(player, "if3", 0);
  setVarp(player, "if2", -1);
  setVarp(player, "if1", state.coffer);
  player.getInventory().refreshItems();
  display(player, BLANK_OBJ);
  sender.sendInterfaceScript(SCRIPT.mainModalBackground, [-1, -1]);
  sender.sendSubInterface(COMPONENT.mainModal, Common.ID.cofferInterface, MODAL);
  sender.sendSubInterface(COMPONENT.sideModal, Common.ID.cofferSideInterface, MODAL);
  sender.sendInterfaceScript(SCRIPT.invInit, [COMPONENT.cofferSideItems, INVENTORY, 4, 7, 0, -1, "Select", "", "", "", ""]);
  sender.sendInterfaceFlagsRange(COMPONENT.cofferSideItems, 0, INVENTORY_SLOTS - 1, OP1 | OP10);
  return true;
}

function selectItem(event) {
  const { player } = event;
  if (!isOpen(player)) return;
  const slot = Number.isInteger(event.slot) ? event.slot : -1;
  const item = player.getInventory().getItems()[slot];
  if (!item || item.getId() <= 0) return;
  if ((event.opId ?? event.action) === EXAMINE_OP) {
    player.sendMessage(item.getDefinition().getExamine());
    return;
  }
  if (restricted(item)) {
    player.sendMessage(MESSAGE.untradeable);
    return;
  }
  setVarp(player, "if4", credit(item.getId()));
  setVarp(player, "if3", 1);
  setVarp(player, "if2", slot);
  display(player, item.getId());
}

/** Nothing happens without a selection. */
function setCount(player, count) {
  if (!isOpen(player) || varp(player, "if2") < 0) return;
  setVarp(player, "if3", count);
}

function countOne({ player }) {
  setCount(player, 1);
}

function countFive({ player }) {
  setCount(player, 5);
}

function countAll({ player }) {
  setCount(player, MAX_COFFER);
}

function countX({ player }) {
  if (!isOpen(player) || varp(player, "if2") < 0) return;
  player.setEnteredAmountAction({ execute: (amount) => setCount(player, amount) });
  player.getPacketSender().sendEnterAmountPrompt("How many would you like to sacrifice?");
}

function confirm({ player }) {
  if (!isOpen(player)) return;
  const slot = varp(player, "if2");
  const item = player.getInventory().getItems()[slot];
  const wanted = varp(player, "if3");
  if (!item || item.getId() <= 0 || wanted <= 0) return;
  const itemId = item.getId();
  if (restricted(item) || !baseDefinition(itemId).isTradeable() || isBond(itemId)) {
    player.sendMessage(MESSAGE.untradeable);
    return;
  }
  const each = credit(itemId);
  if (each < MIN_CREDIT) {
    player.sendMessage(MESSAGE.cheap);
    return;
  }
  const inventory = player.getInventory();
  const count = Math.min(wanted, plainCount(inventory, itemId));
  const total = each * count;
  if (Common.state(player).coffer + total > MAX_COFFER || !Common.adjustCoffer(player, total)) {
    player.sendMessage(MESSAGE.full);
    return;
  }
  takePlain(inventory, itemId, count, slot);
  inventory.refreshItems();
  setVarp(player, "if1", Common.state(player).coffer);
  clearSelection(player);
  Common.sound(player, SACRIFICE_SOUND);
  Common.sound(player, Common.PAYMENT_SOUND, Common.PAYMENT_SOUND_DELAY);
  portalAnimation(player, PORTAL_SHRINK);
  Common.later(player, PORTAL_LOOP_DELAY, () => {
    if (isOpen(player)) portalAnimation(player, PORTAL_LOOP);
  });
}

function portalAnimation(player, seq) {
  const id = Common.core().CacheDefinitions.getSeqId(seq);
  if (id != null) player.getPacketSender().sendInterfaceAnimation(Common.COMPONENT.cofferPortal, id);
}

function attach(api) {
  Common.bind(api);
  const { COMPONENT } = Common;
  api.onObjectFirstClick(Common.ID.cofferLoc, openCoffer);
  api.onInterfaceActionButton(COMPONENT.cofferSideItems, selectItem);
  api.onInterfaceActionButton(COMPONENT.coffer1, countOne);
  api.onInterfaceActionButton(COMPONENT.coffer5, countFive);
  api.onInterfaceActionButton(COMPONENT.cofferX, countX);
  api.onInterfaceActionButton(COMPONENT.cofferAll, countAll);
  api.onInterfaceActionButton(COMPONENT.cofferConfirm, confirm);
}

module.exports = { attach, credit };
