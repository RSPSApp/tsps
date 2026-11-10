/**
 * All Settings > Notifications: "Minimum item value needed for Alchemy spells warning" (setting 66,
 * alchemy_warning_valuethreshold, varbit 6091). Clicking it asks "Set value threshold for alchemy
 * warnings:" (script 108; rsprox 338, 3275) and the number answered is saved through "settings:set"
 * and resent at login; a new account starts at 20000 (settings.json, rsprox: 703 of 703 default-state
 * logins). ValueWarnings.plugin.js compares an item's worth against it before an Alchemy cast.
 */
const SETTING_ID = 66;
const FLOATER_CHATBOX_VARBIT = 16075;
const BUSY_VARBIT = 12393;
const MAX_VALUE = 2147483647; // the varbit is 31 bits wide
const PROMPT = "Set value threshold for alchemy warnings:";

function settingClicked(request) {
  if (request.settingId !== SETTING_ID) return;
  request.handled = true;
  const { player } = request;
  const sender = player.getPacketSender();
  sender.sendVarbit(FLOATER_CHATBOX_VARBIT, 1);
  sender.sendVarbit(BUSY_VARBIT, 1);
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute: (amount) => {
      const value = Math.max(0, Math.min(MAX_VALUE, Math.trunc(Number(amount) || 0)));
      pluginApi.emitCustomEvent("settings:set", { player, settingId: SETTING_ID, value });
      sender.sendVarbit(FLOATER_CHATBOX_VARBIT, 0);
      sender.sendVarbit(BUSY_VARBIT, 0);
    },
  });
  sender.sendEnterAmountPrompt(PROMPT);
}

let pluginApi = null;

module.exports = {
  name: "AlchemyWarningThreshold",
  description: "Settings option for the item value above which casting Alchemy asks first.",
  register(api) {
    pluginApi = api;
    api.onCustomEvent("settings:setting-clicked", settingClicked);
  },
  _test: { settingClicked, setApi: (api) => { pluginApi = api; } },
};
