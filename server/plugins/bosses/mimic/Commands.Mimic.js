"use strict";

/**
 * Developer commands for the Mimic fight (see ../Mimic.plugin.js for sources).
 * Mirrors other bosses' Commands units (zulrahkill, corpkill, yamakill).
 */

const Shared = require("./Shared.Mimic");
const Lair = require("./Lair.Mimic");

/** Kill the player's own Mimic: its death, drops and minion cleanup run for real. */
function mimicKill({ player }) {
  const area = player.getPrivateArea?.() ?? player.getArea?.();
  const session = area ? Lair.sessionOf(area) : null;
  if (!session?.boss || !Shared.alive(session.boss)) {
    player.sendMessage("You don't have a living Mimic.");
    return;
  }
  session.boss.setHitpoints(0);
}

function attach(api) {
  api.registerCommand("mimickill", mimicKill, api.core.PlayerRights.DEVELOPER, "Kill your Mimic");
}

module.exports = { attach, mimicKill };
