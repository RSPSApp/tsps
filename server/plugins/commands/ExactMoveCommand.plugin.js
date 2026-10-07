"use strict";

/**
 * ::exactmove [npcId] [tiles] [laps] [snap] - tries NPC exact moves (npc.exactMove).
 *
 * Spawns an NPC (the burrowed Doom of Mokhaiotl, 5x5, by default) three tiles north of you and
 * moves it `tiles` tiles a tick (4, as the Doom's zooms) through all eight directions, `laps`
 * times, then removes it. Each hop is a glide; with `snap` it is a plain teleport instead, to
 * compare. Each pair of hops goes out and back, so the NPC ends where it started.
 */

const DEFAULT_NPC = 14709;
const DEFAULT_TILES = 4;
const DEFAULT_LAPS = 1;
const MAX_TILES = 10;
const MAX_LAPS = 5;
/** Out and back in each direction: east, north, north-east, north-west. */
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [-1, 1]];

let pluginApi;

function argument(parts, index, fallback, max) {
  const value = Number.parseInt(parts?.[index], 10);
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

/** The hops: for each direction, out `tiles` and back. */
function hops(tiles, laps) {
  const list = [];
  for (let lap = 0; lap < laps; lap++) {
    for (const [dx, dy] of DIRECTIONS) {
      list.push([dx * tiles, dy * tiles], [-dx * tiles, -dy * tiles]);
    }
  }
  return list;
}

function exactMove({ player, parts }) {
  const { Location, Task, TaskManager } = pluginApi.core;
  const npcId = argument(parts, 1, DEFAULT_NPC, 0x3fff);
  const tiles = argument(parts, 2, DEFAULT_TILES, MAX_TILES);
  const laps = argument(parts, 3, DEFAULT_LAPS, MAX_LAPS);
  const snap = parts?.includes("snap");
  const at = player.getLocation();
  const npc = pluginApi.spawnNpc({ id: npcId, x: at.getX(), y: at.getY() + 3, z: at.getZ(), wanderRadius: 0 });
  if (!npc) {
    player.sendMessage(`Couldn't spawn NPC ${npcId}.`);
    return true;
  }
  npc.__skipDefaultRespawn = true;
  npc.setFlag?.("combat:no-retaliate");
  npc.getMovementQueue().setBlockMovement(true);
  const queue = hops(tiles, laps);
  player.sendMessage(`${snap ? "Teleporting" : "Gliding"} NPC ${npcId} ${tiles} tiles a tick, ${queue.length} hops.`);
  // A tick to appear, one hop a tick, then two ticks to look at it before it goes.
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, npc, false);
    }

    execute() {
      tick++;
      if (!npc.isRegistered?.()) {
        this.stop();
        return;
      }
      const hop = queue[tick - 2];
      if (hop) {
        const from = npc.getLocation();
        const destination = new Location(from.getX() + hop[0], from.getY() + hop[1], from.getZ());
        if (snap) npc.moveTo(destination);
        else npc.exactMove(destination);
        return;
      }
      if (tick >= queue.length + 4) {
        pluginApi.removeNpc(npc);
        this.stop();
      }
    }
  })());
  return true;
}

module.exports = {
  name: "ExactMoveCommand",
  register(api) {
    pluginApi = api;
    api.registerCommand("exactmove", exactMove, api.core.PlayerRights.DEVELOPER, "Test NPC exact movement");
  },
};

module.exports.exactMove = exactMove;
module.exports.hops = hops;
