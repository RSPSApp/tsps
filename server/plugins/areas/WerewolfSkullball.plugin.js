"use strict";

// Werewolf Skullball (Wiki: Werewolf Skullball, Skullball Boss, Skullball Trainer, Skullball, and their
// transcripts). The Skullball Boss gives a player wearing a ring of Charos, with 25 Agility, a skullball
// from one of the four spawnholes. Tap, Kick and Shoot move it 1, 4 and 9 tiles away from the player,
// one tile a tick, bouncing back off walls; it must cross the ten goals in order "through the skeleton's
// feet", then the first goal again. The timer starts at the first goal: 750 Agility XP under four
// minutes, 8 less for every 3 seconds over. The scoreboard is the cache's werewolf_goal interface.
//
// data/werewolf-skullball.json lists the goals (werewolf_goal_mid, in the Wiki route's order, with the
// way the loc faces) and the spawnholes, checked against the cache map by the test.
//
// No recording has a game in it, so the ball's speed (a walking NPC's tile a tick), the bounce (back the
// way it came for the rest of its distance), who may kick it (its owner), the Agility refusal line and
// the missing sounds and goal jingle are this plugin's choices, not captured behaviour. So is a ball
// resting on a goal's tile moving only along the goal's line. The trainer's pronoun pick mirrors the
// dialogue plugin's "[He/She/They]" rule; plugins share no formatter, and these lines are overheads,
// not a played transcript.

const DATA = require("./data/werewolf-skullball.json");
const TRANSCRIPTS = require("../../data/definitions/npc-dialogues.json");

const GOAL_EVENT = "skullball:goal";
const COURSE = "werewolf-skullball";
const BALL = "waa_skullball";
const BOSS = "werewolf_skullballboss";
const TRAINER = "werewolf_trainer_1";
const KICK = "kick_skull_ball";
const SCOREBOARD = "werewolf_goal";
const TIME_TEXT = "werewolf_goal:waa_time";
const XP_TEXT = "werewolf_goal:waa_xp";
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
const RINGS_OF_CHAROS = ["RING_OF_CHAROS", "RING_OF_CHAROS_A_"];
const AGILITY_LEVEL = 25;
const DISTANCE = { Tap: 1, Kick: 4, Shoot: 9 };
const FULL_XP = 750;
const PAR_SECONDS = 240;
const LATE_STEP_SECONDS = 3;
const LATE_XP = 8;
const SECONDS_PER_TICK = 0.6;
const DIRECTIONS = { north: [0, 1], east: [1, 0], south: [0, -1], west: [-1, 0] };

// Skullball Boss transcript actions (data/definitions/npc-dialogues.json).
const SPAWN_ACTION = "9-jEF4";
const NEW_BALL_ACTION = "AZK3fS";
const GIVE_UP_ACTION = "VGXgYE";
const VARIANT = {
  standard: "standard-dialogue",
  playing: "after-starting-the-skullball-course",
  human: "when-not-wearing-the-ring-of-charos",
};
const TRAINER_LINES = {
  goal: "overhead-dialogue-when-shooting-the-skullball-through-one-of-the-intermediary-goals",
  last: "overhead-dialogue-when-scoring-the-last-goal",
  goalHuman: "overhead-dialogue-when-shooting-the-skullball-through-one-of-the-intermediary-goals-without-a-ring-of-charos-equipped",
  lastHuman: "overhead-dialogue-when-scoring-the-last-goal-without-a-ring-of-charos-equipped",
};

let api;
let core;
let random = Math.random;
/** player -> { npc, scored, startedTick, motion } */
const games = new Map();
let tick = 0;

const npcId = name => core.CacheDefinitions.getNpcId(name);
const goalCount = () => DATA.goals.length + 1;
/** The goal to score next: the ten in order, then the first again. */
const goalAt = scored => DATA.goals[scored % DATA.goals.length];

function wearsRing(player) {
  const ring = player.getEquipment().getItems()[core.Equipment.RING_SLOT];
  return !!ring && RINGS_OF_CHAROS.some(name => core.ItemIdentifiers[name] === ring.getId());
}

function transcriptLines(variant) {
  const steps = TRANSCRIPTS["Skullball Trainer"]?.variants?.[variant] ?? [];
  const alternatives = steps.find(step => step.type === "random");
  const all = alternatives ? alternatives.options.flatMap(option => option.steps) : steps;
  return all.filter(step => typeof step.npc === "string").map(step => step.npc);
}

/** The transcript's "[He shoots/She shoots/They shoot]" for the player's pronouns. */
function pronounText(text, player) {
  const pronouns = player.getAppearance?.()?.getPronouns?.() ?? 0;
  const wanted = [/^(he|him|his)\b/i, /^(she|her|hers)\b/i, /^(they|them|their)\b/i][Math.min(Math.max(pronouns, 0), 2)];
  return text.replace(/\[([^\]]+)\]/g, (whole, body) => body.split("/").find(part => wanted.test(part.trim()))?.trim() ?? whole);
}

/** The trainers stand along the course, at most this far from a goal. */
const TRAINER_RANGE = 20;

function nearestTrainer(location) {
  let best = null;
  for (const npc of core.World.getNpcsNear(location, TRAINER_RANGE, null)) {
    if (npc.getId?.() !== npcId(TRAINER)) continue;
    if (!best || npc.getLocation().getDistance(location) < best.getLocation().getDistance(location)) best = npc;
  }
  return best;
}

function trainerSays(player, location, variant) {
  const lines = transcriptLines(variant);
  if (lines.length) nearestTrainer(location)?.forceChat(pronounText(lines[Math.floor(random() * lines.length)], player));
}

function removeBall(player) {
  const game = games.get(player);
  if (!game) return;
  games.delete(player);
  // removeNpc also takes a ball still waiting in the world's add queue.
  if (game.npc) api.removeNpc(game.npc);
}

function spawnBall(player) {
  removeBall(player);
  const [x, y] = DATA.holes[Math.floor(random() * DATA.holes.length)];
  const npc = api.spawnNpc({ id: npcId(BALL), x, y: y + 1, z: DATA.arena.z, wanderRadius: 0, owner: player });
  if (!npc) return;
  npc.setFlag?.(IGNORE_CLIPPING_FLAG, true);
  games.set(player, { npc, scored: 0, startedTick: null, motion: null });
  // "An arrow will point to your ball" (the Skullball Boss).
  player.getPacketSender().sendEntityHint(npc);
}

/** The goal on this tile, as its index in DATA.goals. */
function goalIndexAt(x, y) {
  return DATA.goals.findIndex(([gx, gy]) => gx === x && gy === y);
}

function alongAxis(goal, [dx, dy]) {
  const [gx, gy] = DIRECTIONS[goal[2]];
  return (dx !== 0 && gx !== 0) || (dy !== 0 && gy !== 0);
}

/** One step for the ball: open ground, or through a goal's feet along the goal's own line. */
function canStep(x, y, z, direction) {
  const [dx, dy] = direction;
  const into = goalIndexAt(x + dx, y + dy);
  if (into >= 0) return alongAxis(DATA.goals[into], direction);
  const from = goalIndexAt(x, y);
  if (from >= 0) return alongAxis(DATA.goals[from], direction) && !core.RegionManager.blocked(new core.Location(x + dx, y + dy, z), null);
  return core.RegionManager.canMove(x, y, x + dx, y + dy, z, 1, 1, null);
}

function scoreIfGoal(player, game, x, y, direction) {
  const goal = goalAt(game.scored);
  const [gx, gy] = DIRECTIONS[goal[2]];
  if (goal[0] !== x || goal[1] !== y || gx !== direction[0] || gy !== direction[1]) return;
  game.scored++;
  if (game.startedTick === null) game.startedTick = tick;
  const human = !wearsRing(player);
  const location = new core.Location(x, y, DATA.arena.z);
  api.emitCustomEvent(GOAL_EVENT, { player, course: COURSE, goal: game.scored, location });
  if (game.scored < goalCount()) {
    trainerSays(player, location, human ? TRAINER_LINES.goalHuman : TRAINER_LINES.goal);
    return;
  }
  trainerSays(player, location, human ? TRAINER_LINES.lastHuman : TRAINER_LINES.last);
  finish(player, game);
}

/** 750 under four minutes, 8 less for every 3 seconds over (Wiki). */
function experienceFor(seconds) {
  if (seconds <= PAR_SECONDS) return FULL_XP;
  return Math.max(0, FULL_XP - LATE_XP * Math.floor((seconds - PAR_SECONDS) / LATE_STEP_SECONDS));
}

function finish(player, game) {
  const seconds = Math.round((tick - game.startedTick) * SECONDS_PER_TICK);
  const xp = experienceFor(seconds);
  removeBall(player);
  player.getSkillManager().addExperiences(core.Skill.AGILITY, xp);
  const C = core.CacheDefinitions;
  const sender = player.getPacketSender();
  sender.sendInterface(C.getInterfaceId(SCOREBOARD));
  sender.sendString(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`, C.getComponentId(TIME_TEXT));
  sender.sendString(String(xp), C.getComponentId(XP_TEXT));
}

/** Each tick a kicked ball rolls a tile; blocked, it comes back the way it went. */
function roll() {
  tick++;
  for (const [player, game] of games) {
    const motion = game.motion;
    if (!motion || motion.left <= 0) continue;
    const location = game.npc.getLocation();
    const x = location.getX(), y = location.getY(), z = location.getZ();
    if (!canStep(x, y, z, motion.direction)) {
      motion.direction = [-motion.direction[0], -motion.direction[1]];
      if (!canStep(x, y, z, motion.direction)) { motion.left = 0; continue; }
    }
    game.npc.getMovementQueue().walkStep(motion.direction[0], motion.direction[1]);
    motion.left--;
    scoreIfGoal(player, game, x + motion.direction[0], y + motion.direction[1], motion.direction);
  }
}

function kick(event, option) {
  const { player, npc } = event;
  const game = games.get(player);
  if (!game || game.npc !== npc) return true;
  const from = player.getLocation(), at = npc.getLocation();
  const dx = Math.sign(at.getX() - from.getX()), dy = Math.sign(at.getY() - from.getY());
  // Players reach an NPC from a side, never a corner; a ball rolled off meanwhile isn't kicked.
  if ((dx !== 0) === (dy !== 0) || from.getDistance(at) > 1) return true;
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(KICK)));
  game.motion = { direction: [dx, dy], left: DISTANCE[option] };
  // Show-Goal moved the arrow to the goal; the next kick puts it back on the ball.
  if (game.showingGoal) {
    game.showingGoal = false;
    player.getPacketSender().sendEntityHint(npc);
  }
  return true;
}

function tap(event) { return kick(event, "Tap"); }
function kickFour(event) { return kick(event, "Kick"); }
function shoot(event) { return kick(event, "Shoot"); }

/** Show-Goal: the hint arrow moves to the next goal. */
function showGoal({ player, npc }) {
  const game = games.get(player);
  if (!game || game.npc !== npc) return true;
  const [x, y] = goalAt(game.scored);
  game.showingGoal = true;
  player.getPacketSender().sendPositionalHint(new core.Location(x, y, DATA.arena.z));
  return true;
}

function selectVariant({ npcId: id, player }) {
  if (id !== npcId(BOSS)) return null;
  if (!wearsRing(player)) return VARIANT.human;
  return games.has(player) ? VARIANT.playing : VARIANT.standard;
}

/**
 * The cache spells these werewolves' option "Talk-To", which the shared transcript player (keyed on
 * "Talk-to") never answers, so their transcripts are started here.
 */
function talk({ player, npc, npcId: id }) {
  const variant = id === npcId(BOSS) ? selectVariant({ npcId: id, player }) : VARIANT.standard;
  const request = { player, npc, npcId: id, variant, handled: false };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function onDialogueAction(action) {
  if (action.npcId !== npcId(BOSS) || !action.player) return;
  const { player } = action;
  if (action.stepId === SPAWN_ACTION || action.stepId === NEW_BALL_ACTION) {
    action.handled = true;
    if (player.getSkillManager().getCurrentLevel(core.Skill.AGILITY) < AGILITY_LEVEL) {
      player.sendMessage(`You need an Agility level of ${AGILITY_LEVEL} to play skullball.`);
      return;
    }
    spawnBall(player);
  } else if (action.stepId === GIVE_UP_ACTION) {
    action.handled = true;
    removeBall(player);
  }
}

function createArena() {
  const { x, y, z } = DATA.arena;
  return new (class extends core.Area {
    constructor() { super([new core.Boundary(x[0], x[1], y[0], y[1], z)]); }
    postLeave(mobile) { if (mobile.isPlayer()) removeBall(mobile.getAsPlayer()); }
  })();
}

function startRolling() {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, "werewolf-skullball", false); }
    execute() { roll(); }
  })());
}

function init(registry) {
  api = registry;
  core = api.core;
}

function onLogout({ player }) {
  removeBall(player);
}

module.exports = {
  name: "WerewolfSkullball",
  members: true,
  register(registry) {
    init(registry);
    api.onNpcInteraction("Skullball", { Tap: tap, Kick: kickFour, Shoot: shoot, "Show-Goal": showGoal });
    api.onNpcDialogueVariant(selectVariant);
    api.onNpcInteraction("Skullball Boss", { "Talk-To": talk });
    api.onNpcInteraction("Skullball Trainer", { "Talk-To": talk });
    api.onCustomEvent("npc-dialogue:action", onDialogueAction);
    api.onPlayerLogout(onLogout);
    api.registerArea(createArena());
    api.onServerStartup(startRolling);
  },
  _test: {
    GOAL_EVENT, COURSE, DATA, games, roll, spawnBall, removeBall, experienceFor, pronounText, canStep, goalAt,
    setRandom(fn) { random = fn; },
    now: () => tick,
  },
};
