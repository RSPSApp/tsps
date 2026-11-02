"use strict";

/**
 * The creatures from the Abyss, and the fight between them, the barriers, the rift guardians and
 * the Great Guardian.
 *
 * rsprox captures (rev 241):
 * - From the attack on, creatures come out of the rift in batches 76 ticks apart, with
 *   abyssal_demon_teleport map anims (height 90) where they appear. A busy world had batches of
 *   13-22: about two thirds leeches, a quarter walkers and the rest abyssal guardians.
 * - Hits on barriers and rift guardians, and the guardians' hits on creatures, run 0-6; about
 *   four in ten are zeros.
 * - The leech, walker and abyssal guardian attack, block and die with gotr_abyssal_*_attack /
 *   _defend / _death; rift guardians with rift_guardian_attack_melee / _ranged.
 * Wiki: creatures attack the barriers and the Great Guardian, draining its power, and fight back
 * only against rift guardians; more walkers and guardians come after the 60% surge; at 100% they
 * all die. The cache: leech 5, walker 30, abyssal guardian 50 hitpoints.
 * No capture shows a creature reaching the Great Guardian on a world that busy. The batch size
 * for a small world, the hit chances, attack speeds and the power each hit drains are ours.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");
const Cells = require("./Cells.GuardiansOfTheRift");
const Temple = require("./Temple.GuardiansOfTheRift");

const KINDS = {
  leech: { npc: "gotr_abyssal_leech", attack: "gotr_abyssal_leech_attack", maxHit: 2, drain: 1 },
  walker: { npc: "gotr_abyssal_walker", attack: "gotr_abyssal_walker_attack", maxHit: 4, drain: 2 },
  guardian: { npc: "gotr_abyssal_pyramid", attack: "gotr_abyssal_pyramid_attack", maxHit: 6, drain: 3 },
};
/** The mix before and after the surge (captured before; Wiki: more walkers and guardians after). */
const MIX = { calm: { leech: 0.7, walker: 0.2, guardian: 0.1 }, surged: { leech: 0.5, walker: 0.3, guardian: 0.2 } };

const BATCH_TICKS = 76;
const RIFT_AREA = { minX: 3613, maxX: 3617, minY: 9522, maxY: 9525 };
const GREAT_GUARDIAN = { x: 3613, y: 9501, size: 5 };
const ATTACK_TICKS = 4;
const HIT_CHANCE = 0.6;
const TELEPORT_GRAPHIC = "abyssal_demon_teleport";
const MIN_BATCH = 2;
const MAX_BATCH = 22;
const PLAYERS_PER_CREATURE = 30;

const creatures = new Map();
let api = null;
let nextBatch = 0;

/** Ours: two for a quiet world, up to 22 as on the captured world of hundreds. */
function batchSize(players) {
  return Math.max(MIN_BATCH, Math.min(MAX_BATCH, Math.round(players / PLAYERS_PER_CREATURE) + MIN_BATCH));
}

function pickKind(mix, roll = Math.random()) {
  if (roll < mix.leech) return "leech";
  if (roll < mix.leech + mix.walker) return "walker";
  return "guardian";
}

// ------------------------------------------------------------------ geometry

function sizeOf(npc) {
  return Math.max(1, npc.getSize?.() ?? 1);
}

/** Tiles between two footprints; 1 is touching. */
function gap(a, aSize, b, bSize) {
  const dx = Math.max(0, b.x - (a.x + aSize - 1), a.x - (b.x + bSize - 1));
  const dy = Math.max(0, b.y - (a.y + aSize - 1), a.y - (b.y + bSize - 1));
  return Math.max(dx, dy);
}

function tileOf(npc) {
  const location = npc.getLocation();
  return { x: location.getX(), y: location.getY() };
}

function route(npc, x, y) {
  const queue = npc.getMovementQueue();
  if (queue.lastDestX === x && queue.lastDestY === y && (queue.size() > 0 || queue.isMovings?.())) return;
  Shared.core().PathFinder.calculateWalkRoute(npc, x, y);
}

// ------------------------------------------------------------------ hits

const CREATURE_BLOCKS = new Map([[11405, 9395], [11406, 9391], [11407, 9388]]);
const WEAK_ELEMENTAL_GUARDIAN = 11414;
const OVERCHARGED_ELEMENTAL_GUARDIAN = 11417;
const RIFT_GUARDIANS = new Set([11408, 11411, 11412, 11413]);

/** A roll at the target: four in ten miss (rsprox captures), the rest hit 1 to `maxHit`. */
function hit(target, maxHit) {
  const damage = Math.random() < HIT_CHANCE ? Shared.random(1, maxHit) : 0;
  Shared.damageNpc(target, damage);
  const block = blockSequence(target);
  if (block && target.getHitpoints() > 0) target.performAnimation(new (Shared.core().Animation)(block));
  return damage;
}

/** Capture 1840: elemental guardians are 11414-11417, the catalytic ones 11408 and 11411-11413. */
function isElementalGuardian(npc) {
  return npc.getId() >= WEAK_ELEMENTAL_GUARDIAN && npc.getId() <= OVERCHARGED_ELEMENTAL_GUARDIAN;
}

/** Each hit's flinch (capture 1840); the defs' block anim only reaches the combat system. */
function blockSequence(npc) {
  const creature = CREATURE_BLOCKS.get(npc.getId());
  if (creature) return creature;
  if (isElementalGuardian(npc)) return Shared.seq("rift_guardian_defend_melee");
  return RIFT_GUARDIANS.has(npc.getId()) ? Shared.seq("rift_guardian_defend_ranged") : null;
}

function animate(npc, name) {
  npc.performAnimation(new (Shared.core().Animation)(Shared.seq(name)));
}

// ------------------------------------------------------------------ spawning

/** Nothing comes through for a game everyone has left. */
function spawnBatch() {
  if (Game.players().length === 0) return;
  const count = batchSize(Game.players().length);
  const mix = Game._game.surged ? MIX.surged : MIX.calm;
  const viewers = Temple.inTemple();
  for (let i = 0; i < count; i++) {
    const kind = pickKind(mix);
    const x = Shared.random(RIFT_AREA.minX, RIFT_AREA.maxX);
    const y = Shared.random(RIFT_AREA.minY, RIFT_AREA.maxY);
    const npc = api.spawnNpc({ id: Shared.npc(KINDS[kind].npc), x, y, z: 0, wanderRadius: 0 });
    if (!npc) continue;
    Shared.prepareNpc(npc, { walkThrough: true });
    creatures.set(npc, { kind, nextAttack: 0, attacker: null });
    teleportGraphic(viewers, x, y);
  }
}

function teleportGraphic(viewers, x, y) {
  const { Graphic, Location } = Shared.core();
  const graphic = new Graphic(Shared.spotanim(TELEPORT_GRAPHIC), Shared.random(30, 70), 90);
  for (const player of viewers) player.getPacketSender().sendGraphic(graphic, new Location(x, y, 0));
}

function clear() {
  for (const npc of creatures.keys()) if (npc.isRegistered()) api.removeNpc(npc);
  creatures.clear();
}

/** Full power: every creature dies where it stands (Wiki). */
function killAll() {
  for (const npc of creatures.keys()) if (npc.isRegistered() && npc.getHitpoints() > 0) npc.setHitpoints(0);
  creatures.clear();
}

// ------------------------------------------------------------------ the creatures' turn

/** A rift guardian that hit it, while it's close: the only thing a creature fights back. */
function retaliating(npc, state) {
  const attacker = state.attacker;
  if (!attacker || !attacker.isRegistered() || attacker.getHitpoints() <= 0) return null;
  return gap(tileOf(npc), sizeOf(npc), tileOf(attacker), sizeOf(attacker)) <= 1 ? attacker : null;
}

function nearestBarrier(npc) {
  let best = null;
  let bestGap = Infinity;
  for (const tile of Cells.barrierNpcs()) {
    if (tile.npc.getHitpoints() <= 0) continue;
    const distance = gap(tileOf(npc), sizeOf(npc), tileOf(tile.npc), sizeOf(tile.npc));
    if (distance < bestGap) {
      best = tile;
      bestGap = distance;
    }
  }
  return best;
}

function creatureTurn(npc, state, now) {
  const kind = KINDS[state.kind];
  const guardian = retaliating(npc, state);
  const barrier = guardian ? null : nearestBarrier(npc);
  const target = guardian ?? barrier?.npc ?? null;
  const at = target ? tileOf(target) : GREAT_GUARDIAN;
  const size = target ? sizeOf(target) : GREAT_GUARDIAN.size;
  if (gap(tileOf(npc), sizeOf(npc), at, size) > 1) {
    route(npc, at.x, at.y);
    return;
  }
  npc.getMovementQueue().reset();
  if (now < state.nextAttack) return;
  state.nextAttack = now + ATTACK_TICKS;
  npc.setPositionToFace?.(Shared.location(at));
  animate(npc, kind.attack);
  if (target) hit(target, kind.maxHit);
  else Game.addPower(-kind.drain);
}

function tick({ phase }) {
  if (phase !== Game.PHASE.ATTACK) return;
  const now = Game.clock();
  if (now >= nextBatch) {
    nextBatch = now + BATCH_TICKS;
    spawnBatch();
  }
  for (const [npc, state] of creatures) {
    if (!npc.isRegistered() || npc.getHitpoints() <= 0) {
      creatures.delete(npc);
      continue;
    }
    creatureTurn(npc, state, now);
  }
}

/** The first batch comes with the attack; then one every 76 ticks. */
function attackBegins() {
  nextBatch = Game.clock();
}

/** A rift guardian struck this creature: it turns on the guardian while close (Wiki). */
function struckBy(npc, guardian) {
  const state = creatures.get(npc);
  if (state) state.attacker = guardian;
}

function nearestCreature(from, fromSize, range) {
  let best = null;
  let bestGap = Infinity;
  for (const npc of creatures.keys()) {
    if (!npc.isRegistered() || npc.getHitpoints() <= 0) continue;
    const distance = gap(from, fromSize, tileOf(npc), sizeOf(npc));
    if (distance <= range && distance < bestGap) {
      best = npc;
      bestGap = distance;
    }
  }
  return best ? { npc: best, gap: bestGap } : null;
}

module.exports = {
  KINDS, batchSize, pickKind, gap, tileOf, sizeOf, hit, isElementalGuardian, animate, route, struckBy, nearestCreature, creatures, clear,
  attach(pluginApi) {
    api = pluginApi;
    Game.on("attack", attackBegins);
    Game.on("tick", tick);
    Game.on("charged", killAll);
    Game.on("ended", clear);
  },
};
