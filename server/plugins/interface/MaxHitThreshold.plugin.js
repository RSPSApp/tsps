/**
 * Settings > Advanced Display Settings: "Max hit hitsplats threshold" (setting 280, cache struct
 * 347). Like the run-energy threshold (RunAutoEnable) the row asks for a number: the answer becomes
 * settings_hitsplat_threshold (varbit 14195, nine bits). PlayerSession sends a max hit's splat only
 * for hits of at least this much; the "Max hit hitsplats" toggle (setting 279) is the client's.
 */
const SETTING_ID = 280;
const THRESHOLD_VARBIT = 14195;
const FLOATER_CHATBOX_VARBIT = 16075;
const BUSY_VARBIT = 12393;
const MAX_THRESHOLD = 511;
const PROMPT = "Enter the lowest max hit to show a max hit hitsplat for:";
const THRESHOLD_ATTRIBUTE = "settings.max-hit-hitsplat-threshold";

function setThreshold(player, value) {
  const clamped = Math.max(0, Math.min(MAX_THRESHOLD, Math.trunc(Number(value) || 0)));
  player.setAttribute(THRESHOLD_ATTRIBUTE, clamped);
  player.getPacketSender().sendVarbit(THRESHOLD_VARBIT, clamped);
}

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
      setThreshold(player, amount);
      sender.sendVarbit(FLOATER_CHATBOX_VARBIT, 0);
      sender.sendVarbit(BUSY_VARBIT, 0);
    },
  });
  sender.sendEnterAmountPrompt(PROMPT);
}

function restore({ player }) {
  const value = Number(player.getAttribute(THRESHOLD_ATTRIBUTE)) || 0;
  if (value > 0) player.getPacketSender().sendVarbit(THRESHOLD_VARBIT, value);
}

module.exports = {
  name: "MaxHitThreshold",
  description: "Settings option for the lowest damage that shows a max hit hitsplat.",
  register(api) {
    api.persistAttribute(THRESHOLD_ATTRIBUTE);
    api.onCustomEvent("settings:setting-clicked", settingClicked);
    api.onPlayerLogin(restore);
  },
  _test: { settingClicked, restore },
};
