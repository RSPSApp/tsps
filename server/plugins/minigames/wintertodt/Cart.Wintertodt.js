"use strict";

/**
 * The reward cart in the camp: Search, Check and Big-search.
 *
 * Captures (recording 3264): the cart (55423) is a multiloc on varbit 11435, the rewards owed.
 * Search plays anim 11758 and keeps going: a reward every 3 ticks, each with synth 2581 and
 * "You found some loot: 11 x Raw shark" (spam), until nothing is owed ("You think you've taken
 * as much as you're owed from the reward cart.") or the inventory is full ("You need at least
 * one free inventory space to take from the reward cart."). Big-search takes 5 each time (also
 * the Wiki's "batches of 5"). Nothing owed: "There are no rewards here for you. Maybe you could
 * help subdue the Wintertodt....". Check says "You are owed 2 more rewards from the cart.",
 * "You are owed one more reward from the cart." or "You aren't owed any rewards from the cart."
 */

const Shared = require("./Shared.Wintertodt");
const Round = require("./Round.Wintertodt");
const Rewards = require("./Rewards.Wintertodt");

/** Captures (recording 3264) and the Wiki: a batch every 3 ticks; Big-search takes 5 at a time. */
const SEARCH_TICKS = 3;
const BIG_SEARCH = 5;

function check(event) {
  const { player } = event;
  const owed = Round.rewardsOwed(player);
  player.sendMessage(owed > 1 ? `You are owed ${owed} more rewards from the cart.`
    : owed === 1 ? "You are owed one more reward from the cart."
      : "You aren't owed any rewards from the cart.");
  return true;
}

function hasRoom(player, reward) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() > 0) return true;
  const stackable = Shared.core().ItemDefinition.forId(reward.id)?.isStackable?.();
  return stackable && inventory.contains(reward.id);
}

function itemName(id) {
  return Shared.core().ItemDefinition.forId(id)?.getName?.() ?? "item";
}

/** Gives one reward; false if there was no room for it. */
function takeOne(player) {
  const reward = Rewards.roll(player);
  if (!reward) return true;
  if (reward.pet) {
    const event = { player, drops: [{ itemId: reward.id, amount: 1 }] };
    Shared.api()?.emitCustomEvent("npc-drops:roll", event);
    if (event.drops.length === 0) {
      Round.setRewardsOwed(player, Round.rewardsOwed(player) - 1);
      return true;
    }
  }
  if (!hasRoom(player, reward)) {
    inventoryFull(player);
    return false;
  }
  player.getInventory().adds(reward.id, reward.amount);
  player.getInventory().refreshItems();
  Shared.api()?.emitCustomEvent("collection-log:obtain", { player, itemId: reward.id, amount: reward.amount });
  Round.setRewardsOwed(player, Round.rewardsOwed(player) - 1);
  Shared.spam(player, `You found some loot: ${lootText(reward)}`);
  return true;
}

/** rsprox_transcripts/233/03264.txt: "Grimy torstol" for one, "4,886 x Coins" (thousands separated) for more. */
function lootText(reward) {
  const name = itemName(reward.id);
  return reward.amount > 1 ? `${reward.amount.toLocaleString("en-US")} x ${name}` : name;
}

function searched(player) {
  Shared.statement(player, "You think you've taken as much as you're owed from the reward<br>cart.");
}

function inventoryFull(player) {
  Shared.statement(player, "You need at least one free inventory space to take from the reward<br>cart.");
}

/**
 * Takes `count` rewards every 3 ticks, with the search animation and synth 2581 each time, until
 * nothing is owed or the inventory is full (captures, recording 3264).
 */
function startSearch(player, count) {
  if (Round.rewardsOwed(player) <= 0) {
    Shared.statement(player, "There are no rewards here for you.<br>Maybe you could help subdue the Wintertodt....");
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    inventoryFull(player);
    return true;
  }
  Shared.startAction(player, "cart", (ticks) => {
    if (ticks % SEARCH_TICKS !== 0) return true;
    const batch = Math.min(count, Round.rewardsOwed(player));
    if (batch > 0) Shared.sound(player, Shared.SOUND.PICK);
    for (let i = 0; i < batch; i++) {
      if (!takeOne(player)) return false;
    }
    if (Round.rewardsOwed(player) <= 0) {
      searched(player);
      return false;
    }
    Shared.animate(player, Shared.ANIM.CART_SEARCH);
    return true;
  });
  Shared.animate(player, Shared.ANIM.CART_SEARCH);
  return true;
}

function search(event) {
  const { player } = event;
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "reward-cart", resume: () => search(event) };
  Shared.api().emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
  return startSearch(event.player, 1);
}

function bigSearch(event) {
  const { player } = event;
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "reward-cart", resume: () => bigSearch(event) };
  Shared.api().emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
  return startSearch(event.player, BIG_SEARCH);
}

module.exports = function registerWintertodtCart(api) {
  api.onObjectInteraction(Shared.OBJECT.REWARD_CART, { Search: search, Check: check, "Big-search": bigSearch });
};

module.exports.search = search;
module.exports.lootText = lootText;
module.exports.bigSearch = bigSearch;
module.exports.check = check;
