"use strict";

/**
 * Handing a Gnome Restaurant order to its customer: the ordered dish used on the assigned
 * gnome, within the time limit and with the Aluft Aloft box in the inventory. Premade dishes
 * are refused, a wrong dish gives nothing, and a successful delivery pays the easy coin tip
 * or the hard item tip and moves the order's credits (Orders.GnomeRestaurant.js).
 *
 * Hard tip rates come from the wiki's drop-rate table. Rates the wiki leaves as
 * "Common/Uncommon/Rare" (runes, bolts, pure essence) are approximations, marked in the data.
 */

const Orders = require("./Orders.GnomeRestaurant");
const DATA = require("./data/gnome-restaurant-orders.json");

const PREMADE_IDS = new Set(DATA.premadeIds);
const DISH_IDS = new Set([...DATA.items.hard.map((item) => item.id), ...PREMADE_IDS]);

let core;
let COINS_ID;

function init(pluginApi) {
  core = pluginApi.core;
  COINS_ID = core.ItemIdentifiers.COINS;
}

// --- Tips

function rollEasyTip(rng = Math.random) {
  const { coinTipMin: min, coinTipMax: max } = DATA.tiers.easy;
  return min + Math.floor(rng() * (max - min + 1));
}

function eligibleRewards(npcName) {
  return DATA.rewards.filter((entry) => !entry.only || entry.only.includes(npcName));
}

function rollHardReward(npcName, rng = Math.random) {
  const entries = eligibleRewards(npcName);
  const total = entries.reduce((sum, entry) => sum + entry.rate[0] / entry.rate[1], 0);
  let roll = rng() * total;
  let chosen = entries[entries.length - 1];
  for (const entry of entries) {
    roll -= entry.rate[0] / entry.rate[1];
    if (roll < 0) {
      chosen = entry;
      break;
    }
  }
  const items = chosen.items.map((item) => ({
    id: item.id,
    name: item.name,
    amount: item.min + Math.floor(rng() * (item.max - item.min + 1)),
  }));
  return { items, rate: chosen.rate, only: chosen.only };
}

function giveTip(player, session) {
  const inventory = player.getInventory();
  if (session.tier === "easy") {
    const coins = rollEasyTip();
    inventory.adds(COINS_ID, coins);
    player.sendMessage(`You are given ${coins} coins as a tip.`);
    return;
  }
  const reward = rollHardReward(session.npcName);
  for (const item of reward.items) inventory.adds(item.id, item.amount);
  player.sendMessage("You are given a tip for your delivery.");
}

// --- Delivering

function npcNameOf(event) {
  return event.target?.getCurrentDefinition?.(event.player)?.getName?.()
    ?? event.definition?.getName?.()
    ?? core.NpcDefinition?.forId?.(event.npcId)?.getName?.();
}

function deliver(event) {
  const session = Orders.sessionOf(event.player);
  if (!session) return;
  if (!DISH_IDS.has(event.itemId)) return;
  if (npcNameOf(event) !== session.npcName) return;
  event.handled = true;
  if (Date.now() >= session.deadline) {
    Orders.expire(event.player, session);
    return;
  }
  const inventory = event.player.getInventory();
  if (event.itemId !== session.itemId) {
    event.player.sendMessage(PREMADE_IDS.has(event.itemId)
      ? "Premade dishes will not do, I'm afraid."
      : `You don't appear to have brought the correct food for ${session.npcName}.`);
    return;
  }
  if (!inventory.contains(Orders.boxId())) {
    event.player.sendMessage("You need your Aluft Aloft box to hand in a delivery.");
    return;
  }
  inventory.deleteNumber(session.itemId, 1);
  inventory.deleteNumber(Orders.boxId(), 1);
  const { tokens } = Orders.completeDelivery(event.player, session);
  event.player.sendMessage(`You hand over your delivery of ${session.itemName} to ${session.npcName}.`);
  giveTip(event.player, session);
  if (tokens > 0) event.player.sendMessage("You've earned a reward token for your deliveries!");
}

function attach(pluginApi) {
  init(pluginApi);
  pluginApi.onItemOnNpc(deliver);
}

module.exports = attach;
Object.assign(module.exports, {
  _test: {
    init,
    deliver,
    rollEasyTip,
    rollHardReward,
    eligibleRewards,
    npcNameOf,
  },
});
