"use strict";

/**
 * Rogues' Den: what every unit shares - the plugin api, the cache's own object placements, the
 * tile indexes built from them, and the small helpers (levels, messages, items, timing).
 *
 * The maze is the real Burthorpe map (region 11854-11855/12110-12111, plane 1); nothing here
 * re-places terrain or walls. The traps, blades, ledges, doors and safes are read from
 * MapObjects once, so their ids and tiles are the cache's, not a hand-written list.
 */
const fs = require("fs");
const path = require("path");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "rogues-den.json"), "utf8"));

/** Rotation -> the tile a wall decoration faces: 0 south, 1 west, 2 north, 3 east. */
const FACING = [[0, -1], [-1, 0], [0, 1], [1, 0]];

let api = null;
let core = null;
let scanned = false;

const ids = DATA.ids.objects;
const itemIds = DATA.ids.items;
const npcIds = DATA.ids.npcs;

const objectsById = new Map();
const objectsByTile = new Map();
const floorTraps = new Map();
const wallTraps = new Map();
const wallTrapObjects = new Map();
const spinningTiles = new Set();
const pendulumTiles = new Set();
const floorBladeTiles = new Set();
const wallBlades = new Map();
const wallSaws = new Map();
const ledges = new Map();
const grills = new Map();
const passageways = new Map();
const doors = new Map();
const mazeSafes = [];
const lobbySafes = [];
const chests = [];

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

const tileKey = (x, y, z) => `${x},${y},${z}`;
const keyOf = (location) => tileKey(location.getX(), location.getY(), location.getZ());

function walkable(x, y, z) {
  const region = core.RegionManager.getRegion(x, y);
  return region != null && region.getClip(x, y, z) === 0;
}

function inBounds(location) {
  const b = DATA.bounds.maze;
  return location.getZ() === b.z
    && location.getX() >= b.minX && location.getX() <= b.maxX
    && location.getY() >= b.minY && location.getY() <= b.maxY;
}

function inMaze(location) {
  // The doorway itself is at y=4991; the maze starts one tile further south.
  return inBounds(location) && location.getY() >= 4992;
}

function inLobby(location) {
  const b = DATA.bounds.lobby;
  return location.getZ() === b.z
    && location.getX() >= b.minX && location.getX() <= b.maxX
    && location.getY() >= b.minY && location.getY() <= b.maxY;
}

function inSafeRoom(location) {
  const [minX, maxX, minY, maxY, z] = DATA.lobby.safeRoom;
  return location.getZ() === z
    && location.getX() >= minX && location.getX() <= maxX
    && location.getY() >= minY && location.getY() <= maxY;
}

function inGrillRoom(location) {
  const [minX, maxX, minY, maxY, z] = DATA.grillRoom.bounds;
  return location.getZ() === z
    && location.getX() >= minX && location.getX() <= maxX
    && location.getY() >= minY && location.getY() <= maxY;
}

function footprint(object, definition) {
  const sizeX = definition?.sizeX ?? object.getDefinition?.()?.getSizeX?.() ?? 1;
  const sizeY = definition?.sizeY ?? object.getDefinition?.()?.getSizeY?.() ?? 1;
  const face = object.getFace() & 3;
  const width = face % 2 === 0 ? sizeX : sizeY;
  const height = face % 2 === 0 ? sizeY : sizeX;
  const at = object.getLocation();
  const tiles = [];
  for (let dx = 0; dx < width; dx++) {
    for (let dy = 0; dy < height; dy++) {
      tiles.push([at.getX() + dx, at.getY() + dy, at.getZ()]);
    }
  }
  return tiles;
}

/**
 * Indexes a wall obstacle by the tiles it faces, which is where it triggers. Every trigger tile
 * of one wall shares a record, so disarming it covers the whole wall. `sources`, when given, also
 * indexes the record by the wall's own tiles: a Search is clicked on those, not on the trigger.
 */
function addWallTrigger(map, object, id, sources = null) {
  const definition = core.CacheDefinitions.getObject(id);
  const face = object.getFace() & 3;
  const [dx, dy] = FACING[face];
  const tiles = footprint(object, definition);
  const trap = { object, id, face, triggers: [], disarmedBy: null };
  for (const [x, y, z] of tiles) {
    const key = tileKey(x + dx, y + dy, z);
    trap.triggers.push(key);
    map.set(key, trap);
  }
  if (sources) {
    sources.set(object, trap);
    for (const [x, y, z] of tiles) sources.set(tileKey(x, y, z), trap);
  }
}

/**
 * The wall trap a Search was clicked on: the object itself, or the wall standing at its tile when
 * the click carries another instance of it (the packet resolves its own loc).
 */
function wallTrapFor(object) {
  const direct = wallTrapObjects.get(object);
  if (direct) return direct;
  for (const other of objectsByTile.get(keyOf(object.getLocation())) ?? []) {
    if (other.getId() !== object.getId()) continue;
    const trap = wallTrapObjects.get(other);
    if (trap) return trap;
  }
  return null;
}

function addLedge(object, id) {
  const key = tileKey(object.getLocation().getX(), object.getLocation().getY(), object.getLocation().getZ());
  if (ledges.has(key)) return;
  ledges.set(key, { object, id, group: null });
}

/** Groups touching ledges of the same id into one line, once the scan is complete. */
function groupLedges() {
  const seen = new Set();
  for (const [key, entry] of ledges) {
    if (seen.has(key)) continue;
    const group = [];
    const queue = [key];
    seen.add(key);
    while (queue.length) {
      const current = queue.pop();
      const item = ledges.get(current);
      if (!item) continue;
      group.push(item);
      const at = item.object.getLocation();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextKey = tileKey(at.getX() + dx, at.getY() + dy, at.getZ());
        if (!seen.has(nextKey) && ledges.has(nextKey)) {
          seen.add(nextKey);
          queue.push(nextKey);
        }
      }
    }
    const xs = group.map((entry) => entry.object.getLocation().getX());
    const ys = group.map((entry) => entry.object.getLocation().getY());
    const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    const info = {
      horizontal,
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
      z: group[0].object.getLocation().getZ(),
      length: group.length,
      drain: group.length >= 7 ? DATA.drains.longLedge : DATA.drains.ledge,
    };
    for (const entry of group) entry.group = info;
  }
}

/** Loads the maze's regions and indexes the cache's placements once. */
function scan() {
  if (scanned) return;
  const { RegionManager, MapObjects } = core;
  for (let x = DATA.bounds.maze.minX; x <= DATA.bounds.maze.maxX; x += 64) {
    for (let y = DATA.bounds.lobby.minY; y <= DATA.bounds.maze.maxY; y += 64) {
      RegionManager.loadMapFiles(x, y);
    }
  }
  for (const list of MapObjects.mapObjects.values()) {
    for (const object of list) {
      const location = object.getLocation();
      if (!inBounds(location) && !inLobby(location)) continue;
      const id = object.getId();
      if (!objectsById.has(id)) objectsById.set(id, []);
      objectsById.get(id).push(object);
      const key = keyOf(location);
      if (!objectsByTile.has(key)) objectsByTile.set(key, []);
      objectsByTile.get(key).push(object);

      switch (id) {
        case ids.floorSpikes:
        case ids.floorSpring:
        case ids.floorExplosive:
        case ids.floorTrapdoor:
          for (const [x, y, z] of footprint(object, core.CacheDefinitions.getObject(id))) {
            floorTraps.set(tileKey(x, y, z), { object, id, tile: [x, y, z], armed: true, disarmedBy: null });
          }
          break;
        case ids.wallSpikes:
        case ids.wallGas:
        case ids.wallCrusher:
          addWallTrigger(wallTraps, object, id, wallTrapObjects);
          break;
        case ids.spinningBlades:
          for (const [x, y, z] of footprint(object, core.CacheDefinitions.getObject(id))) spinningTiles.add(tileKey(x, y, z));
          break;
        case ids.pendulum:
          pendulumTiles.add(key);
          break;
        case ids.floorBlade:
          for (const [x, y, z] of footprint(object, core.CacheDefinitions.getObject(id))) floorBladeTiles.add(tileKey(x, y, z));
          break;
        case ids.wallBlade:
          addWallTrigger(wallBlades, object, id);
          break;
        case ids.wallSaw:
          addWallTrigger(wallSaws, object, id);
          break;
        case ids.ledgeWall:
        case ids.ledgeBridge:
          addLedge(object, id);
          break;
        case ids.grill:
          grills.set(key, object);
          break;
        case ids.passagewayA:
        case ids.passagewayB:
          passageways.set(key, object);
          break;
        case ids.mazeDoor:
        case ids.gearDoor:
        case ids.mosaicDoor:
        case ids.shortcutDoor:
          doors.set(key, object);
          break;
        case ids.mazeSafe:
          mazeSafes.push(object);
          break;
        case ids.lobbySafe:
          lobbySafes.push(object);
          break;
        case ids.chest:
          chests.push(object);
          break;
        default:
          break;
      }
    }
  }
  groupLedges();
  scanned = true;
}

function resetTrapFor(player) {
  for (const trap of floorTraps.values()) if (trap.disarmedBy === player) trap.disarmedBy = null;
  for (const trap of wallTraps.values()) if (trap.disarmedBy === player) trap.disarmedBy = null;
  for (const trap of wallBlades.values()) if (trap.disarmedBy === player) trap.disarmedBy = null;
}

/**
 * Re-arms a trap the player disarmed once they are no longer on/next to it, as live: disarming
 * only holds while you stay where you searched it.
 */
function rearmLeftTraps(player) {
  const here = keyOf(player.getLocation());
  for (const trap of floorTraps.values()) {
    if (trap.disarmedBy === player && here !== tileKey(...trap.tile)) trap.disarmedBy = null;
  }
  const seen = new Set();
  for (const map of [wallTraps, wallBlades]) {
    for (const trap of map.values()) {
      if (seen.has(trap)) continue;
      seen.add(trap);
      if (trap.disarmedBy === player && !trap.triggers.includes(here)) trap.disarmedBy = null;
    }
  }
}

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(core.Skill[skill]);
}

function maxLevel(player, skill) {
  return player.getSkillManager().getMaxLevel(core.Skill[skill]);
}

function setLevel(player, skill, value) {
  player.getSkillManager().setCurrentLevel(core.Skill[skill], Math.max(0, value), true);
}

function message(name, values = {}) {
  return String(DATA.messages[name] ?? "").replace(/\{(\w+)\}/g, (_, field) => String(values[field] ?? ""));
}

function hasItem(player, id) {
  return player.getInventory().contains(id);
}

function freeSlots(player) {
  return player.getInventory().getFreeSlots();
}

/** Adds `id`; returns false when it does not fit (stackables only need an existing stack). */
function give(player, id, amount = 1) {
  const definition = core.ItemDefinition.forId(id);
  const stackable = definition?.isStackable?.() ?? false;
  if (!stackable && freeSlots(player) < amount) return false;
  if (stackable && freeSlots(player) <= 0 && !hasItem(player, id)) return false;
  player.getInventory().adds(id, amount);
  return true;
}

function take(player, id, amount = 1) {
  player.getInventory().delete(id, amount);
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function weighted(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

module.exports = {
  DATA, FACING, init, scan,
  ids, itemIds, npcIds,
  objectsById, objectsByTile, floorTraps, wallTraps, wallTrapObjects, spinningTiles, pendulumTiles,
  floorBladeTiles, wallBlades, wallSaws, ledges, grills, passageways, doors,
  mazeSafes, lobbySafes, chests,
  tileKey, keyOf, walkable, inBounds, inMaze, inLobby, inSafeRoom, inGrillRoom,
  footprint, wallTrapFor, resetTrapFor, rearmLeftTraps,
  level, maxLevel, setLevel, message, hasItem, freeSlots, give, take, randomInt, weighted,
  api: () => api,
  core: () => core,
};
