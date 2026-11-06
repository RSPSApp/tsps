/**
 * Trouble Brewing (https://oldschool.runescape.wiki/w/Trouble_Brewing), on the east side of Mos
 * Le'Harmless. Ids and placements are from `yarn dump:loc` on the current cache; the rules
 * (teams, ingredients, boilers, bottling, 20 minute round, pieces of eight) are the Wiki's.
 *
 * North base is the blue team and the south base the red team: the red flowers grow outside the
 * blue base and the "Blue Water Sign" is on the north hoppers. Waiting rooms are both south:
 * Fancy Dan (red) west, San Fan (blue) east. Coordinates are cache placements, not guesses.
 */
const TEAMS = ["red", "blue"];
const COLOUR = { red: "ff3232", blue: "3366ff" };

/** Base details: the team's own colour, spawn, and every station it owns. */
const BASE = {
  blue: {
    name: "Blue",
    spawn: [3812, 2957, 0],
    conveyor: [3812, 2948, 0],
    kettle: "3812,2946,0",
    logStore: "3810,2946,0",
    pump: "3807,2954,0",
    tools: "3816,2954,0",
    bench: "3818,2954,0",
    boilers: ["3816,2947,0", "3821,2947,0", "3821,2951,0"],
    hoppers: {
      bitternut: "3816,2948,2",
      sweetgrub: "3818,2948,2",
      bark: "3820,2948,2",
      colour: "3822,2948,2",
      water: "3822,2951,2",
    },
  },
  red: {
    name: "Red",
    spawn: [3815, 2996, 0],
    conveyor: [3821, 3003, 0],
    kettle: "3820,3005,0",
    logStore: "3809,2997,0",
    pump: "3806,2997,0",
    tools: "3817,2997,0",
    bench: "3814,2997,0",
    boilers: ["3816,3003,0", "3811,3003,0", "3811,2999,0"],
    hoppers: {
      bitternut: "3817,3003,2",
      sweetgrub: "3815,3003,2",
      bark: "3813,3003,2",
      colour: "3811,3003,2",
      water: "3811,3000,2",
    },
  },
};

/** The player's colour comes from the flowers growing outside the OTHER base. */
const FLOWERS = {
  red: new Set(["3807,2950,0", "3807,2951,0", "3807,2952,0"]),
  blue: new Set(["3806,2999,0", "3806,3000,0", "3806,3001,0"]),
};

const WAITING = {
  red: { spawn: [3801, 3016, 0], bounds: { minX: 3796, maxX: 3808, minY: 3010, maxY: 3022 }, door: "3802,3015,0" },
  blue: { spawn: [3824, 3016, 0], bounds: { minX: 3818, maxX: 3830, minY: 3010, maxY: 3022 }, door: "3823,3015,0" },
};
const LOBBY_RETURN = [3812, 3027, 0];
const ARENA = { minX: 3772, maxX: 3844, minY: 2940, maxY: 3012, z: 0 };

const SWEETGRUB_MOUNDS = new Set([
  "3778,3003,0", "3783,2949,0", "3788,2973,0", "3801,2995,0", "3803,2949,0",
  "3817,2975,0", "3831,2972,0", "3832,2948,0", "3838,2999,0",
]);
const SCRAPEY_TREES = new Set([
  "3784,2956,0", "3787,2991,0", "3788,3001,0", "3789,2972,0",
  "3795,2946,0", "3814,2975,0", "3834,2999,0", "3835,2953,0",
]);
const BITTERNUT_TREES = new Set(["3783,2972,0", "3805,2972,0", "3833,2975,0"]);
const WATERING_HOLE = { minX: 3808, maxX: 3810, minY: 2973, maxY: 2975, z: 0 };
const MONKEY_SPAWNS = [[3786, 2974, 0], [3808, 2974, 0], [3836, 2977, 0]];
const JUNGLE_TREES = new Set([
  "3778,2953,0", "3781,3002,0", "3787,2951,0", "3788,2996,0", "3799,2998,0",
  "3801,2950,0", "3828,2953,0", "3828,3000,0", "3835,2994,0", "3836,2946,0",
  "3780,2992,0", "3782,2951,0", "3786,2946,0", "3791,2955,0", "3794,2992,0",
  "3795,3004,0", "3827,2946,0", "3836,3003,0", "3777,2987,0", "3780,2956,0",
  "3784,2987,0", "3793,2950,0", "3799,2959,0", "3800,2991,0", "3804,2975,0",
  "3812,2978,0", "3817,2988,0", "3826,3005,0", "3827,2950,0", "3827,2993,0",
  "3832,2954,0", "3837,2958,0",
]);

/** Round timing (Wiki: 20 minute games, 38 s per bottle, 2 s before it is collectable). */
const GAME_TICKS = 2000;
const BREW_TICKS = 63;
const BOTTLE_LIFETIME = 57;
/** 2006 Jagex KB: "it consumes one log per minute" (100 game ticks), per burning boiler. */
const BOILER_BURN_TICKS = 100;
const START_COUNTDOWN = 50;
const BREW_REQUIRED = { bitternut: 1, sweetgrub: 1, water: 5, colour: 3, bark: 1 };
const MIN_BOILER_LOGS = 3;
const MAX_BOILER_LOGS = 10;
const MAX_KETTLE_FLOWERS = 10;
const MAX_FLOWERS = 5;
const STORE_LOGS = 75;

const PIECES_ATTRIBUTE = "trouble-brewing:pieces-of-eight";

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

const key = (location) => `${location.x ?? location.getX()},${location.y ?? location.getY()},${location.z ?? location.getZ()}`;
const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);
const other = (team) => (team === "red" ? "blue" : "red");
const randomInt = (low, high) => low + Math.floor(Math.random() * (high - low + 1));

function inArena(location) {
  const z = location.z ?? location.getZ();
  const x = location.x ?? location.getX();
  const y = location.y ?? location.getY();
  return z === ARENA.z && x >= ARENA.minX && x <= ARENA.maxX && y >= ARENA.minY && y <= ARENA.maxY;
}

function inWaiting(location, team) {
  const box = WAITING[team].bounds;
  const z = location.z ?? location.getZ();
  const x = location.x ?? location.getX();
  const y = location.y ?? location.getY();
  return z === 0 && x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(Math.max(1, ticks), null, false); }
    execute() { this.stop(); action(); }
  })());
}

function every(action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, null, false); }
    execute() { if (action() === false) this.stop(); }
  })());
}

const ticksToSeconds = (ticks) => Math.max(0, Math.floor(ticks * 0.6));
const clock = (ticks) => {
  const total = ticksToSeconds(ticks);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

module.exports = {
  init,
  get api() { return api; },
  get core() { return core; },
  TEAMS, COLOUR, BASE, FLOWERS, WAITING, LOBBY_RETURN, ARENA,
  SWEETGRUB_MOUNDS, SCRAPEY_TREES, BITTERNUT_TREES, WATERING_HOLE, MONKEY_SPAWNS, JUNGLE_TREES,
  GAME_TICKS, BREW_TICKS, BOTTLE_LIFETIME, BOILER_BURN_TICKS, START_COUNTDOWN,
  BREW_REQUIRED, MIN_BOILER_LOGS, MAX_BOILER_LOGS, MAX_KETTLE_FLOWERS, MAX_FLOWERS, STORE_LOGS,
  PIECES_ATTRIBUTE,
  key, toLocation, other, randomInt, inArena, inWaiting, later, every, clock,
};
