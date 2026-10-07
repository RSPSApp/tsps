/**
 * Where a ladder, staircase or trapdoor leads, worked out from the map itself rather than a
 * list of coordinates (issue #119): the object at the other end is found in the cache's map
 * data, and the player lands on a walkable tile from which that object can be used.
 *
 * - The other end has a climb option in the opposite direction (a Climb-up staircase pairs with
 *   a Climb-down one above it; a trapdoor pairs with the ladder below it).
 * - It is looked for on the plane above or below, around the clicked object; failing that,
 *   underground ladders and trapdoors lead 6400 tiles north or south on plane 0, the map's own
 *   layout (Lumbridge's trapdoor at 3209,3216 opens over the cellar ladder at 3209,9616).
 * - Landing tiles are next to it on a side it can be used from (its access mask and rotation,
 *   the same reach check object clicks use), nearest the tile the player climbed from.
 *
 * Content that knows better (an area plugin, a minigame) passes an explicit destination
 * through the ladders:climbUp / ladders:climbDown events, which skip all of this.
 */
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { RegionManager } = require("../../src/main/typescript/elvarg/game/collision/RegionManager");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { ObjectDefinition } = require("../../src/main/typescript/elvarg/game/definition/ObjectDefinition");
const { PathFinder } = require("../../src/main/typescript/elvarg/game/model/movement/path/PathFinder");

const UP = 1;
const DOWN = -1;
const UP_OPTIONS = new Set(["climb-up", "climb", "top-floor", "climb up", "walk-up", "ascend"]);
const DOWN_OPTIONS = new Set(["climb-down", "climb", "bottom-floor", "climb down", "walk-down", "descend"]);
/** How far from a gangplank its other half lies (the ships' pairs are side by side). */
const GANGPLANK_RADIUS = 2;
/** Underground areas lie this many tiles north of the surface above them. */
const UNDERGROUND_OFFSET = 6400;
/** How far around the clicked object the other end may lie. */
const SEARCH_RADIUS = 4;
const MAX_PLANE = 3;

function options(id) {
  return (ObjectDefinition.forId(id)?.getInteractions?.() ?? []).filter(Boolean).map((option) => option.toLowerCase());
}

function climbs(id, direction) {
  const wanted = direction === UP ? UP_OPTIONS : DOWN_OPTIONS;
  return options(id).some((option) => wanted.has(option));
}

/** Tiles an object covers: its size, turned with its rotation. */
function footprint(object) {
  const def = ObjectDefinition.forId(object.getId());
  const turned = (object.getFace() & 1) === 1;
  const width = Math.max(1, turned ? def.getSizeY() : def.getSizeX());
  const length = Math.max(1, turned ? def.getSizeX() : def.getSizeY());
  return { x: object.getLocation().getX(), y: object.getLocation().getY(), width, length };
}

function distanceToFootprint(x, y, area) {
  const dx = Math.max(area.x - x, 0, x - (area.x + area.width - 1));
  const dy = Math.max(area.y - y, 0, y - (area.y + area.length - 1));
  return Math.max(dx, dy);
}

function objectsAround(x, y, z, radius) {
  if (z < 0 || z > MAX_PLANE) return [];
  RegionManager.loadMapFiles(x, y);
  const found = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (const object of MapObjects.mapObjects.get(MapObjects.getHash(x + dx, y + dy, z)) ?? []) found.push(object);
    }
  }
  return found;
}

/**
 * The object at the other end of `object` going `direction`: one that climbs back the other
 * way, on the next plane around the object, else underground (or back up from it).
 */
function otherEnd(object, direction) {
  const from = object.getLocation();
  const area = footprint(object);
  const nearest = (candidates, x, y) => candidates
    .filter((candidate) => climbs(candidate.getId(), -direction))
    .sort((a, b) => distanceToFootprint(x, y, footprint(a)) - distanceToFootprint(x, y, footprint(b)))[0] ?? null;
  const centreX = area.x + (area.width >> 1);
  const centreY = area.y + (area.length >> 1);
  const sameColumn = () => nearest(objectsAround(centreX, centreY, from.getZ() + direction, SEARCH_RADIUS + 1), centreX, centreY);
  const underground = (y) => nearest(objectsAround(centreX, y, 0, SEARCH_RADIUS), centreX, y);
  // Going up from underground, the surface comes first; going down from the ground floor,
  // there is no plane below, only the underground.
  if (direction === UP && from.getY() >= UNDERGROUND_OFFSET) {
    return underground(centreY - UNDERGROUND_OFFSET) ?? sameColumn();
  }
  if (direction === DOWN && from.getZ() === 0) {
    return from.getY() < UNDERGROUND_OFFSET ? underground(centreY + UNDERGROUND_OFFSET) : null;
  }
  return sameColumn();
}

/** Walkable tiles next to `object` from which it can be used, nearest to `hint` first. */
function landingTile(object, hint, privateArea) {
  const def = ObjectDefinition.forId(object.getId());
  const area = footprint(object);
  const z = object.getLocation().getZ();
  const candidates = [];
  for (let x = area.x - 1; x <= area.x + area.width; x++) {
    for (let y = area.y - 1; y <= area.y + area.length; y++) {
      if (distanceToFootprint(x, y, area) !== 1) continue;
      const tile = new Location(x, y, z);
      if (RegionManager.blocked(tile, privateArea)) continue;
      const standIn = { getLocation: () => tile, getSize: () => 1, getPrivateArea: () => privateArea };
      const reaches = PathFinder.reachedObject(standIn, area.x, area.y, def.getSizeX(), def.getSizeY(),
        object.getFace(), object.getType(), def.getBlockingMask());
      if (reaches) candidates.push(tile);
    }
  }
  const away = (tile) => Math.abs(tile.getX() - hint.x) + Math.abs(tile.getY() - hint.y);
  candidates.sort((a, b) => away(a) - away(b));
  return candidates[0] ?? null;
}

/**
 * Where climbing `object` (`direction` UP or DOWN, `toEnd` for Top-floor / Bottom-floor) puts a
 * player standing on `from`, or null when the map has nothing at the other end.
 */
function destination(object, direction, from, privateArea = null, toEnd = false) {
  if (!object || !climbs(object.getId(), direction)) return null;
  let end = otherEnd(object, direction);
  if (!end) return null;
  // Top-floor / Bottom-floor: keep going while the next end climbs on in the same direction.
  for (let floors = 0; toEnd && floors < MAX_PLANE && climbs(end.getId(), direction); floors++) {
    const next = otherEnd(end, direction);
    if (!next) break;
    end = next;
  }
  const shift = end.getLocation().getY() - object.getLocation().getY();
  const hint = { x: from.getX(), y: from.getY() + (Math.abs(shift) >= UNDERGROUND_OFFSET / 2 ? shift : 0) };
  return landingTile(end, hint, privateArea);
}

/**
 * Crossing a gangplank ("Cross" on both halves): from the dock (plane 0) onto the ship's deck
 * above it, or back. The other half is the gangplank of the same name on the other plane beside
 * it; the landing carries on in the direction of travel, onto the deck or back onto the dock.
 */
function crossDestination(object, privateArea = null) {
  if (!object || !options(object.getId()).includes("cross")) return null;
  const from = object.getLocation();
  const plane = from.getZ() === 0 ? 1 : from.getZ() - 1;
  const name = ObjectDefinition.forId(object.getId()).getName();
  const end = objectsAround(from.getX(), from.getY(), plane, GANGPLANK_RADIUS)
    .filter((candidate) => ObjectDefinition.forId(candidate.getId()).getName() === name && options(candidate.getId()).includes("cross"))
    .sort((a, b) => distanceToFootprint(from.getX(), from.getY(), footprint(a)) - distanceToFootprint(from.getX(), from.getY(), footprint(b)))[0];
  if (!end) return null;
  const stepX = Math.sign(end.getLocation().getX() - from.getX());
  const stepY = Math.sign(end.getLocation().getY() - from.getY());
  const hint = { x: end.getLocation().getX() + stepX * 3, y: end.getLocation().getY() + stepY * 3 };
  return landingTile(end, hint, privateArea);
}

module.exports = { destination, crossDestination, otherEnd, landingTile, climbs, UP, DOWN };
