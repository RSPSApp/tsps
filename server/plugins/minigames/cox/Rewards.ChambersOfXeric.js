"use strict";

/**
 * The raid's end: completion counts and times, Challenge Mode's target time, the ancient chest's
 * loot, and Captain Rimor's capes.
 *
 * Wiki (Ancient chest; Chambers of Xeric/Challenge Mode; Captain Rimor):
 * - Every 8,676 team points is a 1% chance of a unique, at most 65.7% (570,000 points); points
 *   beyond roll a second unique the same way. The receiver is drawn by personal points; a
 *   raider who left keeps the chance but the item is discarded. A unique replaces the commons.
 * - Uniques (Normal / Challenge Mode weights): dexterous and arcane prayer scrolls 14 / 12,
 *   twisted buckler 4, dragon hunter crossbow 4, Dinh's bulwark 3, ancestral hat, top and
 *   bottom 4 each, dragon claws 3, elder maul 2, kodai insignia 2, twisted bow 2.
 * - Otherwise two different rolls of the common table, the amount by points (the table's
 *   maximum at 131,071 points); a third of herb drops come as seeds (7 or 8 herbs a seed). An
 *   ancient tablet (1 in 10, if not owned) replaces one roll.
 * - Always a dark journal unless banked; an elite clue 1 in 12 without a unique; the olmlet 1 in
 *   53 with one. Challenge Mode within its target time: the twisted ancestral colour kit 1 in
 *   75, metamorphic dust 1 in 400, and 5,000 more points each. Target times by team size: 1:
 *   70 min, 2: 65, 3: 50, 4: 45, 5-10: 42, 11-15: 45, 16-23: 60, 24+: 80.
 * - Unclaimed loot is placed on the ground on leaving.
 * - Capes by Challenge Mode completions: Xeric's guard 100, warrior 500, sentinel 1,000,
 *   general 1,500, champion 2,000.
 * Not on the Wiki (to check against a capture): the reward interface (539: component 5 the items, 6 Bank-all, 8 Take-all, 10
 *   Discard-all; inventory 581), the chest light varbit 5456 (1 white, 2 purple), the messages
 *   ("Congratulations - your raid is complete! Duration: ", the completion counts, "Special
 *   loot:", the target time), the raid counts on the attributes.
 * Wiki-derived: a common amount is the table's maximum x points / 131,071 (at least 1).
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");

const INTERFACE = { REWARDS: 539, ITEMS: 5, BANK_ALL: 6, TAKE_ALL: 8, DISCARD_ALL: 10 };
const INVENTORY = 581;
const VARBIT = { LIGHT: 5456 };
const LIGHT = { NONE: 0, WHITE: 1, PURPLE: 2 };
const POINTS = { PER_PERCENT: 8676, CAP: 570000, COMMON_CAP: 131071, TARGET_BONUS: 5000 };
const ITEM = { DARK_JOURNAL: 20899, OLMLET: 20851, KIT: 24670, DUST: 22386, TABLET: 21046, ELITE_CLUE: 12073 };
const ATTR_TABLET = "cox:ancient-tablet";
const ATTR_BEST = "cox:best-times";
const RAID_NAME = "Chambers of Xeric";

/** Weights: [Normal, Challenge Mode]. */
const UNIQUES = [
  { id: 21034, name: "Dexterous prayer scroll", weight: [14, 12] }, { id: 21079, name: "Arcane prayer scroll", weight: [14, 12] },
  { id: 21000, name: "Twisted buckler", weight: [4, 4] }, { id: 21012, name: "Dragon hunter crossbow", weight: [4, 4] },
  { id: 21015, name: "Dinh's bulwark", weight: [3, 3] }, { id: 21018, name: "Ancestral hat", weight: [4, 4] },
  { id: 21021, name: "Ancestral robe top", weight: [4, 4] }, { id: 21024, name: "Ancestral robe bottom", weight: [4, 4] },
  { id: 13652, name: "Dragon claws", weight: [3, 3] }, { id: 21003, name: "Elder maul", weight: [2, 2] },
  { id: 21043, name: "Kodai insignia", weight: [2, 2] }, { id: 20997, name: "Twisted bow", weight: [2, 2] },
];

/** The common table: item, its maximum (at 131,071 points), noted, and for herbs the seed. */
const COMMONS = [
  { id: 560, max: 3640 }, { id: 565, max: 4095 }, { id: 566, max: 6553 }, { id: 892, max: 9362 }, { id: 11212, max: 648 },
  { id: 207, max: 138, noted: true, seed: 5295, perSeed: 7 }, { id: 3049, max: 210, noted: true, seed: 5296, perSeed: 8 },
  { id: 209, max: 675, noted: true, seed: 5297, perSeed: 8 }, { id: 211, max: 337, noted: true, seed: 5298, perSeed: 8 },
  { id: 213, max: 289, noted: true, seed: 5299, perSeed: 8 }, { id: 3051, max: 84, noted: true, seed: 5300, perSeed: 7 },
  { id: 215, max: 330, noted: true, seed: 5301, perSeed: 8 }, { id: 2485, max: 442, noted: true, seed: 5302, perSeed: 8 },
  { id: 217, max: 546, noted: true, seed: 5303, perSeed: 8 }, { id: 219, max: 134, noted: true, seed: 5304, perSeed: 7 },
  { id: 442, max: 6553, noted: true }, { id: 453, max: 6553, noted: true }, { id: 444, max: 2978, noted: true },
  { id: 447, max: 4095, noted: true }, { id: 449, max: 789, noted: true }, { id: 451, max: 65, noted: true },
  { id: 1623, max: 697, noted: true }, { id: 1621, max: 923, noted: true }, { id: 1619, max: 541, noted: true },
  { id: 1617, max: 258, noted: true }, { id: 13391, max: 4681 }, { id: 7936, max: 65535, noted: true },
  { id: 13421, max: 4681, noted: true }, { id: 8780, max: 1365, noted: true }, { id: 8782, max: 550, noted: true },
  { id: 13573, max: 2427, noted: true }, { id: 21047, max: 1 }, { id: 21027, max: 1 },
];

/** Challenge Mode target times in minutes by team size. */
const TARGET_MINUTES = [[1, 70], [2, 65], [3, 50], [4, 45], [10, 42], [15, 45], [23, 60], [Infinity, 80]];

const CAPES = [[2000, 22396], [1500, 22394], [1000, 22392], [500, 22390], [100, 22388]];

function targetTicks(size) {
  const minutes = TARGET_MINUTES.find(([most]) => size <= most)[1];
  return Math.round((minutes * 60) / 0.6);
}

/** A unique roll: each 8,676 points 1%, up to 570,000 points a roll; the rest rolls again. */
function uniqueRolls(totalPoints, random = Math.random) {
  const rolls = [];
  let left = totalPoints;
  while (left > 0) {
    const points = Math.min(POINTS.CAP, left);
    left -= points;
    rolls.push(random() * 100 < points / POINTS.PER_PERCENT);
  }
  return rolls.filter(Boolean).length;
}

function pickWeighted(entries, weightOf, random = Math.random) {
  const total = entries.reduce((sum, entry) => sum + weightOf(entry), 0);
  let roll = random() * total;
  for (const entry of entries) {
    roll -= weightOf(entry);
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

/** Two different common drops, their amounts by personal points. */
function commonLoot(points, random = Math.random) {
  const share = Math.min(POINTS.COMMON_CAP, Math.max(0, points)) / POINTS.COMMON_CAP;
  const first = COMMONS[Math.floor(random() * COMMONS.length)];
  const rest = COMMONS.filter((entry) => entry !== first);
  const picks = [first, rest[Math.floor(random() * rest.length)]];
  return picks.map((entry) => {
    let amount = Math.max(1, Math.floor(entry.max * share));
    if (entry.seed && random() < 1 / 3) {
      amount = Math.max(1, Math.floor(amount / entry.perSeed));
      return { id: entry.seed, amount, noted: false };
    }
    return { id: entry.id, amount, noted: !!entry.noted };
  });
}

function itemName(id) {
  return Shared.core().ItemDefinition.forId(id)?.getName?.() ?? `Item ${id}`;
}

function owns(player, id) {
  if (player.getInventory().contains(id)) return true;
  try {
    const { Bank } = Shared.core();
    return Bank.contains?.(player, id) ?? player.getBank?.(Bank.getTabForItem(player, id))?.contains?.(id) ?? false;
  } catch {
    return false;
  }
}

/** The noted form of an item, if it has one. */
function notedId(id) {
  const { ItemDefinition } = Shared.core();
  const note = ItemDefinition.forId(id)?.getNoteId?.();
  return Number.isInteger(note) && note >= 0 && ItemDefinition.forId(note)?.isNoted?.() ? note : id;
}

function rewardsOf(raid) {
  raid.rewards ??= new Map();
  return raid.rewards;
}

function give(raid, username, id, amount = 1) {
  const list = rewardsOf(raid).get(username) ?? [];
  list.push({ id, amount });
  rewardsOf(raid).set(username, list);
}

// ---------------------------------------------------------------- completion

function completed(raid) {
  const raiders = [...raid.players];
  const size = raid.scale;
  const inTime = raid.challenge && raid.duration <= targetTicks(size);
  const time = Shared.formatTicks(raid.duration);
  for (const player of raiders) {
    if (inTime) {
      player.sendMessage("Your team beat the challenge target time and you earned an extra 5,000 points.");
      raid.addPoints(player, POINTS.TARGET_BONUS);
    }
    Shared.raidMessage(player, `Congratulations - your raid is complete! Team size: ${size} Duration: <col=ff0000>${time}</col>`);
    recordBest(player, raid, time);
    const attribute = raid.challenge ? Shared.ATTR.CHALLENGE_KILLS : Shared.ATTR.KILLS;
    const count = (Number(player.getAttribute(attribute)) || 0) + 1;
    player.setAttribute(attribute, count);
    player.sendMessage(`Your completed Chambers of Xeric${raid.challenge ? " Challenge Mode" : ""} count is: <col=ff0000>${count}</col>.`);
  }
  generate(raid, inTime);
}

/** Personal bests by mode and team size. */
function recordBest(player, raid, time) {
  const bests = { ...(player.getAttribute(ATTR_BEST) ?? {}) };
  const key = `${raid.challenge ? "cm" : "normal"}:${raid.scale}`;
  if (bests[key] == null || raid.duration < bests[key]) {
    bests[key] = raid.duration;
    player.setAttribute(ATTR_BEST, bests);
    Shared.api().emitCustomEvent("boss:personal-best", { player, boss: `${RAID_NAME}${raid.challenge ? " Challenge Mode" : ""}`, ticks: raid.duration });
    player.sendMessage(`New personal best: <col=ff0000>${time}</col>`);
  }
}

function generate(raid, inTime) {
  const raiders = [...raid.players];
  const named = new Map(raiders.map((player) => [player.getUsername(), player]));
  const entrants = [...raid.original];
  const mode = raid.challenge ? 1 : 0;
  const special = [];
  const uniques = new Set();
  for (let i = uniqueRolls(raid.totalPoints); i > 0; i--) {
    const receiver = pickWeighted(entrants, (name) => Math.max(0, raid.points.get(name) ?? 0));
    const item = pickWeighted(UNIQUES, (entry) => entry.weight[mode]);
    // Wiki: a raider who left keeps the chance, but the item is discarded.
    if (!named.has(receiver)) continue;
    uniques.add(receiver);
    give(raid, receiver, item.id);
    special.push([receiver, item.id]);
    if (Shared.random(1, 53) === 1) {
      give(raid, receiver, ITEM.OLMLET);
      special.push([receiver, ITEM.OLMLET]);
    }
  }
  for (const player of raiders) {
    const name = player.getUsername();
    if (!uniques.has(name)) {
      const loot = commonLoot(raid.pointsOf(player));
      if (Shared.random(1, 10) === 1 && !player.getAttribute(ATTR_TABLET) && !owns(player, ITEM.TABLET)) loot[1] = { id: ITEM.TABLET, amount: 1, noted: false };
      for (const drop of loot) give(raid, name, drop.noted ? notedId(drop.id) : drop.id, drop.amount);
      if (Shared.random(1, 12) === 1) give(raid, name, ITEM.ELITE_CLUE);
    }
    if (!owns(player, ITEM.DARK_JOURNAL)) give(raid, name, ITEM.DARK_JOURNAL);
    if (inTime) {
      if (Shared.random(1, 75) === 1) {
        give(raid, name, ITEM.KIT);
        special.push([name, ITEM.KIT]);
      }
      if (Shared.random(1, 400) === 1) {
        give(raid, name, ITEM.DUST);
        special.push([name, ITEM.DUST]);
      }
    }
    player.getPacketSender().sendVarbit(VARBIT.LIGHT, uniques.has(name) ? LIGHT.PURPLE : LIGHT.WHITE);
  }
  if (special.length) {
    for (const player of raiders) {
      Shared.raidMessage(player, "Special loot:");
      for (const [name, id] of special) player.sendMessage(`${Shared.displayName(named.get(name))} - <col=ff0000>${itemName(id)}</col>`);
    }
  }
}

// ---------------------------------------------------------------- the chest

/** raids_client_needsrewardbook: set as the chest is searched. */
const VARBIT_NEEDS_REWARD_BOOK = 5457;

/** Pet ownership/delivery belongs to Pets, never the chest's bank/inventory/ground paths. */
function claimPetLoot(player, raid) {
  const items = rewardsOf(raid).get(player.getUsername()) ?? [];
  for (let index = items.length - 1; index >= 0; index--) {
    const entry = items[index];
    if (entry?.id !== ITEM.OLMLET) continue;
    const drops = [{ itemId: ITEM.OLMLET, amount: 1 }];
    Shared.api().emitCustomEvent("npc-drops:roll", { player, drops });
    // An unconsumed row means Pets is disabled: retain the ordinary-loot fallback.
    const remaining = items.indexOf(entry);
    if (drops.length === 0 && remaining !== -1) items.splice(remaining, 1);
  }
}

function openChest(event) {
  const { player } = event;
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  claimPetLoot(player, raid);
  const items = rewardsOf(raid).get(player.getUsername()) ?? [];
  if (items.length === 0) {
    Shared.statement(player, "The chest is empty.");
    return true;
  }
  const sender = player.getPacketSender();
  // rsprox captures: raids_client_needsrewardbook is set, then the rewards open with slots 0-5 clickable.
  sender.sendVarbit(VARBIT_NEEDS_REWARD_BOOK, 1);
  sender.sendInterface(INTERFACE.REWARDS);
  sender.sendInventory(INVENTORY, Math.max(items.length, 9), items);
  sender.sendInterfaceFlagsRange((INTERFACE.REWARDS << 16) | INTERFACE.ITEMS, 0, Math.max(items.length - 1, 5),
    Shared.EVENT.OP1 | (1 << 10));
  return true;
}

function refreshChest(player, raid) {
  const items = rewardsOf(raid).get(player.getUsername()) ?? [];
  player.getPacketSender().sendInventory(INVENTORY, Math.max(items.length, 9), items);
  player.getInventory().refreshItems();
  if (items.length === 0) player.getPacketSender().sendVarbit(VARBIT.LIGHT, LIGHT.NONE);
}

function takeItem(player, raid, index) {
  const items = rewardsOf(raid).get(player.getUsername()) ?? [];
  const entry = items[index];
  if (!entry) return false;
  if (entry.id === ITEM.OLMLET) {
    claimPetLoot(player, raid);
    if (!items.includes(entry)) return true;
  }
  const { Item, ItemDefinition } = Shared.core();
  const stackable = ItemDefinition.forId(entry.id)?.isStackable?.() === true;
  const inventory = player.getInventory();
  const room = stackable ? inventory.contains(entry.id) || inventory.getFreeSlots() > 0 : inventory.getFreeSlots() >= entry.amount;
  if (!room) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  inventory.add(new Item(entry.id, entry.amount), true);
  items.splice(index, 1);
  if (entry.id === ITEM.TABLET) player.setAttribute(ATTR_TABLET, true);
  return true;
}

function clickReward(event) {
  const { player } = event;
  const raid = Raid.raidOf(player);
  if (!raid) return true;
  const items = rewardsOf(raid).get(player.getUsername()) ?? [];
  const entry = items[event.slot ?? -1];
  if (!entry) return true;
  if ((event.opId ?? event.action) === 10) {
    player.sendMessage(Shared.core().ItemDefinition.forId(entry.id)?.getExamine?.() ?? "");
    return true;
  }
  takeItem(player, raid, event.slot);
  refreshChest(player, raid);
  return true;
}

function takeAll({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid) return true;
  const items = rewardsOf(raid).get(player.getUsername()) ?? [];
  for (let index = items.length - 1; index >= 0; index--) takeItem(player, raid, index);
  refreshChest(player, raid);
  return true;
}

function bankAll({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid) return true;
  claimPetLoot(player, raid);
  const { Item, Bank } = Shared.core();
  const items = rewardsOf(raid).get(player.getUsername()) ?? [];
  for (let index = items.length - 1; index >= 0; index--) {
    const entry = items[index];
    const bank = player.getBank(Bank.getTabForItem(player, entry.id));
    if (bank.getFreeSlots() <= 0 && !bank.contains(entry.id)) continue;
    bank.add(new Item(entry.id, entry.amount), false);
    if (entry.id === ITEM.TABLET) player.setAttribute(ATTR_TABLET, true);
    items.splice(index, 1);
  }
  if (items.length) player.sendMessage("Not enough space in your bank.");
  refreshChest(player, raid);
  return true;
}

function discardAll({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid) return true;
  claimPetLoot(player, raid);
  Shared.options(player, "Discard all the remaining loot?",
    "Yes, discard it all.", () => {
      rewardsOf(raid).set(player.getUsername(), []);
      refreshChest(player, raid);
      player.getPacketSender().sendInterfaceRemoval();
    },
    "No.", () => {});
  return true;
}

/** Wiki: unclaimed loot is placed on the ground on leaving (outside the raid). */
function unclaimedLoot(raid, player, logout) {
  if (!raid.rewards) return;
  claimPetLoot(player, raid);
  if (logout) return;
  const items = raid.rewards.get(player.getUsername()) ?? [];
  if (items.length === 0) return;
  raid.rewards.delete(player.getUsername());
  const { Item, ItemOnGroundManager } = Shared.core();
  Shared.later(player, 3, () => {
    for (const entry of items) ItemOnGroundManager.registerLocation(player, new Item(entry.id, entry.amount), player.getLocation().clone());
    player.sendMessage("Your unclaimed loot from the chest has been placed on the ground.");
  });
}

// ---------------------------------------------------------------- Captain Rimor's capes

function claimCape(event) {
  const { player } = event;
  const count = Number(player.getAttribute(Shared.ATTR.CHALLENGE_KILLS)) || 0;
  const earned = CAPES.find(([needed]) => count >= needed);
  if (!earned) {
    Shared.statement(player, "You need to complete at least 100 Challenge Mode raids before I can give you a cape.");
    return true;
  }
  const [, cape] = earned;
  if (owns(player, cape)) {
    player.sendMessage("You already have the cape you have earned.");
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You need some free inventory space for the cape.");
    return true;
  }
  Shared.give(player, cape);
  player.sendMessage(`Captain Rimor hands you ${itemName(cape)}.`);
  return true;
}

module.exports = function registerCoxRewards(api) {
  Shared.bind(api);
  api.persistAttribute(ATTR_TABLET);
  api.persistAttribute(ATTR_BEST);
  Raid.onComplete(completed);
  Raid.onLeave(unclaimedLoot);
  api.onObjectInteraction("Ancient chest", { Search: openChest });
  api.onInterfaceActionButton((INTERFACE.REWARDS << 16) | INTERFACE.ITEMS, clickReward);
  api.onInterfaceActionButton((INTERFACE.REWARDS << 16) | INTERFACE.TAKE_ALL, takeAll);
  api.onInterfaceActionButton((INTERFACE.REWARDS << 16) | INTERFACE.BANK_ALL, bankAll);
  api.onInterfaceActionButton((INTERFACE.REWARDS << 16) | INTERFACE.DISCARD_ALL, discardAll);
  api.onNpcInteraction("Captain Rimor", { "Claim-cape": claimCape });
};

Object.assign(module.exports, { uniqueRolls, commonLoot, targetTicks, generate, completed, UNIQUES, COMMONS });
