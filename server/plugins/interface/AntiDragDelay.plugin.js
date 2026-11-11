/**
 * All Settings > Controls: "Anti Drag - Delay" (setting 236, a number row). Its varbit (13830,
 * eight bits) holds the delay in steps of 20 ms, so the answer is rounded to the nearest 20 ms
 * and capped at 5000 ms, as the row's description says. It is saved through "settings:set" and
 * resent at login; the cache's Anti Drag scripts read it in the client.
 * Ours: the prompt's wording (no capture of it).
 */
const SETTING_ID = 236;
const STEP_MS = 20;
const MAX_MS = 5000;
const PROMPT = "Enter the Anti Drag delay in milliseconds (max 5000):";
const FLOATER_CHATBOX_VARBIT = 16075;
const BUSY_VARBIT = 12393;

let pluginApi = null;

/** The varbit's value for an answer in milliseconds. */
function delaySteps(ms) {
  const clamped = Math.max(0, Math.min(MAX_MS, Math.trunc(Number(ms) || 0)));
  return Math.round(clamped / STEP_MS);
}

function settingClicked(request) {
  if (request.handled || request.settingId !== SETTING_ID) return;
  request.handled = true;
  const { player } = request;
  const sender = player.getPacketSender();
  sender.sendVarbit(FLOATER_CHATBOX_VARBIT, 1);
  sender.sendVarbit(BUSY_VARBIT, 1);
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute: (amount) => {
      pluginApi.emitCustomEvent("settings:set", { player, settingId: SETTING_ID, value: delaySteps(amount) });
      sender.sendVarbit(FLOATER_CHATBOX_VARBIT, 0);
      sender.sendVarbit(BUSY_VARBIT, 0);
    },
  });
  sender.sendEnterAmountPrompt(PROMPT);
}

module.exports = {
  name: "AntiDragDelay",
  description: "Settings option for the Anti Drag delay, asked as a number of milliseconds.",
  register(api) {
    pluginApi = api;
    api.onCustomEvent("settings:setting-clicked", settingClicked);
  },
  _test: { settingClicked, delaySteps, setApi: (api) => { pluginApi = api; } },
};
