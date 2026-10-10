"use strict";

/**
 * Brimhaven Agility Arena: shared ids, the world's ticket cycle and the small helpers every unit
 * uses. The 24 Ticket Dispensers sit on a 5x5 grid of pillars; one is active for 100 ticks
 * (one minute) at a time, marked with the native hint arrow over it.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Brimhaven_Agility_Arena
 */

const CYCLE_TICKS = 100;
const CYCLE_TASK_KEY = "brimhaven-agility-arena:cycle";
/** The arena is its own plane under the Brimhaven hut. */
const ARENA_PLANE = 3;
const ARENA = { minX: 2759, maxX: 2806, minY: 9544, maxY: 9592 };
/** The entrance hut, where the exit ladder lands (rsprox captures); logging out inside too. */
const HUT = { x: 2808, y: 3193, z: 0 };
/** Centre of the 3x3 the hut ladder lands on, beside the exit ladder (3618) (rsprox captures). */
const ENTRY = { x: 2805, y: 9590, z: 3 };
/** Fee paid and not yet spent (OSRS keeps it in varbit agilityarena_canenter). */
const PAID_ATTRIBUTE = "brimhaven-agility-arena:paid";
const ENTRY_FEE = 200;

const NPC = { IZZY: "Cap'n Izzy No-Beard" };

/** The arena's cache block; variants of one obstacle share a name. */
const OBSTACLE_IDS = {
  BALANCING_ROPE: [3551, 3552],
  LOG_BALANCE: [3553, 3554, 3555, 3556, 3557, 3558],
  BALANCING_LEDGE: [3559, 3560, 3561, 3562],
  MONKEY_BARS: [3563, 3564],
  LOW_WALL: [3565],
  ROPE_SWING: [3566],
  PLANK: [3570, 3571, 3572, 3573, 3574, 3575, 3576],
  PILLAR: [3578, 3579],
  HAND_HOLDS: [3583, 3584],
};
const OBJECTS = {
  ENTRANCE_LADDER: 3617,
  EXIT_LADDER: 3618,
  SPINNING_BLADES: 3580,
  DARTS_DISPENSER: 3581,
  TICKET_DISPENSER: 3608,
};

/** The 24 dispensers as the cache places them (8 of them are the darts version). */
const DISPENSER_TILES = [
  { id: 3608, x: 2761, y: 9546 }, { id: 3608, x: 2772, y: 9546 }, { id: 3608, x: 2783, y: 9546 },
  { id: 3608, x: 2794, y: 9546 }, { id: 3608, x: 2805, y: 9546 },
  { id: 3608, x: 2761, y: 9557 }, { id: 3608, x: 2772, y: 9557 }, { id: 3581, x: 2783, y: 9557 },
  { id: 3581, x: 2794, y: 9557 }, { id: 3608, x: 2805, y: 9557 },
  { id: 3608, x: 2761, y: 9568 }, { id: 3581, x: 2772, y: 9568 }, { id: 3581, x: 2783, y: 9568 },
  { id: 3581, x: 2794, y: 9568 }, { id: 3608, x: 2805, y: 9568 },
  { id: 3608, x: 2761, y: 9579 }, { id: 3608, x: 2772, y: 9579 }, { id: 3608, x: 2783, y: 9579 },
  { id: 3581, x: 2794, y: 9579 }, { id: 3608, x: 2805, y: 9579 },
  { id: 3608, x: 2761, y: 9590 }, { id: 3608, x: 2772, y: 9590 }, { id: 3608, x: 2783, y: 9590 },
  { id: 3608, x: 2794, y: 9590 },
];

/** Walk-over traps: stepping on the tile rolls the obstacle. */
const FLOOR_SPIKE_TILES = [[2772, 9551], [2772, 9552], [2799, 9568], [2800, 9568], [2761, 9573], [2761, 9574]];
const PRESSURE_PAD_TILES = [[2799, 9557], [2800, 9557], [2799, 9579], [2800, 9579], [2772, 9584], [2772, 9585]];
/** Spinning blades (3580) occupy these tiles; the tiles next to them are where a player is hit. */
const BLADE_TILES = [
  [2777, 9556], [2778, 9556], [2779, 9556],
  [2782, 9573], [2782, 9574], [2782, 9575],
  [2777, 9580], [2778, 9580], [2779, 9580],
];
/** Ticks between spinning-blade rolls, `ponytail:` the Wiki gives 5t to cross, so one roll a crossing. */
const BLADE_COOLDOWN_TICKS = 5;
const PRESSURE_PAD_COOLDOWN_TICKS = 8;
const PRESSURE_PAD_USES = 2;

/** Obstacle XP as the Wiki lists it (without Karamja gloves). */
const OBSTACLE_XP = {
  BALANCING_ROPE: 10, LOG_BALANCE: 12, BALANCING_LEDGE: 16, MONKEY_BARS: 14, LOW_WALL: 8,
  ROPE_SWING: 20, PLANK: 6, PILLAR: 18, HAND_HOLDS: 22, PRESSURE_PAD: 26, FLOOR_SPIKES: 24,
  SPINNING_BLADES: 28, DARTS: 30,
};
/** Only these obstacles have an Agility requirement (Wiki). */
const OBSTACLE_LEVEL = { PRESSURE_PAD: 20, FLOOR_SPIKES: 20, SPINNING_BLADES: 40, DARTS: 40 };
/** Floor spikes stop failing at 50 Agility (Wiki). */
const FLOOR_SPIKES_NEVER_FAIL = 50;

/** OSRS success-chart endpoints for dodging the darts: ~70.7% at 40, always at 99. */
const DARTS_SUCCESS = { low: 130, high: 255 };

const RECEIVED_MESSAGE = "You have received an Agility Arena Ticket and Brimhaven Voucher!";
const REPEAT_MESSAGE = "You can only get one ticket at a time, wait till the arrow moves again.";
const INACTIVE_MESSAGE = "You can only get a ticket when the flashing arrow is above the pillar.";
const BLADES_FAIL_MESSAGE = "You were hit by the spinning blades!";
const DARTS_FAIL_MESSAGE = "You were hit by some darts, something on them makes you feel dizzy!";
const FEE_MESSAGE = "You give Cap'n Izzy the 200 coin entrance fee.";

const TRAPS = new Map();
for (const [x, y] of FLOOR_SPIKE_TILES) TRAPS.set(tileKey(x, y), "FLOOR_SPIKES");
for (const [x, y] of PRESSURE_PAD_TILES) TRAPS.set(tileKey(x, y), "PRESSURE_PAD");

/** Tiles one step off a blade tile, where the blades catch the player. */
const BLADE_HITS = new Set();
for (const [x, y] of BLADE_TILES) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    BLADE_HITS.add(tileKey(x + dx, y + dy));
  }
}
for (const [x, y] of BLADE_TILES) BLADE_HITS.delete(tileKey(x, y));

let core = null;
let random = Math.random;
/** The one world cycle: the tick clock, how many cycles have passed, and the active dispenser. */
const cycle = { tick: 0, index: -1, active: null, nextAt: CYCLE_TICKS };
/** player -> per-session state. */
const sessions = new Map();

function init(pluginApi) {
  core = pluginApi.core;
}

function tileKey(x, y) {
  return `${x},${y}`;
}

function stateOf(player) {
  let state = sessions.get(player);
  if (!state) {
    state = {
      taggedCycle: -1,
      lastTile: null,
      lastTrap: null,
      padUses: 0,
      padCooldownUntil: 0,
      bladeCooldownUntil: 0,
    };
    sessions.set(player, state);
  }
  return state;
}

function hasSession(player) {
  return sessions.has(player);
}

function clearState(player) {
  sessions.delete(player);
}

function agilityLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.AGILITY);
}

/** Wiki: 30 XP per 10 Agility levels, boosted level counts, capped at 300. */
function tagXp(level) {
  return 30 * Math.min(10, Math.floor(level / 10));
}

function addXp(player, amount) {
  if (amount > 0) {
    player.getSkillManager().addExperiences(core.Skill.AGILITY, amount);
  }
}

/** Trap damage: floor(current HP * 5 / 100) + 2 (Wiki, Mod Ash). */
function trapDamage(hitpoints) {
  return Math.floor((hitpoints * 5) / 100) + 2;
}

function hit(player, amount) {
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(amount, core.HitMask.RED)]);
}

function drainAgility(player, amount) {
  const skills = player.getSkillManager();
  skills.setCurrentLevel(core.Skill.AGILITY, Math.max(0, agilityLevel(player) - amount), true);
}

/** The OSRS skilling success roll in 256ths (Wiki: Skilling success rate). */
function successChance(low, high, level) {
  const capped = Math.max(1, Math.min(99, level));
  return (1 + Math.floor((low * (99 - capped)) / 98 + (high * (capped - 1)) / 98 + 0.5)) / 256;
}

function roll(chance) {
  return random() < chance;
}

function levelRefusal(level) {
  return `You need an Agility level of at least ${level} to attempt this.`;
}

function activeTile() {
  return cycle.active;
}

/** Picks a different dispenser for the new cycle and moves everyone's arrow to it. */
function advanceCycle() {
  let index = Math.floor(random() * DISPENSER_TILES.length);
  if (cycle.active && DISPENSER_TILES[index] === cycle.active) {
    index = (index + 1) % DISPENSER_TILES.length;
  }
  cycle.index++;
  cycle.active = DISPENSER_TILES[index];
  cycle.nextAt = cycle.tick + CYCLE_TICKS;
  for (const player of sessions.keys()) {
    if (isInArena(player)) sendArrow(player);
  }
}

function tick() {
  cycle.tick++;
  if (!cycle.active || cycle.tick >= cycle.nextAt) {
    advanceCycle();
  }
}

function sendArrow(player) {
  const tile = activeTile();
  if (!tile) return;
  const sender = player.getPacketSender();
  // Centre of the tile at height 60, as captured.
  sender.sendPositionalHint(new core.Location(tile.x, tile.y, ARENA_PLANE), 2, 60, ARENA_PLANE);
}

function isInArena(player) {
  const at = player.getLocation();
  return at.getZ() === ARENA_PLANE
    && at.getX() >= ARENA.minX && at.getX() <= ARENA.maxX
    && at.getY() >= ARENA.minY && at.getY() <= ARENA.maxY;
}

/** The ticket and voucher, plus the scaled XP and the announcement. */
function rewardTag(player) {
  const state = stateOf(player);
  state.taggedCycle = cycle.index;
  state.lastTrap = "TAG";
  const Items = core.ItemIdentifiers;
  player.getInventory().forceAdd(player, new core.Item(Items.AGILITY_ARENA_TICKET, 1));
  player.getInventory().forceAdd(player, new core.Item(Items.BRIMHAVEN_VOUCHER, 1));
  addXp(player, tagXp(agilityLevel(player)));
  player.sendMessage(RECEIVED_MESSAGE);
}

function trapAt(x, y) {
  return TRAPS.get(tileKey(x, y)) ?? null;
}

function isBladeHit(x, y) {
  return BLADE_HITS.has(tileKey(x, y));
}

module.exports = {
  init,
  core: () => core,
  setRandom: (fn) => { random = fn; },
  CYCLE_TICKS, CYCLE_TASK_KEY, ARENA_PLANE, ARENA, HUT, ENTRY, ENTRY_FEE, PAID_ATTRIBUTE, NPC,
  OBSTACLE_IDS, OBJECTS, DISPENSER_TILES, BLADE_TILES, OBSTACLE_XP, OBSTACLE_LEVEL,
  DARTS_SUCCESS, FLOOR_SPIKES_NEVER_FAIL,
  PRESSURE_PAD_COOLDOWN_TICKS, PRESSURE_PAD_USES, BLADE_COOLDOWN_TICKS,
  RECEIVED_MESSAGE, REPEAT_MESSAGE, INACTIVE_MESSAGE, BLADES_FAIL_MESSAGE,
  DARTS_FAIL_MESSAGE, FEE_MESSAGE,
  cycle, sessions, tileKey, stateOf, hasSession, clearState, agilityLevel, tagXp, addXp,
  trapDamage, hit, drainAgility, successChance, roll, levelRefusal, activeTile, advanceCycle,
  tick, sendArrow, isInArena, rewardTag, trapAt, isBladeHit,
};
