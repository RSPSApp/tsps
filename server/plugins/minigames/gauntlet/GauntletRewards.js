"use strict";

/**
 * The reward chest in the lobby (Wiki, Reward Chest (The Gauntlet)):
 * - defeating the Crystalline Hunllef: 5-9 crystal shards and two rolls on the regular table;
 * - defeating the Corrupted Hunllef: 7-12 crystal shards, the Gauntlet cape if not owned, and
 *   three rolls on the corrupted table;
 * - otherwise, by the run's points: 50+ the incomplete table, 1-49 the junk table, 0 nothing.
 *   Leaving by the teleport platform gives nothing; escaping at the barrier is a normal loss.
 * - the tertiary items are rolled each on their own.
 *
 * Points: a demi-boss or an attuned-to-perfected upgrade 10; a strong monster or a basic-to-
 * attuned upgrade 5; a weak monster or a basic item 2; cooking a paddlefish or adding crystals
 * to one 1 (the Wiki's worked example counts crystal paddlefish at 1).
 */

const Shared = require("./GauntletShared");

const ATTR_REWARD = "gauntlet:reward";
const INCOMPLETE_POINTS = 50;
const POINTS = { weak: 2, strong: 5, demi: 10, tiers: [2, 5, 10], cook: 1, comboFish: 1 };

const ID = {
  CRYSTAL_SHARD: 23962, GAUNTLET_CAPE: 23859, CLUE_ELITE: 12073,
  WEAPON_SEED: 4207, ARMOUR_SEED: 23956, ENHANCED_SEED: 25859, YOUNGLLEF: 23757, COINS: 995,
};

// [item id, min, max, weight, noted]; weights are halves of the Wiki's x/24 (so 0.5/24 is 1).
const MAIN = {
  regular: [
    [1391, 4, 8, 2, true], [1163, 2, 4, 2, true], [1113, 1, 2, 2, true], [1127, 1, 2, 2, true],
    [1079, 1, 2, 2, true], [1093, 1, 2, 2, true], [3202, 1, 2, 2, true], [1275, 1, 2, 2, true],
    [3204, 1, 1, 2, true],
    [564, 160, 240, 2], [561, 100, 140, 2], [563, 80, 140, 2], [562, 180, 300, 2], [560, 100, 160, 2],
    [565, 80, 140, 2], [888, 800, 1200, 2], [890, 400, 600, 2], [892, 200, 300, 2], [11212, 30, 85, 2],
    [1623, 20, 60, 2, true], [1621, 10, 50, 2, true], [1619, 5, 30, 2, true], [1617, 3, 7, 2, true],
    [ID.COINS, 20000, 80000, 2],
  ],
  corrupted: [
    [1391, 8, 12, 2, true], [1163, 3, 5, 2, true], [1113, 2, 3, 2, true], [1127, 2, 2, 2, true],
    [1079, 2, 3, 2, true], [1093, 2, 3, 2, true], [3202, 2, 3, 2, true], [1275, 2, 3, 2, true],
    [3204, 1, 2, 1, true],
    [564, 175, 250, 2], [561, 125, 150, 2], [563, 100, 150, 2], [562, 200, 350, 2], [560, 125, 175, 2],
    [565, 100, 150, 2], [888, 1000, 1500, 2], [890, 500, 750, 2], [892, 250, 450, 2], [11212, 50, 100, 2],
    [1623, 25, 65, 2, true], [1621, 15, 60, 2, true], [1619, 10, 40, 2, true], [1617, 5, 15, 2, true],
    [ID.COINS, 75000, 150000, 3],
  ],
};
const ROLLS = { regular: 2, corrupted: 3 };
const SHARDS = { regular: [5, 9], corrupted: [7, 12] };
// [item id, 1 in n]
const TERTIARY = {
  regular: [[ID.CLUE_ELITE, 25], [ID.WEAPON_SEED, 120], [ID.ARMOUR_SEED, 120], [ID.ENHANCED_SEED, 2000], [ID.YOUNGLLEF, 2000]],
  corrupted: [[ID.CLUE_ELITE, 20], [ID.WEAPON_SEED, 50], [ID.ARMOUR_SEED, 50], [ID.ENHANCED_SEED, 400], [ID.YOUNGLLEF, 800]],
};
// Each 1/27.
const INCOMPLETE = [
  [1211, 1, 1], [1161, 1, 1], [1430, 2, 3, true], [1271, 1, 1], [1123, 1, 1], [1073, 1, 1], [1091, 1, 1],
  [1331, 1, 1], [851, 7, 13, true], [853, 8, 11, true], [1159, 1, 1], [1428, 2, 5, true], [1121, 1, 1],
  [1071, 1, 1], [1085, 1, 1],
  [556, 200, 300], [559, 250, 350], [557, 200, 300], [554, 200, 300], [558, 300, 400], [555, 200, 300],
  [1891, 10, 20, true], [339, 75, 125, true], [333, 50, 100, true], [221, 300, 500, true],
  [2355, 15, 30, true], [1623, 1, 3, true],
];
// Iwan's flyer, Potion (Apothecary), Rotten tomato: each 1/3.
const JUNK = [[23670, 1, 1], [195, 1, 1], [2518, 1, 1]];

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function entry([id, min, max, , noted], random) {
  return { id, amount: randomInt(random, min, max), noted: !!noted };
}

function rollWeighted(table, random) {
  const total = table.reduce((sum, row) => sum + row[3], 0);
  let roll = Math.floor(random() * total);
  for (const row of table) {
    if (roll < row[3]) return entry(row, random);
    roll -= row[3];
  }
  return entry(table[table.length - 1], random);
}

/** What a run earned: "completed", "incomplete", "junk" or null. */
function rewardFor(run, reason) {
  if (reason === "completed") return "completed";
  if (reason === "exit") return null;
  const points = run.points ?? 0;
  if (points >= INCOMPLETE_POINTS) return "incomplete";
  return points > 0 ? "junk" : null;
}

/** The items a waiting reward gives, as { id, amount, noted }. */
function rollReward(reward, ownsCape, random = Math.random) {
  const items = [];
  if (reward.kind === "completed") {
    items.push({ id: ID.CRYSTAL_SHARD, amount: randomInt(random, ...SHARDS[reward.mode]) });
    if (reward.mode === "corrupted" && !ownsCape) items.push({ id: ID.GAUNTLET_CAPE, amount: 1 });
    for (let i = 0; i < ROLLS[reward.mode]; i++) items.push(rollWeighted(MAIN[reward.mode], random));
    for (const [id, chance] of TERTIARY[reward.mode]) {
      if (Math.floor(random() * chance) === 0) items.push({ id, amount: 1 });
    }
  } else if (reward.kind === "incomplete") {
    items.push(entry(INCOMPLETE[Math.floor(random() * INCOMPLETE.length)], random));
  } else if (reward.kind === "junk") {
    items.push(entry(JUNK[Math.floor(random() * JUNK.length)], random));
  }
  return items;
}

function waitingReward(player) {
  const reward = player.getAttribute(ATTR_REWARD);
  return reward && reward.kind && reward.mode ? reward : null;
}

/** The chest shows open (with loot) while a reward waits (varbit 9179). */
function sendChest(player) {
  player.getPacketSender().sendVarbit(Shared.VARBIT.REWARD, waitingReward(player) ? 1 : 0);
}

function setReward(player, mode, kind) {
  player.setAttribute(ATTR_REWARD, kind ? { mode, kind } : null);
  sendChest(player);
}

function ownsItem(player, id) {
  return player.getInventory().contains(id) || player.getEquipment().contains(id)
    || (player.getBanks?.() ?? []).some((bank) => bank?.contains?.(id));
}

/** Opens the chest: one free slot is needed; whatever doesn't fit goes on the ground. */
function openChest(player, random = Math.random) {
  const reward = waitingReward(player);
  if (!reward) {
    player.sendMessage("There is nothing waiting for you in this chest.");
    return;
  }
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0) {
    player.sendMessage("You need a free inventory space for whatever you may find in the chest.");
    return;
  }
  const { Item, ItemDefinition } = Shared.core();
  const items = rollReward(reward, ownsItem(player, ID.GAUNTLET_CAPE), random);
  setReward(player, null, null);
  player.sendMessage("You open the chest.");
  for (const reward of items) {
    const noteId = reward.noted ? ItemDefinition.forId(reward.id)?.getNoteId?.() ?? -1 : -1;
    const id = noteId >= 0 ? noteId : reward.id;
    const stackable = ItemDefinition.forId(id)?.isStackable?.() ?? false;
    const fits = stackable ? inventory.contains(id) || inventory.getFreeSlots() > 0 : inventory.getFreeSlots() >= reward.amount;
    if (fits) {
      inventory.adds(id, reward.amount);
    } else {
      Shared.api().getItemOnGroundManager().registerLocation(player, new Item(id, reward.amount), player.getLocation().clone());
    }
  }
  inventory.refreshItems();
  if (items.length > 0) player.sendMessage("You find some treasure in the chest!");
}

module.exports = {
  ATTR_REWARD, POINTS, INCOMPLETE_POINTS, ID, MAIN, TERTIARY, INCOMPLETE, JUNK, SHARDS, ROLLS,
  rewardFor, rollReward, waitingReward, setReward, sendChest, openChest,
};
