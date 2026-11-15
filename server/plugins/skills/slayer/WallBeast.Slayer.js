"use strict";

/**
 * Wall beasts (docs/slayer.md, "Wall beasts"): the holes in the Lumbridge Swamp Caves walls
 * (swamp_wallbeast) grab the head of a player who stops on the tile in front of them.
 *
 * - The tick after the player stops there the player is held and faces the hole; the next tick the
 *   hand comes out.
 * - Without a spiny helmet or Slayer helmet (slayer-gear.json's "grab" row) the hand holds the
 *   player's head for 9 ticks, then lets go and hits for up to 18 (Wiki); the hole never becomes
 *   attackable.
 * - With one, the helmet repels it: the hole turns into the attackable wall beast
 *   (swamp_wallbeast_combat), which attacks the player. Unless a player is attacking it, 18 ticks
 *   later it pulls back into the wall and is a hole again.
 * - A hole rests before it grabs again: 17 ticks after letting go, 6 after pulling back. A player
 *   still standing in front then is grabbed without moving.
 * Timings, messages, animations and sounds: rsprox captures 1000134, 1000140, 1001671, 1001932.
 */
const GEAR = require("../data/slayer-gear.json");
const Equipment = require("./Equipment.Slayer");

/** Held after the grab until the hand lets go (rec 1000134: grab tick 813, release 822). */
const GRAB_HOLD_TICKS = 9;
/**
 * A repelled beast nobody attacks goes back into the wall this long after the repel (rec 1001932:
 * 2391 -> 2409; 1000134: 840 -> 858 and 865 -> 883, the player standing in front from 855 without
 * attacking it). Attacked, it stays out (rec 1000140: the fight goes on past it).
 */
const RETREAT_IDLE_TICKS = 18;
/**
 * Ticks a hole waits before it grabs again, each fitted to the one gap rec 1000134 shows: let go
 * at 822, nothing while the player stood in front from 829 to 834, held again at 839; pulled back
 * at 858 with the player in front, held again at 864.
 */
const GRAB_REST_TICKS = 17;
const RETREAT_REST_TICKS = 6;
/** The in-place exact move on the grab tick: delay1 0, delay2 5, facing north (angle 1024). */
const HOLD_MOVE = { speed: 0, reverseSpeed: 5, direction: 0 };
const GRAB_MESSAGE = "A giant hand appears and grabs your head!";
const REPEL_MESSAGE = "Your helmet repels the wall beast!";
/** rec 1000134 tick 813: the grab. rec 1001932 tick 2391: wall_beast_foiled. */
const GRAB_SOUND = 893;
const REPEL_SOUND = 895;
/** Every hole faces south (rsprox captures: spawnangle south at all five holes they show), so its front is the tile below it. */
const FRONT_OFFSET = { x: 0, y: -1 };

let api = null;
let core = null;
let rule = null;
let holeId = -1;
let beastId = -1;
let seq = {};
/** "x,y,z" of each hole's front tile -> the hole's tile. */
const fronts = new Map();
/** "x,y,z" of each 64x64 map square holding a front tile. */
const squares = new Set();
/** Players standing in a wall beast square. */
const watched = new Set();
/** Holes busy with a player, awake or resting: -> { stage: "seen"|"holding"|"awake"|"rest", player, ticks, idle }. */
const beasts = new Map();
/** Players a hole is holding (seen or grabbed). */
const held = new Set();

const tileKey = (x, y, z) => `${x},${y},${z}`;
const squareKey = (x, y, z) => `${x >> 6},${y >> 6},${z}`;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  rule = GEAR.monsters.find((monster) => monster.grab);
}

/** Finds the holes from the spawns and starts the task. */
function start() {
  holeId = core.NpcIdentifiers.HOLE_IN_THE_WALL;
  beastId = core.NpcIdentifiers.WALL_BEAST;
  seq = {
    start: core.CacheDefinitions.getSeqId("wall_beast_specialattack_start"),
    ready: core.CacheDefinitions.getSeqId("wall_beast_specialattack_ready"),
    end: core.CacheDefinitions.getSeqId("wall_beast_specialattack_end"),
    fail: core.CacheDefinitions.getSeqId("wall_beast_specialattack_fail"),
    disappear: core.CacheDefinitions.getSeqId("wall_beast_specialattack_disappear"),
    humanStart: core.CacheDefinitions.getSeqId("human_wall_beast_specialattack_start"),
    humanReady: core.CacheDefinitions.getSeqId("human_wall_beast_specialattack_ready"),
    humanEnd: core.CacheDefinitions.getSeqId("human_wall_beast_specialattack_end"),
  };
  fronts.clear();
  squares.clear();
  const spawns = JSON.parse(require("fs").readFileSync(
    require("path").join(core.GameConstants.DEFINITIONS_DIRECTORY, "npc-spawns.json"), "utf8"));
  for (const spawn of spawns) {
    if (spawn.id !== holeId) continue;
    const z = spawn.level ?? spawn.z ?? 0;
    const x = spawn.x + FRONT_OFFSET.x;
    const y = spawn.y + FRONT_OFFSET.y;
    fronts.set(tileKey(x, y, z), { x: spawn.x, y: spawn.y, z });
    squares.add(squareKey(x, y, z));
  }
  core.TaskManager.submit(new (class WallBeastsTask extends core.Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      tick();
    }
  })());
}

function track({ player }) {
  const at = player.getLocation();
  if (squares.has(squareKey(at.getX(), at.getY(), at.getZ()))) watched.add(player);
  else watched.delete(player);
}

function forget({ player }) {
  watched.delete(player);
  release(player);
}

function protectedFrom(player) {
  return Equipment.protectedFrom(player, rule);
}

/** The hole at this front tile that is free to grab: a hole right now, alive and not busy. */
function holeAt(player, hole) {
  for (const npc of player.getLocalNpcs?.() ?? []) {
    if (!npc || npc.getId() !== holeId || beasts.has(npc) || !npc.isRegistered()) continue;
    const at = npc.getLocation();
    if (at.getX() === hole.x && at.getY() === hole.y && at.getZ() === hole.z) return npc;
  }
  return null;
}

/** Where the player stopped last tick: on a hole's front, the hole holds them and they face it. */
function noticeAt(player) {
  if (held.has(player) || !player.isRegistered() || player.getHitpoints() <= 0) return;
  if (player.getForceMovement?.() || player.getPrivateArea?.()) return;
  const at = player.getLocation();
  const hole = fronts.get(tileKey(at.getX(), at.getY(), at.getZ()));
  if (!hole) return;
  const npc = holeAt(player, hole);
  if (!npc) return;
  hold(player);
  player.setPositionToFace(npc.getLocation());
  beasts.set(npc, { stage: "seen", player, ticks: 0, idle: 0 });
}

function hold(player) {
  held.add(player);
  player.getMovementQueue().setBlockMovement(true);
}

function release(player) {
  if (!held.delete(player)) return;
  player.getMovementQueue().setBlockMovement(false);
}

function stillThere(npc, player) {
  const at = player.getLocation();
  const hole = npc.getLocation();
  return player.isRegistered() && player.getHitpoints() > 0
    && at.getX() === hole.getX() + FRONT_OFFSET.x && at.getY() === hole.getY() + FRONT_OFFSET.y && at.getZ() === hole.getZ();
}

/**
 * The in-place exact move the grab and the repel both send, cleared the next tick. Not a
 * ForceMovementTask: that resets the walk, and a repelled player runs on along their path
 * (rec 1001932: the run resumes the tick after the repel).
 */
function holdInPlace(player) {
  const move = new core.ForceMovement(player.getLocation().clone(), new core.Location(0, 0, 0),
    HOLD_MOVE.speed, HOLD_MOVE.reverseSpeed, HOLD_MOVE.direction, -1);
  player.setForceMovement(move);
  core.TaskManager.submit(new (class WallBeastHoldTask extends core.Task {
    constructor() {
      super(1, player, false);
    }
    execute() {
      if (player.getForceMovement() === move) player.setForceMovement(null);
      this.stop();
    }
  })());
}

function animate(mobile, id) {
  if (id != null && id >= 0) mobile.performAnimation(new core.Animation(id));
}

/** The hand comes out: repelled by the helmet, or grabbing the head. */
function reach(npc, state) {
  const { player } = state;
  if (protectedFrom(player)) {
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, REPEL_MESSAGE);
    holdInPlace(player);
    release(player);
    animate(npc, seq.fail);
    player.getPacketSender().sendSound(REPEL_SOUND, 10, 0);
    awaken(npc, player);
    return;
  }
  player.sendMessage(GRAB_MESSAGE);
  holdInPlace(player);
  animate(player, seq.humanStart);
  animate(npc, seq.start);
  player.getPacketSender().sendSound(GRAB_SOUND, 10, 0);
  beasts.set(npc, { stage: "holding", player, ticks: 0, idle: 0 });
}

/** Repelled: the attackable beast, which goes for the player who repelled it. */
function awaken(npc, player) {
  const definition = core.NpcDefinition.forId(beastId);
  npc.setNpcTransformationId(beastId);
  npc.setMaxHitpoints(definition.getHitpoints());
  npc.setHitpoints(definition.getHitpoints());
  // It lives in the wall: it never walks out of it.
  npc.getMovementQueue().reset();
  npc.getMovementQueue().setBlockMovement(true);
  beasts.set(npc, { stage: "awake", player: null, ticks: 0, idle: 0 });
  npc.getCombat().attack(player);
}

/** Back into the wall, healed, a hole again. */
function retreat(npc) {
  npc.getCombat().reset?.();
  // Nobody keeps attacking the hole it becomes.
  core.World.getPlayers().forEach((player) => {
    if (player?.getCombat?.().getTarget() === npc) player.getCombat().reset();
  });
  animate(npc, seq.disappear);
  npc.setNpcTransformationId(-1);
  npc.setMaxHitpoints(-1);
  npc.setHitpoints(npc.getMaxHitpoints());
  npc.getMovementQueue().setBlockMovement(false);
  beasts.set(npc, { stage: "rest", player: null, ticks: RETREAT_REST_TICKS, idle: 0 });
}

/** The grab's hit: up to 18 without the helmet (Wiki). */
function grabDamage() {
  return Math.floor(Math.random() * (rule.hit + 1));
}

function letGo(npc, player) {
  animate(player, seq.humanEnd);
  animate(npc, seq.end);
  const damage = grabDamage();
  player.getCombat().getHitQueue().addPendingDamage([
    new core.HitDamage(damage, damage > 0 ? core.HitMask.RED : core.HitMask.BLUE),
  ]);
  release(player);
  beasts.set(npc, { stage: "rest", player: null, ticks: GRAB_REST_TICKS, idle: 0 });
}

/**
 * Whether a fight keeps the awake beast out: a player attacking it, from its front tile or from range
 * (rec 1000140 is a crossbow fight). The attacker clears 8 ticks after the last hit (Combat).
 */
function fighting(npc) {
  const attacker = npc.getCombat().getAttacker?.();
  return attacker?.isPlayer?.() === true && attacker.getCombat().getTarget() === npc;
}

function step(npc, state) {
  // Killed: it respawns as a hole (NPCDeathTask clears the transformation).
  if (!npc.isRegistered() || npc.getHitpoints() <= 0) {
    if (state.player) release(state.player);
    beasts.delete(npc);
    return;
  }
  if (state.stage === "seen") {
    if (!stillThere(npc, state.player)) {
      release(state.player);
      beasts.delete(npc);
      return;
    }
    reach(npc, state);
    return;
  }
  if (state.stage === "holding") {
    // Logged out, died or moved off (a respawn): the hand lets go without the hit.
    if (!stillThere(npc, state.player)) {
      release(state.player);
      beasts.set(npc, { stage: "rest", player: null, ticks: GRAB_REST_TICKS, idle: 0 });
      return;
    }
    state.ticks++;
    if (state.ticks === 1) {
      animate(state.player, seq.humanReady);
      animate(npc, seq.ready);
    }
    if (state.ticks >= GRAB_HOLD_TICKS) letGo(npc, state.player);
    return;
  }
  if (state.stage === "rest") {
    if (--state.ticks <= 0) beasts.delete(npc);
    return;
  }
  if (fighting(npc)) {
    state.idle = 0;
    return;
  }
  if (++state.idle >= RETREAT_IDLE_TICKS) retreat(npc);
}

function tick() {
  for (const [npc, state] of beasts) step(npc, state);
  for (const player of watched) {
    if (!player.isRegistered()) watched.delete(player);
    else noticeAt(player);
  }
}

function attach(pluginApi) {
  pluginApi.onServerStartup(start);
  pluginApi.onPlayerLogin(track);
  pluginApi.onPlayerMapSquareChange(track);
  pluginApi.onPlayerLogout(forget);
  pluginApi.onPlayerDisconnect(forget);
}

module.exports = {
  init,
  attach,
  _test: { start, track, tick, fronts, squares, watched, beasts, held, GRAB_HOLD_TICKS, RETREAT_IDLE_TICKS, GRAB_REST_TICKS, RETREAT_REST_TICKS },
};
