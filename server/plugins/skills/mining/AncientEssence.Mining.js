"use strict";

/**
 * Ancient essence crystals in the Ghorrock Dungeon mine (Wiki: Ancient essence crystals).
 *
 * The map places only the empty "Wall" (loc 46702) at the mine's three spots. Wiki: "Only one spot
 * will be active at a time, switching between two other nearby spots randomly with 60 to 90 seconds
 * between each movement." So one wall at a time is swapped for the crystals (loc 46701, the wall's own
 * rotation) and moves to a random one of the other two every 100-150 ticks. A miner at the spot it leaves
 * is stopped by the Mining loop, which finds no rock there.
 * shortcut: no capture shows the move, so the swap is a plain loc change with no sound or animation.
 */
const SPOTS = [
  { x: 2908, y: 10311, face: 3 },
  { x: 2915, y: 10311, face: 0 },
  { x: 2912, y: 10307, face: 1 },
];
// Cache locs (Wiki: Ancient essence crystals, Wall).
const CRYSTALS_ID = 46701;
const WALL_ID = 46702;
const MIN_TICKS = 100;
const MAX_TICKS = 150;
// Wiki: 1-2 essence at 75-77 Mining, 2-3 at 78-89, 3-4 from 90.
const AMOUNT_BY_LEVEL = [
  { from: 90, min: 3, max: 4 },
  { from: 78, min: 2, max: 3 },
  { from: 75, min: 1, max: 2 },
];

let api;
let core;
let active = null;
let wait = 0;

/** The essence a success gives at this visible Mining level. */
function essenceAmount(level, random = Math.random) {
  const band = AMOUNT_BY_LEVEL.find(({ from }) => level >= from) ?? AMOUNT_BY_LEVEL.at(-1);
  return band.min + Math.floor(random() * (band.max - band.min + 1));
}

function locAt(spot, locId) {
  return core.MapObjects.get(locId, new core.Location(spot.x, spot.y, 0), null);
}

function swap(from, to) {
  core.MapObjects.remove(from);
  core.ObjectManager.deregister(from, false);
  core.ObjectManager.register(to, true);
}

function showCrystals(spot) {
  const wall = locAt(spot, WALL_ID);
  if (!wall) return false;
  swap(wall, new core.GameObject(CRYSTALS_ID, wall.getLocation().clone(), wall.getType(), wall.getFace(), null));
  return true;
}

function hideCrystals(spot) {
  const crystals = locAt(spot, CRYSTALS_ID);
  if (!crystals) return;
  swap(crystals, new core.GameObject(WALL_ID, crystals.getLocation().clone(), crystals.getType(), crystals.getFace(), null));
}

function nextWait(random = Math.random) {
  return MIN_TICKS + Math.floor(random() * (MAX_TICKS - MIN_TICKS + 1));
}

/** Moves the crystals to a random one of the other spots, or starts them at a random spot. */
function move(random = Math.random) {
  const others = SPOTS.filter((spot) => spot !== active);
  const target = others[Math.floor(random() * others.length)];
  if (!showCrystals(target)) return false;
  if (active) hideCrystals(active);
  active = target;
  wait = nextWait(random);
  return true;
}

function tick() {
  // The map's regions may not be loaded yet at startup: try again next tick.
  if (!active) {
    move();
    return;
  }
  if (--wait <= 0) move();
}

function start() {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1);
    }
    execute() {
      tick();
    }
  })());
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.onServerStartup(start);
}

module.exports = { attach, essenceAmount, _test: { move, tick, SPOTS, state: () => ({ active, wait }) } };
