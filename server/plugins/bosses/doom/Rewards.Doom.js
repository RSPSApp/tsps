"use strict";

/**
 * The rewards: the burrow hole's screen, claiming, and the lobby's chest of unclaimed loot.
 *
 * Cache: interface 919 ("Level N Complete!", Earned Loot, Claim & Leave, Delve Deeper) is
 * drawn by script 7927(level, claiming, chest). Its item grid redraws from inventory 935 while
 * the hole is shown and from 923 once claiming or at the chest. Claim & Leave is component 14,
 * Descend 23, Leave 16, Take-all 17, Bank-all 26, the loot 19; component 20 is the value line.
 * Capture (delves 1-4): Investigate sends inventories 935 (the loot) and 923 (empty), opens 919
 * as the main modal, runs 7927 with the level 0-based and 0, 0, sets OP1 on the five buttons and
 * ops 1-5 and 10 on the loot's 28 slots, and writes "Value: 1,728 GP". Descend closes it and says
 * "You jump further into the burrow...".
 * Wiki: Investigate shows the rewards so far, to claim and leave or to risk by descending,
 * with a warning when a unique is waiting; leaving without claiming leaves the loot in the
 * chest across from the scoreboard (50938); dying after descending loses it.
 * Guesses: how script 7927's second and third arguments map to the hole, claiming and the
 * chest; the chest's messages; Leave ending the run.
 */

const Shared = require("./DoomShared");
const Run = require("./DoomRun");
const Loot = require("./DoomLoot");
const { onObject } = require("./Lobby.Doom");

const INTERFACE = 919;
const SCRIPT_OPEN = 7927;
const INVENTORY = { HOLE: 935, CLAIM: 923 };
const SIZE = 28;
const COMPONENT = { CLAIM: 14, LEAVE: 16, TAKE_ALL: 17, VALUE: 20, DESCEND: 23, BANK_ALL: 26 };
const uid = (component) => (INTERFACE << 16) | component;
const OP1 = 1 << 1;
/** Capture: ops 1-5 and 10 on the loot. */
const LOOT_OPS = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 10);
const LOOT = 19;
const BUTTONS = [COMPONENT.CLAIM, COMPONENT.DESCEND, COMPONENT.LEAVE, COMPONENT.TAKE_ALL, COMPONENT.BANK_ALL];

function unclaimed(player) {
  const pile = player.getAttribute(Run.ATTR.UNCLAIMED);
  return Array.isArray(pile) ? pile : [];
}

function setUnclaimed(player, pile) {
  player.setAttribute(Run.ATTR.UNCLAIMED, pile.length > 0 ? pile : null);
}

function valueText(items) {
  return `Value: ${Loot.valueOf(items, Shared.core().ItemDefinition).toLocaleString("en-US")} GP`;
}

function open(player, { level, inventory, items, claiming, chest }) {
  const sender = player.getPacketSender();
  sender.sendInventory(INVENTORY.HOLE, SIZE, inventory === INVENTORY.HOLE ? items : []);
  sender.sendInventory(INVENTORY.CLAIM, SIZE, inventory === INVENTORY.CLAIM ? items : []);
  sender.sendInterface(INTERFACE);
  sender.sendClientScript(SCRIPT_OPEN, Math.max(0, level - 1), claiming ? 1 : 0, chest ? 1 : 0);
  for (const component of BUTTONS) sender.sendInterfaceFlagsRange(uid(component), 0, 1, OP1);
  sender.sendInterfaceFlagsRange(uid(LOOT), 0, SIZE - 1, LOOT_OPS);
  sender.sendString(valueText(items), uid(COMPONENT.VALUE));
}

/** The burrow hole's Investigate. */
function openHole(run) {
  open(run.player, {
    level: run.level, inventory: INVENTORY.HOLE, items: run.loot, claiming: false, chest: false,
  });
}

/** Claiming (in the arena) or the lobby's chest: take or bank what is left, then leave. */
function openClaim(player, { level = 1, chest = false } = {}) {
  open(player, {
    level, inventory: INVENTORY.CLAIM, items: unclaimed(player), claiming: !chest, chest,
  });
}

function refreshClaim(player) {
  const items = unclaimed(player);
  player.getPacketSender().sendInventory(INVENTORY.CLAIM, SIZE, items).sendString(valueText(items), uid(COMPONENT.VALUE));
}

// ---------------------------------------------------------------- taking items

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

/** Moves one entry to the inventory or bank; returns how many moved. */
function take(player, entry, destination) {
  const { Item, ItemDefinition } = Shared.core();
  if (destination === "bank") {
    const bank = bankFor(player, entry.id);
    if (!bank) return 0;
    bank.add(new Item(entry.id, entry.amount), false);
    return entry.amount;
  }
  const inventory = player.getInventory();
  const stackable = ItemDefinition.forId(entry.id)?.isStackable?.() === true;
  const moved = stackable ? (inventory.contains(entry.id) || inventory.getFreeSlots() > 0 ? entry.amount : 0)
    : Math.min(entry.amount, inventory.getFreeSlots());
  if (moved <= 0) return 0;
  inventory.add(new Item(entry.id, moved), false);
  return moved;
}

function takeAll(player, destination) {
  const pile = unclaimed(player).map((entry) => ({ ...entry }));
  let short = false;
  for (const entry of pile) {
    const moved = take(player, entry, destination);
    entry.amount -= moved;
    if (entry.amount > 0) short = true;
  }
  setUnclaimed(player, pile.filter((entry) => entry.amount > 0));
  player.getInventory().refreshItems?.();
  if (short) player.sendMessage(destination === "bank" ? "You need more space in your bank." : "You don't have enough inventory space.");
  refreshClaim(player);
}

// ---------------------------------------------------------------- buttons

function clickClaim({ player }) {
  const run = Run.runOf(player);
  if (run?.stage !== "hole") return;
  run.claim();
  openClaim(player, { level: run.level });
}

function clickDescend({ player }) {
  const run = Run.runOf(player);
  if (run?.stage !== "hole") return;
  player.getPacketSender().sendInterfaceRemoval();
  run.askToDescend();
}

function clickLeave({ player }) {
  const run = Run.runOf(player);
  player.getPacketSender().sendInterfaceRemoval();
  if (run?.stage === "claimed") run.end("claimed");
}

function clickTakeAll({ player }) {
  takeAll(player, "inventory");
}

function clickBankAll({ player }) {
  takeAll(player, "bank");
}

/** The lobby, where the chest of unclaimed loot stands (the id is used elsewhere too). */
const LOBBY = { minX: 1300, maxX: 1320, minY: 9537, maxY: 9556, z: 0 };

function lookInChest({ player }) {
  if (!Shared.inBox(player.getLocation(), LOBBY)) return false;
  if (unclaimed(player).length === 0) {
    player.sendMessage("The chest is empty.");
    return true;
  }
  openClaim(player, { chest: true });
  return true;
}

module.exports = function registerDoomRewards(api) {
  Shared.bind(api);
  api.onInterfaceActionButton(uid(COMPONENT.CLAIM), clickClaim);
  api.onInterfaceActionButton(uid(COMPONENT.DESCEND), clickDescend);
  api.onInterfaceActionButton(uid(COMPONENT.LEAVE), clickLeave);
  api.onInterfaceActionButton(uid(COMPONENT.TAKE_ALL), clickTakeAll);
  api.onInterfaceActionButton(uid(COMPONENT.BANK_ALL), clickBankAll);
  onObject(api, Shared.OBJECT.REWARD_CHEST, lookInChest);
};

Object.assign(module.exports, {
  INTERFACE, INVENTORY, COMPONENT, openHole, openClaim, unclaimed, takeAll,
  clickClaim, clickDescend, clickLeave, clickTakeAll, clickBankAll, lookInChest,
});
