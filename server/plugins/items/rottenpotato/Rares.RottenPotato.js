"use strict";

/**
 * The rares Peel > Spawn RARE! drops, and where they land.
 *
 * A rare lands on a random tile up to SPAWN_RADIUS from the player, and only where the player could
 * pick it up: open floor they can walk to, or a table they can reach. A walk from the player's tile,
 * one collision-checked step at a time, finds the floor. Trees, rocks, water, walls and anything
 * fenced off are never reached. A tile counts as open floor when nothing stands on it but wall edges
 * and ground decoration (flowers, rubble). Tables are scenery named "table" with a reached tile beside them.
 */
const Common = require("./Common.RottenPotato");

/** The discontinued holiday rares (Wiki: Rare items). */
const RARE_NAMES = [
  "RED_PARTYHAT", "YELLOW_PARTYHAT", "BLUE_PARTYHAT", "GREEN_PARTYHAT", "PURPLE_PARTYHAT", "WHITE_PARTYHAT",
  "RED_HALLOWEEN_MASK", "GREEN_HALLOWEEN_MASK", "BLUE_HALLOWEEN_MASK", "SANTA_HAT", "CHRISTMAS_CRACKER",
  "PUMPKIN", "EASTER_EGG", "DISK_OF_RETURNING", "HALF_FULL_WINE_JUG",
];
/** Tiles each way from the player a rare may land: a square about 10 by 10 around them. */
const SPAWN_RADIUS = 5;
/** A dropped item's lifetime: it doesn't come back once taken. */
const NO_RESPAWN = -1;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const CARDINAL = STEPS.slice(0, 4);
/** Loc shapes 0-8 are walls and wall decoration on a tile's edge; 22 is ground decoration. */
const LAST_WALL_SHAPE = 8;
const GROUND_DECORATION = 22;
const TABLE = /\btable\b/i;

const key = (x, y) => `${x},${y}`;

function rareIds() {
  const I = Common.getCore().ItemIdentifiers;
  return RARE_NAMES.map((name) => I[name]).filter(Number.isInteger);
}

/** Every tile within SPAWN_RADIUS the player can walk to from where they stand, as "x,y" -> [x, y]. */
function reachableTiles(player) {
  const { RegionManager } = Common.getCore();
  const origin = player.getLocation();
  const ox = origin.getX(), oy = origin.getY(), z = origin.getZ();
  const area = player.getPrivateArea?.() ?? null;
  const reached = new Map([[key(ox, oy), [ox, oy]]]);
  const queue = [[ox, oy]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of STEPS) {
      const nx = x + dx, ny = y + dy;
      if (Math.abs(nx - ox) > SPAWN_RADIUS || Math.abs(ny - oy) > SPAWN_RADIUS || reached.has(key(nx, ny))) continue;
      if (!RegionManager.canMove(x, y, nx, ny, z, 1, 1, area)) continue;
      reached.set(key(nx, ny), [nx, ny]);
      queue.push([nx, ny]);
    }
  }
  return reached;
}

/** The map's and the server's own objects on a tile, in the player's world or instance. */
function objectsOn(player, location) {
  const { MapObjects, ObjectManager } = Common.getCore();
  const area = player.getPrivateArea?.() ?? null;
  return [
    ...MapObjects.getObjectsAt(location, area),
    ...ObjectManager.objectsAt(location).filter((object) => object.getPrivateArea() === area),
  ];
}

function isOpenFloor(player, location) {
  if (Common.getCore().RegionManager.isWater(location)) return false;
  return objectsOn(player, location).every((object) => object.getType() <= LAST_WALL_SHAPE || object.getType() === GROUND_DECORATION);
}

/** The tiles a table covers, turned as it stands. */
function footprint(object) {
  const at = object.getLocation();
  const definition = object.getDefinition();
  const turned = (object.getFace() & 1) === 1;
  const width = Math.max(1, (turned ? definition?.getSizeY() : definition?.getSizeX()) ?? 1);
  const length = Math.max(1, (turned ? definition?.getSizeX() : definition?.getSizeY()) ?? 1);
  const tiles = [];
  for (let dx = 0; dx < width; dx++) for (let dy = 0; dy < length; dy++) tiles.push([at.getX() + dx, at.getY() + dy]);
  return tiles;
}

/** Table tiles within SPAWN_RADIUS that a reached tile stands beside. */
function tableTiles(player, reached) {
  const { Location } = Common.getCore();
  const origin = player.getLocation();
  const tiles = new Map();
  for (let dx = -SPAWN_RADIUS; dx <= SPAWN_RADIUS; dx++) {
    for (let dy = -SPAWN_RADIUS; dy <= SPAWN_RADIUS; dy++) {
      const at = new Location(origin.getX() + dx, origin.getY() + dy, origin.getZ());
      for (const object of objectsOn(player, at)) {
        if (!TABLE.test(object.getDefinition()?.getName?.() ?? "") || !object.getLocation().equals(at)) continue;
        const covered = footprint(object).filter(([x, y]) =>
          Math.abs(x - origin.getX()) <= SPAWN_RADIUS && Math.abs(y - origin.getY()) <= SPAWN_RADIUS);
        const beside = covered.some(([x, y]) => CARDINAL.some(([sx, sy]) => reached.has(key(x + sx, y + sy))));
        if (beside) for (const [x, y] of covered) tiles.set(key(x, y), [x, y]);
      }
    }
  }
  return tiles;
}

/** Where a rare may land around the player: reached open floor (not their own tile) and reachable tables. */
function spawnTiles(player) {
  const { Location } = Common.getCore();
  const origin = player.getLocation();
  const z = origin.getZ();
  const reached = reachableTiles(player);
  const tiles = [...reached.values()]
    .filter(([x, y]) => x !== origin.getX() || y !== origin.getY())
    .map(([x, y]) => new Location(x, y, z))
    .filter((location) => isOpenFloor(player, location));
  for (const [x, y] of tableTiles(player, reached).values()) tiles.push(new Location(x, y, z));
  return tiles;
}

/** Drops a random rare on a random spawn tile (the player's own when there is none). */
function spawnRare(player, random = Math.random) {
  const core = Common.getCore();
  const ids = rareIds();
  const tiles = spawnTiles(player);
  const tile = tiles.length ? tiles[Math.floor(random() * tiles.length)] : player.getLocation().clone();
  const drop = new core.ItemOnGround(
    core.GroundItemState.SEEN_BY_EVERYONE, undefined, tile, new core.Item(ids[Math.floor(random() * ids.length)], 1),
    false, NO_RESPAWN, player.getPrivateArea?.() ?? null,
  );
  core.ItemOnGroundManager.register(drop);
  return drop;
}

/** A rare on the ground anywhere, or null. */
function groundRare() {
  const ids = new Set(rareIds());
  return Common.getCore().World.getItems().find((ground) => ids.has(ground?.getItem?.()?.getId?.())) ?? null;
}

/** The rare's tile, or the free tile beside it when it lies on a table. */
function standingTile(rare) {
  const { RegionManager, Location } = Common.getCore();
  const at = rare.getPosition();
  const area = rare.getPrivateArea?.() ?? null;
  if (!RegionManager.blocked(at, area)) return at.clone();
  for (const [dx, dy] of STEPS) {
    const beside = new Location(at.getX() + dx, at.getY() + dy, at.getZ());
    if (!RegionManager.blocked(beside, area)) return beside;
  }
  return at.clone();
}

module.exports = { SPAWN_RADIUS, rareIds, spawnTiles, spawnRare, groundRare, standingTile };
