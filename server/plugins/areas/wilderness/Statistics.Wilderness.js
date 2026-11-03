"use strict";

// OSRS Wiki: Wilderness Statistics; Jagex's 13 March 2014 patch notes count player kills/PK deaths.
// Cache 241: kd_toggle (1105:0), kdr_transmit_kills (1320), kdr_transmit_deaths (718).
const SHOW_KD_ATTRIBUTE = "wilderness-statistics:show-kd";
const KILLS_ATTRIBUTE = "wilderness-statistics:kills";
const DEATHS_ATTRIBUTE = "wilderness-statistics:deaths";
const SHOW_KD_VARBIT = 4143;
const KILLS_VARBIT = 8376;
const DEATHS_VARBIT = 8375;
const MAX_COUNT = 0x7fffffff;
let Wilderness;
let inWilderness;

function sync({ player }) {
  const sender = player.getPacketSender();
  sender.sendVarbit(KILLS_VARBIT, player.getAttribute(KILLS_ATTRIBUTE) ?? 0);
  sender.sendVarbit(DEATHS_VARBIT, player.getAttribute(DEATHS_ATTRIBUTE) ?? 0);
  sender.sendVarbit(SHOW_KD_VARBIT, player.getAttribute(SHOW_KD_ATTRIBUTE) === true ? 1 : 0);
}

function toggle({ player }) {
  player.setAttribute(SHOW_KD_ATTRIBUTE, player.getAttribute(SHOW_KD_ATTRIBUTE) !== true);
  sync({ player });
  return true;
}

function human(player) {
  return player?.isPlayer?.() === true && player.isPlayerBot() !== true;
}

function recordDefeat({ killer, victim }) {
  if (killer === victim || !human(killer) || !human(victim)) return;
  // The defeat hook runs before respawn. A killer may already have teleported away.
  const at = victim.getLocation();
  if (Wilderness.levelAt(at.getX(), at.getY()) <= 0 || !inWilderness(victim)) return;
  killer.setAttribute(KILLS_ATTRIBUTE, Math.min(MAX_COUNT, (killer.getAttribute(KILLS_ATTRIBUTE) ?? 0) + 1));
  victim.setAttribute(DEATHS_ATTRIBUTE, Math.min(MAX_COUNT, (victim.getAttribute(DEATHS_ATTRIBUTE) ?? 0) + 1));
  sync({ player: killer });
  sync({ player: victim });
}

module.exports = function attachWildernessStatistics(api, isInWilderness) {
  Wilderness = api.core.Wilderness;
  inWilderness = isInWilderness;
  api.persistAttribute(SHOW_KD_ATTRIBUTE, false);
  api.persistAttribute(KILLS_ATTRIBUTE, 0);
  api.persistAttribute(DEATHS_ATTRIBUTE, 0);
  api.onObjectInteraction("Wilderness Statistics", { "Toggle K/D": toggle });
  api.onPlayerLogin(sync);
  api.onPlayerDefeated(recordDefeat);
};
