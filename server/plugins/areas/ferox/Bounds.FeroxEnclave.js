/**
 * Ferox Enclave's ground (https://oldschool.runescape.wiki/w/Ferox_Enclave): the town's outline,
 * its barriers, and the buffer just outside them. Shared by the FeroxEnclave plugin and the
 * plugins that treat the town as safe (Wilderness, LootKeys, LootingBag, PvP presets).
 */
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { MapObjects } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");

const BARRIER_IDS = [39652, 39653];
const BOUNDARY = [[3126,3618],[3130,3618],[3131,3617],[3139,3617],[3140,3618],[3144,3618],[3144,3620],[3150,3626],[3153,3626],[3154,3627],[3156,3627],[3156,3634],[3155,3634],[3155,3636],[3156,3636],[3156,3647],[3148,3647],[3147,3646],[3139,3646],[3138,3645],[3138,3640],[3125,3640],[3125,3633],[3123,3631],[3123,3623],[3124,3622],[3126,3622]];

function tile(location) {
  const value = Location.readTile(location);
  return value && value.z === 0 ? value : null;
}

function isInsideEnclave(location) {
  const point = tile(location);
  if (!point) return false;
  let inside = false;
  for (let index = 0, previous = BOUNDARY.length - 1; index < BOUNDARY.length; previous = index++) {
    const [x, y] = BOUNDARY[index];
    const [lastX, lastY] = BOUNDARY[previous];
    if ((y > point.y) !== (lastY > point.y) && point.x < ((lastX - x) * (point.y - y)) / (lastY - y) + x) inside = !inside;
  }
  return inside;
}

/** Next to a barrier: the safe zone outside the town (attackable when teleblocked). */
function isNextToBarrier(point) {
  for (let x = point.x - 1; x <= point.x + 1; x++) {
    for (let y = point.y - 1; y <= point.y + 1; y++) {
      if ((MapObjects.mapObjects.get(MapObjects.getHash(x, y, point.z)) ?? []).some((object) => BARRIER_IDS.includes(object.getId()))) return true;
    }
  }
  return false;
}

function isSafeLocation(location) {
  const point = tile(location);
  if (!point) return false;
  return isInsideEnclave(point) || isNextToBarrier(point);
}

/** The buffer: safe ground outside the town, by a barrier (varbit 10530, wildy_hub_buffer). */
function isInBuffer(location) {
  const point = tile(location);
  return !!point && !isInsideEnclave(point) && isNextToBarrier(point);
}

/**
 * Where crossing a barrier from `playerLocation` leads. The barriers are type-0 walls; their map
 * face is the crossing axis, measured from the player's routed tile.
 */
function crossingTarget(playerLocation, object) {
  const source = tile(playerLocation);
  const barrier = tile(object?.getLocation?.());
  const face = object?.getFace?.();
  if (!source || !barrier || !Number.isInteger(face)) return null;
  const delta = face === 0 ? { x: source.x < barrier.x ? 1 : -1, y: 0 }
    : face === 2 ? { x: source.x > barrier.x ? -1 : 1, y: 0 }
    : face === 1 ? { x: 0, y: source.y > barrier.y ? -1 : 1 }
    : face === 3 ? { x: 0, y: source.y < barrier.y ? 1 : -1 }
    : null;
  if (!delta) return null;
  const target = { x: source.x + delta.x, y: source.y + delta.y, z: source.z };
  return { entering: isInsideEnclave(target), target, delta };
}

module.exports = { BARRIER_IDS, BOUNDARY, isInsideEnclave, isSafeLocation, isInBuffer, crossingTarget };
