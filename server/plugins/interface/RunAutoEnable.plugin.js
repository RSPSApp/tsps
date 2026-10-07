/**
 * Settings > Controls: "Energy threshold to re-enable running" (setting 389). As captured:
 * - clicking the setting sets floater_chatbox_opened (16075) and busy, and asks "Set energy
 *   threshold for auto-enabling run mode:" (script 108); the number answered becomes
 *   runenergy_autoenable (11031), 0 meaning "Do not enable";
 * - once run has switched itself off at 0 energy and the player walks on, run switches back on
 *   (option_run 173 = 1) the tick energy has recovered to the threshold - no message, and the
 *   walk carries on as a run.
 * Only run that ran out counts ("After your run energy has naturally depleted"): turning run off
 * by hand is never overridden, and turning it back on by hand clears the wait.
 */
const SETTING_ID = 389;
const THRESHOLD_VARBIT = 11031;
const FLOATER_CHATBOX_VARBIT = 16075;
const BUSY_VARBIT = 12393;
const OPTION_RUN_VARP = 173;
const MAX_THRESHOLD = 100;
const PROMPT = "Set energy threshold for auto-enabling run mode:";
const THRESHOLD_ATTRIBUTE = "settings.run-auto-enable";

/**
 * Recovery adds at most 1% a tick, and on the tick run runs out it often already has: the player
 * stopped running, so the same tick's restore adds 1% straight after the drain to 0.
 */
const RAN_OUT_AT_MOST = 1;

/** Per player: was running last tick, and has run run out (and not been turned on since)? */
const state = new WeakMap();

const threshold = (player) => Number(player.getAttribute(THRESHOLD_ATTRIBUTE)) || 0;

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
  const value = threshold(player);
  if (value > 0) player.getPacketSender().sendVarbit(THRESHOLD_VARBIT, value);
}

/** Each tick, after energy has been restored. */
function process({ player }) {
  if (player.isPlayerBot?.() === true) return;
  const running = player.isRunningReturn();
  const energy = player.getRunEnergy();
  const was = state.get(player) ?? { running, depleted: false };
  let depleted = was.depleted;
  if (running) depleted = false;
  else if (was.running && energy <= RAN_OUT_AT_MOST) depleted = true;
  const limit = threshold(player);
  if (depleted && !running && limit > 0 && energy >= limit) {
    player.setRunning(true);
    player.getPacketSender().sendConfig(OPTION_RUN_VARP, 1);
    player.getPacketSender().sendRunStatus();
    state.set(player, { running: true, depleted: false });
    return;
  }
  state.set(player, { running, depleted });
}

module.exports = {
  name: "RunAutoEnable",
  register(api) {
    api.persistAttribute(THRESHOLD_ATTRIBUTE);
    api.onCustomEvent("settings:setting-clicked", settingClicked);
    api.onPlayerLogin(restore);
    api.onPlayerProcess(process);
  },
  _test: { settingClicked, process, restore, setThreshold, state },
};
