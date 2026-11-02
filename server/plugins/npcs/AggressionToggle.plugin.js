"use strict";

/**
 * ::aggro keeps monsters aggressive towards the player after the ten-minute aggression
 * tolerance (docs/dormant-npcs.md), so a crab coast can be trained without walking away to
 * reset it (issue #1860). Live OSRS has no such option, so it is an administrator's cheat;
 * a world can open it to everyone with "commands:permissions".
 */
const IGNORE_TOLERANCE_ATTRIBUTE = "npc-aggression:ignore-tolerance";

function toggleTolerance({ player }) {
  const ignoring = player.getAttribute(IGNORE_TOLERANCE_ATTRIBUTE) !== true;
  player.setAttribute(IGNORE_TOLERANCE_ATTRIBUTE, ignoring);
  player.sendMessage(ignoring
    ? "Monsters will stay aggressive towards you."
    : "Monsters will grow tolerant of you again after ten minutes.");
  return true;
}

function keepAggressive(event) {
  if (event.override === null && event.player.getAttribute(IGNORE_TOLERANCE_ATTRIBUTE) === true) {
    event.override = true;
  }
}

module.exports = {
  name: "AggressionToggle",
  register(api) {
    api.persistAttribute(IGNORE_TOLERANCE_ATTRIBUTE, false);
    api.registerCommand("aggro", toggleTolerance, api.core.PlayerRights.ADMINISTRATOR,
      "Toggle monsters staying aggressive after ten minutes");
    api.onNpcAggressionTolerance(keepAggressive);
  },
};
