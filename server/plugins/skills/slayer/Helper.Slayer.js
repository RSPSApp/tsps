"use strict";

/**
 * The Slayer helper ("Slayer Info"): the cache's helper_generic overlay, drawn by its own
 * scripts from the task varps (slayer_count, slayer_target, ...). rsprox captures (rev 242,
 * recordings 1002084 t127, 1002067 t185/t686/t789, 1001683, 1001788):
 * - it opens when the enchanted gem's Check is clicked, when a master assigns a task, and on a
 *   task kill, each time only if it isn't already showing (current_helper is 0);
 * - opening sets current_helper to 3, mounts helper_generic (711) as an overlay on
 *   toplevel_osrs_stretch:helper_content and runs helper_setup [that component, 3, 148, 308]
 *   then helper_slayer_init;
 * - it closes 501 ticks after it opened, whatever was killed in between (current_helper back
 *   to 0, then the overlay closes); completing the task doesn't close it.
 * The Settings interface's "Slayer helper" toggle (varbit slayer_helper_disabled) keeps it shut.
 */
const State = require("./State.Slayer");

const SLAYER_HELPER = 3;
const SETUP_SCRIPT = 4689; // helper_setup
const INIT_SCRIPT = 5317; // helper_slayer_init
const SETUP_KIND = 3;
const SETUP_WIDTH = 148;
const SETUP_HEIGHT = 308;
const SHOWN_TICKS = 501;

let api = null;
let ids = null;
/** player -> the open helper's token, so a close only ends the helper it was scheduled for. */
const opened = new WeakMap();

function cacheIds() {
  if (ids) return ids;
  const defs = api.core.CacheDefinitions;
  ids = {
    content: defs.getComponentId("toplevel_osrs_stretch:helper_content") ?? ((161 << 16) | 12),
    overlay: defs.getInterfaceId("helper_generic") ?? 711,
  };
  return ids;
}

function isOpen(player) {
  return State.varbit(player, "current_helper") === SLAYER_HELPER;
}

function open(player) {
  if (!player?.isPlayer?.() || player.isPlayerBot?.() === true) return false;
  if (isOpen(player) || State.varbit(player, "slayer_helper_disabled") === 1) return false;
  const { content, overlay } = cacheIds();
  const sender = player.getPacketSender();
  sender.sendVarbit(api.core.CacheDefinitions.getVarbitId("current_helper"), SLAYER_HELPER);
  sender.sendSubInterface(content, overlay, 1);
  sender.sendClientScript(SETUP_SCRIPT, content, SETUP_KIND, SETUP_WIDTH, SETUP_HEIGHT);
  sender.sendClientScript(INIT_SCRIPT);
  const token = {};
  opened.set(player, token);
  api.core.TaskManager.submit(new api.core.CountdownTask(player, SHOWN_TICKS, () => {
    if (opened.get(player) === token) close(player);
  }));
  return true;
}

function close(player) {
  opened.delete(player);
  if (!isOpen(player)) return;
  const sender = player.getPacketSender();
  sender.sendVarbit(api.core.CacheDefinitions.getVarbitId("current_helper"), 0);
  sender.closeSubInterface(cacheIds().content);
}

function taskKill(kill) {
  if (kill?.offTask) return;
  open(kill?.player);
}

function attach(pluginApi) {
  api = pluginApi;
  api.onCustomEvent("slayer:task-assigned", ({ player }) => open(player));
  api.onCustomEvent("slayer:task-kill", taskKill);
}

module.exports = { init: (pluginApi) => { api = pluginApi; }, attach, open, close, isOpen, SHOWN_TICKS };
