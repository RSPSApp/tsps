/**
 * Yama's stepping stones, the agility course of the Leagues' Yama's Lair (the league's `stones`):
 * as recording 237/01098 plays it, a jump each tick from stone to stone, no laps but a count of
 * stones jumped on, and the stone left behind on fire for a few ticks. Landing on a burning stone
 * hurts and gives no experience, yet still counts.
 *
 * The count is announced every tenth stone and reported as the course's laps
 * (`agility:lap` { player, course, laps, count }), which the league tasks count.
 */
const Common = require("./Common.LeagueAreaUnlocks");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

/** Stones jumped on, all told. */
const COUNT_ATTRIBUTE = "league:yama-stones";

/** Per player: the fires its jumps lit, oldest first ({ npc, x, y, out }). */
const fires = new WeakMap();
/** Per player: the stone it jumped to this tick ([x, y]), its slide cleared at the next tick's start. */
const inFlight = new WeakMap();
/** ForceMovement direction indices, as ObstacleRunner gives them. */
const FORCE_DIRECTION = Object.freeze({ north: 0, east: 1, south: 2, west: 3 });

const tileKey = (x, y) => `${x},${y}`;
let stoneTiles = null;
let shoreTiles = null;

function rules(player) {
  const type = Common.leagueOf(player);
  return type === null ? null : Common.league(type)?.stones ?? null;
}

function isStone(stones, x, y) {
  stoneTiles ??= new Set(stones.tiles.map(([sx, sy]) => tileKey(sx, sy)));
  return stoneTiles.has(tileKey(x, y));
}

function isShore(stones, x, y) {
  shoreTiles ??= new Set(stones.shore.map(([sx, sy]) => tileKey(sx, sy)));
  return shoreTiles.has(tileKey(x, y));
}

function ours(stones, objectId) {
  return Common.core.CacheDefinitions.getLocId(stones.loc) === objectId;
}

const distance = (a, b) => Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));

/** How far the player can jump from where it stands: off a stone, off the shore, or not at all. */
function reachFrom(stones, at) {
  if (isStone(stones, at.getX(), at.getY())) return stones.reach;
  if (isShore(stones, at.getX(), at.getY())) return stones.shoreReach;
  return 0;
}

/** On the stones, or on the shore in reach: jump from where it stands. Further off: to the nearest shore tile. */
function route(event) {
  const stones = rules(event.player);
  if (!stones || !ours(stones, event.objectId)) return;
  const at = event.player.getLocation();
  const target = event.object.getLocation();
  if (isStone(stones, at.getX(), at.getY()) || (reachFrom(stones, at) && distance(at, target) <= stones.shoreReach)) {
    event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
    return;
  }
  const [x, y] = stones.shore.reduce((best, tile) =>
    Math.max(Math.abs(tile[0] - target.getX()), Math.abs(tile[1] - target.getY())) < Math.max(Math.abs(best[0] - target.getX()), Math.abs(best[1] - target.getY())) ? tile : best);
  event.destination = { x, y, z: target.getZ() };
}

function burning(player, x, y) {
  return (fires.get(player) ?? []).some((fire) => fire.x === x && fire.y === y);
}

function putOut(fire) {
  if (fire.npc?.isRegistered?.()) Common.api.removeNpc(fire.npc);
}

/** The stone left catches fire: the fire NPC (size 3) centred on it, out after `fireTicks`, the oldest past `maxFires`. */
function light(player, stones, x, y) {
  const list = (fires.get(player) ?? []).filter((fire) => fire.x !== x || fire.y !== y);
  const npc = Common.api.spawnNpc({ id: Common.core.CacheDefinitions.getNpcId(stones.fire), x: x - 1, y: y - 1, z: 0, wanderRadius: 0 });
  if (npc) npc.__skipDefaultRespawn = true;
  const fire = { npc, x, y };
  list.push(fire);
  while (list.length > stones.maxFires) putOut(list.shift());
  fires.set(player, list);
  later(stones.fireTicks, () => {
    putOut(fire);
    const now = fires.get(player);
    if (now) fires.set(player, now.filter((each) => each !== fire));
  });
}

function later(ticks, action) {
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(ticks, null, false);
    }

    execute() {
      this.stop();
      action();
    }
  })());
}

function count(player) {
  return Number(player.getAttribute(COUNT_ATTRIBUTE)) || 0;
}

/** Lands on stone (x, y): a burn or the experience, then the count. */
function landed(player, stones, x, y, burnt) {
  if (burnt) {
    player.sendMessage(Common.message("stoneBurns"));
  } else {
    player.getSkillManager().addExperiences(Common.core.Skill.AGILITY, stones.experience);
  }
  const total = count(player) + 1;
  player.setAttribute(COUNT_ATTRIBUTE, total);
  if (total % stones.announceEvery === 0) player.sendMessage(Common.message("stoneCount", { count: total }));
  Common.api.emitCustomEvent("agility:lap", { player, course: stones.course, laps: total, count: 1 });
}

/**
 * A jump, as live plays it (237/01098): on the click's own tick the player is on the stone, with
 * the slide from the stone left (human_yama_shortjump01 over 27 client cycles) and the sound, the
 * experience and the count; the stone left catches fire. The next tick's start clears the slide,
 * before that tick's click, so a stone can be jumped every tick.
 */
function start(player, stones, to) {
  const { ForceMovement, Location, Animation, CacheDefinitions } = Common.core;
  const from = player.getLocation().clone();
  const animation = CacheDefinitions.getSeqId(stones.animation);
  const direction = ObstacleRunner.directionBetween(from.getX(), from.getY(), to[0], to[1]);
  const slide = new ForceMovement(from, new Location(to[0] - from.getX(), to[1] - from.getY()), 0, stones.cycles,
    FORCE_DIRECTION[direction] ?? direction, animation);
  player.moveTo(new Location(to[0], to[1], from.getZ()));
  player.performAnimation(new Animation(animation));
  player.setForceMovement(slide);
  player.getPacketSender().sendSoundEffect(stones.sound.id, 1, stones.sound.delay);
  if (isStone(stones, from.getX(), from.getY())) light(player, stones, from.getX(), from.getY());
  land(player, stones, to);
  inFlight.set(player, to);
  later(1, () => {
    if (inFlight.get(player) === to) inFlight.delete(player);
    if (player.getForceMovement() === slide) player.setForceMovement(null);
  });
}

/** Landed on stone `to`: a burn (no experience) or the experience, then the count. */
function land(player, stones, to) {
  const burnt = burning(player, to[0], to[1]);
  if (burnt) player.getCombat().getHitQueue().addPendingDamage([new Common.core.HitDamage(stones.burnDamage, Common.core.HitMask.RED)]);
  landed(player, stones, to[0], to[1], burnt);
}

function jump({ player, object, objectId }) {
  const stones = player && rules(player);
  if (!stones || !ours(stones, objectId)) return false;
  if (inFlight.has(player) || ObstacleRunner.isBusy(player)) return true;
  const at = player.getLocation();
  const to = object.getLocation();
  const gap = distance(at, to);
  if (gap === 0 || gap > reachFrom(stones, at)) {
    player.sendMessage(Common.message("stoneUnreachable"));
    return true;
  }
  start(player, stones, [to.getX(), to.getY()]);
  return true;
}

function logout({ player }) {
  for (const fire of fires.get(player) ?? []) putOut(fire);
  fires.delete(player);
  inFlight.delete(player);
}

module.exports = function attach(api) {
  api.persistAttribute(COUNT_ATTRIBUTE, 0);
  api.onObjectInteraction("Stone", { Jump: jump });
  api.onObjectRoute(route);
  api.onPlayerLogout(logout);
};

Object.assign(module.exports, { jump, route, COUNT_ATTRIBUTE });
