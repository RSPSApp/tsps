/**
 * A boss's kill-count line ("Your Zulrah kill count is: N."), sent through one place so it follows
 * All Settings' "Filter out boss kill-count with spam-filter" (boss_killcount_filtered): with it on
 * the line goes to the spam channel, which the chatbox's Game filter hides; with it off it is an
 * ordinary game message.
 *
 *   const { sendBossKillCount } = require("<path>/interface/BossKillCount.plugin");
 *   sendBossKillCount(player, `Your Zulrah kill count is: <col=ff0000>${kills}</col>.`);
 */
const FILTERED_VARBIT = 4930;

let spamChatType = null;

function sendBossKillCount(player, message) {
  const sender = player.getPacketSender?.();
  if (spamChatType !== null && sender?.getVarbit?.(FILTERED_VARBIT) === 1) sender.sendTypedMessage(spamChatType, message);
  else player.sendMessage(message);
}

function initialize(core) {
  spamChatType = core.ChatType.SPAM;
}

module.exports = {
  name: "BossKillCount",
  description: "Sends boss kill-count lines as filterable spam when the player's All Settings row asks for it.",
  sendBossKillCount,
  FILTERED_VARBIT,
  register(api) {
    initialize(api.core);
  },
};
