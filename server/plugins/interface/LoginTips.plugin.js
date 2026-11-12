/**
 * "Did you know?" tips: one at random right after the login greeting, unless the player turned
 * off the "'Did you know?' tips" setting (row 433). The chatbox colours them by rows 434 and 435.
 */
const { tips: TIPS } = require("./data/login-tips.json");

const DID_YOU_KNOW_CHAT_TYPE = 117;
const DID_YOU_KNOW_DISABLED_VARBIT = 16235; // settings_didyouknow_disabled
const SETTINGS_VALUES_ATTRIBUTE = "settings:values";

/** The saved setting: the greeting can come before Settings sends it back at login. */
function tipsDisabled(player) {
  const saved = player.getAttribute(SETTINGS_VALUES_ATTRIBUTE);
  const key = `varbit:${DID_YOU_KNOW_DISABLED_VARBIT}`;
  if (saved && typeof saved === "object" && Number.isInteger(saved[key])) return saved[key] === 1;
  return player.getPacketSender().getVarbit(DID_YOU_KNOW_DISABLED_VARBIT) === 1;
}

function sendTip({ player }, random = Math.random) {
  if (!player || player.isPlayerBot?.() === true || tipsDisabled(player)) return;
  const tip = TIPS[Math.floor(random() * TIPS.length)];
  player.getPacketSender().sendTypedMessage(DID_YOU_KNOW_CHAT_TYPE, tip);
}

module.exports = {
  name: "LoginTips",
  description: "Sends a 'Did you know?' tip after the login greeting, following the All Settings row that turns them off.",
  TIPS,
  sendTip,
  register(api) {
    api.onCustomEvent("welcome-screen:greeted", sendTip);
  },
};
