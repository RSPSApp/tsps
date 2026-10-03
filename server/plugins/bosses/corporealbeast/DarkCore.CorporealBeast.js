"use strict";

/**
 * The dark energy core.
 *
 * Wiki ("Corporeal Beast/Strategies" and "Dark energy core"):
 * - The Beast sends one out with a 1/8 chance whenever it is hit for 32 or more, or when it
 *   attacks below 1,000 hitpoints; its own attack timer then restarts at 4 ticks.
 * - It leeches 5-13 from every player beside it (the 3x3 around it) every 2 ticks, healing
 *   the Beast by as much, and jumps to a player when nobody is beside it - usually the one
 *   standing furthest north, else the one furthest east.
 * - Poisoned, it attacks very slowly while someone stays beside it; once it hops again it
 *   can't be stunned a second time. It disappears when the Beast dies.
 * - 25 hitpoints, and it doesn't fight back.
 * RuneLite (gameval): its jump is DARK_CORE_JUMP (319).
 * Offline_Scape: the jump only every other tick, its flight time (30 cycles plus 30 more every
 * 3 tiles) and the core waiting out of sight during it, and the leech message.
 * Estimate (the Wiki only says "very slowly"): a stunned core leeches every 10 ticks.
 */

const Shared = require("./CorpShared");

const SPAWN = { chance: 8, minHit: 32, lowHitpoints: 1000, attackDelay: 4 };
const LEECH = { min: 5, max: 13, every: 2, stunnedEvery: 10 };
const JUMP = { projectile: 319, base: 30, perThreeTiles: 30 };

/** Live cores by their Beast. */
const cores = new Map();
let MethodClass = null;

function tileOf(entity) {
  const at = entity.getLocation();
  return { x: at.getX(), y: at.getY(), z: at.getZ() };
}

function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function coreOf(corp) {
  return cores.get(corp) ?? null;
}

/** The core never attacks: it only leeches and jumps. */
function method() {
  if (MethodClass) return MethodClass;
  const { CombatMethod, CombatType } = Shared.core();
  MethodClass = class DarkCoreMethod extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    canAttack() {
      return false;
    }

    hits() {
      return [];
    }
  };
  return MethodClass;
}

/** The player it goes for: furthest north, then furthest east (Wiki). */
function pickTarget(players) {
  return players.reduce((best, player) => {
    if (!best) return player;
    const a = tileOf(player);
    const b = tileOf(best);
    return a.y > b.y || (a.y === b.y && a.x > b.x) ? player : best;
  }, null);
}

/** Off it flies to the player's tile, out of sight until it lands. */
function jump(state, player) {
  const { Projectile } = Shared.core();
  const from = state.landed ? tileOf(state.npc) : state.origin;
  const to = tileOf(player);
  const end = JUMP.base + Math.ceil(distance(from, to) / 3) * JUMP.perThreeTiles;
  new Projectile(Shared.loc(from), Shared.loc(to), null, JUMP.projectile, 0, end, 0, 0, null).sendProjectile();
  state.npc.moveTo(Shared.loc({ ...to, z: to.z + 1 }));
  state.landed = false;
  state.landsIn = Math.ceil(end / 30) + 1;
  state.target = to;
  if (state.stunned) {
    state.stunned = false;
    state.canBeStunned = false;
  }
}

function leech(state, players) {
  const { HitDamage, HitMask } = Shared.core();
  for (const player of players) {
    const amount = Math.min(player.getHitpoints(), Shared.randomInclusive(LEECH.min, LEECH.max));
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(amount, HitMask.RED)]);
    state.corp.heal(amount);
    player.sendMessage("The dark core creature steals some life from you for its master.");
  }
}

function remove(state) {
  cores.delete(state.corp);
  if (state.npc.isRegistered()) Shared.api().removeNpc(state.npc);
}

function tickCore(state) {
  const { npc, corp } = state;
  if (corp.getHitpoints() <= 0 || !corp.isRegistered() || npc.getHitpoints() <= 0 || !npc.isRegistered()) {
    remove(state);
    return;
  }
  const players = Shared.playersNear(corp);
  if (players.length === 0) {
    remove(state);
    return;
  }
  state.ticks++;
  if (!state.landed) {
    if (--state.landsIn > 0) return;
    npc.moveTo(Shared.loc(state.target));
    state.landed = true;
    state.leechIn = LEECH.every;
    return;
  }
  if (state.canBeStunned && !state.stunned && npc.isPoisoned?.()) state.stunned = true;
  const beside = players.filter((player) => distance(tileOf(player), tileOf(npc)) <= 1);
  if (beside.length > 0) {
    if (--state.leechIn > 0) return;
    state.leechIn = state.stunned ? LEECH.stunnedEvery : LEECH.every;
    leech(state, beside);
    return;
  }
  if (state.ticks % 2 === 0) jump(state, pickTarget(players));
}

/** The Beast sends a core out from its middle, straight at a player. */
function sendOut(corp) {
  if (coreOf(corp)) return null;
  const players = Shared.playersNear(corp);
  if (players.length === 0) return null;
  const at = tileOf(corp);
  const origin = { x: at.x + 2, y: at.y + 2, z: at.z };
  const npc = Shared.api().spawnNpc({ id: Shared.NPC.DARK_CORE, ...origin, wanderRadius: 0 });
  if (!npc) return null;
  npc.__skipDefaultRespawn = true;
  npc.setFlag?.("combat:no-retaliate");
  npc.getMovementQueue?.().setBlockMovement?.(true);
  const state = { npc, corp, origin, landed: true, landsIn: 0, target: null, leechIn: LEECH.every, stunned: false, canBeStunned: true, ticks: 0 };
  cores.set(corp, state);
  corp.getCombat().setAttackDelay(SPAWN.attackDelay);
  jump(state, pickTarget(players));
  return state;
}

function roll(random = Math.random) {
  return Math.floor(random() * SPAWN.chance) === 0;
}

/** A hit of 32 or more on the Beast. */
function beastHit(corp, damage, random = Math.random) {
  if (damage >= SPAWN.minHit && !coreOf(corp) && roll(random)) sendOut(corp);
}

/** The Beast attacks while below 1,000 hitpoints. */
function beastAttacks(corp, random = Math.random) {
  if (corp.getHitpoints() < SPAWN.lowHitpoints && !coreOf(corp) && roll(random)) sendOut(corp);
}

function beastDied(corp) {
  const state = coreOf(corp);
  if (state) remove(state);
}

function tick() {
  for (const state of [...cores.values()]) tickCore(state);
}

function start() {
  Shared.repeat("dark-energy-core", 1, () => tick());
}

module.exports = function registerDarkCore(api) {
  Shared.bind(api);
  api.registerNpcCombatMethodProvider([Shared.NPC.DARK_CORE], method(), { singleton: true });
  api.onServerStartup(start);
};

Object.assign(module.exports, {
  SPAWN, LEECH, JUMP, cores,
  coreOf, pickTarget, sendOut, beastHit, beastAttacks, beastDied, tickCore, tick, method,
});
