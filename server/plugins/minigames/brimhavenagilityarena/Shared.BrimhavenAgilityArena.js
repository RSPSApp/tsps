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

/** The 24 dispensers as the cache places them (6 of them are the darts version, 3581). */
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

/**
 * Walk-over traps, as spans of path tiles: `axis` is the way the path runs, `at` the path's other
 * coordinate, `from`-`to` the tiles a player is caught on. Standing on any of them at a tick's end
 * sets the trap off, and the player is jumped (the darts: walked) to the first tile past the span
 * in the way they were going (rsprox 1735, 1738, 4308, 75). Floor spikes (3582) and pressure pads
 * (3585) are the cache's own tiles. The spinning blades (3580, 1x3) stand beside the path, and the
 * captures jump players over the three path tiles beside them (2777-2779 at y 9557 and 9579,
 * 9573-9575 at x 2783). The darts fire on the middle two tiles of the three corridors that join
 * two darts dispensers with nothing else between them (captured on 2777/2778, 2788 and 9573;
 * 2789 and 9574 by symmetry).
 */
const TRAP_SPANS = [
  { kind: "FLOOR_SPIKES", axis: "y", at: 2772, from: 9551, to: 9552 },
  { kind: "FLOOR_SPIKES", axis: "x", at: 9568, from: 2799, to: 2800 },
  { kind: "FLOOR_SPIKES", axis: "y", at: 2761, from: 9573, to: 9574 },
  { kind: "PRESSURE_PAD", axis: "x", at: 9557, from: 2799, to: 2800 },
  { kind: "PRESSURE_PAD", axis: "x", at: 9579, from: 2799, to: 2800 },
  { kind: "PRESSURE_PAD", axis: "y", at: 2772, from: 9584, to: 9585 },
  { kind: "SPINNING_BLADES", axis: "x", at: 9557, from: 2777, to: 2779 },
  { kind: "SPINNING_BLADES", axis: "x", at: 9579, from: 2777, to: 2779 },
  { kind: "SPINNING_BLADES", axis: "y", at: 2783, from: 9573, to: 9575 },
  { kind: "DARTS", axis: "x", at: 9568, from: 2777, to: 2778 },
  { kind: "DARTS", axis: "x", at: 9557, from: 2788, to: 2789 },
  { kind: "DARTS", axis: "y", at: 2794, from: 9573, to: 9574 },
];
const PRESSURE_PAD_COOLDOWN_TICKS = 8;
const PRESSURE_PAD_USES = 2;

/** Obstacle XP as the Wiki lists it (without Karamja gloves). */
const OBSTACLE_XP = {
  BALANCING_ROPE: 10, LOG_BALANCE: 12, BALANCING_LEDGE: 16, MONKEY_BARS: 14, LOW_WALL: 8,
  ROPE_SWING: 20, PLANK: 6, PILLAR: 18, HAND_HOLDS: 22, PRESSURE_PAD: 26, FLOOR_SPIKES: 24,
  SPINNING_BLADES: 28, DARTS: 30,
};
/** Only these obstacles have an Agility requirement (Wiki: Brimhaven Agility Arena, Hand holds). */
const OBSTACLE_LEVEL = { PRESSURE_PAD: 20, FLOOR_SPIKES: 20, HAND_HOLDS: 20, SPINNING_BLADES: 40, DARTS: 40 };
/** Karamja gloves 2-4 add 10% to obstacle XP, but not to the tag XP (Wiki). */
const GLOVES_XP_BONUS = 1.1;
/** Floor spikes stop failing at 50 Agility (Wiki). */
const FLOOR_SPIKES_NEVER_FAIL = 50;

/** Skilling success-chart endpoints from level 40 (Wiki: the Darts and Spinning blades pages). */
const DARTS_SUCCESS = { low: 131, high: 255 };
const BLADES_SUCCESS = { low: 153, high: 255 };

const RECEIVED_MESSAGE = "You have received an Agility Arena Ticket and Brimhaven Voucher!";
/** Every tag first sends the count line, worded like the courses' lap counts (rsprox 75, 1738, 1863). */
const LAP_MESSAGE = (laps) => `Your Agility Arena lap count is: <col=ff0000>${laps}</col>.`;
const LAPS_ATTRIBUTE = "brimhaven-agility-arena:laps";
/** The tag's item box shows the old ticket (2996) at zoom 400, with jingle 71 (rsprox 75, 1863). */
const TAG_BOX_ITEM = 2996;
const TAG_JINGLE = 71;
/** The Karamja Diary's medium task, done on a first tag (rsprox 75). */
const DIARY_TASK = { diary: "karamja", task: "claim-a-ticket-from-the-agility-arena-in-brimhav" };
/** The Elite Karamja Diary's chance of two tickets and vouchers per tag (Wiki). */
const DIARY_DOUBLE_CHANCE = 0.1;
const REPEAT_MESSAGE = "You can only get one ticket at a time, wait till the arrow moves again.";
const INACTIVE_MESSAGE = "You can only get a ticket when the flashing arrow is above the pillar.";
const BLADES_FAIL_MESSAGE = "You were hit by the spinning blades!";
const DARTS_FAIL_MESSAGE = "You were hit by some darts, something on them makes you feel dizzy!";
const FEE_MESSAGE = "You give Cap'n Izzy the 200 coin entrance fee.";

/** tile -> the trap span covering it. */
const TRAPS = new Map();
for (const span of TRAP_SPANS) {
  for (let along = span.from; along <= span.to; along++) {
    const [x, y] = span.axis === "x" ? [along, span.at] : [span.at, along];
    TRAPS.set(tileKey(x, y), span);
  }
}

let api = null;
let core = null;
let random = Math.random;
/** The one world cycle: the tick clock, how many cycles have passed, and the active dispenser. */
const cycle = { tick: 0, index: -1, active: null, nextAt: CYCLE_TICKS };
/** player -> per-session state. */
const sessions = new Map();

function init(pluginApi) {
  api = pluginApi;
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
      /** The tile the player stood on at the end of the previous tick, to tell which way they go. */
      lastAt: null,
      lastTrap: null,
      padUses: 0,
      padCooldownUntil: 0,
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

function wearsBonusGloves(player) {
  const slot = core.Equipment?.HANDS_SLOT;
  if (slot == null) return false;
  const gloves = player.getEquipment?.()?.get?.(slot);
  return /^Karamja gloves [234]$/.test(gloves?.getDefinition?.()?.getName?.() ?? "");
}

/** An obstacle's (or trap's) XP, with the Karamja gloves bonus. */
function addObstacleXp(player, kind) {
  const xp = OBSTACLE_XP[kind] ?? 0;
  addXp(player, wearsBonusGloves(player) ? xp * GLOVES_XP_BONUS : xp);
}

function diaryComplete(player, tier) {
  const request = { player, diary: "karamja", tier, complete: null };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
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

/**
 * The ticket and voucher, plus the scaled XP, the count and the announcement. The ticket is the
 * 2024 one (29480; 2996 is the discontinued ticket), as the captures' inventories show.
 */
function rewardTag(player) {
  const state = stateOf(player);
  state.taggedCycle = cycle.index;
  state.lastTrap = "TAG";
  const Items = core.ItemIdentifiers;
  const count = diaryComplete(player, "elite") && random() < DIARY_DOUBLE_CHANCE ? 2 : 1;
  const award = { player, minigame: "brimhaven-agility-arena", points: count };
  api.emitCustomEvent("minigame:points", award);
  const laps = (Number(player.getAttribute(LAPS_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(LAPS_ATTRIBUTE, laps);
  player.sendMessage(LAP_MESSAGE(laps));
  api.emitCustomEvent("diary:task", { player, ...DIARY_TASK });
  player.getInventory().forceAdd(player, new core.Item(Items.AGILITY_ARENA_TICKET_3, award.points));
  player.getInventory().forceAdd(player, new core.Item(Items.BRIMHAVEN_VOUCHER, award.points));
  addXp(player, tagXp(agilityLevel(player)));
  // ponytail: the main game's wording for more than one is not recorded; the Leagues one is
  // "You have received 1 Agility Arena Tickets and 8 Brimhaven Vouchers!" (rsprox 75).
  const text = award.points === 1
    ? RECEIVED_MESSAGE
    : `You have received ${award.points} Agility Arena Tickets and ${award.points} Brimhaven Vouchers!`;
  const sender = player.getPacketSender();
  if (sender.sendTypedMessage && core.ChatType) sender.sendTypedMessage(core.ChatType.SPAM, text);
  else player.sendMessage(text);
  sender.sendJingle?.(TAG_JINGLE, 0);
  if (core.ItemStatementDialogue && core.DialogueChainBuilder) {
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
      new core.ItemStatementDialogue(0, TAG_BOX_ITEM, text.replace(" and ", " and<br>")),
    ));
  }
}

/** The trap span covering a tile, or null. */
function trapSpanAt(x, y) {
  return TRAPS.get(tileKey(x, y)) ?? null;
}

function trapAt(x, y) {
  return trapSpanAt(x, y)?.kind ?? null;
}

module.exports = {
  init,
  core: () => core,
  setRandom: (fn) => { random = fn; },
  CYCLE_TICKS, CYCLE_TASK_KEY, ARENA_PLANE, ARENA, HUT, ENTRY, ENTRY_FEE, PAID_ATTRIBUTE, NPC,
  OBSTACLE_IDS, OBJECTS, DISPENSER_TILES, TRAP_SPANS, OBSTACLE_XP, OBSTACLE_LEVEL,
  DARTS_SUCCESS, BLADES_SUCCESS, FLOOR_SPIKES_NEVER_FAIL, GLOVES_XP_BONUS,
  PRESSURE_PAD_COOLDOWN_TICKS, PRESSURE_PAD_USES, LAPS_ATTRIBUTE, LAP_MESSAGE,
  RECEIVED_MESSAGE, REPEAT_MESSAGE, INACTIVE_MESSAGE, BLADES_FAIL_MESSAGE,
  DARTS_FAIL_MESSAGE, FEE_MESSAGE,
  cycle, sessions, tileKey, stateOf, hasSession, clearState, agilityLevel, tagXp, addXp,
  addObstacleXp, wearsBonusGloves, trapDamage, hit, drainAgility, successChance, roll,
  levelRefusal, activeTile, advanceCycle, tick, sendArrow, isInArena, rewardTag, trapAt,
  trapSpanAt,
};
