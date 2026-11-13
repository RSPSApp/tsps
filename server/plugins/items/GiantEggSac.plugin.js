"use strict";

/**
 * Giant egg sac (members), Sarachnis's drop (https://oldschool.runescape.wiki/w/Giant_egg_sac).
 * docs/giant-egg-sac.md has the rsprox captures this follows.
 *
 * The full sac holds 100 red spiders' eggs. Cut-open, or a knife used on it, opens it only in a
 * bank ("You can only do this whilst in a bank.", checked before the knife): the eggs fill the
 * free inventory slots, unnoted, and the rest stay in the untradeable open sac. The open sac's
 * Remove-eggs takes out as many as there is room for, its Check-eggs says how many are left, and
 * its bank-side Empty puts them all in the bank, the sac going with them.
 *
 * The open sac's egg count is item meta, so it stays with the sac in the bank and over a relog.
 */

const EGGS_META = "giant-egg-sac:eggs";
const FULL_EGGS = 100;
/** The bank panel's op the open sac labels "Empty" (rsprox captures: bankside op9). */
const BANK_EMPTY_OP = 9;
const KNIFE = "Knife";

const NOT_IN_BANK = "You can only do this whilst in a bank.";
const NO_KNIFE = "You need to have a knife to cut the egg sac open.";
const NO_SPACE = "You do not have enough inventory space.";

let pluginApi;
let core;

function nearBank(player) {
  const query = { player, near: false };
  pluginApi.emitCustomEvent("league:near-bank", query);
  return query.near === true;
}

/** An unnoted item named Knife (any of the cache's knife copies; a noted one isn't a knife to cut with). */
function hasKnife(inventory) {
  return inventory.getValidItems().some((item) => {
    const definition = item.getDefinition();
    return !definition.isNoted() && definition.getName() === KNIFE;
  });
}

/** The eggs left in an open sac; one saved before its count was set holds none (a full sac is never one). */
function eggsIn(sac) {
  const value = sac?.getMetaValue?.(EGGS_META);
  return Number.isInteger(value) ? Math.max(0, Math.min(FULL_EGGS, value)) : 0;
}

function isSacAt(player, sac, slot, id) {
  const items = player.getInventory().getItems();
  return Number.isInteger(slot) && items[slot] === sac && sac?.getId?.() === id;
}

/** Eggs into the free inventory slots (one each: they don't stack), at most `eggs`; returns how many went in. */
function addEggs(inventory, eggs) {
  const given = Math.min(eggs, inventory.getFreeSlots());
  for (let i = 0; i < given; i++) inventory.add(new core.Item(core.ItemIdentifiers.RED_SPIDERS_EGGS, 1), false);
  return given;
}

/** What's left in the sac at `slot`: the open sac with its count, or nothing once it's empty. */
function setLeft(inventory, slot, left) {
  if (left > 0) inventory.setItem(slot, new core.Item(core.ItemIdentifiers.GIANT_EGG_SAC, 1, { [EGGS_META]: left }));
  else inventory.setItem(slot, new core.Item(-1, 0));
}

function cutOpen(player, sac, slot) {
  const I = core.ItemIdentifiers;
  if (!isSacAt(player, sac, slot, I.GIANT_EGG_SAC_FULL_)) return;
  if (!nearBank(player)) {
    player.sendMessage(NOT_IN_BANK);
    return;
  }
  const inventory = player.getInventory();
  if (!hasKnife(inventory)) {
    player.sendMessage(NO_KNIFE);
    return;
  }
  // Ours: no capture opens a sac with a full backpack; it stays shut rather than opening for none.
  if (inventory.getFreeSlots() === 0) {
    player.sendMessage(NO_SPACE);
    return;
  }
  // The open sac takes the full one's slot before the eggs fill the rest (rsprox captures).
  inventory.setItem(slot, new core.Item(I.GIANT_EGG_SAC, 1, { [EGGS_META]: FULL_EGGS }));
  const given = addEggs(inventory, FULL_EGGS);
  setLeft(inventory, slot, FULL_EGGS - given);
  inventory.refreshItems();
  player.sendMessage(`You cut open the egg sac and receive ${given} red spiders' eggs.`);
}

/** Cut-open on the full sac. */
function cutOpenOption(event) {
  cutOpen(event.player, event.item, event.slot);
  return true;
}

/** A knife on the full sac, either way round. */
function knifeOnSac(event) {
  const usedIsSac = event.usedItemId === core.ItemIdentifiers.GIANT_EGG_SAC_FULL_;
  const sac = usedIsSac ? event.usedItem : event.usedWithItem;
  const slot = usedIsSac ? event.usedItemSlot : event.usedWithItemSlot;
  event.handled = true;
  cutOpen(event.player, sac, slot);
  return true;
}

/** Check-eggs on the full sac. */
function checkFull({ player }) {
  player.sendMessage(`There are ${FULL_EGGS} eggs left.`);
  return true;
}

/** Check-eggs on the open sac. */
function checkOpen({ player, item }) {
  player.sendMessage(`There are ${eggsIn(item)} eggs left.`);
  return true;
}

/** Remove-eggs on the open sac: as many as there is room for. */
function removeEggs({ player, item, slot }) {
  if (!isSacAt(player, item, slot, core.ItemIdentifiers.GIANT_EGG_SAC)) return true;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() === 0) {
    player.sendMessage(NO_SPACE);
    return true;
  }
  // Ours: no capture takes eggs out with room to spare, so no line is sent and an emptied sac goes,
  // as it does when emptied into the bank.
  const eggs = eggsIn(item);
  const given = addEggs(inventory, eggs);
  setLeft(inventory, slot, eggs - given);
  inventory.refreshItems();
  return true;
}

/** The bank panel's Empty on the open sac: every egg into the bank, and the sac goes. */
function bankEmpty(event) {
  if (event.op !== BANK_EMPTY_OP || event.item?.getId?.() !== core.ItemIdentifiers.GIANT_EGG_SAC) return;
  const { player, item, slot } = event;
  if (!isSacAt(player, item, slot, core.ItemIdentifiers.GIANT_EGG_SAC)) return;
  event.handled = true;
  const eggs = eggsIn(item);
  const { Bank } = core;
  const eggsId = core.ItemIdentifiers.RED_SPIDERS_EGGS;
  const bank = player.getBank(Bank.getTabForItem(player, eggsId));
  // Ours: no capture empties into a full bank; as the storage items' bank Empty, nothing moves then.
  const moved = Math.min(eggs, bank.getAddableAmount(new core.Item(eggsId, eggs)));
  if (moved <= 0) return;
  bank.add(new core.Item(eggsId, moved), false);
  const inventory = player.getInventory();
  setLeft(inventory, slot, eggs - moved);
  inventory.refreshItems();
  if (Bank.isOpen(player)) {
    if (player.isSearchingBank()) player.getBank(Bank.BANK_SEARCH_TAB_INDEX).refreshItems();
    else player.getBank(player.getCurrentBankTab()).refreshItems();
  }
  player.sendMessage(`You empty ${moved} red spiders' eggs into the bank.`);
}

module.exports = {
  name: "GiantEggSac",
  description: "Giant egg sac: cut open in a bank for 100 red spiders' eggs, Remove-eggs, Check-eggs and bank Empty.",
  members: true,
  register(api) {
    pluginApi = api;
    core = api.core;
    api.onItemAction("Giant egg sac(full)", { "Cut-open": cutOpenOption, "Check-eggs": checkFull });
    api.onItemAction("Giant egg sac", { "Remove-eggs": removeEggs, "Check-eggs": checkOpen });
    api.onItemOnItem(KNIFE, "Giant egg sac(full)", knifeOnSac, { noted: false });
    api.onCustomEvent(core.Bank.INVENTORY_OP_EVENT, bankEmpty);
  },
  _test: { cutOpen, knifeOnSac, checkFull, checkOpen, removeEggs, bankEmpty, eggsIn, EGGS_META, FULL_EGGS },
};
