"use strict";

/**
 * The Dagannoth Kings' lairs (see ../DagannothKings.plugin.js for behaviour and
 * sources). Both the public lair and the Slayer-task lair are multicombat (Wiki:
 * handling multicombat is core to the fight).
 *
 * Wiki (Strategies): Rex aggros within 5 tiles of his south-western tile, Prime and
 * Supreme within 7. The engine otherwise aggros by attack range, so the area enforces
 * the captured ranges here. Wiki (each king): none of them become tolerant.
 */
const Common = require("./Common.DagannothKings");
const Hud = require("./Hud.DagannothKings");

function areaClass() {
  const { Area, Boundary } = Common.core;
  return class DagannothKingsArea extends Area {
    constructor() {
      // Bounds live in the data file (Common.PUBLIC_LAIR / Common.TASK_LAIR).
      const publicLair = Common.PUBLIC_LAIR;
      const taskLair = Common.TASK_LAIR;
      super([
        new Boundary(publicLair.minX, publicLair.maxX, publicLair.minY, publicLair.maxY, 0),
        new Boundary(taskLair.minX, taskLair.maxX, taskLair.minY, taskLair.maxY, 0),
      ]);
    }

    getName() {
      return "Dagannoth Kings";
    }

    isMulti() {
      return true;
    }

    postLeave(character) {
      if (character?.isPlayer?.()) Hud.hideForLeaver(character);
    }

    npcAggression(player, npc) {
      if (!Common.isKing(npc)) return null;
      const range = Common.AGGRO_TILES[npc.getId?.()];
      if (!Number.isInteger(range)) return null;
      return Common.tileDistance(npc.getLocation(), player.getLocation()) <= range;
    }

    npcAggressionTolerance(player, npc) {
      if (!Common.isKing(npc)) return null;
      void player;
      return true;
    }
  };
}

let area = null;

/** Players currently inside the public lair and alive, for Peek. */
function playersInside() {
  const bounds = Common.DATA.lairs.public.bounds;
  return (area?.getPlayers?.() ?? []).filter((player) => {
    const at = player?.getLocation?.();
    return at && Common.within(bounds, at) && (player.getHitpoints?.() ?? 1) > 0;
  });
}

function attach(api) {
  area = new (areaClass())();
  api.registerArea(area);
}

module.exports = { attach, areaClass, playersInside };
