"use strict";

/**
 * The run's loot and Glory, and the rewards chest.
 *
 * Capture: opening the intermission sends the three reward inventories in full - 843 what has
 * been earned, 844 the next wave's loot (80 sunfire splinters before wave 1), 845 the last
 * wave's - and script 4931's three values after the offer are theirs (0, 30560, 0: the
 * splinters at 382 each). rsprox labels them longs, but this cache's 4931 takes 8 ints. Dying empties the preview, and the chest's value line (246:3) reads "Total Value: 0".
 * Wiki ("Fortis Colosseum", "Rewards Chest (Fortis Colosseum)", "Glory"):
 * - Dying, teleporting or logging out loses the loot. Ending the run between waves, or beating
 *   Sol Heredit, brings the rewards chest out in the middle of the arena with Minimus beside
 *   it to leave by; leaving through Minimus restores the player's stats.
 * - Glory per wave: the completion bonus (100 x wave), the same again if no enemy hurt the player
 *   (environmental damage - Solarflare, molten sand, the sky javelin - doesn't count), every
 *   active modifier's Glory, and a time bonus of 500 x wave less wave points a tick, rounded
 *   down to even. Only the best run counts, and dying keeps a run's Glory; teleporting out doesn't.
 * - Wave 12's pet roll (Smol Heredit, 1/200).
 * rsprox 1227 and 4117: the rewards modal, item withdrawal, banking and discard confirmation.
 * Offline_Scape: the chest's and Minimus's tiles.
 * RuneLite (gameval): the chest's appearing animation 10825.
 */

const Shared = require("./Shared.Colosseum");
const Loot = require("./Loot.Colosseum");
const { byKey } = require("./Modifiers.Colosseum");
const Scoreboard = require("./Scoreboard.Colosseum");

const INVENTORY = { REWARDS: 843, FUTURE: 844, PREVIOUS: 845 };
const INVENTORY_SIZE = 28;
const CHEST = { id: 50741, x: 1829, y: 3105, rotation: 1, appear: 10825 };
const MINIMUS_BY_CHEST = { x: 1830, y: 3103 };
const VARP_CURRENT_GLORY = 4132;

const CHEST_INTERFACE = 864;
const LEGACY_INTERFACE = 246;
const COMPONENT = { MODIFIERS: 11, DISCARD_ALL: 13, TAKE_ALL: 14, BANK_ALL: 15, ITEMS: 17 };
const LEGACY_COMPONENT = { VALUE: 3, ITEMS: 11 };
const ITEMS_UID = (CHEST_INTERFACE << 16) | COMPONENT.ITEMS;
const LEGACY_ITEMS_UID = (LEGACY_INTERFACE << 16) | LEGACY_COMPONENT.ITEMS;
const VALUE_UID = (LEGACY_INTERFACE << 16) | LEGACY_COMPONENT.VALUE;
const SCRIPT_CHEST_INIT = 4923;
const SCRIPT_CHEST_VALUE = 4929;
const VARBIT_LOOT_OPENED = 9802;
const SCRIPT_ITEM_OPS = 149;
const OP1 = 1 << 1;

const GLORY = { completion: 100, noDamage: 100, timeStart: 500 };

function runOf(player) {
  return require("./Run.Colosseum").runOf(player);
}

function valueOf(items) {
  const { ItemDefinition } = Shared.core();
  return items.reduce((sum, { id, amount }) => sum + (ItemDefinition.forId(id)?.getValue?.() ?? 0) * amount, 0);
}

function merge(into, items) {
  for (const { id, amount } of items) {
    const existing = into.find((entry) => entry.id === id);
    if (existing) existing.amount += amount;
    else into.push({ id, amount });
  }
}

// ---------------------------------------------------------------- the run

function start(run) {
  run.loot = { rewards: [], future: Loot.roll(1, run.player, run.random), previous: [] };
  run.glory = 0;
  run.player.getPacketSender().sendConfig(VARP_CURRENT_GLORY, 0);
}

function sendInventories(run) {
  const sender = run.player.getPacketSender();
  sender.sendInventory(INVENTORY.REWARDS, INVENTORY_SIZE, run.loot.rewards);
  sender.sendInventory(INVENTORY.FUTURE, INVENTORY_SIZE, run.loot.future);
  sender.sendInventory(INVENTORY.PREVIOUS, INVENTORY_SIZE, run.loot.previous);
}

const INT_MAX = 2147483647;

/** Before the intermission screen: the three inventories, and their values for script 4931. */
function intermission(run) {
  sendInventories(run);
  const { rewards, future, previous } = run.loot;
  return [rewards, future, previous].map((items) => Math.min(INT_MAX, valueOf(items)));
}

function modifierGlory(run) {
  let total = 0;
  for (const [key, tier] of run.modifiers.tiers) total += (byKey(key)?.glory ?? 0) * tier;
  return total;
}

/** A wave's Glory: completion, no damage from enemies, the modifiers, and time. */
function gloryFor(run, wave) {
  const time = Math.max(0, (GLORY.timeStart - run.waveTicks) * wave);
  return GLORY.completion * wave
    + (run.hitByEnemy ? 0 : GLORY.noDamage * wave)
    + modifierGlory(run)
    + time - (time % 2);
}

/** A wave cleared: its loot joins the chest, the next wave's is rolled, and Glory is earned. */
function waveCompleted(run) {
  const wave = run.wave;
  const earned = run.loot.future;
  merge(run.loot.rewards, earned);
  Loot.received(run.player, earned);
  for (const { id, amount } of earned) {
    Shared.api().emitCustomEvent("collection-log:obtain", { player: run.player, itemId: id, amount });
  }
  run.loot.previous = earned;
  run.loot.future = wave < Shared.FINAL_WAVE ? Loot.roll(wave + 1, run.player, run.random) : [];
  if (wave >= Shared.FINAL_WAVE && Loot.rollsPet(run.random)) {
    Shared.api().emitCustomEvent("npc-drops:roll", { player: run.player, drops: [{ itemId: Loot.SMOL_HEREDIT, amount: 1 }] });
  }
  run.glory += gloryFor(run, wave);
  run.player.getPacketSender().sendConfig(VARP_CURRENT_GLORY, run.glory);
  // "colosseum:glory" { player, glory }: the run's Glory so far, for a league's "Obtain 40,000/58,000 Glory".
  Shared.api().emitCustomEvent("colosseum:glory", { player: run.player, glory: run.glory });
}

/** Only the best run's Glory counts. */
function keepGlory(run) {
  const player = run.player;
  if (run.glory > Shared.gloryOf(player)) {
    player.setAttribute(Shared.ATTR.GLORY, run.glory);
    Shared.syncGlory(player);
  }
  Scoreboard.gloryKept(run);
}

/** Died, teleported or logged out: the loot is gone. */
function lost(run) {
  run.loot = { rewards: [], future: [], previous: [] };
  sendInventories(run);
  run.player.getPacketSender().sendString("Total Value: 0", VALUE_UID);
}

/** The run is over with loot to claim: the chest comes out, with Minimus beside it. */
function bringOutChest(run) {
  const { Animation, GameObject, ObjectManager } = Shared.core();
  const chest = new GameObject(CHEST.id, Shared.loc(CHEST), 10, CHEST.rotation, run.area);
  ObjectManager.register(chest, true);
  run.player.getPacketSender().sendObjectAnimation?.(chest, new Animation(CHEST.appear));
  run.chest = chest;
  run.spawnMinimus(MINIMUS_BY_CHEST);
}

function removeChest(run) {
  if (!run.chest) return;
  Shared.core().ObjectManager.deregister(run.chest, true);
  run.chest = null;
  run.player.getPacketSender().sendVarbit(VARBIT_LOOT_OPENED, 0);
}

// ---------------------------------------------------------------- the chest

function rewardsOf(player) {
  const run = runOf(player);
  return run?.chest ? run.loot.rewards : null;
}

function sendChestValue(player, rewards) {
  const sender = player.getPacketSender();
  const { ItemDefinition } = Shared.core();
  const total = rewards.reduce((sum, { id, amount }) => sum + BigInt(ItemDefinition.forId(id)?.getValue?.() ?? 0) * BigInt(amount), 0n);
  const value = total > 9223372036854775807n ? 9223372036854775807n : total;
  sender.sendString(`Total Value: ${value.toLocaleString("en-US")}`, VALUE_UID);
  sender.sendInterfaceScript(SCRIPT_CHEST_VALUE, [value]);
}

function refreshChest(player, rewards) {
  player.getPacketSender().sendInventory(INVENTORY.REWARDS, INVENTORY_SIZE, rewards);
  sendChestValue(player, rewards);
}

function openChest(event) {
  const { player } = event;
  const rewards = rewardsOf(player);
  if (!rewards) return false;
  if (rewards.length === 0) {
    player.sendMessage("The chest appears to be empty.");
    return true;
  }
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT_LOOT_OPENED, 1);
  sender.sendInventory(INVENTORY.REWARDS, INVENTORY_SIZE, rewards);
  sender.sendInterface(CHEST_INTERFACE);
  sender.sendClientScript(SCRIPT_CHEST_INIT, 1, 16);
  sendChestValue(player, rewards);
  sender.sendInterfaceFlagsRange((CHEST_INTERFACE << 16) | COMPONENT.MODIFIERS, 0, 26, OP1);
  sender.sendInterfaceFlagsRange(ITEMS_UID, 0, 30, OP1 | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5));
  sender.sendClientScript(SCRIPT_ITEM_OPS, LEGACY_ITEMS_UID, INVENTORY.REWARDS, 4, 4, 0, -1, "Take", "Take-5", "Take-All", "Take-X", "");
  return true;
}

function bankFor(player, id) {
  const { Bank } = Shared.core();
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).contains(id)) return player.getBank(tab);
  }
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).getFreeSlots() > 0) return player.getBank(tab);
  }
  return null;
}

/** Moves up to `amount` of one entry to the inventory or bank; returns how many moved. */
function take(player, entry, amount, destination) {
  const { Item } = Shared.core();
  const wanted = Math.max(0, Math.min(entry.amount, amount));
  if (wanted === 0) return 0;
  if (destination === "bank") {
    const bank = bankFor(player, entry.id);
    const banked = bank ? bank.getAddableAmount(new Item(entry.id, wanted)) : 0;
    if (banked <= 0) return 0;
    bank.add(new Item(entry.id, banked), false);
    return banked;
  }
  const inventory = player.getInventory();
  const moved = inventory.getAddableAmount(new Item(entry.id, wanted));
  if (moved <= 0) return 0;
  inventory.add(new Item(entry.id, moved), false);
  inventory.refreshItems();
  return moved;
}

const TAKE_ALL_REFUSAL = {
  bank: "Your bank cannot hold your items.",
  inventory: "You don't have enough space to take anything.",
};

/**
 * Takes or banks everything that fits, with one line if nothing does.
 * Bank-all on an empty chest: "You have nothing to deposit." Either way the value line is resent.
 */
function takeAll(player, destination) {
  if (player.getInterfaceId() !== CHEST_INTERFACE) return;
  const rewards = rewardsOf(player);
  if (!rewards) return;
  if (rewards.length === 0) {
    if (destination === "bank") player.sendMessage("You have nothing to deposit.");
  } else {
    let moved = 0;
    for (const entry of [...rewards]) {
      const taken = take(player, entry, entry.amount, destination);
      moved += taken;
      entry.amount -= taken;
      if (entry.amount <= 0) rewards.splice(rewards.indexOf(entry), 1);
    }
    // Ours: when only some of the rewards fit, the rest stay in the chest without a line.
    if (moved === 0) player.sendMessage(TAKE_ALL_REFUSAL[destination]);
  }
  refreshChest(player, rewards);
}

function clickBankAll({ player }) {
  takeAll(player, "bank");
}

function clickTakeAll({ player }) {
  takeAll(player, "inventory");
}

function clickDiscardAll({ player }) {
  if (player.getInterfaceId() !== CHEST_INTERFACE) return;
  const rewards = rewardsOf(player);
  if (!rewards?.length) return;
  player.getPacketSender().sendInterfaceRemoval();
  Shared.options(player, "Are you sure? You can't get your discarded rewards back!",
    "Yes, discard my rewards.", () => {
      if (rewardsOf(player) !== rewards) return;
      rewards.length = 0;
      player.sendMessage("The chest empties before your eyes...");
      refreshChest(player, rewards);
    },
    "No, keep my rewards.", () => openChest({ player }));
}

function clickItem(event) {
  const { player } = event;
  if (player.getInterfaceId() !== CHEST_INTERFACE) return;
  const rewards = rewardsOf(player);
  const entry = rewards?.[Number.isInteger(event.slot) ? event.slot : -1];
  if (!entry || (event.itemId != null && event.itemId !== entry.id)) return;
  const op = event.opId ?? event.action;
  const withdraw = (amount) => {
    if (player.getInterfaceId() !== CHEST_INTERFACE || rewardsOf(player) !== rewards || !rewards.includes(entry) || !Number.isSafeInteger(amount) || amount <= 0) return;
    const moved = take(player, entry, amount, "inventory");
    if (moved === 0) player.sendMessage("You don't have enough inventory space to take any.");
    entry.amount -= moved;
    if (entry.amount <= 0) rewards.splice(rewards.indexOf(entry), 1);
    refreshChest(player, rewards);
  };
  if (op === 1) withdraw(1);
  else if (op === 2) withdraw(5);
  else if (op === 3) withdraw(entry.amount);
  else if (op === 4) {
    const action = { acceptsZero: false, execute(amount) {
      if (player.getEnteredAmountAction() !== action) return;
      player.setEnteredAmountAction(null);
      withdraw(amount);
    } };
    player.setEnteredAmountAction(action);
    player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
  }
}

module.exports = function registerColosseumRewards(api) {
  Shared.bind(api);
  api.persistAttribute(Loot.ATTR_FANATIC);
  api.onObjectInteraction("Rewards Chest", { Search: openChest });
  api.onInterfaceActionButton((CHEST_INTERFACE << 16) | COMPONENT.BANK_ALL, clickBankAll);
  api.onInterfaceActionButton((CHEST_INTERFACE << 16) | COMPONENT.TAKE_ALL, clickTakeAll);
  api.onInterfaceActionButton((CHEST_INTERFACE << 16) | COMPONENT.DISCARD_ALL, clickDiscardAll);
  api.onInterfaceActionButton(ITEMS_UID, clickItem);
};

Object.assign(module.exports, {
  INVENTORY, CHEST, MINIMUS_BY_CHEST, VARP_CURRENT_GLORY,
  start, intermission, gloryFor, waveCompleted, keepGlory, lost, bringOutChest, removeChest,
  openChest, valueOf, rewardsOf,
});
