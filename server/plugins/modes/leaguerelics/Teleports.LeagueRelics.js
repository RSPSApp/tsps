/**
 * What the relics' teleport items share: a paged destination menu, the teleport itself (the
 * standard animation, or the league's area-teleport cast for an item that asks for it; the
 * Wilderness limit of the item, and only to areas the league character has unlocked), the item's
 * last destination, and the destinations listed by league area that Demonic Pacts' items share
 * (`areaTeleports`).
 *
 * Areas: `league:area-at` { player, x, y } -> area (null when open) and `league:areas` { player } ->
 * unlocked, from the league's area unlocks; with nobody answering, every area is open. The cast:
 * `league:teleport-cast` { player } -> cast, from the same; with nobody answering, the standard
 * teleport.
 */
const Common = require("./Common.LeagueRelics");
const { startHomeTeleport, castOf } = require("../../combat/HomeTeleportSequence");

/** Four destinations a page and "More...", as the jewellery's own menus. */
const PAGE_SIZE = 5;
/** "Ignores Wilderness teleport restrictions" (Wiki): no level stops it. */
const ANY_WILDERNESS_LEVEL = 60;

function lastAttribute(key) {
  return `league:last-destination:${key}`;
}

/** The area ids the league character has unlocked, or null when nobody answers (everything open). */
function unlockedAreas(player) {
  const areas = { player, unlocked: null };
  Common.api.emitCustomEvent("league:areas", areas);
  return Array.isArray(areas.unlocked) ? areas.unlocked : null;
}

/** Whether the tile is in an area the league character has unlocked (or no area at all). */
function areaOpen(player, location) {
  const at = { player, x: location.getX(), y: location.getY(), area: null };
  Common.api.emitCustomEvent("league:area-at", at);
  if (at.area === null || at.area === undefined) return true;
  const unlocked = unlockedAreas(player);
  return unlocked === null || unlocked.includes(at.area);
}

/** Whether league area `area` (an id) is unlocked; true with nobody answering. */
function areaUnlocked(player, area) {
  const unlocked = unlockedAreas(player);
  return unlocked === null || unlocked.includes(area);
}

/** Enough open floor to walk from (tiles): not a pocket behind a counter. */
const LANDING_REACH = 30;
const LANDING_RADIUS = 4;
/** Cardinal steps in RegionManager.canMoveIsBlocked's directions: north, west, east, south. */
const STEPS = [[1, 0, 1], [3, -1, 0], [4, 1, 0], [6, 0, -1]];

/** How many tiles can be walked to from `tile`, up to `limit` (walls and solid locs block). */
function reach(tile, limit) {
  const { RegionManager, Location } = Common.core;
  const seen = new Set([`${tile.getX()},${tile.getY()}`]);
  const queue = [tile];
  while (queue.length > 0 && seen.size < limit) {
    const at = queue.shift();
    for (const [direction, dx, dy] of STEPS) {
      const key = `${at.getX() + dx},${at.getY() + dy}`;
      if (seen.has(key) || !RegionManager.canMoveIsBlocked(at, direction, null)) continue;
      seen.add(key);
      queue.push(new Location(at.getX() + dx, at.getY() + dy, at.getZ()));
    }
  }
  return seen.size;
}

/**
 * Where to land for `location`: the tile itself when it is open floor, else the nearest open tile
 * within 4 from which 30 tiles can be walked (a STASH unit, a clue's loc, a bank booth: not the
 * banker's side of the counter), else the open tile that reaches furthest.
 */
function landing(location) {
  const { RegionManager, Location } = Common.core;
  if (!RegionManager?.blocked || !RegionManager.canMoveIsBlocked) return location;
  let best = null;
  for (let radius = 0; radius <= LANDING_RADIUS; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const tile = radius === 0 ? location : new Location(location.getX() + dx, location.getY() + dy, location.getZ());
        if (RegionManager.blocked(tile, null)) continue;
        const tiles = reach(tile, LANDING_REACH);
        if (tiles >= LANDING_REACH) return tile;
        if (!best || tiles > best.tiles) best = { tile, tiles };
      }
    }
  }
  return best?.tile ?? location;
}

/** The league's area-teleport cast for the character (`league:teleport-cast`), or null. */
function leagueCast(player) {
  const query = { player, cast: null };
  Common.api.emitCustomEvent("league:teleport-cast", query);
  return query.cast ?? null;
}

/**
 * Teleports to `destination` { label, location, wildernessLevel?, remember? } for item `key`,
 * remembering it as the item's last destination on arrival (not with `remember: false`, a
 * destination that needs its own arrival, the house). `onArrival` runs after. With `cast` true, the
 * league's area-teleport cast plays (interrupted as a home teleport is) where the league has one; a
 * cast definition ({ steps, lockTick, landTick }, an item's own recorded cast) plays instead.
 */
function go(player, key, destination, { wildernessLevel = ANY_WILDERNESS_LEVEL, onArrival = null, cast = false } = {}) {
  const { TeleportHandler, TeleportType } = Common.core;
  const location = landing(destination.location);
  if (!areaOpen(player, location)) {
    player.sendMessage(Common.message("areaLocked"));
    return false;
  }
  const limit = destination.wildernessLevel ?? wildernessLevel;
  if (!TeleportHandler.checkReqs(player, location, limit)) return false;
  const arrived = () => {
    if (destination.remember !== false) {
      player.setAttribute(lastAttribute(key), {
        label: destination.label, x: location.getX(), y: location.getY(), z: location.getZ(), wildernessLevel: limit,
      });
    }
    onArrival?.();
  };
  const definition = cast === true ? leagueCast(player) : cast || null;
  if (definition) startHomeTeleport(Common.core, player, location, arrived, castOf(definition));
  else TeleportHandler.teleport(player, location, TeleportType.NORMAL, false, arrived);
  return true;
}

/** The item's last destination, or a message when there is none yet. */
function goLast(player, key) {
  const last = player.getAttribute(lastAttribute(key));
  if (!last || !Number.isInteger(last.x)) {
    player.sendMessage(Common.message("noLastDestination"));
    return false;
  }
  const location = new Common.core.Location(last.x, last.y, last.z ?? 0);
  return go(player, key, { label: last.label, location, wildernessLevel: last.wildernessLevel });
}

/** A paged chatbox menu of [label, action] entries. */
function menu(player, title, entries) {
  if (entries.length === 0) {
    player.sendMessage(Common.message("noDestinations"));
    return;
  }
  let page = entries;
  if (entries.length > PAGE_SIZE) {
    const rest = entries.slice(PAGE_SIZE - 1);
    page = [...entries.slice(0, PAGE_SIZE - 1), ["More...", () => menu(player, title, rest)]];
  }
  Common.api.sendMultiChatboxPrompt(player, title, ...page.flat());
}

/** A menu of destinations, each teleporting with `options`. */
function destinations(player, key, title, list, options = {}) {
  menu(player, title, list.map((destination) => [destination.label, () => go(player, key, destination, options)]));
}

/** Asks an owner for a list (`{ ...request, list: [] }`) and returns it. */
function ask(name, request = {}) {
  const query = { ...request, list: [] };
  Common.api.emitCustomEvent(name, query);
  return query.list;
}

/** NPC spawns with this name, one per tile (data/definitions/npc-spawns.json). */
function spawnsNamed(name) {
  const spawns = require("../../../data/definitions/npc-spawns.json");
  const all = Array.isArray(spawns) ? spawns : spawns.spawns ?? Object.values(spawns);
  const seen = new Set();
  return all.filter((spawn) => {
    if (spawn?.name !== name) return false;
    const key = `${spawn.x},${spawn.y},${spawn.level ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The worn options' submenus (cache params): the first entry at 661 + op, later ones at 2066 + op + 8 * n. */
const WORN_OPTION_CLICK = 2;
const WORN_SUBOP_FIRST = 661;
const WORN_SUBOP_BASE = 2066;
const WORN_SUBOP_STEP = 8;

/** The submenu entry an item click came from (the cache's subops carried, its params worn), or null. */
function subOption(event) {
  if (!Number.isInteger(event.subOpId) || event.subOpId <= 0) return null;
  const { CacheDefinitions, Equipment } = Common.core;
  const definition = CacheDefinitions.getItem(event.itemId);
  const sub = event.subOpId - 1;
  if (event.interfaceId === Equipment.INVENTORY_INTERFACE_ID) {
    const op = event.clickType - WORN_OPTION_CLICK;
    const params = definition?.params;
    if (op < 0 || !params?.get) return null;
    if (sub === 0) return params.get(WORN_SUBOP_FIRST + op) ?? params.get(WORN_SUBOP_BASE + op) ?? null;
    return params.get(WORN_SUBOP_BASE + op + WORN_SUBOP_STEP * sub) ?? null;
  }
  return definition?.subops?.[event.clickType - 1]?.[sub] ?? null;
}

/**
 * A Demonic Pacts item's destinations by league area (data `areas`: [{ name, area, destinations:
 * [{ name, x, y, z, level?, quest? }] }], `name` the item's submenu entry, `area` the league's area
 * id): Teleport (or its area submenu) lists an area's destinations, Last-destination repeats the
 * last. A destination needs its area unlocked (and its tile's: `areaOpen`), its Agility `level`
 * (current, boosted) and its `quest` completed (`quest:is-complete` by name; unanswered, no bar);
 * any Wilderness level, with the league's area-teleport cast, or the item's own `cast` (a cast
 * definition), and with `lastVarp` the varp sent the destination's packed tile as the cast starts.
 */
function areaTeleports({ key, title, areas, cast = true, lastVarp = null }) {
  const byName = new Map(areas.flatMap((area) => area.destinations.map((destination) => [destination.name, { area, destination }])));

  function refusal(player, area, destination) {
    if (!areaUnlocked(player, area.area)) return Common.message("areaLocked");
    const { Skill } = Common.core;
    if (destination?.level !== undefined && player.getSkillManager().getCurrentLevel(Skill.AGILITY) < destination.level) {
      return Common.message("agilityTooLow", { level: destination.level });
    }
    if (destination?.quest !== undefined) {
      const query = { player, name: destination.quest, complete: null };
      Common.api.emitCustomEvent("quest:is-complete", query);
      if (query.complete === false) return Common.message("questNeeded", { quest: destination.quest });
    }
    return null;
  }

  function choose(player, area, destination) {
    const refused = refusal(player, area, destination);
    if (refused) {
      player.sendMessage(refused);
      return false;
    }
    const location = new Common.core.Location(destination.x, destination.y, destination.z ?? 0);
    const went = go(player, key, { label: destination.name, location }, { cast });
    // The varp holds the tile as live packs one: plane << 28 | x << 14 | y.
    if (went && lastVarp !== null) player.getPacketSender().sendConfig(lastVarp, ((location.getZ() << 28) | (location.getX() << 14) | location.getY()) >>> 0);
    return went;
  }

  function areaMenu(player, area) {
    const refused = refusal(player, area, null);
    if (refused) {
      player.sendMessage(refused);
      return;
    }
    menu(player, area.name, area.destinations.map((destination) => [destination.name, () => choose(player, area, destination)]));
  }

  function teleport(event) {
    const picked = subOption(event);
    const area = picked === null ? null : areas.find((entry) => entry.name === picked);
    if (area) {
      areaMenu(event.player, area);
      return;
    }
    menu(event.player, title, areas.map((entry) => [entry.name, () => areaMenu(event.player, entry)]));
  }

  function last(event) {
    const { player } = event;
    const saved = player.getAttribute(lastAttribute(key));
    const found = saved ? byName.get(saved.label) : undefined;
    if (!found) {
      player.sendMessage(Common.message("noLastDestination"));
      return false;
    }
    return choose(player, found.area, found.destination);
  }

  return { teleport, last, choose };
}

module.exports = {
  areaOpen, areaUnlocked, landing, reach, go, goLast, menu, destinations, ask, spawnsNamed, lastAttribute, subOption, areaTeleports,
  ANY_WILDERNESS_LEVEL,
};
