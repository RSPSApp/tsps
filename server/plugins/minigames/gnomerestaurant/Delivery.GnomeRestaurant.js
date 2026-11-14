"use strict";

/**
 * Handing a Gnome Restaurant order to its customer: the ordered dish used on the assigned
 * gnome, within the time limit and with the Aluft Aloft box in the inventory. Premade dishes
 * are refused, a wrong dish gives nothing, and a successful delivery pays the easy coin tip
 * or the hard item tip and moves the order's credits (Orders.GnomeRestaurant.js).
 *
 * Hard tip rates come from the wiki's drop-rate table. Rates the wiki leaves as
 * "Common/Uncommon/Rare" (runes, bolts, pure essence) are approximations, marked in the data.
 * Content may make the `unique` rows (the goggles and the scarf) commoner ("minigame:chance"
 * kind "unique"); the other rows then share what is left, so a tip is still one row.
 */

const Orders = require("./Orders.GnomeRestaurant");
const DATA = require("./data/gnome-restaurant-orders.json");

const PREMADE_IDS = new Set(DATA.premadeIds);
const DISH_IDS = new Set([...DATA.items.hard.map((item) => item.id), ...PREMADE_IDS]);

let api;
let core;
let COINS_ID;

function init(pluginApi) {
  api = pluginApi;
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

/** Each row's weight (its rate), the `unique` rows `uniqueMultiplier` times theirs at the others' expense. */
function tipWeights(entries, uniqueMultiplier) {
  const rates = entries.map((entry) => entry.rate[0] / entry.rate[1]);
  if (!(uniqueMultiplier > 1)) return rates;
  const total = rates.reduce((sum, rate) => sum + rate, 0);
  const unique = rates.reduce((sum, rate, index) => sum + (entries[index].unique ? rate : 0), 0);
  if (unique <= 0 || unique >= total) return rates;
  const raised = Math.min(total, unique * uniqueMultiplier);
  const common = (total - raised) / (total - unique);
  return rates.map((rate, index) => rate * (entries[index].unique ? raised / unique : common));
}

function rollHardReward(npcName, rng = Math.random, uniqueMultiplier = 1) {
  const entries = eligibleRewards(npcName);
  const weights = tipWeights(entries, uniqueMultiplier);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  let chosen = entries[entries.length - 1];
  for (const [index, entry] of entries.entries()) {
    roll -= weights[index];
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
    // A coin stack near the cap keeps what fits; the rest lands under the player.
    inventory.forceAdd(player, new core.Item(COINS_ID, coins));
    player.sendMessage(`You are given ${coins} coins as a tip.`);
    return;
  }
  const unique = { player, minigame: "gnome-restaurant", kind: "unique", multiplier: 1 };
  api.emitCustomEvent("minigame:chance", unique);
  const reward = rollHardReward(session.npcName, Math.random, Math.max(1, Number(unique.multiplier) || 1));
  for (const item of reward.items) {
    // Several rows are unnoted and many (pure essence is 51-97): what has no slot lands under the player.
    inventory.forceAdd(player, new core.Item(item.id, item.amount));
    api.emitCustomEvent("collection-log:obtain", { player, itemId: item.id, amount: item.amount });
  }
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
  api.emitCustomEvent?.("gnome-restaurant:delivered", { player: event.player, tier: session.tier });
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
    giveTip,
    eligibleRewards,
    npcNameOf,
  },
});
