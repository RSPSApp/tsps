"use strict";

/**
 * The Rewards Guardian (Check, Search, Big-search), its loot, and the intricate pouch.
 *
 * rsprox captures (rev 241):
 * - Check: mesbox "You have 3 catalytic energy and 2 elemental energy. You can use them to search
 *   the rift 2 times. You have searched the rift 4,003 times."
 * - Search: picking_low_shorter a tick after the click, then a reward every 3 ticks (the animation
 *   again), "You found some loot: 125 x Chaos rune" (spam) and sound 2581, until the searches run
 *   out: mesbox "There doesn't seem to be anything else in the rift for you."
 * - Big-search: the animation, and three ticks later up to five rewards at once.
 * - With nothing to search: mesbox "There doesn't seem to be anything in the rift for you."
 * Wiki: a search costs an elemental and a catalytic point; the tables are in
 * data/guardians-of-the-rift-rewards.json (the rare table rolls apart from the main one; a pouch
 * the player lacks, else a reroll; Atlax's diary and the abyssal needle only once); a needle on the
 * Rewards Guardian makes an abyssal needle. The intricate pouch needs two free slots.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Records = require("./Records.GuardiansOfTheRift");
const DATA = require("../data/guardians-of-the-rift-rewards.json");

const BIG_SEARCH = 5;
const SEARCH_TICKS = 3;
const LOOT_SOUND = 2581;
const INTRICATE_FREE_SLOTS = 2;
/** "once" rewards and the gotr_perm_0/gotr_rewards_perm varbits that remember them. */
const ONCE_VARBITS = {
  gotr_book: "gotr_book_obtained",
  abyssal_needle: "gotr_unlocked_needle",
  gotr_tarnished_locket: "gotr_locket_obtained",
  gotr_lost_bag: "gotr_bag_obtained",
};

function itemName(id) {
  return Shared.core().ItemDefinition.forId(id)?.getName?.() ?? "item";
}

function owns(player, itemId) {
  const { Bank } = Shared.core();
  return player.getInventory().contains(itemId) || player.getEquipment().contains(itemId)
    || player.getBanks().some((bank, tab) => tab !== Bank.BANK_SEARCH_TAB_INDEX && bank?.contains?.(itemId));
}

function questDone(player, key) {
  const request = { player, key, complete: false };
  Shared.api().emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function hadOnce(player, item) {
  return Records.setting(player, ONCE_VARBITS[item]) === 1;
}

// ------------------------------------------------------------------ rolls

function amountOf(entry) {
  return entry.amount ? Shared.random(entry.amount[0], entry.amount[1]) : 1;
}

function pickWeighted(entries, total, random = Math.random) {
  let roll = random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

/** The pouch the player is next missing, small to giant (Wiki: else the table rolls again). */
function missingPouch(player) {
  return DATA.search.pouches.find((pouch) => !owns(player, Shared.obj(pouch))) ?? null;
}

function runeAmount(player, entry) {
  const amount = amountOf(entry);
  if (!entry.level || Shared.runecraftLevel(player) >= entry.level) return amount;
  return Math.max(1, Math.floor(amount / 3));
}

function mainReward(player) {
  const table = DATA.search;
  const pouch = missingPouch(player);
  const entries = pouch ? table.main : table.main.filter((entry) => entry.table !== "pouch");
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const entry = pickWeighted(entries, total);
  if (entry.table === "pouch") return { item: pouch, amount: 1 };
  if (entry.table === "talisman") return talisman(player);
  return { item: entry.item, amount: runeAmount(player, entry) };
}

function talisman(player) {
  const entry = pickWeighted(DATA.search.talismans.entries, DATA.search.talismans.total);
  if (entry.quest && !questDone(player, entry.quest)) return { item: "cert_air_talisman", amount: 1 };
  return { item: entry.item, amount: 1 };
}

function rareReward(player) {
  for (const entry of DATA.search.rare) {
    if (entry.once && hadOnce(player, entry.item)) continue;
    if (Math.random() * entry.chance < 1) return { item: entry.item, amount: 1, once: entry.once };
  }
  return null;
}

/** One search's rewards: the rare table, the main table and the pet, rolled apart (Wiki). */
function rollSearch(player) {
  const rewards = [];
  const rare = rareReward(player);
  if (rare) rewards.push(rare);
  rewards.push(mainReward(player));
  if (Math.random() * DATA.search.pet.chance < 1) rewards.push({ item: DATA.search.pet.item, amount: 1, pet: true });
  return rewards;
}

// ------------------------------------------------------------------ giving

/** Free slots a set of rewards needs: none for a stack already held (a pet may need one). */
function slotsNeeded(player, rewards) {
  const inventory = player.getInventory();
  return rewards.filter((reward) => {
    const itemId = Shared.obj(reward.item);
    return !(Shared.core().ItemDefinition.forId(itemId)?.isStackable?.() && inventory.contains(itemId));
  }).length;
}

/** Gives one reward the inventory has been checked to hold. */
function give(player, reward) {
  const itemId = Shared.obj(reward.item);
  if (reward.pet) {
    const event = { player, drops: [{ itemId, amount: 1 }] };
    Shared.api().emitCustomEvent("npc-drops:roll", event);
    if (event.drops.length === 0) return true;
  }
  player.getInventory().adds(itemId, reward.amount);
  player.getInventory().refreshItems();
  if (reward.once && ONCE_VARBITS[reward.item]) Records.setSetting(player, ONCE_VARBITS[reward.item], 1);
  Shared.api().emitCustomEvent("collection-log:obtain", { player, itemId, amount: reward.amount });
  Shared.spam(player, `You found some loot: ${reward.amount} x ${itemName(itemId)}`);
  return true;
}

function searchesLeft(player) {
  const points = Records.points(player);
  return Math.min(points.elemental, points.catalytic);
}

/**
 * One search: the whole roll must fit before anything is given, then its points are spent and
 * every reward handed over. False when there are no searches left or no room.
 */
function searchOnce(player) {
  if (searchesLeft(player) <= 0) return false;
  const rewards = rollSearch(player);
  if (slotsNeeded(player, rewards) > player.getInventory().getFreeSlots()) {
    player.getInventory().full();
    return false;
  }
  const points = Records.points(player);
  Records.setPoints(player, points.elemental - 1, points.catalytic - 1);
  Records.addSearches(player, 1);
  for (const reward of rewards) give(player, reward);
  return true;
}

function emptied(player) {
  Shared.statement(player, "There doesn't seem to be anything else in the rift for you.");
}

function isRift(objectId) {
  return Shared.isLoc(objectId, "gotr_reward_rift");
}

function search({ player, objectId }) {
  if (!isRift(objectId)) return false;
  if (searchesLeft(player) <= 0) {
    Shared.statement(player, "There doesn't seem to be anything in the rift for you.");
    return true;
  }
  let next = 1;
  Shared.startAction(player, "search", (ticks) => {
    if (ticks === 1) Shared.animate(player, "picking_low_shorter");
    if (ticks < next + SEARCH_TICKS) return true;
    next = ticks;
    Shared.animate(player, "picking_low_shorter");
    if (!searchOnce(player)) return false;
    Shared.sound(player, LOOT_SOUND);
    if (searchesLeft(player) > 0) return true;
    emptied(player);
    return false;
  });
  return true;
}

function bigSearch({ player, objectId }) {
  if (!isRift(objectId)) return false;
  if (searchesLeft(player) <= 0) {
    Shared.statement(player, "There doesn't seem to be anything in the rift for you.");
    return true;
  }
  Shared.startAction(player, "big-search", (ticks) => {
    if (ticks === 1) Shared.animate(player, "picking_low_shorter");
    if (ticks < 1 + SEARCH_TICKS) return true;
    let searched = 0;
    while (searched < BIG_SEARCH && searchOnce(player)) searched++;
    if (searched > 0) Shared.sound(player, LOOT_SOUND);
    if (searchesLeft(player) <= 0) emptied(player);
    return false;
  });
  return true;
}

function check({ player, objectId }) {
  if (!isRift(objectId)) return false;
  const points = Records.points(player);
  const n = Shared.formatNumber;
  Shared.statement(player, `You have ${n(points.catalytic)} catalytic energy and ${n(points.elemental)} elemental energy. `
    + `You can use them to search the rift ${n(searchesLeft(player))} times. You have searched the rift ${n(Records.searches(player))} times.`);
  return true;
}

/** Wiki: a needle used on the Rewards Guardian becomes an abyssal needle. */
function needleOnRift({ player }) {
  if (!Shared.inTemple(player.getLocation())) return false;
  const inventory = player.getInventory();
  inventory.delete(Shared.obj("needle"), 1);
  inventory.adds(Shared.obj("abyssal_needle"), 1);
  inventory.refreshItems();
  Records.setSetting(player, "gotr_unlocked_needle", 1);
  return true;
}

// ------------------------------------------------------------------ the intricate pouch

function rollIntricate(player) {
  const table = DATA.intricatePouch;
  const rewards = [];
  for (const entry of table.preroll) {
    if (entry.once && hadOnce(player, entry.item)) continue;
    if (Math.random() * entry.chance < 1) {
      rewards.push({ item: entry.item, amount: 1, once: entry.once });
      break;
    }
  }
  if (rewards.length === 0) {
    const entry = pickWeighted(table.main, table.total);
    rewards.push({ item: entry.item, amount: amountOf(entry) });
  }
  for (const entry of table.tertiary) {
    if (Math.random() * entry.chance < 1) rewards.push({ item: entry.item, amount: 1 });
  }
  return rewards;
}

function openPouch({ player }) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < INTRICATE_FREE_SLOTS) {
    player.sendMessage("You need at least two free inventory spaces to open this pouch.");
    return true;
  }
  inventory.delete(Shared.obj("gotr_intricate_pouch"), 1);
  for (const reward of rollIntricate(player)) give(player, reward);
  Shared.itemStatement(player, "gotr_intricate_pouch", "You open the intricate pouch and find something inside!");
  return true;
}

module.exports = {
  DATA, rollSearch, rollIntricate, missingPouch, searchesLeft,
  attach(api) {
    api.onObjectInteraction("<col=ffff00>Rewards Guardian</col>", { Search: search, Check: check, "Big-search": bigSearch });
    api.onItemOnObject("Needle", "<col=ffff00>Rewards Guardian</col>", needleOnRift);
    api.onItemAction("Intricate pouch", { Open: openPouch });
  },
};
