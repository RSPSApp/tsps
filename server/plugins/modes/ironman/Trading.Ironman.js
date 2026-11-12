/**
 * No trading with other players, either way (captured): the Ironman asking is told "You are an
 * Ironman. You stand alone."; anyone asking an Ironman is told "<name> is an Ironman. He/She
 * stands alone." (or "They stand alone.", by the Ironman's pronouns).
 *
 * The request hook answers the normal trade-request packet. The window hook is the backstop
 * for every other route into a trade (a mode set while a trade is open, content that starts
 * one directly), so no path can complete a trade involving an Ironman.
 */
const Common = require("./Common.Ironman");

/** By the appearance's pronouns (0 he, 1 she, 2 they). */
const TRADE_PRONOUNS = [["He", "stands"], ["She", "stands"], ["They", "stand"]];

function pronouns(player) {
  const appearance = player.getAppearance?.();
  const value = appearance?.getPronouns?.() ?? (appearance?.isMale?.() === false ? 1 : 0);
  return TRADE_PRONOUNS[value] ? value : 0;
}

/** Sends the captured refusal for whichever side is an Ironman; true when one was refused. */
function refuse(player, target) {
  if (Common.isIron(player)) {
    player.sendMessage(Common.message("tradeSelf"));
    return true;
  }
  if (Common.isIron(target)) {
    const [pronoun, stands] = TRADE_PRONOUNS[pronouns(target)];
    player.sendMessage(Common.message("tradeOther", { name: target.getDisplayName(), pronoun, stands }));
    return true;
  }
  return false;
}

function canTrade(event) {
  if (refuse(event.player, event.target)) event.allow = false;
}

function tradeRequest(event) {
  if (refuse(event.player, event.target)) event.handled = true;
}

module.exports = function attach(api) {
  api.onCanTrade(canTrade);
  api.onTradeRequest(tradeRequest);
};
