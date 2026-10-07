"use strict";

/**
 * Corporeal Beast: shared ids, tiles and small helpers.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Corporeal_Beast
 * docs/corporeal-beast.md records the live capture these ids and tiles come from.
 */

const state = { api: null, core: null };

function bind(api) {
  state.api = api;
  state.core = api.core;
}

function core() {
  return state.core;
}

function api() {
  return state.api;
}

const NPC = {
  CORP: 319,
  DARK_CORE: 320,
};

const OBJECT = {
  /** In the Wilderness, north-east of Ferox Enclave (cache: 3201, 3679). */
  CAVE: 678,
  /** The lobby's way back out (cache: 2963, 4382). */
  CAVE_EXIT: 679,
  /** Between the lobby and the Beast's room (capture and cache: 2971, 4382; 3 tiles wide). */
  PASSAGE: 677,
};

/**
 * The lair exists twice in the map, 128 tiles apart: the room everyone uses and the one for
 * ironmen of combat level 90+ (Wiki: Corporeal Beast, Location). The capture (games necklace,
 * Corp at 2994 4381) was taken in the northern copy; which room an account goes to is set in
 * ROOMS below. Tiles here are for the northern copy and shifted by `dy`.
 */
const ROOMS = {
  normal: { dy: -128 },
  ironman: { dy: 0 },
};
/** Where the games necklace lands you (capture) and the cave puts you (Offline_Scape). */
const LOBBY = { x: 2966, y: 4380, z: 2 };
const CAVE_ARRIVAL = { x: 2964, y: 4382, z: 2 };
/** The Wilderness side of the cave (Offline_Scape). */
const OUTSIDE = { x: 3206, y: 3681, z: 0 };
/** The Beast's room: everything east of the passage (cache collision), in both copies. */
const ROOM_AREAS = Object.values(ROOMS).map(({ dy }) => ({ minX: 2974, maxX: 3007, minY: 4352 + dy, maxY: 4415 + dy, levels: [2] }));

function shifted(tile, room = "normal") {
  return { ...tile, y: tile.y + ROOMS[room].dy };
}

/** The Corp overlay (interface 13) and the damage it shows (varbit 999, script 693). */
const INTERFACE = { OVERLAY: 13 };
const VARBIT = { DAMAGE: 999 };
const OVERLAY_HUD_UID = (161 << 16) | 8;

function loc({ x, y, z = 0 }) {
  return new (core().Location)(x, y, z);
}

function inRoom(location) {
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === 2 && ROOM_AREAS.some((room) => x >= room.minX && x <= room.maxX && y >= room.minY && y <= room.maxY);
}

function later(key, ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(0, ticks), key, ticks <= 0);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  TaskManager.submit(task);
  return task;
}

function repeat(key, ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), key, false);
    }
    execute() {
      if (action() === false) this.stop();
    }
  })();
  TaskManager.submit(task);
  return task;
}

function randomInclusive(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** The players in the same copy of the room as `npc` (the copies are 128 tiles apart). */
function playersNear(npc) {
  const { World } = core();
  const y = npc.getLocation().getY();
  const players = [];
  World.getPlayers().forEach((player) => {
    if (!player || player.getHitpoints?.() <= 0) return;
    const at = player.getLocation();
    if (inRoom(at) && Math.abs(at.getY() - y) < 64) players.push(player);
  });
  return players;
}

/** A graphic on a tile, for everyone in that copy of the room. */
function tileGraphic(players, id, tile, delay = 0, height = 0) {
  const { Graphic } = core();
  const graphic = Object.assign(new Graphic(id), { delay, height });
  for (const player of players) player.getPacketSender().sendGraphic(graphic, loc(tile));
}

/** A graphic on a tile, for everyone in that copy of the room. */

function options(player, title, ...pairs) {
  const args = [];
  for (let i = 0; i < pairs.length; i += 2) args.push(pairs[i], pairs[i + 1] ?? (() => {}));
  api().sendMultiChatboxPrompt(player, title, ...args);
}

module.exports = {
  bind, core, api,
  NPC, OBJECT, ROOMS, LOBBY, CAVE_ARRIVAL, OUTSIDE, ROOM_AREAS, INTERFACE, VARBIT, OVERLAY_HUD_UID,
  loc, shifted, inRoom, later, repeat, randomInclusive, playersNear, tileGraphic, options,
};
