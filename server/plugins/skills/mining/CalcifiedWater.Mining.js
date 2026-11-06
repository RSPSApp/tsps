/**
 * Cam Torum mine's oozing water (https://oldschool.runescape.wiki/w/Calcified_rocks): every 1-2 minutes
 * water leaks from some calcified rocks, boosting the skilling success rate by 15%, and when it stops
 * after 20-30 seconds those deposits are depleted.
 *
 * rsprox capture 1105 (rev 237, a Leagues world; ten cycles):
 * - The water starts with the game message `<col=a53fff>Some cracks around the cave begin to ooze water.`,
 *   sound 2041, and `varlamore_mining_special_rock` added as a wall decoration (shape 4) on four rocks'
 *   tiles, each with its rock's rotation. Cycles started 117-146 ticks apart.
 * - It stops 38-54 ticks later: the decorations go, and on the next tick each of the four rocks is mined
 *   out whether or not anyone was mining it: its `_empty` loc, area sound 2661 (delay 10, range 1), and
 *   the respawn timer for the players there.
 * - Every recorded cycle wet two rocks of the mine's west half and two of its east half.
 *
 * Estimated, not recorded: that only standing rocks are picked and the pick within each half is uniform;
 * that "15%" multiplies the roll's chance (x1.15, capped at 1); that the area is the mine's chamber.
 * The world-hop debuff ("Your pickaxe keeps slipping on the rocks ...") is not modelled.
 */
const ROCK_NAME = "Calcified rocks";
const WATER_LOC = "varlamore_mining_special_rock";
const WATER_SHAPE = 4;
const OOZE_MESSAGE = "<col=a53fff>Some cracks around the cave begin to ooze water.";
const OOZE_SOUND = 2041;
const CYCLE_TICKS = { min: 117, max: 146 };
const WATER_TICKS = { min: 38, max: 54 };
// The mine's chamber, and the x that splits its two rock groups (1497-1505 west, 1514-1521 east).
const MINE = { x: 1490, x2: 1528, y: 9530, y2: 9553, z: 1 };
const EAST_FROM_X = 1510;
const WET_PER_HALF = 2;
const SUCCESS_BOOST = 1.15;

let core = null;
let objects = null;
let rock = null;
let exhaustRock = null;
let keepsStanding = null;
let mine = null;
let rockSites = null;
// Wet rocks by tile key: the rock as found on the map, and its water decoration.
const wet = new Map();
const cycle = { tick: 0, nextOoze: 0, stopAt: -1, depleteAt: -1 };

function between({ min, max }, random = Math.random) {
  return min + Math.floor(random() * (max - min + 1));
}

function tileKey(location) {
  return `${location.getX()},${location.getY()},${location.getZ()}`;
}

/** Mined-out loc id -> the calcified rock it stands in for, from Mining's `depletedRocks` (gameval names). */
function rockForEmpty() {
  const { CacheDefinitions } = core;
  const map = new Map();
  for (const [rockName, emptyName] of Object.entries(rock?.depletedRocks ?? {})) {
    const rockId = CacheDefinitions.getLocId(rockName);
    const emptyId = CacheDefinitions.getLocId(emptyName);
    if (rockId != null && emptyId != null) map.set(emptyId, rockId);
  }
  return map;
}

/**
 * The mine's calcified rocks, as the cache's map places them: found once, the first time they're needed.
 * A rock mined out at that moment counts by its tile, as the rock its `_empty` loc stands in for, so it
 * can still ooze once it respawns.
 */
function sites() {
  if (rockSites) return rockSites;
  const { MapObjects, RegionManager, CacheDefinitions, GameObject } = core;
  RegionManager.loadMapFiles(MINE.x, MINE.y);
  RegionManager.loadMapFiles(MINE.x2, MINE.y2);
  const empties = rockForEmpty();
  // One rock a tile: a region's template copy can sit in the list beside the placed rock.
  const byTile = new Map();
  for (let x = MINE.x; x <= MINE.x2; x++) {
    for (let y = MINE.y; y <= MINE.y2; y++) {
      for (const object of MapObjects.mapObjects.get(MapObjects.getHash(x, y, MINE.z)) ?? []) {
        if (object.getPrivateArea() != null) continue;
        const key = tileKey(object.getLocation());
        if (byTile.has(key)) continue;
        if (CacheDefinitions.getObject(object.getId())?.name === ROCK_NAME) {
          byTile.set(key, MapObjects.get(object.getId(), object.getLocation(), null) ?? object);
        } else if (empties.has(object.getId())) {
          byTile.set(key, new GameObject(empties.get(object.getId()), object.getLocation().clone(), object.getType(), object.getFace(), null));
        }
      }
    }
  }
  rockSites = [...byTile.values()];
  return rockSites;
}

/** The rock standing at a site now (null while it is mined out). */
function standing(site) {
  return core.MapObjects.get(site.getId(), site.getLocation(), null);
}

/** Two standing rocks from each half of the mine. */
function pickWetRocks(random = Math.random) {
  const picked = [];
  for (const east of [false, true]) {
    const half = sites().filter((site) => (site.getLocation().getX() >= EAST_FROM_X) === east && standing(site));
    for (let n = 0; n < WET_PER_HALF && half.length > 0; n++) {
      picked.push(half.splice(Math.floor(random() * half.length), 1)[0]);
    }
  }
  return picked;
}

function startWater(random = Math.random) {
  const { GameObject, CacheDefinitions } = core;
  const waterId = CacheDefinitions.getLocId(WATER_LOC);
  for (const site of pickWetRocks(random)) {
    const water = new GameObject(waterId, site.getLocation().clone(), WATER_SHAPE, site.getFace(), null);
    objects.register(water, true);
    wet.set(tileKey(site.getLocation()), { site, water });
  }
  for (const player of mine.getPlayers()) {
    player.sendMessage(OOZE_MESSAGE);
    player.getPacketSender().sendSoundEffect(OOZE_SOUND, 1, 0, 1);
  }
  cycle.stopAt = cycle.tick + between(WATER_TICKS, random);
}

function stopWater() {
  for (const { water } of wet.values()) objects.deregister(water, true);
  cycle.stopAt = -1;
  cycle.depleteAt = cycle.tick + 1;
}

/** The tick after the water stops, every rock it ran from is mined out. */
function depleteWetRocks() {
  const viewers = mine.getPlayers();
  for (const { site } of wet.values()) {
    const object = standing(site);
    // A miner whose rocks do not deplete (Demonic Pacts' Endless Harvest) keeps the rock and their mining.
    if (object && !keepsStanding?.(object, rock)) exhaustRock(object, rock, viewers);
  }
  wet.clear();
  cycle.depleteAt = -1;
}

function processWater(random = Math.random) {
  cycle.tick++;
  if (cycle.tick === cycle.depleteAt) depleteWetRocks();
  if (cycle.tick === cycle.stopAt) stopWater();
  if (cycle.tick >= cycle.nextOoze) {
    cycle.nextOoze = cycle.tick + between(CYCLE_TICKS, random);
    if (cycle.stopAt < 0 && cycle.depleteAt < 0) startWater(random);
  }
}

function isWet(object) {
  return object != null && wet.has(tileKey(object.getLocation())) && cycle.stopAt >= 0;
}

/**
 * "mining:attempt": a roll on a wet rock has its chance raised by 15%, so a miss turns into a hit with
 * the probability that makes up the difference.
 */
function waterBoost(attempt, random = Math.random) {
  if (attempt.success || attempt.rock !== ROCK_NAME || !isWet(attempt.object)) return;
  const chance = attempt.chance ?? 0;
  if (chance >= 1) return;
  const boosted = Math.min(1, chance * SUCCESS_BOOST);
  if (random() < (boosted - chance) / (1 - chance)) attempt.success = true;
}

function createMine(api) {
  return new (class CamTorumMine extends api.core.Area {
    constructor() {
      super([new api.core.Boundary(MINE.x, MINE.x2, MINE.y, MINE.y2, MINE.z)]);
    }
  })();
}

/** One task for the whole mine: the water's cycle runs whether or not anyone is there. */
function createWaterTask(api) {
  return new (class CalcifiedWaterTask extends api.core.Task {
    constructor() {
      super(1);
    }

    execute() {
      processWater();
    }
  })();
}

/**
 * `calcified`: Mining's rock entry; `exhaust(object, rock, viewers)` mines a rock out with nothing to keep it;
 * `keeps(object, rock)` is true when the rock's miners have content that keeps it standing.
 */
function attach(api, calcified, exhaust, keeps) {
  core = api.core;
  objects = api.getObjectManager();
  rock = calcified;
  exhaustRock = exhaust;
  keepsStanding = keeps;
  rockSites = null;
  wet.clear();
  Object.assign(cycle, { tick: 0, nextOoze: between(CYCLE_TICKS), stopAt: -1, depleteAt: -1 });
  mine = createMine(api);
  api.registerArea(mine);
  api.getTaskManager().submit(createWaterTask(api));
  api.onCustomEvent("mining:attempt", waterBoost);
}

module.exports = {
  attach,
  ROCK_NAME,
  _test: { mine: () => mine, processWater, waterBoost, pickWetRocks, isWet, wet, cycle, sites, MINE, SUCCESS_BOOST },
};
