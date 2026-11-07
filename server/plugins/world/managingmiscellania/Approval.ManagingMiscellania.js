"use strict";

/**
 * Approval from working alongside the subjects on the islands (OSRS Wiki, Managing Miscellania):
 * +1 per coal mined, and a 50% chance of +1 per maple log or per tuna, lobster or
 * swordfish caught. Before the quest is complete, Throne of Miscellania counts these itself.
 * Approval tops out at 127 (100%).
 *
 * Coal mined there is handed to Miner Magnus, who thanks the player (rsprox capture 1757, rev 227:
 * "You manage to mine some coal, and give it to Miner Magnus.", no coal, and his "Thanks!").
 *
 * Wiki: https://oldschool.runescape.wiki/w/Managing_Miscellania#Approval
 */

const Common = require("./Common.ManagingMiscellania");

function raise(player, amount) {
  Common.catchUp(player);
  const now = Common.favour(player);
  if (now >= Common.DATA.favourMax) return;
  Common.setFavour(player, Math.min(Common.DATA.favourMax, now + amount));
  Common.getApi().emitCustomEvent("miscellania:approval-changed", { player, value: Common.favour(player), max: Common.DATA.favourMax });
}

function eligible(player) {
  return player && Common.onIslands(player) && Common.ruler(player);
}

const MINER = "Miner Magnus";

/** "mining:hand-over": a regent's coal goes to Miner Magnus, who says so. */
function handOverCoal(request) {
  const { player } = request;
  if (request.taker || request.itemId !== Common.items().COAL || !eligible(player)) return;
  request.taker = MINER;
  const miner = player.getLocalNpcs().find((npc) => npc.getDefinition()?.getName() === MINER);
  if (miner) miner.forceChat("Thanks!");
}

function onMined({ player, itemId }) {
  if (!eligible(player)) return;
  if (itemId === Common.items().COAL) raise(player, 1);
}

function onChopped({ player, logId }, random = Math.random) {
  if (!eligible(player) || logId !== Common.items().MAPLE_LOGS) return;
  if (random() < 0.5) raise(player, 1);
}

function onFished({ player, itemId }, random = Math.random) {
  const i = Common.items();
  if (!eligible(player) || ![i.RAW_TUNA, i.RAW_LOBSTER, i.RAW_SWORDFISH].includes(itemId)) return;
  if (random() < 0.5) raise(player, 1);
}

module.exports = function registerApproval(api) {
  Common.bind(api);
  api.onCustomEvent("mining:hand-over", handOverCoal);
  api.onCustomEvent("mining:success", onMined);
  api.onCustomEvent("woodcutting:success", onChopped);
  api.onCustomEvent("fishing:success", onFished);
};

module.exports._test = { raise, handOverCoal, onMined, onChopped, onFished };
