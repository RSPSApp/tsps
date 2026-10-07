/**
 * Dwarf multicannon: the fixed numbers (docs/dwarf-cannon.md). The capture gives the vars,
 * sounds, animations and projectile; the Wiki the capacity, damage, XP and decay.
 */

/** Directions in the order the barrel turns (captured): N, NE, E, SE, S, SW, W, NW. */
const DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/** Varps and varbits (names as rsprox prints them). */
const VARP = {
  FIRING: 1, // mcannonmulti: 1 << 20 while firing
  STAGE: 2, // dropcannon: 1-4, one per part added
  BALLS: 3, // rockthrower: cannonballs loaded
  OWNED: 4, // ownedmcannon: packed coord
  OWNED_TEMP: 3551, // ownedmcannon_temp: packed coord, -1 when picked up
};
const VARBIT = {
  WORLD: 1968, // mcannon_world
  SETUP_TIME: 2180, // mcannon_setuptime
  LOAD_X: 17870, // option_cannonballs_load_x
  BUSY: 12393,
};
const FIRING_FLAG = 1 << 20;

const SOUND = { SETUP: 2876, TURN: 2877, FIRE: 1667, PICK_UP: 2581 };
const SETUP_ANIMATION = 827; // human_pickupfloor
/** Ticks before each part goes down, from the click: base, stand, barrels, furnace (captured). */
const SETUP_TICKS = [2, 2, 3, 3];

const CAPACITY = 30;
const MAX_HIT = { steel: 30, granite: 35 };
const RANGED_XP_PER_DAMAGE = 2;

/** Projectile 53 (granite 1443, Wiki): heights 145 -> 140 as rsprox prints them, a quarter here. */
const PROJECTILE = {
  steel: 53,
  granite: 1443,
  startHeight: 36,
  endHeight: 35,
  angle: 2,
  progress: 11,
  /** Flight in cycles: the capture's shot north took 35, the one south-west 40. */
  straightCycles: 35,
  diagonalCycles: 40,
};

/** 25 minutes set up, it breaks; 10 more unrepaired, it's gone (Wiki). */
const BREAK_TICKS = 2500;
const LOSE_TICKS = 3500;

/**
 * Where each direction fires: polygon offsets from the cannon's centre. These are
 * Near-Reality's (the Wiki gives no shape); they overlap, which is how one monster can take two
 * balls in a rotation (Wiki). Indexed as DIRECTIONS.
 */
const ZONES = [
  [[-5, 19], [-5, 8], [-2, 8], [-2, 7], [-4, 7], [-4, 6], [-3, 6], [-3, 5], [-2, 5], [-2, 4], [-1, 4], [-1, 2], [2, 2], [2, 4], [3, 4], [3, 5], [4, 5], [4, 6], [5, 6], [5, 7], [3, 7], [3, 8], [6, 8], [6, 19]],
  [[18, 19], [7, 19], [7, 8], [5, 8], [5, 7], [4, 7], [4, 6], [3, 6], [3, 4], [1, 4], [1, 4], [1, 1], [4, 1], [4, 3], [6, 3], [6, 4], [7, 4], [7, 5], [8, 5], [8, 7], [18, 7]],
  [[19, 6], [8, 6], [8, 3], [7, 3], [7, 5], [6, 5], [6, 4], [5, 4], [5, 3], [4, 3], [4, 2], [2, 2], [2, -1], [4, -1], [4, -2], [5, -2], [5, -3], [6, -3], [6, -4], [7, -4], [7, -2], [8, -2], [8, -5], [19, -5]],
  [[19, -17], [19, -6], [8, -6], [8, -4], [7, -4], [7, -3], [6, -3], [6, -2], [4, -2], [4, 0], [4, 0], [1, 0], [1, -3], [3, -3], [3, -5], [4, -5], [4, -6], [5, -6], [5, -7], [7, -7], [7, -17]],
  [[6, -18], [6, -7], [3, -7], [3, -6], [5, -6], [5, -5], [4, -5], [4, -4], [3, -4], [3, -3], [2, -3], [2, -1], [-1, -1], [-1, -3], [-2, -3], [-2, -4], [-3, -4], [-3, -5], [-4, -5], [-4, -6], [-2, -6], [-2, -7], [-5, -7], [-5, -18]],
  [[-17, -18], [-6, -18], [-6, -7], [-4, -7], [-4, -6], [-3, -6], [-3, -5], [-2, -5], [-2, -3], [0, -3], [0, -3], [0, 0], [-3, 0], [-3, -2], [-5, -2], [-5, -3], [-6, -3], [-6, -4], [-7, -4], [-7, -6], [-17, -6]],
  [[-18, -5], [-7, -5], [-7, -2], [-6, -2], [-6, -4], [-5, -4], [-5, -3], [-4, -3], [-4, -2], [-3, -2], [-3, -1], [-1, -1], [-1, 2], [-3, 2], [-3, 3], [-4, 3], [-4, 4], [-5, 4], [-5, 5], [-6, 5], [-6, 3], [-7, 3], [-7, 6], [-18, 6]],
  [[-18, 18], [-18, 7], [-7, 7], [-7, 5], [-6, 5], [-6, 4], [-5, 4], [-5, 3], [-3, 3], [-3, 1], [-3, 1], [0, 1], [0, 4], [-2, 4], [-2, 6], [-3, 6], [-3, 7], [-4, 7], [-4, 8], [-6, 8], [-6, 18]],
];

/** Monsters a cannon can't hit (Wiki), by name. */
const NO_CANNON_NPCS = ["Sand crab", "Ammonite crab", "Demonic gorilla", "Kurask"];

/** Is (dx, dy) from the centre inside the polygon (even-odd rule on tile centres)? */
function inZone(direction, dx, dy) {
  const points = ZONES[direction];
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > dy) !== (yj > dy) && dx < ((xj - xi) * (dy - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

module.exports = {
  DIRECTIONS, VARP, VARBIT, FIRING_FLAG, SOUND, SETUP_ANIMATION, SETUP_TICKS,
  CAPACITY, MAX_HIT, RANGED_XP_PER_DAMAGE, PROJECTILE, BREAK_TICKS, LOSE_TICKS, ZONES, NO_CANNON_NPCS, inZone,
};
