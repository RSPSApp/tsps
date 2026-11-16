"use strict";

/**
 * Entrana's ground floor (https://oldschool.runescape.wiki/w/Entrana), where the monks refuse caskets,
 * lockboxes, supply crates and the like. Shared by every plugin that asks "is the player on Entrana?".
 */
const ENTRANA = Object.freeze({ minX: 2800, maxX: 2879, minY: 3320, maxY: 3391, z: 0 });

function onEntrana(player) {
  const at = player?.getLocation?.();
  return at != null && at.getZ() === ENTRANA.z && at.getX() >= ENTRANA.minX && at.getX() <= ENTRANA.maxX
    && at.getY() >= ENTRANA.minY && at.getY() <= ENTRANA.maxY;
}

module.exports = { ENTRANA, onEntrana };
