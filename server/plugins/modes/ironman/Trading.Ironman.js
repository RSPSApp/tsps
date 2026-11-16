/**
 * No trading with other players, either way (captured): the Ironman asking is told "You are an
 * Ironman. You stand alone."; anyone asking an Ironman is told "<name> is an Ironman. He/She
 * stands alone." (or "They stand alone.", by the Ironman's pronouns).
 *
 * A Group Ironman trades freely with the members of their group, leavers in their seven days
 * included (Wiki, Group Ironman Mode); anyone else asking one is told "<name> is a Group Ironman.
 * He/She/They can only trade members of their group." (Wiki), and the Group Ironman asking someone
 * else "You are a Group Ironman. You can only trade members of your group." (ours).
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

/** Sends the refusal for whichever side is an Ironman; true when one was refused. */
function refuse(player, target) {
  if (Common.groupMate(player, target)) return false;
  if (Common.isIron(player)) {
    player.sendMessage(Common.message(Common.isGroup(player) ? "tradeGroupSelf" : "tradeSelf"));
    return true;
  }
  if (Common.isIron(target)) {
    const [pronoun, stands] = TRADE_PRONOUNS[pronouns(target)];
    const key = Common.isGroup(target) ? "tradeGroupOther" : "tradeOther";
    player.sendMessage(Common.message(key, { name: target.getDisplayName(), pronoun, stands }));
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
