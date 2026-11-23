"use strict";

/**
 * Edgeville's Streak info noticeboard (target_noticeboard, loc 37434): Read opens the target
 * streaks board (target_streaks, 648). The Wiki: it shows "the player's Target World streaks",
 * the current and the best, "broken down between Hunter kills and Rogue kills".
 *
 * rsprox 232/03212 t2261-t2265: the player walks up to the board at (3096, 3506, 0); two ticks
 * after arriving the server runs toplevel_mainmodal_open (2524, -1, -1), opens target_streaks as
 * the main modal and writes both columns as "<col=ffb83f>current</col><br>best", 0 and 0 for that
 * player. No busy varbit or message goes with it; closing it is a plain if_closesub.
 *
 * Target Worlds were removed in May 2023 (Wiki, Bounty Hunter), and this server never had them,
 * so nobody here can have a streak: both columns always read 0, as recorded.
 */

const INTERFACE_NAME = "target_streaks";
/** Client script toplevel_mainmodal_open, sent before the modal as recorded. */
const SCRIPT_MAINMODAL_OPEN = 2524;
/** Current streak (orange), then the best streak. */
const STREAK_TEXT = "<col=ffb83f>0</col><br>0";

let cache = null;

function read(event) {
  const sender = event.player.getPacketSender();
  sender.sendClientScript(SCRIPT_MAINMODAL_OPEN, -1, -1);
  sender.sendInterface(cache.getInterfaceId(INTERFACE_NAME));
  sender.sendString(STREAK_TEXT, cache.getComponentId(`${INTERFACE_NAME}:hunter`));
  sender.sendString(STREAK_TEXT, cache.getComponentId(`${INTERFACE_NAME}:rogue`));
  return true;
}

module.exports = {
  name: "StreakInfo",
  description: "Reading Edgeville's Streak info noticeboard opens the Target World streaks board, with no hunter or rogue streak as there are no Target Worlds.",
  register(api) {
    cache = api.core.CacheDefinitions;
    api.onObjectInteraction("Streak info", { Read: read });
  },
  read, STREAK_TEXT,
};
