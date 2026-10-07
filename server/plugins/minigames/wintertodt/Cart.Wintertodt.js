"use strict";

/**
 * The reward cart in the camp: Search, Check and Big-search.
 *
 * Captures: the cart (55423) is a multiloc on varbit 11435, the rewards owed. A search plays
 * anim 11758 and gives one reward 3 ticks later ("You found some loot: 11 x Raw shark");
 * Check says "You are owed 2 more rewards from the cart." or "You aren't owed any rewards from
 * the cart."; taking the last opens "You think you've taken as much as you're owed from the
 * reward cart.". Big-search takes up to 10 at once, in one search (or every reward left when
 * fewer are owed).
 */

const Shared = require("./WintertodtShared");
const Round = require("./WintertodtRound");
const Rewards = require("./WintertodtRewards");

const SEARCH_TICKS = 3;
const BIG_SEARCH = 10;

function check(event) {
  const { player } = event;
  const owed = Round.rewardsOwed(player);
  player.sendMessage(owed > 0
    ? `You are owed ${owed} more ${owed === 1 ? "reward" : "rewards"} from the cart.`
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
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  player.getInventory().adds(reward.id, reward.amount);
  player.getInventory().refreshItems();
  Shared.api()?.emitCustomEvent("collection-log:obtain", { player, itemId: reward.id, amount: reward.amount });
  Round.setRewardsOwed(player, Round.rewardsOwed(player) - 1);
  player.sendMessage(`You found some loot: ${reward.amount} x ${itemName(reward.id)}`);
  return true;
}

function searched(player) {
  Shared.statement(player, "You think you've taken as much as you're owed from the reward<br>cart.");
}

function startSearch(player, count) {
  if (Round.rewardsOwed(player) <= 0) {
    player.sendMessage("You aren't owed any rewards from the cart.");
    return true;
  }
  Shared.startAction(player, "cart", (ticks) => {
    if (ticks < SEARCH_TICKS) return true;
    const batch = Math.min(count, Round.rewardsOwed(player));
    for (let i = 0; i < batch; i++) {
      if (!takeOne(player)) return false;
    }
    if (Round.rewardsOwed(player) <= 0) searched(player);
    return false;
  });
  Shared.animate(player, Shared.ANIM.CART_SEARCH);
  return true;
}

function search(event) {
  return startSearch(event.player, 1);
}

function bigSearch(event) {
  return startSearch(event.player, BIG_SEARCH);
}

module.exports = function registerWintertodtCart(api) {
  api.onObjectInteraction(Shared.OBJECT.REWARD_CART, { Search: search, Check: check, "Big-search": bigSearch });
};

module.exports.search = search;
module.exports.bigSearch = bigSearch;
module.exports.check = check;
