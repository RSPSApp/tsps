"use strict";

/**
 * The reward pool in the Ruins of Unkah, the Spirit Angler's free net, and the pool's casket.
 *
 * Captures: Net plays `human_smallnet`; a permit goes (varbit 11936) on the third tick and the
 * loot comes as "You found some loot: <n> x <item>" ("You found some loot: Casket" for one).
 * Big-search takes five permits at once. Check: "There are <col=ef1020><n> rewards</col> for you
 * to find in the reward pool.". With no net the Spirit Angler says "A net may be of use to you.
 * Speak to me if you need one.". Opening a casket plays sound 52.
 * Wiki: a small or big net; 10 Fishing XP a reward; the tables in DATA.rewards (by base Fishing
 * level) and DATA.casketLoot; a second fish barrel or tackle box becomes 25 soaked pages.
 */

const Shared = require("./Shared.Tempoross");
const Records = require("./Records.Tempoross");

const { DATA, ITEM, NPC } = Shared;
const R = DATA.rewards;

const ANIM_NET = 621;
const SOUND_CASKET = 52;
const NETS = ["SMALL_FISHING_NET", "BIG_FISHING_NET"];
const BIG_SEARCH = 5;
/** Empty pool 41296 through the fullest pool 41304. */
const POOL_VARIANTS = [41296, 41304];

function ids() {
  return Shared.core().ItemIdentifiers;
}

function between(min, max) {
  return Shared.randomInt(min, max);
}

function noted(id) {
  const note = Shared.core().ItemDefinition.forId(id)?.getNoteId?.() ?? -1;
  return note > 0 ? note : id;
}

function owned(player, id) {
  let count = player.getInventory().getAmount(id) + player.getEquipment().getAmount(id);
  for (const tab of player.getBanks?.() ?? []) count += tab?.getAmount?.(id) ?? 0;
  return count;
}

function weighted(entries, weightOf) {
  const total = entries.reduce((sum, entry) => sum + weightOf(entry), 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= weightOf(entry);
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

/** The fish tier by base Fishing level (boosts don't count, Wiki). */
function rollFish(player) {
  const level = Shared.baseLevel(player, "FISHING");
  const tier = R.fish.find((entry) => level >= entry.minLevel);
  const { i } = weighted(R.fishWeights.map((weight, i) => ({ weight, i })), (entry) => entry.weight);
  const [name, min, max] = tier.items[i];
  return { id: noted(ids()[name]), amount: between(min, max) };
}

function rollMain(player) {
  const entry = weighted(R.main, (e) => e.weight);
  if (entry.table === "fish") return rollFish(player);
  const table = entry.table ? R[entry.table] : entry;
  const id = ids()[table.item];
  return { id: table.noted ? noted(id) : id, amount: between(table.min, table.max) };
}

/** One search: the uniques roll first (each on its own chance), then the main table. */
function roll(player) {
  for (const unique of R.uniques) {
    if (Math.floor(Math.random() * unique.chance) !== 0) continue;
    const id = ids()[unique.item];
    if (unique.duplicate && owned(player, id) > 0) {
      return { id: ids()[unique.duplicate[0]], amount: unique.duplicate[1] };
    }
    return { id, amount: 1, pet: unique.pet === true };
  }
  const [numerator, denominator] = R.soakedPages.chance;
  if (Math.random() * denominator < numerator) {
    return { id: ids()[R.soakedPages.item], amount: between(R.soakedPages.min, R.soakedPages.max) };
  }
  return rollMain(player);
}

function itemName(id) {
  return Shared.core().ItemDefinition.forId(id)?.getName?.() ?? "item";
}

/** Gives one reward; false when it can't fit, leaving the permit. */
function giveReward(player, reward) {
  const inventory = player.getInventory();
  const stackable = Shared.core().ItemDefinition.forId(reward.id)?.isStackable?.();
  if (inventory.getFreeSlots() <= 0 && !(stackable && inventory.contains(reward.id))) {
    inventory.full();
    return false;
  }
  if (reward.pet) {
    const event = { player, drops: [{ itemId: reward.id, amount: 1 }] };
    Shared.api().emitCustomEvent("npc-drops:roll", event);
    if (event.drops.length === 0) return true;
  }
  inventory.adds(reward.id, reward.amount);
  inventory.refreshItems();
  // rsprox (227/00552, 227/01858, 234/03275): spam, "You found some loot: 60 x Spirit flakes" / "...: Casket"; soaked
  // pages a game message, red: "You found some loot: <col=ef1020>9 x Soaked page</col>".
  const text = reward.amount > 1 ? `${reward.amount.toLocaleString("en-US")} x ${itemName(reward.id)}` : itemName(reward.id);
  if (reward.id === Shared.core().ItemIdentifiers.SOAKED_PAGE) player.sendMessage(`You found some loot: <col=ef1020>${text}</col>`);
  else player.getPacketSender().sendTypedMessage(Shared.core().ChatType.SPAM, `You found some loot: ${text}`);
  Shared.api().emitCustomEvent("collection-log:obtain", { player, itemId: reward.id, amount: reward.amount });
  return true;
}

function hasNet(player) {
  return NETS.some((name) => Shared.hasItem(player, ids()[name]));
}

function search(player, perAction) {
  if (Records.permits(player) <= 0) {
    player.sendMessage("There are no rewards for you to find in the reward pool.");
    return;
  }
  if (!hasNet(player)) {
    Shared.npcSays(player, NPC.REWARD_ANGLER, "A net may be of use to you. Speak to me if you need one.");
    return;
  }
  Shared.animate(player, ANIM_NET);
  Shared.startAction(player, "reward-pool", (ticks) => {
    if (ticks % DATA.ticks.rewardNet !== 0) return true;
    for (let i = 0; i < perAction; i++) {
      if (Records.permits(player) <= 0) return false;
      const reward = roll(player);
      if (!giveReward(player, reward)) return false;
      Records.setPermits(player, Records.permits(player) - 1);
      // The log's Tempoross count is reward permits claimed (Wiki, "Reward pool").
      Shared.api().emitCustomEvent("collection-log:count", { player, category: "Tempoross" });
      Shared.addXp(player, "FISHING", R.xp);
    }
    if (Records.permits(player) <= 0) return false;
    Shared.animate(player, ANIM_NET);
    return true;
  });
}

/** The pool is a multiloc on the permits varbit; a click names the parent or its variant. */
function isPool(objectId) {
  return objectId === Shared.LOC.REWARD_POOL || (objectId >= POOL_VARIANTS[0] && objectId <= POOL_VARIANTS[1]);
}

function net({ player, objectId }) {
  if (!isPool(objectId)) return false;
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "tempoross-reward-pool", resume: () => net({ player, objectId }) };
  Shared.api().emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
  search(player, 1);
  return true;
}

function bigSearch({ player, objectId }) {
  if (!isPool(objectId)) return false;
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "tempoross-reward-pool", resume: () => bigSearch({ player, objectId }) };
  Shared.api().emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
  search(player, BIG_SEARCH);
  return true;
}

function check({ player, objectId }) {
  if (!isPool(objectId)) return false;
  const count = Records.permits(player);
  player.sendMessage(`There are <col=ef1020>${count} reward${count === 1 ? "" : "s"}</col> for you to find in the reward pool.`);
  return true;
}

function takeNet({ player }) {
  const id = ids().SMALL_FISHING_NET;
  if (player.getInventory().contains(id)) {
    player.sendMessage("You already have a small fishing net.");
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.getInventory().full();
    return true;
  }
  player.getInventory().adds(id, 1);
  player.getInventory().refreshItems();
  return true;
}

// ------------------------------------------------------------------ the casket

function rollCasket() {
  const loot = DATA.casketLoot;
  const [name, min, max] = weighted(loot.items, (entry) => entry[3]);
  const id = ids()[name];
  return { id: name === "COINS" ? id : noted(id), amount: between(min, max) };
}

function openCasket(event) {
  const { player } = event;
  if (event.itemId !== ITEM.CASKET) return false;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0) {
    inventory.full();
    return true;
  }
  inventory.delete(ITEM.CASKET, 1);
  player.getPacketSender().sendSound(SOUND_CASKET, 100, 0);
  const reward = rollCasket();
  inventory.adds(reward.id, reward.amount);
  for (const [tier, numerator, denominator] of DATA.casketLoot.clues) {
    if (Math.random() * denominator >= numerator) continue;
    const scroll = ids()[`CLUE_SCROLL_${tier.toUpperCase()}_`];
    if (scroll && inventory.getFreeSlots() > 0) inventory.adds(scroll, 1);
  }
  inventory.refreshItems();
  return true;
}

function attachRewards(api) {
  api.onObjectInteraction("Reward pool", { Net: net, Check: check, "Big-search": bigSearch });
  api.onObjectInteraction("Empty pool", { Net: net });
  api.onNpcInteraction("Spirit Angler", { "Take-net": takeNet });
  api.onItemAction("Casket", { Open: openCasket });
}

module.exports = { attachRewards, roll, rollCasket, giveReward };
