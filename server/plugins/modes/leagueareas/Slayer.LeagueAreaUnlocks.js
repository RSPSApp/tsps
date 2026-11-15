/**
 * Slayer masters and a league character's areas (Wiki, Demonic_Pacts_League/Areas: Slayer masters
 * "will all assign their standard task list, taking into account unlocked areas"): a master leaves
 * out a task none of whose monsters lives in an area the character may enter, as Slayer asks
 * through `slayer:task-available`.
 * - A task's monsters are where the world spawns them (npc-spawns.json), every NPC that counts for
 *   it; an open square (no area's) counts as entered. Krystilia's tasks count only in the
 *   Wilderness, so only spawns there count for hers.
 * - A boss task's boss is in the area the Wiki's Demonic Pacts Slayer guide gives it (the Culling
 *   Spree relic's `bossAreas`), else where it spawns.
 * - Konar's area for a task is one whose box is open, when any is.
 * - Ours: a task with no placed monster at all (all spawned by content) is left to the master.
 */
const fs = require("fs");
const path = require("path");
const Common = require("./Common.LeagueAreaUnlocks");
const Regions = require("./Regions.LeagueAreaUnlocks");

const SPAWNS_FILE = path.join(__dirname, "..", "..", "..", "data", "definitions", "npc-spawns.json");
const RELICS_FILE = path.join(__dirname, "..", "data", "league-relics.json");

let spawnTiles = null;
let bossAreas = null;
/** "task:<id>" / "boss:<id>" -> the distinct map squares' tiles where its monsters spawn. */
const placed = new Map();

/** Every world spawn as { id, name, x, y }, one per NPC id and map square. */
function spawns() {
  if (spawnTiles) return spawnTiles;
  const { CacheDefinitions, NpcIdentifiers } = Common.core;
  const seen = new Set();
  spawnTiles = [];
  for (const row of JSON.parse(fs.readFileSync(SPAWNS_FILE, "utf8"))) {
    const id = Number.isInteger(row.id) ? row.id : NpcIdentifiers[row.key];
    if (!Number.isInteger(id) || !Number.isInteger(row.x) || !Number.isInteger(row.y)) continue;
    const key = `${id}:${row.x >> 6}:${row.y >> 6}`;
    if (seen.has(key)) continue;
    seen.add(key);
    spawnTiles.push({ id, name: CacheDefinitions.getNpc(id)?.name ?? row.name ?? "", x: row.x, y: row.y });
  }
  return spawnTiles;
}

function tilesFor(request) {
  const key = request.bossId ? `boss:${request.bossId}` : `task:${request.task?.id}`;
  let tiles = placed.get(key);
  if (!tiles) {
    tiles = spawns().filter((spawn) => request.counts(spawn.id, spawn.name));
    placed.set(key, tiles);
  }
  return tiles;
}

function wildernessAt(type, x, y) {
  const area = Regions.areaAt(type, x, y);
  return area !== null && Common.area(area)?.key === "wilderness";
}

/** The area key the Wiki's boss table gives a boss task, or undefined. */
function bossArea(task) {
  bossAreas ??= JSON.parse(fs.readFileSync(RELICS_FILE, "utf8")).effects?.cullingSpree?.bossAreas ?? {};
  return bossAreas[task?.displayName];
}

function taskAvailable(request) {
  const { player } = request;
  const type = player ? Common.leagueOf(player) : null;
  if (type === null || request.available === false) return;
  if (request.area) {
    const boxes = request.area.boxes ?? [];
    if (boxes.length && !boxes.some(([minX, minY, maxX, maxY]) =>
      Regions.isOpen(type, player, (minX + maxX) >> 1, (minY + maxY) >> 1))) request.available = false;
    return;
  }
  if (request.bossId) {
    const key = bossArea(request.task);
    if (key !== undefined) {
      const area = [...Common.areas.values()].find((entry) => entry.key === key);
      if (area && !Common.unlocked(player).includes(area.id)) request.available = false;
      return;
    }
  }
  const tiles = tilesFor(request).filter((tile) => !request.wilderness || wildernessAt(type, tile.x, tile.y));
  if (tilesFor(request).length === 0) return;
  if (!tiles.some((tile) => Regions.isOpen(type, player, tile.x, tile.y))) request.available = false;
}

module.exports = function attach(api) {
  api.onCustomEvent("slayer:task-available", taskAvailable);
};
module.exports.taskAvailable = taskAvailable;
