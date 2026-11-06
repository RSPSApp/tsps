"use strict";

/**
 * The Bounty Hunter coffer (OSRS Wiki: Coffer (Bounty Hunter), Bounty Hunter#Coffer, Emblem
 * Trader and Corrupted Warrior transcripts).
 *
 * Coins kept here (up to 2,000,000) pay for taking part: a player needs the minimum deposit for
 * their combat level to get a target. When another player kills you in the crater, your minimum
 * deposit (10,000 if you were skulled) leaves your coffer and goes to your killer.
 *
 * Reached through the Coffer loc, the Coffer option on the Emblem Trader and Corrupted Warriors,
 * and their "manage my Coffer" dialogue.
 */

const COFFER_ATTRIBUTE = "bounty-hunter:coffer";

const MAX_COFFER = 2_000_000;
const SKULLED_DEATH_COST = 10_000;
/** [highest combat level, minimum deposit] */
const MINIMUM_DEPOSITS = [[60, 30_000], [88, 50_000], [110, 100_000], [126, 150_000]];

/** The transcript lines that lead into the deposit/withdraw choice. */
const COFFER_LINES = new Set([
  "Do you want to add or remove coins from your coffer?",
  "Certainly. Would you like to add or remove coins from it?",
]);

let core;
let pluginApi;

function balance(player) {
  const value = Number(player.getAttribute(COFFER_ATTRIBUTE));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function minimumDeposit(combatLevel) {
  return (MINIMUM_DEPOSITS.find(([level]) => combatLevel <= level) ?? MINIMUM_DEPOSITS[MINIMUM_DEPOSITS.length - 1])[1];
}

function playerMinimumDeposit(player) {
  return minimumDeposit(player.getSkillManager().getCombatLevel());
}

/** Bot supplies cover the entry fee again after a death. */
function fundToMinimum(player) {
  const minimum = playerMinimumDeposit(player);
  if (balance(player) < minimum) player.setAttribute(COFFER_ATTRIBUTE, minimum);
}

function coins(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS);
}

function openCoffer({ player }) {
  pluginApi.sendMultiChatboxPrompt(player, `Current coffer: ${balance(player).toLocaleString()}`,
    "Deposit coins.", () => askAmount(player, "Deposit how many coins?", deposit),
    "Withdraw coins.", () => askAmount(player, "Withdraw how many coins?", withdraw));
}

function askAmount(player, title, then) {
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredAmountAction({ execute: (amount) => then(player, Math.floor(Number(amount))) });
  player.getPacketSender().sendEnterAmountPrompt(title);
}

function deposit(player, amount) {
  const count = Math.min(amount, coins(player), MAX_COFFER - balance(player));
  if (!(count > 0)) return;
  player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, count);
  player.setAttribute(COFFER_ATTRIBUTE, balance(player) + count);
}

function withdraw(player, amount) {
  const wanted = Math.min(amount, balance(player));
  if (!(wanted > 0)) return;
  // What the coin stack can still hold; the coffer keeps the rest.
  const count = player.getInventory().getAddableAmount(new core.Item(core.ItemIdentifiers.COINS, wanted));
  if (count <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  player.setAttribute(COFFER_ATTRIBUTE, balance(player) - count);
  player.getInventory().addItem(new core.Item(core.ItemIdentifiers.COINS, count));
}

/** What a death costs the victim's coffer. */
function deathCost(player, skulled) {
  return Math.min(balance(player), skulled ? SKULLED_DEATH_COST : playerMinimumDeposit(player));
}

function died({ player, killer, skulled }) {
  if (!killer) return;
  const cost = deathCost(player, skulled);
  if (cost <= 0) return;
  player.setAttribute(COFFER_ATTRIBUTE, balance(player) - cost);
  killer.getInventory().forceAdd(killer, new core.Item(core.ItemIdentifiers.COINS, cost));
}

function cofferLine(request) {
  if (COFFER_LINES.has(request.text)) request.after = () => openCoffer(request);
}

function useCoffer(event) {
  if (event.objectId !== core.ObjectIdentifiers.COFFER_4) return false;
  openCoffer(event);
}

function answerBalance(query) {
  query.balance = balance(query.player);
}

function answerMinimumDeposit(query) {
  query.amount = playerMinimumDeposit(query.player);
}

module.exports = function attachBountyHunterCoffer(api) {
  core = api.core;
  pluginApi = api;
  api.persistAttribute(COFFER_ATTRIBUTE, 0);
  api.onObjectInteraction("Coffer", { Use: useCoffer });
  api.onNpcsInteraction(["Emblem Trader", "Corrupted Warrior"], { Coffer: openCoffer });
  api.onCustomEvent("npc-dialogue:line", cofferLine);
  api.onCustomEvent("bounty-hunter:died", died);
  api.onCustomEvent("bounty-hunter:coffer-balance", answerBalance);
  api.onCustomEvent("bounty-hunter:minimum-deposit", answerMinimumDeposit);
};
Object.assign(module.exports, { balance, minimumDeposit, playerMinimumDeposit, fundToMinimum, deathCost, deposit, withdraw, died });
