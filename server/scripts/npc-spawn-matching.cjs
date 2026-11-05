"use strict";

// Parsing the Wiki's spawn coordinates and deciding which of them npc-spawns.json is missing,
// for scripts/sync-npc-spawns.ts (docs/npc-spawns.md). Plain JS so tests can load it.

/** "x:2580,y:8589" or "2580,8589" -> { x, y }; anything else -> null. */
function parsePoint(text) {
  const match = String(text).trim().match(/^(?:x:)?\s*(\d+)\s*,\s*(?:y:)?\s*(\d+)$/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/**
 * The `{{Map}}` templates in an NPC infobox: `|map = {{Map|2576,2253|r=3}}`, or one per version
 * (`|map2 = {{Map|x=2589|y=8614|plane=0}}`). Every `{{Map}}` on a map line counts, labelled or not
 * (Cabin Boy Herbert: `|map = Port Sarim Docks {{Map|…}} Port Piscarilius {{Map|…}}`). Returns
 * { version (1-based, null when shared), points, plane, mapId (the Wiki map layer, null when not given) }.
 * A polygon, rectangle or line outlines an area: it becomes one spawn at its
 * centre. The map's `r` only sizes the marker, so it's ignored.
 */
function parseInfoboxMaps(wikitext) {
  const maps = [];
  const bodies = [];
  for (const [, version, line] of String(wikitext).matchAll(/\|\s*map(\d*)\s*=([^\n]*)/gi)) {
    for (const [, body] of line.matchAll(/\{\{\s*Map\s*\|([^{}]*)\}\}/gi)) bodies.push([version, body]);
  }
  for (const [version, body] of bodies) {
    const named = {};
    const points = [];
    for (const part of body.split("|")) {
      const equals = part.indexOf("=");
      const key = equals > 0 ? part.slice(0, equals).trim().toLowerCase() : null;
      if (key && !/^x:/.test(part.trim())) named[key] = part.slice(equals + 1).trim();
      else {
        const point = parsePoint(part);
        if (point) points.push(point);
      }
    }
    if (named.x !== undefined && named.y !== undefined) {
      const point = parsePoint(`${named.x},${named.y}`);
      if (point) points.push(point);
    }
    if (points.length === 0) continue;
    if (/^(polygon|rectangle|line)$/i.test(named.mtype ?? "") && points.length > 1) {
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      points.splice(0, points.length, { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) });
    }
    maps.push({
      version: version ? Number(version) : null,
      points,
      plane: Number.isFinite(Number(named.plane)) ? Number(named.plane) : 0,
      mapId: named.mapid !== undefined && Number.isFinite(Number(named.mapid)) ? Number(named.mapid) : null,
    });
  }
  return maps;
}

/**
 * An infobox's ids by version number: `|id1 = 13426` -> { 1: [13426] }, `|id = 1, 2` -> { 0: [1, 2] }.
 * Map N belongs to version N, whose ids are id N; the data bucket lists versions in its own order.
 */
function versionIds(wikitext) {
  const ids = {};
  for (const [, number, list] of String(wikitext).matchAll(/^\|\s*id(\d*)\s*=\s*(.*?)\s*$/gim)) {
    const values = list.split(/[,\s]+/).map(Number).filter((id) => Number.isInteger(id) && id >= 0);
    if (values.length) ids[number === "" ? 0 : Number(number)] = values;
  }
  return ids;
}

/** Boxes from "minX,minY,maxX,maxY[,plane]". */
function parseBox(text) {
  const values = String(text).split(",").map((value) => Number(value.trim()));
  if (values.length < 4 || values.length > 5 || values.some((value) => !Number.isInteger(value))) {
    throw new Error(`Bad --box "${text}": expected minX,minY,maxX,maxY[,plane]`);
  }
  const [x1, y1, x2, y2, plane] = values;
  return { minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minY: Math.min(y1, y2), maxY: Math.max(y1, y2), plane };
}

function inBoxes(spawn, boxes) {
  return boxes.some((box) => spawn.x >= box.minX && spawn.x <= box.maxX && spawn.y >= box.minY && spawn.y <= box.maxY
    && (box.plane === undefined || box.plane === spawn.level));
}

function nameKey(name) {
  return String(name ?? "").trim().toLowerCase();
}

/** Chebyshev distance on one plane; Infinity across planes. */
function distance(a, b) {
  return a.level === b.level ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : Infinity;
}

/** The 64x64 map square a spawn is in. */
function squareOf(spawn) {
  return `${spawn.x >> 6},${spawn.y >> 6}`;
}

/**
 * Reconcile literal IDs whose cache name contradicts the authored spawn name.
 * Only one nearby, same-plane Wiki/cache-confirmed identity is sufficient evidence.
 * Correct variants and explicit cache keys are retained; inputs are never mutated.
 * `cacheName(id)` may give several names: a nameless multinpc parent answers with its variants'.
 */
function reconcileIdentities(existingSpawns, wikiSpawns, cacheName, radius, inScope = () => true) {
  const repairs = [], unresolved = [];
  const cached = id => { try { return [cacheName(id)].flat().map(nameKey); } catch { return []; } };
  const spawns = existingSpawns.map(spawn => {
    const expected = nameKey(spawn.name);
    if (!inScope(spawn) || !expected || spawn.key != null || !Number.isInteger(spawn.id) ||
        cached(spawn.id).includes(expected)) return spawn;
    const evidence = wikiSpawns.filter(candidate => !candidate.skip && nameKey(candidate.name) === expected &&
      Number.isInteger(candidate.id) && cached(candidate.id).includes(expected) && distance(spawn, candidate) <= radius);
    const ids = [...new Set(evidence.map(candidate => candidate.id))];
    if (ids.length !== 1) {
      unresolved.push({ name: spawn.name, id: spawn.id, x: spawn.x, y: spawn.y, level: spawn.level,
        candidates: ids, reason: ids.length ? 'ambiguous Wiki identities' : 'no matching Wiki/cache evidence' });
      return spawn;
    }
    repairs.push({ name: spawn.name, previousId: spawn.id, id: ids[0], x: spawn.x, y: spawn.y,
      level: spawn.level, page: evidence[0].page });
    return { ...spawn, id: ids[0] };
  });
  return { spawns, repairs, unresolved };
}

/**
 * Which Wiki spawns the existing ones in the same boxes lack. Per NPC name and plane:
 * 1. each Wiki spawn takes the nearest unmatched existing spawn of that name within `radius`;
 * 2. existing spawns of that name left over in the same map square still count, so only the
 *    difference in number is added there (the Wiki spawns furthest from any existing one). A
 *    spawn elsewhere on the map doesn't stand in for one missing here;
 * Existing spawns are never moved or removed, so a second run adds nothing.
 * Returns { add: wiki spawns to add, report: per name { wiki, existing, added } }.
 */
function planAdditions(wikiSpawns, existingSpawns, radius) {
  const byName = new Map();
  const group = (spawn, side) => {
    const key = `${nameKey(spawn.name)}@${spawn.level}`;
    if (!byName.has(key)) byName.set(key, { name: spawn.name, level: spawn.level, wiki: [], existing: [] });
    byName.get(key)[side].push(spawn);
  };
  wikiSpawns.forEach((spawn) => group(spawn, "wiki"));
  existingSpawns.forEach((spawn) => group(spawn, "existing"));

  const add = [];
  const report = [];
  for (const { name, level, wiki, existing } of byName.values()) {
    if (wiki.length === 0) continue;
    // Closest pairs first, so a Wiki spawn a tile off can't take the existing spawn another
    // Wiki spawn stands exactly on (that one would then be added on top of it).
    const pairs = [];
    for (const spawn of wiki) {
      for (const candidate of existing) {
        const d = distance(spawn, candidate);
        if (d <= radius) pairs.push({ spawn, candidate, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const unmatchedExisting = new Set(existing);
    const matchedWiki = new Set();
    for (const { spawn, candidate } of pairs) {
      if (matchedWiki.has(spawn) || !unmatchedExisting.has(candidate)) continue;
      matchedWiki.add(spawn);
      unmatchedExisting.delete(candidate);
    }
    const unmatchedWiki = wiki.filter((spawn) => !matchedWiki.has(spawn));
    const nearest = (spawn) => Math.min(Infinity, ...existing.map((other) => distance(spawn, other)));
    const leftoverBySquare = new Map();
    for (const spawn of unmatchedExisting) leftoverBySquare.set(squareOf(spawn), (leftoverBySquare.get(squareOf(spawn)) ?? 0) + 1);
    const wikiBySquare = new Map();
    for (const spawn of unmatchedWiki) {
      if (!wikiBySquare.has(squareOf(spawn))) wikiBySquare.set(squareOf(spawn), []);
      wikiBySquare.get(squareOf(spawn)).push(spawn);
    }
    const chosen = [];
    for (const [square, inSquare] of wikiBySquare) {
      const missing = Math.max(0, inSquare.length - (leftoverBySquare.get(square) ?? 0));
      chosen.push(...inSquare.sort((a, b) => nearest(b) - nearest(a)).slice(0, missing));
    }
    add.push(...chosen);
    report.push({ name, level, wiki: wiki.length, existing: existing.length, added: chosen.length });
  }
  return { add, report: report.sort((a, b) => b.added - a.added || a.name.localeCompare(b.name)) };
}

/**
 * The {{LocLine}} templates of a page: { location (its first link), plane, points }. Monster
 * pages name each spawn group's place this way; the buckets don't.
 */
function parseLocLines(wikitext) {
  const lines = [];
  for (const [, body] of String(wikitext).matchAll(/\{\{\s*LocLine\s*\|([\s\S]*?)\}\}/gi)) {
    const location = locationName(body.match(/(?:^|\|)\s*location\s*=([^|]*(?:\[\[[^\]]*\]\][^|]*)*)/i)?.[1] ?? "");
    const plane = Number(body.match(/(?:^|\|)\s*plane\s*=\s*(\d+)/i)?.[1] ?? 0);
    const points = [...body.matchAll(/x:\s*(\d+)\s*,\s*y:\s*(\d+)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
    if (location && points.length) lines.push({ location, plane, points });
  }
  return lines;
}

/** "[[Lumbridge Castle]] kitchen" or "[[Wyrmscraig Cavern|the cavern]]" -> the linked page's name. */
function locationName(text) {
  const link = String(text).match(/\[\[([^\]|#]+)/);
  return (link ? link[1] : String(text).replace(/<[^>]*>/g, "")).trim();
}

/** Layers drawn in game coordinates: the surface (0) and "not given" (-1). */
const SURFACE_LAYERS = new Set([null, undefined, -1, 0]);

/**
 * The Wiki draws many dungeons on their own map layers (mapID), whose coordinates or plane can
 * differ from the game's: the God Wars Dungeon is on plane 0 there and 2 in the game, and one
 * layer can hold several places shifted differently (each Stronghold of Security floor). Each
 * Wiki map square of a layer votes, through its spawns, for the shift that puts them on existing
 * spawns of the same NPC name (one vote per spawn per shift); a square is aligned when at least
 * `minVotes` spawns, and half of those with a same-name spawn anywhere, agree.
 * - A layer whose aligned squares all agree takes that shift everywhere, its empty squares too.
 * - A layer with different shifts uses each aligned square's own; its other squares stay unaligned.
 * Returns { shiftOf(spawn) -> {dx, dy, dz} | null (null: unaligned), layers: per layer summary }.
 */
function alignLayers(wikiSpawns, existingSpawns, minVotes = 2) {
  const existingByName = new Map();
  for (const spawn of existingSpawns) {
    const key = nameKey(spawn.name);
    if (!existingByName.has(key)) existingByName.set(key, []);
    existingByName.get(key).push(spawn);
  }
  const squareKey = (spawn) => `${spawn.mapId}:${spawn.x >> 6},${spawn.y >> 6},${spawn.level}`;
  const bySquare = new Map();
  for (const spawn of wikiSpawns) {
    if (SURFACE_LAYERS.has(spawn.mapId)) continue;
    if (!bySquare.has(squareKey(spawn))) bySquare.set(squareKey(spawn), []);
    bySquare.get(squareKey(spawn)).push(spawn);
  }
  const squareShift = new Map();
  for (const [key, spawns] of bySquare) {
    const votes = new Map();
    let matched = 0;
    for (const spawn of spawns) {
      const others = existingByName.get(nameKey(spawn.name)) ?? [];
      if (others.length) matched++;
      const seen = new Set();
      for (const other of others) {
        const shift = `${other.x - spawn.x},${other.y - spawn.y},${other.level - spawn.level}`;
        if (seen.has(shift)) continue;
        seen.add(shift);
        votes.set(shift, (votes.get(shift) ?? 0) + 1);
      }
    }
    const best = [...votes].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= minVotes && best[1] >= matched / 2) squareShift.set(key, best[0]);
  }
  const layerShifts = new Map();
  for (const [key, shift] of squareShift) {
    const layer = key.slice(0, key.indexOf(":"));
    if (!layerShifts.has(layer)) layerShifts.set(layer, new Set());
    layerShifts.get(layer).add(shift);
  }
  const parse = (shift) => { const [dx, dy, dz] = shift.split(",").map(Number); return { dx, dy, dz }; };
  const layers = [];
  const layerIds = new Set([...bySquare.keys()].map((key) => key.slice(0, key.indexOf(":"))));
  for (const layer of layerIds) {
    const shifts = layerShifts.get(layer) ?? new Set();
    const squares = [...bySquare.keys()].filter((key) => key.startsWith(`${layer}:`));
    const aligned = squares.filter((key) => squareShift.has(key) || shifts.size === 1).length;
    layers.push({ mapId: Number(layer), shifts: [...shifts].map(parse), squares: squares.length, aligned });
  }
  const shiftOf = (spawn) => {
    if (SURFACE_LAYERS.has(spawn.mapId)) return { dx: 0, dy: 0, dz: 0 };
    const own = squareShift.get(squareKey(spawn));
    if (own) return parse(own);
    const shifts = layerShifts.get(String(spawn.mapId));
    return shifts?.size === 1 ? parse([...shifts][0]) : null;
  };
  return { shiftOf, layers };
}

/** The loader's radius for a spawn that has none. */
const DEFAULT_WANDER_RADIUS = 5;

/** Counts a spawn set's radii, either explicitly written or including the loader default. */
function radiusCounts(spawns, matches, explicitOnly) {
  const counts = new Map();
  for (const spawn of spawns) {
    if (!matches(spawn)) continue;
    const radius = explicitOnly ? spawn.wanderRadius : (spawn.wanderRadius ?? DEFAULT_WANDER_RADIUS);
    if (radius === undefined) continue;
    counts.set(radius, (counts.get(radius) ?? 0) + 1);
  }
  return counts;
}

/** The most common radius, or `{ found: false }` when no spawn matches. */
function dominantRadius(counts) {
  if (!counts.size) return { found: false };
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const [radius, count] = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return { found: true, radius, count, total };
}

/**
 * The radius a Wiki-added spawn inherits from the spawns already placed.
 *
 * A non-attackable NPC prefers its established explicit radius (at least two witnesses and a
 * majority of the explicit rows) over the implicit default. That is what stops a batch added
 * after a refine from reintroducing the default 5 on tool leprechauns, soldiers and other
 * stationary NPCs. Attackable NPCs keep the effective majority, because a monster's radius is
 * not measured by a capture that may only contain a fight.
 *
 * Returns `undefined` for the default 5, so new rows stay as short as the existing ones.
 */
function chooseWanderRadius(spawns, { id, name }, { walkSeqId, attackable = false } = {}, keyOf = nameKey) {
  if (!attackable) {
    for (const matches of [
      (spawn) => spawn.id === id,
      (spawn) => keyOf(spawn.name) === keyOf(name),
    ]) {
      const explicit = dominantRadius(radiusCounts(spawns, matches, true));
      if (explicit.found && explicit.count >= 2 && explicit.count * 2 >= explicit.total) {
        return explicit.radius === DEFAULT_WANDER_RADIUS ? undefined : explicit.radius;
      }
    }
  }
  for (const matches of [
    (spawn) => spawn.id === id,
    (spawn) => keyOf(spawn.name) === keyOf(name),
  ]) {
    const effective = dominantRadius(radiusCounts(spawns, matches, false));
    if (effective.found) return effective.radius === DEFAULT_WANDER_RADIUS ? undefined : effective.radius;
  }
  return walkSeqId === -1 ? 0 : undefined;
}

module.exports = { versionIds, SURFACE_LAYERS, alignLayers, parsePoint, parseInfoboxMaps, parseBox, inBoxes, nameKey, distance, planAdditions, reconcileIdentities, squareOf, parseLocLines, locationName, DEFAULT_WANDER_RADIUS, chooseWanderRadius };
