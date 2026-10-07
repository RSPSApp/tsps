"use strict";

/**
 * The game's date_minutes varp (3078): whole minutes since 1970, as OSRS sends it on login and
 * each new minute. Cache scripts compare it with the minute of the last home (892) and minigame
 * (888) teleport to show their cooldowns.
 */

const { dateMinutes } = require("../combat/HomeTeleportSequence");

const DATE_MINUTES_VARP = 3078;
const lastSent = new WeakMap();

function sendDateMinutes({ player }) {
  const minute = dateMinutes();
  if (lastSent.get(player) === minute) return;
  lastSent.set(player, minute);
  player.getPacketSender().sendConfig(DATE_MINUTES_VARP, minute);
}

module.exports = {
  name: "DateMinutes",
  register(api) {
    api.onPlayerLogin(sendDateMinutes);
    api.onPlayerProcess(sendDateMinutes);
  },
};
