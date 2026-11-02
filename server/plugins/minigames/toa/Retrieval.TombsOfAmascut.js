"use strict";

/**
 * The lobby's retrieval chest (toa_lobby_gravestone_chest, Claim). A raid that fails for good sends
 * what a death wouldn't keep here.
 *
 * Captured (227/01762 ticks 18801-18832):
 * - "You failed to survive the Tombs of Amascut.", the fade, and on arriving "A magical chest has
 *   retrieved some of your items. You can collect them from it in the Tombs of Amascut lobby."
 * - Claim opens gravestone_retrieval (602) over inv gravestone (525), as Torfinn's does. The button
 *   pays first ("Payment has been taken from your bank: 6,500 x Coins", script 3478), then takes
 *   what fits; what doesn't stays, and costs nothing more.
 * - The empty chest's line (227/01852 tick 15786).
 * Wiki (Tombs of Amascut, Death mechanics; Item Retrieval Service):
 * - The fee follows the items' Grand Exchange values, up to 500,000 coins, "the same as dying under
 *   normal circumstances": gravestones' fee, asked with `gravestones:fee`. (That capture's 6,500 is
 *   a Leagues world's and isn't reproduced.)
 * - Dying again with no attempts left loses what the chest held; so does a logout that wipes.
 */

const Shared = require("./Shared.TombsOfAmascut");

const ATTR_STORED = "toa:retrieval";
/** gravestone_retrieval is shared (Vorkath's, the Theatre of Blood's): whichever opened it answers its clicks. */
const OWNER = "tombs-of-amascut";
const CHEST_NAME = "toa_lobby_gravestone_chest";
const INV = 525;
const SLOTS = 120;
const IF1 = { UNPAID: 5, PAID: 6, EMPTY: -1 };
const PAID_SCRIPT = 3478;
const MODAL = 0;
const TAKE_OP = 2;
const EXAMINE_OP = 10;
const EVENTS = (1 << 2) | (1 << 9) | (1 << 10);
const EMPTY_LINE = "The chest seems to be empty. If it did have any of your items, but you died before collecting them, they'll now be lost.";
const CANNOT_PAY = "You don't have enough coins with you or in your bank to pay the fee.";
const RETRIEVED_LINE = "A magical chest has retrieved some of your items. You can collect them from it in the Tombs of Amascut lobby.";
const COMPONENT = {};
const VARP = {};

function lotOf(player) {
  const stored = player.getAttribute(ATTR_STORED);
  return Array.isArray(stored?.items) && stored.items.length > 0 ? stored : null;
}

function setLot(player, lot) {
  player.setAttribute(ATTR_STORED, lot && lot.items.length > 0 ? lot : null);
}

/** What the fee would be for these records, by gravestones' bands. */
function feeFor(player, items) {
  const request = { player, items, fee: 0 };
  Shared.api().emitCustomEvent("gravestones:fee", request);
  return request.fee;
}

/**
 * What a death wouldn't keep moves to the chest, replacing anything already there. Returns how many
 * stacks it holds now.
 */
function storeLost(player) {
  const { Item, Flag, PlayerDeathTask } = Shared.core();
  const kept = PlayerDeathTask.getItemsToKeep(player);
  const stored = [];
  for (const container of [player.getInventory(), player.getEquipment()]) {
    const items = container.getItems();
    for (let slot = 0; slot < items.length; slot++) {
      const item = items[slot];
      if (!item || item.getId() <= 0 || item.getAmount() <= 0 || kept.includes(item)) continue;
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
  setLot(player, { items: stored, paid: false, fee: feeFor(player, stored) });
  return stored.length;
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
  player.__retrievalOwner = OWNER;
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendConfig(VARP.if2, 0);
  sender.sendConfig(VARP.if1, lot.paid ? IF1.PAID : IF1.UNPAID);
  sender.sendInventory(INV, SLOTS, lot.items);
  sender.sendInterfaceScript(Shared.SCRIPT.MAINMODAL_OPEN, [-1, -1]);
  sender.sendSubInterface(COMPONENT.mainModal, COMPONENT.items >>> 16, MODAL);
  sender.sendInterfaceFlagsRange(COMPONENT.items, 0, SLOTS - 1, EVENTS);
  sender.sendString(summary(lot.items), COMPONENT.discard);
}

function pay(player, lot) {
  const fee = lot.fee ?? 0;
  if (fee > 0) {
    const request = { player, amount: fee, office: false, source: null, message: null };
    Shared.api().emitCustomEvent("gravestones:pay-fee", request);
    if (!request.source) {
      player.sendMessage(CANNOT_PAY);
      return false;
    }
    if (request.message) player.sendMessage(request.message);
  }
  lot.paid = true;
  setLot(player, lot);
  const sender = player.getPacketSender();
  sender.sendConfig(VARP.if1, IF1.PAID);
  sendContents(player, lot);
  sender.sendInterfaceScript(PAID_SCRIPT, [fee, 0]);
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
  if (player.__retrievalOwner !== OWNER || !isOpen(player)) return false;
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
  if (player.__retrievalOwner !== OWNER || !isOpen(player)) return false;
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

function claim({ player }) {
  if (lotOf(player)) open(player);
  else Shared.statement(player, EMPTY_LINE);
  return true;
}

function retrievalItems(request) {
  for (const { id, amount } of lotOf(request.player)?.items ?? []) request.items.push({ itemId: id, amount });
}

module.exports = function registerTombsRetrieval(api) {
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
  api.onObjectClick(CacheDefinitions.getLocId(CHEST_NAME), 1, claim);
  api.onInterfaceActionButton(COMPONENT.button, button);
  api.onInterfaceActionButton(COMPONENT.items, clickItem);
};

Object.assign(module.exports, { ATTR_STORED, RETRIEVED_LINE, EMPTY_LINE, storeLost, lotOf, open, button, clickItem, claim, retrievalItems });
