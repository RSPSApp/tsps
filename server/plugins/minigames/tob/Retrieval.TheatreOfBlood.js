"use strict";

/**
 * The item retrieval chests in Ver Sinhaza.
 *
 * Wiki ("Theatre of Blood", Death within the Theatre): if the whole party dies, everything but
 * the items a death keeps goes to a storage chest, reclaimed for 100,000 coins; a second such
 * death before reclaiming them loses them for good. The empty chest's message is not captured.
 * A logout during a fight whose raid has ended by the time the player returns counts the same.
 */

const Shared = require("./Shared.TheatreOfBlood");

const ATTR_STORED = "tob:retrieval";
const FEE = 100000;

function storedOf(player) {
  const stored = player.getAttribute(ATTR_STORED);
  return Array.isArray(stored) ? stored : [];
}

function retrievalItems(request) {
  for (const {id: itemId, amount} of storedOf(request.player)) request.items.push({itemId, amount});
}

/** Everything but the kept items moves into the chest, replacing anything already there. */
function storeAfterWipe(player) {
  const { Item, PlayerDeathTask } = Shared.core();
  const kept = new Set(PlayerDeathTask.getItemsToKeep(player));
  const stored = [];
  for (const container of [player.getInventory(), player.getEquipment()]) {
    const items = container.getItems();
    for (let slot = 0; slot < items.length; slot++) {
      const item = items[slot];
      if (!item || item.getId() <= 0 || item.getAmount() <= 0 || kept.has(item)) continue;
      stored.push({ id: item.getId(), amount: item.getAmount() });
      container.setItem(slot, new Item(-1, 0));
    }
    container.refreshItems();
  }
  Shared.api().getBonusManager().update(player);
  player.getUpdateFlag().flag(Shared.core().Flag.APPEARANCE);
  player.setAttribute(ATTR_STORED, stored);
  return stored;
}

function collect(player) {
  const stored = storedOf(player);
  const inventory = player.getInventory();
  if (inventory.getAmount(Shared.ITEM.COINS) < FEE) {
    Shared.statement(player, `You need ${FEE.toLocaleString("en-US")} coins to reclaim your items.`);
    return;
  }
  inventory.delete(Shared.ITEM.COINS, FEE);
  const { Item, ItemDefinition, Bank } = Shared.core();
  let banked = 0;
  for (const { id, amount } of stored) {
    const stackable = ItemDefinition.forId(id)?.isStackable?.() === true;
    const fits = stackable ? (inventory.contains(id) || inventory.getFreeSlots() > 0) : inventory.getFreeSlots() >= amount;
    if (fits) {
      inventory.add(new Item(id, amount), false);
      continue;
    }
    player.getBank(Bank.getTabForItem(player, id)).add(new Item(id, amount), false);
    banked++;
  }
  inventory.refreshItems();
  player.setAttribute(ATTR_STORED, []);
  player.sendMessage(banked > 0 ? "You reclaim your items. Those that didn't fit were sent to your bank." : "You reclaim your items.");
}

function searchChest(event) {
  const { player } = event;
  if (storedOf(player).length === 0) {
    Shared.statement(player, "The chest seems to be empty. If it did have any of your items, but<br>you died before collecting them, they'll now be lost.");
    return true;
  }
  Shared.options(player, `Reclaim your items for ${FEE.toLocaleString("en-US")} coins?`,
    "Yes, pay the fee.", () => collect(player),
    "No.", () => {});
  return true;
}

module.exports = function registerTheatreRetrieval(api) {
  Shared.bind(api);
  api.onCustomEvent("item-retrieval:items", retrievalItems);
  api.persistAttribute(ATTR_STORED);
  Shared.onObject(api, Shared.OBJECT.RETRIEVAL_CHEST, searchChest);
};

Object.assign(module.exports, { ATTR_STORED, FEE, storeAfterWipe, storedOf, collect, searchChest, retrievalItems });
