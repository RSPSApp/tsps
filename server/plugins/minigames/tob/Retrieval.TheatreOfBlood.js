"use strict";

/**
 * The item retrieval chests in Ver Sinhaza.
 *
 * Captured (rsprox 227/01764 ticks 24726-24746, 234/03299, 227/01833): the chest opens
 * gravestone_retrieval (602) over inv gravestone (525), as Torfinn does. Its button pays first
 * ("Payment has been taken from your bank: 100,000 x Coins"), then takes whatever fits, and
 * what doesn't fit stays for later. The empty chest's line (227/01764).
 * Wiki ("Theatre of Blood", Death mechanics): if the whole party dies, everything goes here,
 * kept items included, for 100,000 coins; Entry Mode has no cost; a second such death before
 * reclaiming them loses them for good. A logout during a fight whose raid has ended by the time
 * the player returns counts the same.
 */

const Shared = require("./Shared.TheatreOfBlood");

const ATTR_STORED = "tob:retrieval";
const OWNER = "tob";
const FEE = 100000;
const INV = 525;
const SLOTS = 120;
const IF1 = { UNPAID: 5, PAID: 6, EMPTY: -1 };
const PAID_SCRIPT = 3478;
const MAIN_MODAL_OPEN = 2524;
const MODAL = 0;
const TAKE_OP = 2;
const EXAMINE_OP = 10;
const EVENTS = (1 << 2) | (1 << 9) | (1 << 10);
const EMPTY_LINE = "The chest seems to be empty. If it did have any of your items, but you died before collecting them, they'll now be lost.";
const CANNOT_PAY = "You don't have enough coins with you or in your bank to pay the fee.";
const COMPONENT = {};
const VARP = {};

function lotOf(player) {
  const stored = player.getAttribute(ATTR_STORED);
  return Array.isArray(stored?.items) && stored.items.length > 0 ? stored : null;
}

function storedOf(player) {
  return lotOf(player)?.items ?? [];
}

function setLot(player, lot) {
  player.setAttribute(ATTR_STORED, lot && lot.items.length > 0 ? lot : null);
}

function retrievalItems(request) {
  for (const { id, amount } of storedOf(request.player)) request.items.push({ itemId: id, amount });
}

/** Everything moves into the chest, replacing anything already there. Entry Mode's lot is free. */
function storeAfterWipe(player, { free = false } = {}) {
  const { Item, Flag } = Shared.core();
  const stored = [];
  for (const container of [player.getInventory(), player.getEquipment()]) {
    const items = container.getItems();
    for (let slot = 0; slot < items.length; slot++) {
      const item = items[slot];
      if (!item || item.getId() <= 0 || item.getAmount() <= 0) continue;
      const entry = { id: item.getId(), amount: item.getAmount() };
      const meta = item.getMeta?.() ?? null;
      if (meta) entry.meta = JSON.parse(JSON.stringify(meta));
      stored.push(entry);
      container.setItem(slot, new Item(-1, 0));
    }
    container.refreshItems();
  }
  Shared.api().getBonusManager().update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  setLot(player, { items: stored, paid: free });
  return stored;
}

function isOpen(player) {
  return player.getPacketSender().isSubInterfaceOpen(COMPONENT.items >>> 16);
}

function summary(entries) {
  const { ItemDefinition } = Shared.core();
  const value = entries.reduce((sum, { id, amount }) => sum + Math.max(0, ItemDefinition.forId(id).getGrandExchangeValue?.() ?? 0) * amount, 0);
  const count = `Stack count: <col=ffffff>${entries.length}</col><br>Guide value: <col=ffffff>${value.toLocaleString("en-GB")}</col>`;
  return entries.length > 0 ? `${count} (approximately)` : count;
}

function sendContents(player, lot) {
  const entries = lot?.items ?? [];
  const sender = player.getPacketSender();
  sender.sendInventory(INV, SLOTS, entries);
  sender.sendString(summary(entries), COMPONENT.discard);
}

function open(player) {
  const lot = lotOf(player);
  // The interface is shared (Torfinn's lot): whichever opened it answers its clicks.
  player.__retrievalOwner = OWNER;
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendConfig(VARP.if2, 0);
  sender.sendConfig(VARP.if1, lot.paid ? IF1.PAID : IF1.UNPAID);
  sender.sendInventory(INV, SLOTS, lot.items);
  sender.sendInterfaceScript(MAIN_MODAL_OPEN, [-1, -1]);
  sender.sendSubInterface(COMPONENT.mainModal, COMPONENT.items >>> 16, MODAL);
  sender.sendInterfaceFlagsRange(COMPONENT.items, 0, SLOTS - 1, EVENTS);
  sender.sendString(summary(lot.items), COMPONENT.discard);
}

function pay(player, lot) {
  const request = { player, amount: FEE, office: false, source: null, message: null };
  Shared.api().emitCustomEvent("gravestones:pay-fee", request);
  if (!request.source) {
    player.sendMessage(CANNOT_PAY);
    return false;
  }
  if (request.message) player.sendMessage(request.message);
  lot.paid = true;
  setLot(player, lot);
  const sender = player.getPacketSender();
  sender.sendConfig(VARP.if1, IF1.PAID);
  sendContents(player, lot);
  sender.sendInterfaceScript(PAID_SCRIPT, [FEE, 0]);
  return true;
}

function takeEntry(player, entry) {
  const { Item } = Shared.core();
  const inventory = player.getInventory();
  const count = Math.min(entry.amount, inventory.getAddableAmount(new Item(entry.id, entry.amount, entry.meta ?? null)));
  if (count <= 0) return false;
  inventory.add(new Item(entry.id, count, entry.meta ?? null), false);
  entry.amount -= count;
  return true;
}

function finishTaking(player, lot) {
  player.getInventory().refreshItems?.();
  lot.items = lot.items.filter((entry) => entry.amount > 0);
  setLot(player, lot);
  if (lot.items.length === 0) player.getPacketSender().sendConfig(VARP.if1, IF1.EMPTY);
  sendContents(player, lot);
}

function button({ player }) {
  if (player.__retrievalOwner !== OWNER) return false;
  if (!isOpen(player)) return;
  const lot = lotOf(player);
  if (!lot) return;
  if (!lot.paid) {
    pay(player, lot);
    return;
  }
  for (const entry of lot.items) takeEntry(player, entry);
  finishTaking(player, lot);
}

function clickItem(event) {
  const { player } = event;
  if (player.__retrievalOwner !== OWNER) return false;
  if (!isOpen(player)) return;
  const lot = lotOf(player);
  const entry = lot?.items[Number.isInteger(event.slot) ? event.slot : -1];
  if (!entry) return;
  const op = event.opId ?? event.action;
  if (op === EXAMINE_OP) {
    player.sendMessage(Shared.core().ItemDefinition.forId(entry.id).getExamine());
    return;
  }
  if (op !== TAKE_OP) return;
  if (!lot.paid) {
    pay(player, lot);
    return;
  }
  takeEntry(player, entry);
  finishTaking(player, lot);
}

function searchChest({ player }) {
  if (lotOf(player)) open(player);
  else player.sendMessage(EMPTY_LINE);
  return true;
}

module.exports = function registerTheatreRetrieval(api) {
  Shared.bind(api);
  const { CacheDefinitions } = api.core;
  COMPONENT.items = CacheDefinitions.getComponentId("gravestone_retrieval:items");
  COMPONENT.button = CacheDefinitions.getComponentId("gravestone_retrieval:button");
  COMPONENT.discard = CacheDefinitions.getComponentId("gravestone_retrieval:discard");
  COMPONENT.mainModal = CacheDefinitions.getComponentId("toplevel_osrs_stretch:mainmodal");
  VARP.if1 = CacheDefinitions.getVarpId("if1");
  VARP.if2 = CacheDefinitions.getVarpId("if2");
  api.persistAttribute(ATTR_STORED);
  api.onCustomEvent("item-retrieval:items", retrievalItems);
  Shared.onObject(api, Shared.OBJECT.RETRIEVAL_CHEST, searchChest);
  api.onInterfaceActionButton(COMPONENT.button, button);
  api.onInterfaceActionButton(COMPONENT.items, clickItem);
};

Object.assign(module.exports, { ATTR_STORED, FEE, storeAfterWipe, storedOf, lotOf, open, button, clickItem, searchChest, retrievalItems });
