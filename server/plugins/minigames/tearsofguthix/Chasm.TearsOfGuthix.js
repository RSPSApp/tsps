"use strict";

/**
 * The Chasm of Tears' light creatures: nine of them drift over the chasm, a tile a tick.
 *
 * rsprox captures (local 1001964 and 1002071, rev 242): nine tog_light_creature (401) are in the
 * chasm, each the cache multinpc that varbit 451 (tog_juna_bowl) turns into the inert
 * tog_light_creature_noop (5434) before the quest and the Attract-able tog_light_creature_op
 * (5435) once Juna has asked for the bowl. They float over the clipped pool (x 3211-3237,
 * y 9505-9529) one tile a tick: of 1,001 consecutive recorded steps 76% kept their heading, 13%
 * turned 45 degrees, 4% 90, 5% 135 and 3% turned back.
 *
 * Ours: the drift is a random walk fitted to those step counts, inside those bounds. The nine
 * spawns (data/definitions/npc-spawns.json) stand on the tiles the first recording first saw
 * them on, as the cache places none. The crossing (TearsOfGuthix.Quest.js) takes a creature over with
 * setScriptedMovement(true) and hands it back when it is done; a scripted creature is left alone.
 */

const CHASM_PLANE = 2;
/** Far enough from the chasm's middle to find every spawn in BOUNDS. */
const SEARCH_RADIUS = 20;
const BOUNDS = { x0: 3211, x1: 3237, y0: 9505, y1: 9529 };
/** The eight headings, clockwise from north. */
const HEADINGS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
/** Turns (in 45-degree steps) by their share of the recorded consecutive steps. */
const TURNS = [[0, 764], [1, 63], [-1, 69], [2, 12], [-2, 24], [3, 28], [-3, 14], [4, 27]];
const TURN_TOTAL = TURNS.reduce((sum, [, weight]) => sum + weight, 0);
/** Ours: the share of ticks a creature holds still (the recorded walks pause now and then). */
const PAUSE_CHANCE = 0.08;
const LIGHT_CREATURE_GAMEVAL = "tog_light_creature";

let api;
/** The chasm's creatures, each with its heading. */
const creatures = new Map();
let random = Math.random;

const inside = (x, y) => x >= BOUNDS.x0 && x <= BOUNDS.x1 && y >= BOUNDS.y0 && y <= BOUNDS.y1;

function pickTurn() {
  let roll = random() * TURN_TOTAL;
  for (const [turn, weight] of TURNS) {
    roll -= weight;
    if (roll < 0) return turn;
  }
  return 0;
}

/** The heading index pointing from a tile towards the middle of the chasm. */
function headingInward(x, y) {
  const dx = Math.sign((BOUNDS.x0 + BOUNDS.x1) / 2 - x);
  const dy = Math.sign((BOUNDS.y0 + BOUNDS.y1) / 2 - y);
  const index = HEADINGS.findIndex(([hx, hy]) => hx === dx && hy === dy);
  return index < 0 ? 0 : index;
}

/** One creature's tick: hold still, or step one tile on its (possibly turned) heading. */
function drift(npc, state) {
  if (npc.isScriptedMovement?.() || random() < PAUSE_CHANCE) return;
  const at = npc.getLocation();
  let heading = (state.heading + pickTurn() + HEADINGS.length) % HEADINGS.length;
  let [dx, dy] = HEADINGS[heading];
  if (!inside(at.getX() + dx, at.getY() + dy)) {
    heading = headingInward(at.getX(), at.getY());
    [dx, dy] = HEADINGS[heading];
  }
  state.heading = heading;
  // The pool is clipped, so a glide (a tile in one tick, as a walk shows) rather than a path.
  npc.exactMove(new api.core.Location(at.getX() + dx, at.getY() + dy, at.getZ()));
}

/** The world's spawns of the creature on the chasm floor, found once they are in the world. */
function gather() {
  const { Location, World, CacheDefinitions } = api.core;
  const id = CacheDefinitions.getNpcId(LIGHT_CREATURE_GAMEVAL);
  const middle = new Location((BOUNDS.x0 + BOUNDS.x1) >> 1, (BOUNDS.y0 + BOUNDS.y1) >> 1, CHASM_PLANE);
  for (const npc of World.getNpcsNear(middle, SEARCH_RADIUS, null)) {
    const at = npc.getLocation();
    if (npc.getId() !== id || at.getZ() !== CHASM_PLANE || !inside(at.getX(), at.getY()) || creatures.has(npc)) continue;
    creatures.set(npc, { heading: Math.floor(random() * HEADINGS.length) });
  }
}

function driftAll() {
  if (creatures.size === 0) gather();
  for (const [npc, state] of creatures) {
    if (npc.isRegistered?.() === false) {
      creatures.delete(npc);
      continue;
    }
    drift(npc, state);
  }
}

/** Points a creature the crossing hands back along a heading (north after a landing, as recorded). */
function setHeading(npc, dx, dy) {
  const state = creatures.get(npc);
  const index = HEADINGS.findIndex(([hx, hy]) => hx === Math.sign(dx) && hy === Math.sign(dy));
  if (state && index >= 0) state.heading = index;
}

function start() {
  const { Task, TaskManager } = api.core;
  const key = {};
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, key, false); }
    execute() { driftAll(); }
  })());
}

module.exports = function registerChasm(pluginApi) {
  api = pluginApi;
  api.onServerStartup(start);
};

Object.assign(module.exports, {
  BOUNDS,
  setHeading,
  isChasmCreature: (npc) => creatures.has(npc),
  _test: { drift, driftAll, gather, creatures, setRandom: (fn) => { random = fn; }, setApi: (value) => { api = value; } },
});
