// Read the same destination tables as the travel plugins. Never copy landing coordinates
// into admin tools: a source correction must reach the menu without a second edit.
const MINIGAMES = require("../../interface/data/minigame-teleports.json").minigames;
const SERVER_TELEPORTS = require("../../interface/data/teleports.json").destinations;
const TABLETS = require("../../combat/data/teleport-tablets.json");
const DIARIES = require("../../items/data/diary-rewards.json");
const SCEPTRE = require("../../items/data/pharaohs-sceptre.json");
const SPHERES = require("../../items/data/teleport-spheres.json").spheres;
const TREES = require("../../world/data/spirit-trees.json").trees;

const title = name => String(name).replace(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
const tileOf = location => Array.isArray(location) ? location : location?.getX
  ? [location.getX(), location.getY(), location.getZ()] : [location?.x, location?.y, location?.z ?? 0];
const validTile = tile => Array.isArray(tile) && tile.length === 3 && tile.every(Number.isInteger) && tile[0] >= 0 && tile[0] <= 16383 &&
  tile[1] >= 0 && tile[1] <= 16383 && tile[2] >= 0 && tile[2] <= 3;

function destinations(api, player) {
  const { core } = api;
  const groups = new Map();
  function add(path, name, location, key = name, resolve) {
    const tile = tileOf(location);
    if (!validTile(tile)) return;
    const group = path.join("/");
    if (!groups.has(group)) groups.set(group, { path, places: [] });
    const places = groups.get(group).places;
    const qualifiedKey = `${group}:${key}`;
    if (places.some(place => place.key === qualifiedKey)) return;
    places.push({ key: qualifiedKey, name, x: tile[0], y: tile[1], z: tile[2], resolve });
  }
  add(["World"], "World spawn", core.GameConstants.DEFAULT_LOCATION);
  for (const [unit, book] of [["SpellTeleports", null], ["LunarSpells", "Lunar spellbook"], ["ArceuusSpells", "Arceuus spellbook"]]) {
    for (const spell of core[unit]?.getTeleportDestinations?.(unit === "LunarSpells") ?? []) {
      if (spell.name === "teleport to house") continue; // Its core tile is a fallback portal, not a POH instance.
      const source = book ?? (spell.spellbook === core.MagicSpellbook?.ANCIENT ? "Ancient spellbook" : "Standard spellbook");
      add(["Spellbooks", source], spell.name, spell.destination);
    }
  }
  for (const [name, alternate] of Object.entries(TABLETS.alternates)) {
    add(["Spellbooks", "Standard spellbook"], `${name}: ${alternate.alternate}`, alternate.tile);
  }
  for (const [name, game] of Object.entries(MINIGAMES)) {
    if (game.choices) for (const choice of game.choices) add(["Minigame teleports", name], choice.option, choice);
    else add(["Minigame teleports"], name, game);
  }
  for (const [kind, label] of [["redirects", "House tablets"], ["tablets", "Other tablets"], ["scrolls", "Teleport scrolls"]]) {
    for (const [name, tile] of Object.entries(TABLETS[kind])) add(["Items", label], title(name), tile);
  }
  for (const family of DIARIES.families) for (const teleport of family.teleports) {
    for (const key of new Set([].concat(teleport.to))) {
      add(["Diary rewards", family.name], title(key), DIARIES.destinations[key]?.tile, key);
    }
  }
  for (const place of SCEPTRE.destinations) add(["Items", "Pharaoh's sceptre"], place.name, place.tile);
  for (const [name, landings] of Object.entries(SPHERES)) landings.forEach(({ tile }, index) =>
    add(["Items", name], `Landing ${index + 1}`, tile, String(index)));
  // Static tree landings are canonical even when the target has not grown/unlocked a tree.
  // A POH interior is deliberately omitted: coordinate teleporting cannot create an instance.
  for (const tree of TREES) if (tree.landing) add(["Spirit trees"], tree.name, tree.landing);
  for (const [event, path] of [["fairy-rings:destinations", ["Fairy rings"]]]) {
    const request = { player, list: [] };
    api.emitCustomEvent(event, request);
    for (const place of request.list) add(path, place.code ? `${place.code}: ${place.name}` : place.name, place.location);
  }
  // This catalogue supplies the existing ::teleports places, bosses, dungeons and travel
  // sources as a separate, clearly named branch. Live targets have no fixed landing tile.
  for (const place of SERVER_TELEPORTS) if (place.tile) {
    add(["Server destinations", place.group ?? "Places"], place.name, place.tile, place.key);
  }
  // Other travel plugins may contribute read-only, validated destinations without changing
  // the host or importing this plugin. No callback may perform travel while describing it.
  const extra = { player, list: [] };
  api.emitCustomEvent("adminpanel:teleport-destinations", extra);
  for (const place of extra.list) if (typeof place?.name === "string" && place.name.length > 0 && place.name.length <= 120 &&
    Array.isArray(place.path) && place.path.length > 0 && place.path.every(label => typeof label === "string" && label.length > 0 && label.length <= 80)) {
    add(place.path.slice(0, 6), place.name, place.location ?? place.tile, place.key ?? place.name,
      typeof place.resolve === "function" ? target => {
        try { return tileOf(place.resolve(target)); } catch { return []; }
      } : undefined);
  }
  return [...groups.values()];
}

module.exports = { destinations, tileOf, validTile };
