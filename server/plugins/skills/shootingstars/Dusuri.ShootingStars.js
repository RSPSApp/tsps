"use strict";

/**
 * Dusuri, by the Mining Guild (her Wiki transcript is in npc-dialogues.json).
 *
 * Capture: the first conversation is her introduction; on its "If you ever come across one,
 * I'd be happy to trade you for any stardust you find." star_trader_met (11887) goes to 1, which
 * turns her into star_trader_2op with the Trade option. After that she uses the standard
 * transcript. The transcript's conditions ask whether the player has mined a star (star_mined,
 * 11886), carries stardust, and whether the world is a members world.
 */

const Common = require("./Common.ShootingStars");

/** Transcript actions "Dusuri gains a 'Trade' right-click option". */
const GAINS_TRADE_STEPS = new Set(["TUeyGg", "OIVWkR"]);
const INTRODUCTION_VARIANT = "introduction-dialogue";
const STANDARD_VARIANT = "standard-dialogue";

/** star_trader (the spawned multinpc) or the star_trader_1op / _2op it shows as. */
function isDusuri(npcId) {
  const ids = Common.core.NpcIdentifiers;
  return npcId === Common.DATA.npcs.trader || npcId === ids.DUSURI || npcId === ids.DUSURI_2;
}

function onDialogueVariant({ player, npcId }) {
  if (!isDusuri(npcId)) return null;
  return Common.hasMetTrader(player) ? STANDARD_VARIANT : INTRODUCTION_VARIANT;
}

function answerCondition({ player, npcId, text }) {
  if (!isDusuri(npcId)) return null;
  const condition = String(text);
  if (/has not interacted with a shooting star/.test(condition)) return !Common.hasMined(player);
  if (/has interacted with a shooting star/.test(condition)) return Common.hasMined(player);
  const stardust = player.getInventory().getAmount(Common.core.ItemIdentifiers.STARDUST) > 0;
  if (/does not have stardust/.test(condition)) return !stardust;
  if (/has stardust/.test(condition)) return stardust;
  if (/free-to-play world/.test(condition)) return !Common.isMembersWorld();
  if (/members world/.test(condition)) return Common.isMembersWorld();
  return null;
}

function onDialogueAction(request) {
  if (!isDusuri(request.npcId) || !GAINS_TRADE_STEPS.has(request.stepId)) return;
  request.handled = true;
  Common.markTraderMet(request.player);
}

module.exports = function attachDusuri(api) {
  api.onNpcDialogueVariant(onDialogueVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", onDialogueAction);
};

Object.assign(module.exports, { onDialogueVariant, answerCondition, onDialogueAction, isDusuri, GAINS_TRADE_STEPS });
