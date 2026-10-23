"use strict";

/**
 * What every Dagannoth Kings unit shares: ids, tiles and small helpers.
 * Facts and their sources are in docs/dagannoth-kings.md.
 */
const DATA = require("../data/dagannoth-kings.json");

/** Cache: the three kings (each 255 hp, 3x3). */
const SUPREME_ID = DATA.npcs.supreme;
const PRIME_ID = DATA.npcs.prime;
const REX_ID = DATA.npcs.rex;
/** Cache: surfaced spinolyps and their submerged water forms (order-paired). */
const SPINOLYP_IDS = Object.freeze([...DATA.npcs.spinolyp]);
const WATER_IDS = Object.freeze([...DATA.npcs.spinolypWater]);

/** Cache: the Kings' ladder multiloc. 3831's own definition is unnamed and optionless;
 * the names and options live on its resolved children (40417/40418), which never exist
 * as server objects - the interaction event carries 3831, verified live. A name-based
 * hook cannot work here: the server-side definition has no name to match. */
const LADDER_ID = DATA.locs.ladder;
/** Cache: the Climb-up ladders back out of each lair. */
const EXIT_LADDER_ID = DATA.locs.exitLadder;

/** The public lair (Standard option) and the Slayer-task lair (Slayer option). */
const PUBLIC_LAIR = Object.freeze({ ...DATA.lairs.public.bounds });
const TASK_LAIR = Object.freeze({ ...DATA.lairs.task.bounds });
const PUBLIC_SPAWN = Object.freeze([...DATA.lairs.public.spawnTile]);
const TASK_SPAWN = Object.freeze([...DATA.lairs.task.spawnTile]);
/** Dungeon side: the player stands here before climbing down. */
const OUTSIDE_TILE = Object.freeze([...DATA.outsideTile]);
/** The ladder's own tile, as clicked in captures 89/3433 (oploc 3831 at 1911, 4367). */
const ENTRANCE_TILE = Object.freeze([...DATA.entranceTile]);
/** The ::teleports landing, by the ladder room. */
const TELEPORT_TILE = Object.freeze([...DATA.teleportTile]);

const KING_IDS = Object.freeze([SUPREME_ID, PRIME_ID, REX_ID]);

/** Wiki: Rex approaches within 5 tiles, Prime/Supreme within 7 (from the SW tile). */
const AGGRO_TILES = Object.freeze({
  [REX_ID]: DATA.aggression.rexTiles,
  [PRIME_ID]: DATA.aggression.primeTiles,
  [SUPREME_ID]: DATA.aggression.supremeTiles,
});

/** Cache sequences (dagannoth_meganoth_*), as captured. */
const ANIM = Object.freeze({
  defend: DATA.anims.defend,
  rexMelee: DATA.anims.rexMelee,
  primeMagic: DATA.anims.primeMagic,
  supremeRange: DATA.anims.supremeRange,
  death: DATA.anims.death,
  spinolypAttack: DATA.anims.spinolypAttack,
  spinolypDefend: DATA.anims.spinolypDefend,
  spinolypDeath: DATA.anims.spinolypDeath,
  spinolypEmerge: DATA.anims.spinolypEmerge,
});
/** Captured projectiles: Prime's water wave, Supreme's spine, spinolyp shots. */
const PROJECTILE = Object.freeze({ ...DATA.projectiles });
/** Captured synth at Prime's tile on every cast; Supreme's impact sound at the target. */
const PRIME_CAST_SOUND = DATA.sounds.primeCast;
const SUPREME_IMPACT_SOUND = DATA.sounds.supremeImpact;

/** Wiki: every king attacks every 4 ticks. Captured Prime/Supreme range: 12/10. */
const ATTACK_SPEED = DATA.combat.attackSpeed;
const PRIME_DISTANCE = DATA.combat.primeDistance;
const SUPREME_DISTANCE = DATA.combat.supremeDistance;
/** Wiki: Prime's AoE hits the 3x3 around his target; Supreme's the 6x6 (radius 3). */
const PRIME_SPLASH_RADIUS = DATA.combat.primeSplashRadius;
const SUPREME_SPLASH_RADIUS = DATA.combat.supremeSplashRadius;
/** Captured hit delays: Prime 3 ticks, Supreme 2, Rex 1 (melee). */
const HIT_DELAY = Object.freeze({
  prime: DATA.combat.hitDelayPrime,
  supreme: DATA.combat.hitDelaySupreme,
  rex: DATA.combat.hitDelayRex,
});
/** Wiki max hits; the engine rolls the definition's (identical) values. */
const MAX_HIT = Object.freeze({ ...DATA.combat.maxHit });
/** Wiki: 150-tick (90s) respawn, 5-tick deaths (ReasonPS agrees on deathTicks). */
const RESPAWN_TICKS = DATA.combat.respawnTicks;
const DEATH_TICKS = DATA.combat.deathTicks;
/** Spinolyp: 60% ranged (poisonous), 40% magic (prayer drain) - ReasonPS rates. */
const SPINOLYP_RANGED_CHANCE = 0.6;
/** Spinolyp magic drains 1 prayer on a damaging hit (Mod Ash; spectral halves it). */
const SPINOLYP_PRAYER_DRAIN = 1;

/** Surfaced spinolyp id -> submerged water id (order-paired; estimate). */
const DIVE_PAIRS = new Map(SPINOLYP_IDS.map((id, index) => [id, WATER_IDS[index]]));
/** Submerged water id -> surfaced spinolyp id. */
const EMERGE_PAIRS = new Map(SPINOLYP_IDS.map((id, index) => [WATER_IDS[index], id]));

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

const location = ([x, y, z]) => new core.Location(x, y, z ?? 0);

function within(bounds, at) {
  if (!at || (at.getZ?.() ?? 0) !== 0) return false;
  const x = at.getX();
  const y = at.getY();
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

const inPublicLair = (at) => within(PUBLIC_LAIR, at);
const inTaskLair = (at) => within(TASK_LAIR, at);
const inEitherLair = (at) => inPublicLair(at) || inTaskLair(at);

function isKing(npc) {
  return KING_IDS.includes(npc?.getId?.());
}

function isSpinolyp(npc) {
  const id = npc?.getId?.();
  return SPINOLYP_IDS.includes(id);
}

function isSubmerged(npc) {
  return WATER_IDS.includes(npc?.getId?.());
}

/** Chebyshev distance between two tiles. */
function tileDistance(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

/** Edge-to-edge distance between an `npcSize` body at `base` and a 1x1 `pos`. */
function edgeDistance(base, npcSize, pos) {
  const dx = pos.getX() < base.getX() ? base.getX() - pos.getX()
    : pos.getX() > base.getX() + npcSize - 1 ? pos.getX() - (base.getX() + npcSize - 1) : 0;
  const dy = pos.getY() < base.getY() ? base.getY() - pos.getY()
    : pos.getY() > base.getY() + npcSize - 1 ? pos.getY() - (base.getY() + npcSize - 1) : 0;
  return Math.max(dx, dy);
}

/** Players within `radius` tiles (Chebyshev) of `at`, alive, in the same area.
 * `fetchRadius` is how far from the NPC to look: splash victims cluster around the
 * target, which can stand up to a full attack range away (getPlayersWithinDistance
 * measures from the NPC, not from `at`). */
function playersAround(npc, at, radius, fetchRadius = radius) {
  const area = npc.getPrivateArea?.() ?? null;
  return npc.getPlayersWithinDistance(fetchRadius).filter((player) =>
    player.getPrivateArea?.() === area
    && tileDistance(player.getLocation(), at) <= radius
    && player.getHitpoints() > 0);
}

module.exports = {
  DATA, SUPREME_ID, PRIME_ID, REX_ID, SPINOLYP_IDS, WATER_IDS, KING_IDS,
  LADDER_ID, EXIT_LADDER_ID, ENTRANCE_TILE,
  PUBLIC_LAIR, TASK_LAIR, PUBLIC_SPAWN, TASK_SPAWN, OUTSIDE_TILE, TELEPORT_TILE,
  AGGRO_TILES, ANIM, PROJECTILE, PRIME_CAST_SOUND, SUPREME_IMPACT_SOUND,
  ATTACK_SPEED, PRIME_DISTANCE, SUPREME_DISTANCE,
  PRIME_SPLASH_RADIUS, SUPREME_SPLASH_RADIUS, HIT_DELAY, MAX_HIT,
  RESPAWN_TICKS, DEATH_TICKS, SPINOLYP_RANGED_CHANCE, SPINOLYP_PRAYER_DRAIN,
  DIVE_PAIRS, EMERGE_PAIRS,
  init, location, within, inPublicLair, inTaskLair, inEitherLair,
  isKing, isSpinolyp, isSubmerged, tileDistance, edgeDistance, playersAround,
  get api() { return api; },
  get core() { return core; },
};
