/**
 * Slayer masters and a league character's areas (Wiki, Demonic_Pacts_League/Areas: Slayer masters
 * "will all assign their standard task list, taking into account unlocked areas"): a master leaves
 * out a task none of whose monsters lives in an area the character may enter, as Slayer asks
 * through `slayer:task-available`.
 * - A task's monsters are where the world spawns them (npc-spawns.json), every NPC that counts for
 *   it, and a spawn counts only inside an area the character unlocked or on a square the league
 *   opens to everyone by name (its `area: null` overrides: Demonic Pacts' Zanaris and Abyss).
 *   A square no area names (an instance, an unmapped dungeon) is not counted: the Wiki puts
 *   underground places in their entrance's area, which the data does not always know.
 *   Krystilia's tasks count only in the Wilderness, so only spawns there count for hers.
 * - A boss task's boss is in the area the Wiki's Demonic Pacts Slayer guide gives it (the Culling
 *   Spree relic's `bossAreas`); a boss it does not list (the Shellbane Gryphon and the Maggot
 *   King, released after the league) is never given, as Culling Spree never offers it.
 * - Konar's area for a task is one whose box's centre is entered by the same rule, when any is.
 * - A counting spawn in a sealed location does not count while the seal holds: a quest seals
 *   the entrance (the Ruins of Tapoyauik needs The Heart of Darkness, the Ogre Enclave needs
 *   Watchtower - the Wiki's blue dragon task page lists each location with its requirement).
 *   A task whose counting monsters spawn only behind seals is not offered.
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

/**
 * Whether a spawn or box centre on this tile counts for the character: its square lies in an area
 * the character unlocked, or a league override opens it to everyone (`area: null`). Unlike
 * Regions.isOpen, a square no area names is not entered.
 */
function entered(type, player, x, y) {
  if (!Regions.indexFor(type).has(Regions.squareOf(x, y))) return false;
  return Regions.isOpen(type, player, x, y);
}

/**
 * Locations a character may not enter yet: a quest seals the entrance (Wiki blue dragon task
 * page: "The Ruins of Tapoyauik" needs The Heart of Darkness, "The Ogre Enclave" needs
 * Watchtower). The Dragon Nest is not sealed: its cave entry (tlati_dragon_nest_cave_entry,
 * loc 57591, loc-teleports.json) works in main, and the Wiki gives the Nest no requirement.
 * The boxes are the full map squares holding each location's counted spawns (npc-spawns.json).
 */
const SEALED_LOCATIONS = [
  { label: "Ruins of Tapoyauik", minX: 1536, minY: 9536, maxX: 1727, maxY: 9727, quest: "the_heart_of_darkness" },
  { label: "Ogre Enclave", minX: 2560, minY: 9408, maxX: 2623, maxY: 9471, quest: "watchtower" },
];

/** The sealed location a tile sits in, if any. */
function sealedAt(x, y) {
  for (const loc of SEALED_LOCATIONS) {
    if (x >= loc.minX && x <= loc.maxX && y >= loc.minY && y <= loc.maxY) return loc;
  }
  return null;
}

/**
 * Whether a tile's sealed location counts as entered for the character: its quest is complete.
 */
function sealOpen(player, x, y) {
  const loc = sealedAt(x, y);
  if (loc === null) return true;
  const request = { player, key: loc.quest, complete: false };
  Common.api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function taskAvailable(request) {
  const { player } = request;
  const type = player ? Common.leagueOf(player) : null;
  if (type === null || request.available === false) return;
  if (request.area) {
    const boxes = request.area.boxes ?? [];
    if (boxes.length && !boxes.some(([minX, minY, maxX, maxY]) => {
      const cx = (minX + maxX) >> 1;
      const cy = (minY + maxY) >> 1;
      return entered(type, player, cx, cy) && sealOpen(player, cx, cy);
    })) request.available = false;
    return;
  }
  if (request.bossId) {
    const key = bossArea(request.task);
    const area = key === undefined ? null : [...Common.areas.values()].find((entry) => entry.key === key);
    // As Culling Spree's bossAllowed: Krystilia's boss comes from the Wilderness.
    if (!area || !Common.unlocked(player).includes(area.id) || (request.wilderness && key !== "wilderness")) {
      request.available = false;
    }
    return;
  }
  const tiles = tilesFor(request).filter((tile) => !request.wilderness || wildernessAt(type, tile.x, tile.y));
  if (tilesFor(request).length === 0) return;
  if (!tiles.some((tile) => entered(type, player, tile.x, tile.y) && sealOpen(player, tile.x, tile.y))) {
    request.available = false;
  }
}

module.exports = function attach(api) {
  api.onCustomEvent("slayer:task-available", taskAvailable);
};
module.exports.taskAvailable = taskAvailable;
module.exports.sealedLocations = SEALED_LOCATIONS;
