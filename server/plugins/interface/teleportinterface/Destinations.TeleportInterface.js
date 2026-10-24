/**
 * The ::teleports destinations from data/teleports.json: every destination's row, and which
 * of them each tab lists.
 * A destination's row id is its position in the file, so ids only have to agree between a
 * player's open interface and the server; anything saved uses the destination's key.
 */
const DATA = require("../data/teleports.json");

const TAB = Object.fromEntries(DATA.tabs.map(({ key }) => [key.toUpperCase(), key]));
const TAB_ORDER = DATA.tabs.map(({ key }) => key);
const TAB_LABELS = Object.fromEntries(DATA.tabs.map(({ key, label }) => [key, label]));

const DESTINATIONS = DATA.destinations.map((entry, index) => ({
  ...entry,
  id: index + 1,
  tabs: [].concat(entry.tab),
  type: entry.type ?? "NORMAL",
}));
const BY_ID = new Map(DESTINATIONS.map((entry) => [entry.id, entry]));
const BY_KEY = new Map(DESTINATIONS.map((entry) => [entry.key, entry]));

let core;
const iconIds = new Map();
const wildernessLevels = new Map();

function init(pluginApi) {
  core = pluginApi.core;
}

/** The item id a destination's icon names, or -1 when the cache does not know it. */
function iconId(entry) {
  if (!iconIds.has(entry.key)) iconIds.set(entry.key, core.CacheDefinitions.getObjId(entry.icon) ?? -1);
  return iconIds.get(entry.key);
}

function location(tile) {
  return new core.Location(...tile);
}

/** The Wilderness level of a tile; 0 off PvP ground (Corp's cave sits in a levelled box). */
function levelAt(tile) {
  return core.Wilderness.isInLocation(location(tile)) ? core.Wilderness.levelAt(tile[0], tile[1]) : 0;
}

/** The Wilderness level a fixed destination lands in; a live one is only known when used. */
function wildernessLevel(entry) {
  if (!entry.tile) return 0;
  if (!wildernessLevels.has(entry.key)) wildernessLevels.set(entry.key, levelAt(entry.tile));
  return wildernessLevels.get(entry.key);
}

function row(entry, panelOf) {
  const level = wildernessLevel(entry);
  return {
    id: entry.id, name: entry.name, icon: iconId(entry), detail: level > 0 ? ` Lvl ${level}` : "", terms: entry.terms ?? "",
    ...(panelOf ? { panel: panelOf(entry) } : {}),
  };
}

/** Every destination's row once; `panelOf(entry)` adds its details-panel text. */
function catalog(panelOf = undefined) {
  return DESTINATIONS.map((entry) => row(entry, panelOf));
}

/** Row ids under headers, in the order each header first appears, each section sorted by name. */
function grouped(entries, headerOf) {
  const sections = new Map();
  for (const entry of entries) {
    const header = headerOf(entry);
    if (!sections.has(header)) sections.set(header, []);
    sections.get(header).push(entry);
  }
  const layout = [];
  for (const [header, members] of sections) {
    layout.push({ header });
    for (const entry of [...members].sort((a, b) => a.name.localeCompare(b.name))) layout.push(entry.id);
  }
  return layout;
}

/** Favourites by name, then the most recent teleports, newest first. */
function savedLayout(favouriteKeys, recentKeys) {
  const layout = [];
  const section = (header, entries) => {
    if (entries.length === 0) return;
    layout.push({ header });
    for (const entry of entries) layout.push(entry.id);
  };
  const known = (keys) => keys.map((key) => BY_KEY.get(key)).filter(Boolean);
  section("Favourites", known(favouriteKeys).sort((a, b) => a.name.localeCompare(b.name)));
  section("Recent", known(recentKeys));
  return layout;
}

function tabLayout(tab, favouriteKeys = [], recentKeys = []) {
  if (tab === TAB.SAVED) return savedLayout(favouriteKeys, recentKeys);
  if (tab === TAB.ALL) return grouped(DESTINATIONS, (entry) => TAB_LABELS[entry.tabs[0]]);
  return grouped(DESTINATIONS.filter((entry) => entry.tabs.includes(tab)), (entry) => entry.group ?? TAB_LABELS[tab]);
}

/** What each tab lists, in TAB_ORDER, as the list runtime's `tabs` layout expects. */
function layouts(favouriteKeys = [], recentKeys = []) {
  return TAB_ORDER.map((tab) => tabLayout(tab, favouriteKeys, recentKeys));
}

module.exports = {
  TAB, TAB_ORDER, TAB_LABELS, DESTINATIONS, init, iconId, location, levelAt, wildernessLevel, catalog, layouts,
  byId: (id) => BY_ID.get(id),
  byKey: (key) => BY_KEY.get(key),
};
