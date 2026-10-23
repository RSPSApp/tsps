"use strict";

/**
 * Verzik Vitur's vault: the monumental chests, their loot interface, the teleport crystal out,
 * and the Rewards Chest outside the bank in Ver Sinhaza for loot left behind.
 *
 * Wiki (Monumental chest):
 * - One chest per player, an arrow over the player's own; a unique makes it glow purple.
 * - Without deaths a unique comes 1 time in 9.1 for the whole team, whatever its size; dying
 *   lowers the chance. It goes to one player, weighted by deaths and damage dealt to the bosses.
 *   Weights: hilt 8/19, rapier, sanguinesti staff and the three Justiciar pieces 2/19 each,
 *   scythe 1/19. A unique replaces the common loot.
 * - Otherwise three rolls of the common table (vials of blood 2/30, the rest 1/30 each), with
 *   non-stackables noted; deaths lower the amounts for everyone. A player with no contribution
 *   gets a cabbage and a message.
 * - Tertiaries, scaled by the player's own performance: an elite clue (3/25), Lil' Zik (1/650).
 * - Unclaimed loot can be claimed from the chest outside the bank in Ver Sinhaza.
 * Cache: the chests (33086-33090), each a multiloc on its varbit (6450-6454): 0 someone else's,
 * 1 someone else's with a unique, 2 the player's, 3 the player's with a unique; opened 32994
 * (41746 with a unique). Interface 23: Bank-all (6), Take-all (8), Discard-all (10), the items
 * (12). The Rewards Chest (41437) shows on varbit 11958.
 * Captured: the loot interface (23), "Your completed Theatre of Blood count is: N.".
 * Estimates: the chests' tiles and order (party slot), their facing, the player's opening
 * animation (536), inventory 612 for the loot.
 * Estimates (the Wiki gives no formula): each death costs a fifth of a player's share - of the
 * unique chance (averaged over the team), of the unique weighting (with damage dealt), of the
 * common amounts (averaged) and of their tertiary odds; Rewards Chest varbit values (0 empty,
 * 1 loot waiting); loot left behind is kept on the player rather than lost on logout.
 */

const Shared = require("./Shared.TheatreOfBlood");
const Raid = require("./RaidState.TheatreOfBlood");

const ATTR_LOOT = "tob:loot";
const ATTR_COMPLETIONS = "tob:completions";
const INTERFACE = 23;
const LOOT_INVENTORY = 612;
const LOOT_SLOTS = 6;
const COMPONENT = { BANK_ALL: 6, TAKE_ALL: 8, DISCARD_ALL: 10, ITEMS: 12 };
const ITEMS_UID = (INTERFACE << 16) | COMPONENT.ITEMS;
const SCRIPT_ITEM_OPS = 149;
const OPS = (1 << 1) | (1 << 10);
const OPEN_ANIMATION = 536;

const CHEST_BASE = { x: 3200, y: 4288 };
const CHESTS = [[33, 42], [40, 39], [26, 39], [26, 35], [40, 35]].map(([x, y], slot) => ({
  id: 33086 + slot, varbit: 6450 + slot, x: CHEST_BASE.x + x, y: CHEST_BASE.y + y, z: 0, face: x === 40 ? 1 : x === 26 ? 3 : 0,
}));
const CHEST_STATE = { OTHERS: 0, OTHERS_UNIQUE: 1, MINE: 2, MINE_UNIQUE: 3 };
const OPENED = { REGULAR: 32994, UNIQUE: 41746 };
const CLAIM_CHEST = { id: 41437, varbit: 11958 };

const UNIQUE_CHANCE = 1 / 9.1;
const DEATH_PENALTY = 0.2;
const COMMON_ROLLS = 3;
const TERTIARY = { clue: 3 / 25, pet: 1 / 650 };

function uniqueTable(I) {
  return [
    [I.AVERNIC_DEFENDER_HILT, 8], [I.GHRAZI_RAPIER, 2], [I.SANGUINESTI_STAFF_UNCHARGED_, 2],
    [I.JUSTICIAR_FACEGUARD, 2], [I.JUSTICIAR_CHESTGUARD, 2], [I.JUSTICIAR_LEGGUARDS, 2],
    [I.SCYTHE_OF_VITUR_UNCHARGED_, 1],
  ];
}

/** [item, weight out of 30, min, max] */
function commonTable(I) {
  return [
    [I.VIAL_OF_BLOOD_2, 2, 45, 60], [I.DEATH_RUNE, 1, 500, 600], [I.BLOOD_RUNE, 1, 500, 600],
    [I.SWAMP_TAR, 1, 500, 600], [I.COAL, 1, 500, 600], [I.GOLD_ORE, 1, 300, 360],
    [I.MOLTEN_GLASS, 1, 200, 240], [I.ADAMANTITE_ORE, 1, 130, 156], [I.RUNITE_ORE, 1, 60, 72],
    [I.WINE_OF_ZAMORAK, 1, 50, 60], [I.POTATO_CACTUS, 1, 50, 60], [I.GRIMY_CADANTINE, 1, 50, 60],
    [I.GRIMY_AVANTOE, 1, 40, 48], [I.GRIMY_TOADFLAX, 1, 37, 44], [I.GRIMY_KWUARM, 1, 36, 43],
    [I.GRIMY_IRIT_LEAF, 1, 34, 40], [I.GRIMY_RANARR_WEED, 1, 30, 36], [I.GRIMY_SNAPDRAGON, 1, 27, 32],
    [I.GRIMY_LANTADYME, 1, 26, 31], [I.GRIMY_DWARF_WEED, 1, 24, 28], [I.GRIMY_TORSTOL, 1, 20, 24],
    [I.BATTLESTAFF, 1, 15, 18], [I.RUNE_BATTLEAXE, 1, 4, 4], [I.RUNE_PLATEBODY, 1, 4, 4],
    [I.RUNE_CHAINBODY, 1, 4, 4], [I.PALM_TREE_SEED, 1, 3, 3], [I.YEW_SEED, 1, 3, 3],
    [I.MAGIC_SEED, 1, 3, 3], [I.MAHOGANY_SEED, 1, 10, 12],
  ];
}

// ------------------------------------------------------------------ rolling

/** A player's standing: a fifth off per death, never below nothing. */
function standing(member) {
  return Math.max(0, 1 - DEATH_PENALTY * (member?.deaths ?? 0));
}

function damageDealt(member) {
  let total = 0;
  for (const stats of Object.values(member?.rooms ?? {})) total += stats.damage ?? 0;
  return total;
}

function weightedPick(entries, weightOf, random = Math.random) {
  const total = entries.reduce((sum, entry) => sum + weightOf(entry), 0);
  if (total <= 0) return null;
  let roll = random() * total;
  for (const entry of entries) {
    roll -= weightOf(entry);
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

/** The noted form of a non-stackable item, as the chest hands them out. */
function noted(id) {
  const definition = Shared.core().ItemDefinition.forId(id);
  if (!definition || definition.isStackable?.()) return id;
  const note = definition.getNoteId?.() ?? -1;
  return note > 0 ? note : id;
}

function addLoot(loot, id, amount) {
  const existing = loot.find((entry) => entry.id === id);
  if (existing) existing.amount += amount;
  else loot.push({ id, amount });
}

/** Rolls everyone's loot once, as the party reaches the vault. */
function rollRaid(raid, random = Math.random) {
  const I = Shared.core().ItemIdentifiers;
  const players = [...raid.players];
  const members = players.map((player) => raid.member(player));
  const teamStanding = members.reduce((sum, member) => sum + standing(member), 0) / Math.max(1, members.length);
  const result = new Map();
  let uniqueWinner = null;
  let uniqueId = -1;
  if (random() < UNIQUE_CHANCE * teamStanding) {
    const pick = weightedPick(players, (player) => {
      const member = raid.member(player);
      return standing(member) * Math.max(1, damageDealt(member));
    }, random);
    if (pick) {
      uniqueWinner = pick;
      uniqueId = weightedPick(uniqueTable(I), ([, weight]) => weight, random)[0];
    }
  }
  const commons = commonTable(I);
  for (const player of players) {
    const member = raid.member(player);
    const loot = [];
    if (player === uniqueWinner) {
      loot.push({ id: uniqueId, amount: 1 });
    } else if (damageDealt(member) <= 0) {
      loot.push({ id: I.CABBAGE, amount: 1 }, { id: I.MESSAGE_4, amount: 1 });
    } else {
      for (let roll = 0; roll < COMMON_ROLLS; roll++) {
        const [id, , min, max] = weightedPick(commons, ([, weight]) => weight, random);
        const amount = Math.max(1, Math.floor((min + Math.floor(random() * (max - min + 1))) * teamStanding));
        addLoot(loot, noted(id), amount);
      }
    }
    const own = standing(member);
    if (random() < TERTIARY.clue * own) addLoot(loot, I.CLUE_SCROLL_ELITE_, 1);
    if (random() < TERTIARY.pet * own) addLoot(loot, I.LIL_ZIK, 1);
    result.set(player, loot);
  }
  return { loot: result, uniqueWinner, uniqueId };
}

function lootOf(player) {
  const loot = player.getAttribute(ATTR_LOOT);
  return Array.isArray(loot) ? loot : [];
}

function setLoot(player, loot) {
  player.setAttribute(ATTR_LOOT, loot.length > 0 ? loot : null);
  player.getPacketSender().sendVarbit(CLAIM_CHEST.varbit, loot.length > 0 ? 1 : 0);
}

// ------------------------------------------------------------------ the vault

class RewardsRoom extends Raid.Room {
  onBuild() {
    const raid = this.raid;
    this.slots = new Map(raid.players.map((player, slot) => [player, slot]));
    this.opened = new Set();
    this.chests = [];
    const { loot, uniqueWinner, uniqueId } = rollRaid(raid);
    for (const [player, items] of loot) setLoot(player, items);
    this.uniqueSlot = uniqueWinner ? this.slots.get(uniqueWinner) : -1;
    raid.players.forEach((player, slot) => {
      const chest = CHESTS[slot];
      if (chest) this.chests[slot] = this.placeObject(chest.id, chest, 10, chest.face);
    });
    if (uniqueWinner) {
      const name = Shared.core().ItemDefinition.forId(uniqueId)?.getName?.() ?? "a unique";
      for (const player of raid.players) player.sendMessage(`<col=ef1020>${Shared.displayName(uniqueWinner)} found something special: ${name}</col>`);
    }
  }

  onArrive(player) {
    this.start();
    this.sendChests(player);
  }

  sendChests(player) {
    const mine = this.slots.get(player);
    const sender = player.getPacketSender();
    CHESTS.forEach((chest, slot) => {
      const unique = slot === this.uniqueSlot;
      const state = slot === mine ? (unique ? CHEST_STATE.MINE_UNIQUE : CHEST_STATE.MINE) : (unique ? CHEST_STATE.OTHERS_UNIQUE : CHEST_STATE.OTHERS);
      sender.sendVarbit(chest.varbit, state);
    });
  }

  /** Open: the player's own chest swings open; Search on an opened one shows the loot. */
  openChest(player, location) {
    const slot = this.slots.get(player);
    const index = CHESTS.findIndex((chest) => chest.x === location.x && chest.y === location.y);
    if (index === -1 || !this.chests[index]) return false;
    if (index !== slot) {
      player.sendMessage("This isn't your chest!");
      return true;
    }
    if (this.opened.has(slot)) {
      openLoot(player);
      return true;
    }
    this.opened.add(slot);
    const { Animation, ObjectManager } = Shared.core();
    player.performAnimation(new Animation(OPEN_ANIMATION));
    const chest = CHESTS[slot];
    this.later(1, () => {
      ObjectManager.deregister(this.chests[slot], true);
      this.chests[slot] = this.placeObject(slot === this.uniqueSlot ? OPENED.UNIQUE : OPENED.REGULAR, chest, 10, chest.face);
      openLoot(player);
    });
    return true;
  }
}

// ------------------------------------------------------------------ the loot interface

function openLoot(player) {
  const loot = lootOf(player);
  if (loot.length === 0) {
    player.sendMessage("Your reward chest is empty.");
    return;
  }
  const sender = player.getPacketSender();
  sendLoot(player, loot);
  sender.sendInterface(INTERFACE);
  sender.sendClientScript(SCRIPT_ITEM_OPS, ITEMS_UID, LOOT_INVENTORY, 2, 3, 0, -1, "Take", "", "", "", "");
  sender.sendInterfaceFlagsRange(ITEMS_UID, 0, LOOT_SLOTS - 1, OPS);
}

function sendLoot(player, loot) {
  player.getPacketSender().sendInventory(LOOT_INVENTORY, LOOT_SLOTS, loot.map(({ id, amount }) => ({ id, amount })));
}

function bankFor(player, id) {
  const { Bank } = Shared.core();
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).contains(id)) return player.getBank(tab);
  }
  const preferred = player.getBank(Bank.getTabForItem(player, id));
  if (preferred.getFreeSlots() > 0) return preferred;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).getFreeSlots() > 0) return player.getBank(tab);
  }
  return null;
}

/** Moves one loot entry into the inventory or bank; returns how many moved. */
function take(player, entry, destination) {
  const { Item, ItemDefinition } = Shared.core();
  if (destination === "bank") {
    const bank = bankFor(player, entry.id);
    if (!bank) {
      player.sendMessage("You need more space in your bank.");
      return 0;
    }
    bank.add(new Item(entry.id, entry.amount), false);
    return entry.amount;
  }
  const inventory = player.getInventory();
  const stackable = ItemDefinition.forId(entry.id)?.isStackable?.() === true || ItemDefinition.forId(entry.id)?.isNoted?.() === true;
  const moved = stackable ? (inventory.contains(entry.id) || inventory.getFreeSlots() > 0 ? entry.amount : 0)
    : Math.min(entry.amount, inventory.getFreeSlots());
  if (moved <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return 0;
  }
  inventory.add(new Item(entry.id, moved), false);
  inventory.refreshItems();
  return moved;
}

function takeAll(player, destination) {
  const left = [];
  for (const entry of lootOf(player)) {
    entry.amount -= take(player, entry, destination);
    if (entry.amount > 0) left.push(entry);
  }
  setLoot(player, left);
  sendLoot(player, left);
}

function clickBankAll({ player }) {
  if (lootOf(player).length === 0) return;
  takeAll(player, "bank");
}

function clickTakeAll({ player }) {
  if (lootOf(player).length === 0) {
    player.sendMessage("Your reward chest is empty.");
    return;
  }
  takeAll(player, "inventory");
}

function clickDiscardAll({ player }) {
  if (lootOf(player).length === 0) return;
  Shared.options(player, "Are you sure you want to destroy the items?",
    "<col=ff0000>DESTROY!", () => {
      setLoot(player, []);
      sendLoot(player, []);
    },
    "Cancel", () => openLoot(player));
}

function clickLootItem(event) {
  const { player } = event;
  const loot = lootOf(player);
  const entry = loot[Number.isInteger(event.slot) ? event.slot : -1];
  if (!entry) return;
  const op = event.opId ?? event.action;
  if (op === 10) {
    player.sendMessage(Shared.core().ItemDefinition.forId(entry.id)?.getExamine?.() ?? "");
    return;
  }
  entry.amount -= take(player, entry, "inventory");
  const left = loot.filter((other) => other.amount > 0);
  setLoot(player, left);
  sendLoot(player, left);
}

// ------------------------------------------------------------------ objects

function useChest(event) {
  const { player } = event;
  const raid = Raid.raidOf(player);
  const room = raid?.room;
  if (!(room instanceof RewardsRoom) || raid.member(player).roomKey !== room.key) return false;
  return room.openChest(player, event.location ?? Shared.tileOf(event.object));
}

/** The teleport crystal takes the player out of the theatre. */
function useCrystal(event) {
  const { player } = event;
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  if (lootOf(player).length > 0) player.sendMessage("Your unclaimed rewards can be collected from the Rewards Chest by the bank in Ver Sinhaza.");
  raid.leave(player, "");
  return true;
}

function claimChest({ player }) {
  if (lootOf(player).length === 0) {
    player.sendMessage("You have nothing to collect.");
    return true;
  }
  openLoot(player);
  return true;
}

function showClaimChest({ player }) {
  player.getPacketSender().sendVarbit(CLAIM_CHEST.varbit, lootOf(player).length > 0 ? 1 : 0);
}

/** Verzik beaten: the completion count goes up for everyone still in the raid. */
function countCompletion(player) {
  const completions = (Number(player.getAttribute(ATTR_COMPLETIONS)) || 0) + 1;
  player.setAttribute(ATTR_COMPLETIONS, completions);
  player.sendMessage(`Your completed Theatre of Blood count is: <col=ff0000>${completions}</col>.`);
  // The raid is over for normal mode too, so the quests waiting on a clear hear it.
  Shared.api()?.emitCustomEvent("tob:completed", { player, mode: "normal" });
}

/** A normal-mode clear counts as a Theatre of Blood completion. */
function hasCompletion(request) {
  if ((Number(request.player.getAttribute(ATTR_COMPLETIONS)) || 0) > 0) request.complete = true;
}

module.exports = function registerTheatreRewards(api) {
  Shared.bind(api);
  Raid.registerRoom("REWARDS", RewardsRoom);
  api.persistAttribute(ATTR_LOOT);
  api.persistAttribute(ATTR_COMPLETIONS);
  Shared.onObject(api, ["Monumental chest", ...CHESTS.map((chest) => chest.id)], useChest);
  Shared.onObject(api, Shared.OBJECT.TELEPORT_CRYSTAL, useCrystal);
  Shared.onObject(api, CLAIM_CHEST.id, claimChest);
  api.onPlayerLogin(showClaimChest);
  api.onInterfaceActionButton((INTERFACE << 16) | COMPONENT.BANK_ALL, clickBankAll);
  api.onInterfaceActionButton((INTERFACE << 16) | COMPONENT.TAKE_ALL, clickTakeAll);
  api.onInterfaceActionButton((INTERFACE << 16) | COMPONENT.DISCARD_ALL, clickDiscardAll);
  api.onInterfaceActionButton(ITEMS_UID, clickLootItem);
  api.onCustomEvent("tob:has-completion", hasCompletion);
};

Object.assign(module.exports, { RewardsRoom, rollRaid, standing, lootOf, setLoot, countCompletion, CHESTS, ATTR_LOOT, ATTR_COMPLETIONS });
