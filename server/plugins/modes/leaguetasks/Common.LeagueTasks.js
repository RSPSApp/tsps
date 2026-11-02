/**
 * Shared by the LeagueTasks units: the generated catalog (data/league-tasks.json), the list's
 * cache ids and captured packets (data/league-task-list.json), the hand-written trigger overlay
 * (data/league-task-triggers.json), each league's name and colour (data/leagues.json), a
 * character's league (LeagueMode's `league:profile`) and its completed tasks (LeaguePoints'
 * `league:completed-tasks`).
 */
const fs = require("fs");
const path = require("path");

/** The list's saved dropdown filters: filter key -> value (0 = All). */
const FILTERS_ATTRIBUTE = "league:task-filters";
/** Kills credited to open kill tasks: task id -> kills of any NPC the task accepts. */
const KILLS_ATTRIBUTE = "league:task-kills";

let api = null;
let core = null;
let data = null;
let leagues = null;
/** League type -> { key, fromCache, tasks, slots (list positions), byId }. */
const catalogs = new Map();
/** The named places triggers give (a guild, a dungeon, an island): key -> { name, rects: [minX, minY, maxX, maxY] }. */
let places = {};

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  const dir = path.join(__dirname, "..", "data");
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  data = read("league-task-list.json");
  leagues = read("leagues.json").leagues;
  const catalog = read("league-tasks.json");
  const overlay = read("league-task-triggers.json");
  data.tiers = catalog.tiers;
  places = catalog.places ?? {};
  for (const [type, league] of Object.entries(catalog.leagues)) {
    // A task's completion bit: its place in the list, which is the cache's own position for the
    // league the cache carries (`fromCache`; its list skips the rows not in that league).
    const tasks = league.tasks.map((task, index) => {
      const trigger = overlay[type]?.[task.id] ?? task.trigger ?? null;
      return { ...task, index: Number.isInteger(task.position) ? task.position : index, trigger };
    });
    const slots = tasks.reduce((most, task) => Math.max(most, task.index + 1), 0);
    catalogs.set(Number(type), { key: league.key, fromCache: league.fromCache === true, tasks, slots, byId: new Map(tasks.map((task) => [task.id, task])) });
  }
}

/** The league a character is in (its type), or null for a main character or a league without a catalog. */
function leagueOf(player) {
  const query = { player, league: null };
  api.emitCustomEvent("league:profile", query);
  const type = Number(query.league);
  return query.league !== null && catalogs.has(type) && leagues[type] ? type : null;
}

/** Every league type with a catalog. */
function types() {
  return [...catalogs.keys()];
}

function catalog(type) {
  return catalogs.get(Number(type)) ?? null;
}

function task(type, id) {
  return catalog(type)?.byId.get(String(id)) ?? null;
}

function league(type) {
  return leagues[type] ?? null;
}

/** The ids of the character's completed tasks (LeaguePoints keeps them). */
function completedIds(player) {
  const query = { player, ids: [] };
  api.emitCustomEvent("league:completed-tasks", query);
  return Array.isArray(query.ids) ? query.ids : [];
}

/** A tile in a named place: in one of its boxes, on any plane (docs/leagues.md, Tasks). */
function inPlace(key, x, y) {
  return (places[key]?.rects ?? []).some(([minX, minY, maxX, maxY]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
}

/** The DB row id the client reads a task from. */
function rowId(type, index) {
  return data.virtualRowBase + Number(type) * 10000 + index;
}

function tierName(tier) {
  return data.tiers[tier - 1] ?? String(tier);
}

/** The league's colour as the `<col=...>` hex the captured messages use. */
function colourOf(type) {
  return (league(type)?.colour ?? 0xffffff).toString(16).padStart(6, "0").toUpperCase();
}

function message(key, values = {}) {
  return data.messages[key].text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

module.exports = {
  init, leagueOf, types, catalog, task, league, completedIds, rowId, tierName, colourOf, message, inPlace,
  FILTERS_ATTRIBUTE, KILLS_ATTRIBUTE,
  get data() { return data; },
  get api() { return api; },
  get core() { return core; },
  get places() { return places; },
};
