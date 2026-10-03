/**
 * Warriors' Guild: Ghommal's door. Only a combined base Attack and Strength of 130, or 99 in
 * either, gets in (Wiki); boosts don't count. Leaving is always allowed.
 */
const Guild = require("./Common.WarriorsGuild");

/** The front door sits on the west edge of the tile outside it. */
const DOOR = { x: 2877, y: 3546, z: 0 };
const INSIDE = [2876, 3546];
const OUTSIDE = [2877, 3546];
const COMBINED_LEVEL = 130;
const MAX_LEVEL = 99;

function qualifies(player) {
  const { Skill } = Guild.core;
  const attack = Guild.baseLevel(player, Skill.ATTACK);
  const strength = Guild.baseLevel(player, Skill.STRENGTH);
  return attack >= MAX_LEVEL || strength >= MAX_LEVEL || attack + strength >= COMBINED_LEVEL;
}

function useDoor({ player, object, location }) {
  if (location.x !== DOOR.x || location.y !== DOOR.y || location.z !== DOOR.z) return false;
  const entering = player.getLocation().getX() >= OUTSIDE[0];
  if (entering && !qualifies(player)) {
    // ponytail: no Wiki transcript covers the refusal at the door; these are Near-Reality's lines.
    Guild.npcSays(player, Guild.NPCS.GHOMMAL,
      "Adventurer, stop! You may not enter this guild yet.",
      "You need either level 99 in Attack or Strength, or a combination of both of at least 130 to enter the Warriors' guild.");
    return true;
  }
  const [x, y] = entering ? INSIDE : OUTSIDE;
  Guild.crossDoor(player, object, Guild.tile(x, y, 0));
  return true;
}

function ghommalCondition({ player, npcId, text }) {
  if (npcId !== Guild.NPCS.GHOMMAL) return null;
  if (text === "If the player meets the requirements to enter the Warrior's Guild:") return qualifies(player);
  if (text === "If the player does not meet the requirements to enter the Warrior's Guild:") return !qualifies(player);
  return null;
}

module.exports = function attachEntrance(api) {
  api.onObjectInteraction("Door", { Open: useDoor });
  api.onNpcDialogueCondition(ghommalCondition);
};
module.exports.qualifies = qualifies;
