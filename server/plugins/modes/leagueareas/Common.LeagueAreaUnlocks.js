/**
 * Shared by the LeagueAreaUnlocks units: the data (league-areas.json, plus leagues.json for each
 * league's name and colour), the areas as the cache's `region_data` table defines them (ids,
 * names, the interface's components, the teleport hubs), a character's league (LeagueMode's
 * `league:profile`), its unlocked areas, its completed tasks (LeaguePoints) and the slot maths.
 */
const fs = require("fs");
const path = require("path");

/** Unlocked areas: area ids in unlock order (slot 0 Misthalin, 1 Karamja, then the picks). */
const AREAS_ATTRIBUTE = "league:areas";

let api = null;
let core = null;
let data = null;
let leagues = null;
/** area id -> { id, key, name, shield, nameComponent, teleport: { x, y, z }, rects, squares }. */
const areas = new Map();
/** league type -> area id -> the league's unlock spotanim for it. */
const spotanims = new Map();

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  const dir = path.join(__dirname, "..", "data");
  data = JSON.parse(fs.readFileSync(path.join(dir, "league-areas.json"), "utf8"));
  leagues = JSON.parse(fs.readFileSync(path.join(dir, "leagues.json"), "utf8")).leagues;
  loadAreas();
  loadSpotanims();
}

/** A packed coord (plane << 28 | x << 14 | y) as a tile. */
function unpackCoord(packed) {
  return { x: (packed >> 14) & 0x3fff, y: packed & 0x3fff, z: (packed >>> 28) & 0x3 };
}

/** The areas from the cache's region_data table; the table's other rows (Tutorial Island, Death's Office...) are not areas. */
function loadAreas() {
  const { CacheDefinitions } = core;
  const { name, columns } = data.table;
  const tableId = CacheDefinitions.getDbTableId(name);
  if (tableId === null) throw new Error(`league areas: the cache has no ${name} table`);
  const column = (key) => {
    const id = CacheDefinitions.getDbColumn(tableId, columns[key]);
    if (id === null) throw new Error(`league areas: ${name} has no ${columns[key]} column`);
    return id;
  };
  const ids = { id: column("id"), name: column("name"), shield: column("shield"), nameComponent: column("nameComponent"), teleport: column("teleport") };
  for (const row of CacheDefinitions.getDbTableRows(tableId)) {
    const id = row.int(ids.id, -1);
    const config = data.areas[id];
    if (!config) continue;
    areas.set(id, {
      id,
      key: config.key,
      name: row.string(ids.name),
      shield: row.int(ids.shield, -1),
      nameComponent: row.int(ids.nameComponent, -1),
      teleport: unpackCoord(row.int(ids.teleport, 0)),
      rects: config.rects ?? [],
      squares: config.squares ?? [],
      tilePolygons: config.tilePolygons ?? [],
    });
  }
  for (const id of Object.keys(data.areas)) {
    if (!areas.has(Number(id))) throw new Error(`league areas: ${name} has no row for area ${id}`);
  }
}

/** Each league's unlock spotanims, by gameval name (league_4_area_unlock_emote_spotanim_<area>). */
function loadSpotanims() {
  const { CacheDefinitions } = core;
  for (const [type, league] of Object.entries(data.leagues)) {
    const byArea = new Map();
    for (const id of league.areas) {
      const name = league.spotanimPrefix + areas.get(id).key;
      const spotanim = CacheDefinitions.getSpotanimId(name);
      if (spotanim === null) throw new Error(`league areas: the cache has no spotanim ${name}`);
      byArea.set(id, spotanim);
    }
    spotanims.set(Number(type), byArea);
  }
}

/** The league a character is in (its type), or null for a main character or a league without areas. */
function leagueOf(player) {
  const query = { player, league: null };
  api.emitCustomEvent("league:profile", query);
  const type = query.league;
  return type !== null && data.leagues[type] && leagues[type] ? Number(type) : null;
}

/** The league's area rules (defaults, thresholds, areas offered). */
function league(type) {
  return data.leagues[type] ?? null;
}

/** The league's name and colour (leagues.json). */
function leagueInfo(type) {
  return leagues[type] ?? null;
}

function area(id) {
  return areas.get(Number(id)) ?? null;
}

/** The area whose name or key matches `text` (case-insensitive), or null. */
function areaByName(text) {
  const wanted = String(text ?? "").trim().toLowerCase().replace(/[_\s]+/g, " ");
  if (!wanted) return null;
  for (const entry of areas.values()) {
    if (entry.name.toLowerCase() === wanted || entry.key.replace(/_/g, " ") === wanted) return entry;
  }
  return null;
}

function spotanim(type, id) {
  return spotanims.get(type)?.get(id) ?? -1;
}

/** The character's unlocked areas, in unlock order. */
function unlocked(player) {
  const value = player.getAttribute(AREAS_ATTRIBUTE);
  return Array.isArray(value) ? value.map(Number).filter((id) => areas.has(id)) : [];
}

/** Completed tasks (LeaguePoints answers `league:points`). */
function tasks(player) {
  const query = { player, points: 0, tasks: 0 };
  api.emitCustomEvent("league:points", query);
  return query.tasks | 0;
}

/** The tasks slot `slot` (0-4) needs: 0 for the defaults, else the league's thresholds in order; null past the last. */
function thresholdFor(type, slot) {
  const rules = league(type);
  if (!rules) return null;
  if (slot < rules.defaults.length) return 0;
  const threshold = rules.thresholds[slot - rules.defaults.length];
  return Number.isInteger(threshold) ? threshold : null;
}

/** The next pick: { slot, tasks } (the tasks it needs), or null when every slot is filled. */
function nextSlot(type, player) {
  const slot = unlocked(player).length;
  if (slot >= data.maxUnlocked) return null;
  const needed = thresholdFor(type, slot);
  return needed === null ? null : { slot, tasks: needed };
}

/** Whether the next pick is affordable now. */
function available(type, player) {
  const next = nextSlot(type, player);
  return next !== null && tasks(player) >= next.tasks;
}

/** The league's colour as the six hex digits a <col> tag takes. */
function colourHex(type) {
  return (leagueInfo(type).colour >>> 0).toString(16).toUpperCase().padStart(6, "0");
}

function message(key, values = {}) {
  return data.messages[key].text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

function uid(group, child) {
  return (group << 16) | child;
}

module.exports = {
  init, leagueOf, league, leagueInfo, area, areaByName, spotanim, unlocked, tasks, thresholdFor, nextSlot, available,
  colourHex, message, uid, unpackCoord, AREAS_ATTRIBUTE,
  get areas() { return areas; },
  get data() { return data; },
  get api() { return api; },
  get core() { return core; },
};
