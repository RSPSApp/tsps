"use strict";

/**
 * The Thermonuclear boss room (see ../ThermonuclearSmokeDevil.plugin.js for behaviour
 * and sources).
 *
 * Wiki: the boss "can be fought with another player" (like the Kraken), so the room is
 * multicombat throughout the Slayer-area box. The boss walks through other
 * monsters/players (Wiki), so the flag is ensured for every boss in the room on every
 * tick - a fresh or respawned boss never gets stuck on the room's smoke devils.
 */
const Common = require("./Common.ThermonuclearSmokeDevil");

/** [minX, minY, maxX, maxY] from the boss room polygon. */
const ROOM = [2351, 9438, 2378, 9461];

/** Wiki: the boss walks through other monsters/players, so it never sticks on them. */
function ensureWalkThrough(npc) {
  npc.setFlag(Common.core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
}

let area = null;

function areaClass() {
  const { Area, Boundary } = Common.core;
  return class ThermonuclearSmokeDevilArea extends Area {
    constructor() {
      super([new Boundary(ROOM[0], ROOM[2], ROOM[1], ROOM[3], 0)]);
    }

    getName() {
      return "Thermonuclear Smoke Devil";
    }

    isMulti() {
      return true;
    }

    process(character) {
      if (character?.isNpc?.() && Common.isBoss(character)) ensureWalkThrough(character);
    }
  };
}

/** Players currently inside the room and alive, for Peek. */
function playersInside() {
  return (area?.getPlayers?.() ?? []).filter((player) => {
    const at = player?.getLocation?.();
    return at && Common.inLair(at) && (player.getHitpoints?.() ?? 1) > 0;
  });
}

function attach(api) {
  area = new (areaClass())();
  api.registerArea(area);
}

module.exports = { attach, areaClass, ensureWalkThrough, playersInside, ROOM };
