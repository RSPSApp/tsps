"use strict";

// Matching npc-spawns.json entries with capture sites (rsprox_index.py npc-sites) and deciding
// what the captures change, for scripts/refine-npc-spawns.ts (docs/npc-spawns.md). Plain JS so
// tests can load it.

/**
 * Facing directions in the numbering spawn `direction` uses (NpcSpawnDefinitionLoader converts it):
 * 1 is south and 6 north. Checked against the 68 spawns that already had a direction and a clear
 * captured facing: 1 -> south 21 times, 6 -> north 18, 3 -> west 10, 4 -> east 7.
 */
const DIRECTIONS = ["south-west", "south", "south-east", "west", "east", "north-west", "north", "north-east"];

/** "south" -> 1; null for anything else. */
function directionOf(name) {
  const index = DIRECTIONS.indexOf(String(name));
  return index >= 0 ? index : null;
}

function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Pairs each spawn with the capture site of the same NPC nearest to it on its plane, one site per
 * spawn and one spawn per site, within `reach` tiles. Sites are matched on the rev 241 id, or on
 * the display name when the ids differ (interchangeable copies such as mountain troll 936/937).
 * Returns [{ spawn, site }].
 */
function pairSpawns(spawns, sites, reach) {
  const byKey = new Map();
  for (const site of sites) {
    for (const key of [`id:${site.id}`, `name:${String(site.display ?? "").toLowerCase()}`]) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(site);
    }
  }
  const candidates = [];
  for (const spawn of spawns) {
    const seen = new Set();
    for (const key of [`id:${spawn.id}`, `name:${String(spawn.name ?? "").toLowerCase()}`]) {
      for (const site of byKey.get(key) ?? []) {
        if (seen.has(site) || site.z !== (spawn.level ?? 0)) continue;
        seen.add(site);
        const d = distance(spawn, site);
        if (d <= reach) candidates.push({ spawn, site, d });
      }
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  const usedSpawns = new Set();
  const usedSites = new Set();
  const pairs = [];
  for (const candidate of candidates) {
    if (usedSpawns.has(candidate.spawn) || usedSites.has(candidate.site)) continue;
    usedSpawns.add(candidate.spawn);
    usedSites.add(candidate.site);
    pairs.push(candidate);
  }
  return pairs;
}

/**
 * What a reliable site changes on its spawn:
 * - `wanderRadius: 0` when the NPC stood still in at least `still` of its watched sightings;
 * - `direction` when, standing still, at least `facing` of them agree on a facing that differs
 *   from what the spawn gets now (its own direction, else the cache's spawnDirection). Bankers
 *   and clerks turn towards whoever uses them, so a majority is enough: the Grand Exchange's
 *   north clerks agree on north in only 61-65% of sightings.
 * - otherwise, for an NPC that walks and can't be attacked, `wanderRadius` from how far it
 *   walked (wanderChanges).
 * Sites with labels (follower, roaming, prop, instance, special worlds…) or too few watched
 * sightings change nothing.
 */
function changesFor(spawn, site, { minWatched = 3, still = 0.9, facing = 0.5, defaultDirection = 1, attackable = true } = {}) {
  if ((site.watched ?? 0) < minWatched || site.still_share == null) return {};
  if (site.still_share < still) return attackable ? {} : wanderChanges(spawn, site);
  if ((site.labels ?? []).length) return {};
  const changes = {};
  if (spawn.wanderRadius !== 0) changes.wanderRadius = 0;
  const captured = directionOf(site.facing);
  const current = Number.isInteger(spawn.direction) ? spawn.direction : defaultDirection;
  if (captured !== null && (site.facing_share ?? 0) >= facing && captured !== current) changes.direction = captured;
  return changes;
}

/** The loader's wanderRadius for a spawn that has none (NpcSpawnDefinitionLoader). */
const DEFAULT_WANDER_RADIUS = 5;
/**
 * Labels that only say how the capture index named the NPC: a multinpc parent such as Aubury
 * (aubury_3op) has no display name of its own. They say nothing about where it walks.
 */
const NAMING_LABELS = new Set(["unnamed"]);

/**
 * A walking NPC's `wanderRadius`: how far from its site 90% of its sightings were (`range_p90`),
 * at least 1, when that is less than what the spawn gets now. Blue Moon Inn's bartender stays
 * within 2 tiles behind the bar and Aubury within 3 in his shop, where the default 5 walked them
 * out through the counter and the door. Only for NPCs that can't be attacked (`attackable`
 * false): a monster's sightings include chasing players, which says nothing about its wander.
 * Never widened, for the same reason. Roaming NPCs, followers and the like are left alone.
 */
function wanderChanges(spawn, site) {
  if ((site.labels ?? []).some((label) => !NAMING_LABELS.has(label))) return {};
  if (!Number.isInteger(site.range_p90)) return {};
  const radius = Math.max(1, site.range_p90);
  const current = Number.isInteger(spawn.wanderRadius) ? spawn.wanderRadius : DEFAULT_WANDER_RADIUS;
  return radius < current ? { wanderRadius: radius } : {};
}

module.exports = { DIRECTIONS, directionOf, pairSpawns, changesFor, DEFAULT_WANDER_RADIUS };
