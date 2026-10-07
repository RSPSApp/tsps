"use strict";

/**
 * The modifiers that put something in the arena: Bees!, Solarflare, Totemic, Volatility and
 * Reentry's molten sand.
 *
 * Wiki ("Fortis Colosseum", Modifiers, and the Strategies page):
 * - Bees!: 1-3 swarms (1 HP) drift towards the player a tile every 12 ticks. Under one, the
 *   player takes up to 10 unblockable poison damage a tick and is poisoned from 1. Antipoison
 *   halves it (the Bee Swarm page, which gives 15-20 a tick where the modifier says up to 10).
 *   A swarm killed comes back 30 seconds later.
 * - Solarflare: an orb circles the pillars, a tile every 2 ticks and resting 7 at each corner;
 *   II never rests and hits harder; III moves every tick, rests 2, hits harder still and turns
 *   prayers off.
 * - Totemic: an enemy at half health or below gets a healing totem (1 HP) to its south-west,
 *   or elsewhere if that tile is taken. About 5 ticks later it starts sending heals, each 30%
 *   of the enemy's health, until the enemy is full. A heal in flight is lost if the totem dies.
 *   A destroyed totem comes back two minutes later.
 * - Volatility: an enemy explodes as it dies, one tile past its size (II: two). III leaves a
 *   pool of molten sand on its centre tile for the wave (Reentry II or III: for the run).
 * - Reentry: the Javelin Colossus's sky javelin leaves molten sand where it lands, for the
 *   wave; II makes it permanent and adds the tile south-west, III the tile west of that one
 *   (a random free tile when one is blocked).
 * - Molten sand: up to 15 damage every other tick to a player standing on it, and none
 *   between waves (the Molten Sand page). Sol Heredit's own sand is weaker: 6-8 every tick.
 * - In wave 12 the Solarflare orb circles a 5x5 by a corner of the barricaded arena, and a
 *   totem heals Sol 75 every 7 ticks (Strategies, Modifiers).
 * RuneLite (gameval): the NPCs (bees 12823, totem 12825, solar flare 12826), the totem's
 * animation 10828 and projectile 2687/2688, the explosion graphics 2713-2723 and the
 * Manticore's exploding death 10867.
 * Cache: the pillars from the arena's collision; molten sand is loc 50746, which does not block.
 * Estimates (the Wiki gives no figures): the Solarflare's and the explosions' damage, which
 * pillar the orb circles, where swarms appear and the totem's heal rate.
 */

const Shared = require("./ColosseumShared");
const Waves = require("./ColosseumWaves");

const NPC = { BEES: 12823, TOTEM: 12825, SOLAR_FLARE: 12826 };
const MOLTEN_SAND = 50746;

/** The four 3x3 pillars by south-west corner (the arena's collision in the cache). */
const PILLARS = [{ x: 1816, y: 3113 }, { x: 1831, y: 3113 }, { x: 1816, y: 3098 }, { x: 1831, y: 3098 }];

const BEES = { moveEvery: 12, max: 10, respawnTicks: 50, minDistance: 4 };
const SOLARFLARE = [
  null,
  { moveEvery: 2, cornerRest: 7, max: 5 },
  { moveEvery: 2, cornerRest: 0, max: 10 },
  { moveEvery: 1, cornerRest: 2, max: 15, disablesPrayer: true },
];
const TOTEM = {
  firstHeal: 5, healEvery: 5, healShare: 0.3, respawnTicks: 200,
  anim: 10828, projectile: 2687, impact: 2688, travel: 40,
};
/** Reentry's and Volatility's sand, and Sol Heredit's. */
const SAND = { strong: { min: 1, max: 15, every: 2 }, sol: { min: 6, max: 8, every: 1 } };
const EXPLOSION = { max: 15, delay: 2 };
const EXPLOSION_GFX = { human: 2713, manticore: 2721, colossus: 2722, minotaur: 2723, sol: 2724 };
/** Corners of wave 12's barricaded arena that the orb circles, as 3x3 "pillars" (estimate). */
const SOL_CORNERS = [{ x: 1819, y: 3101 }, { x: 1827, y: 3101 }, { x: 1819, y: 3109 }, { x: 1827, y: 3109 }];
const SOL_TOTEM = { heal: 75, every: 7 };
const MANTICORE_EXPLODE_ANIM = 10867;

function randomInclusive(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function tier(run, id) {
  return run.modifiers.tierOf(id);
}

function free(run, x, y) {
  const { RegionManager } = Shared.core();
  return (RegionManager.getClipping(x, y, 0, run.area) & 0x1280100) === 0;
}

function at(npc) {
  return { x: npc.getLocation().getX(), y: npc.getLocation().getY() };
}

function playerAt(run) {
  return { x: run.player.getLocation().getX(), y: run.player.getLocation().getY() };
}

function covers(npc, tile) {
  const { x, y } = at(npc);
  const size = npc.getSize?.() ?? 1;
  return tile.x >= x && tile.x < x + size && tile.y >= y && tile.y < y + size;
}

function alive(npc) {
  return npc && npc.isRegistered() && npc.getHitpoints() > 0;
}

/** Something the run owns that is not an enemy: it never counts towards clearing the wave. */
function spawnHazard(run, id, tile) {
  const npc = run.spawnNpc(id, tile);
  if (!npc) return null;
  npc.setFlag?.("combat:no-retaliate");
  npc.setFlag?.(Shared.core().NPC.WALK_THROUGH_ENTITIES_FLAG);
  run.hazards.add(npc);
  return npc;
}

function removeHazard(run, npc) {
  if (!npc) return;
  run.hazards.delete(npc);
  if (npc.isRegistered()) Shared.api().removeNpc(npc);
}

// ---------------------------------------------------------------- bees

function beeTile(run) {
  const player = playerAt(run);
  const far = Waves.SPAWN_POINTS.filter((tile) =>
    Math.max(Math.abs(tile.x - player.x), Math.abs(tile.y - player.y)) >= BEES.minDistance);
  const pool = far.length > 0 ? far : Waves.SPAWN_POINTS;
  return pool[Math.floor(run.random() * pool.length)];
}

function spawnBees(run) {
  const swarm = spawnHazard(run, NPC.BEES, beeTile(run));
  if (swarm) run.bees.push({ npc: swarm, respawnAt: 0 });
}

/** One step closer, so that the player ends up under the 2x2 swarm. */
function stepTowards(npc, target) {
  const { PathFinder } = Shared.core();
  const { x, y } = at(npc);
  const size = npc.getSize?.() ?? 1;
  const dx = target.x < x ? -1 : target.x >= x + size ? 1 : 0;
  const dy = target.y < y ? -1 : target.y >= y + size ? 1 : 0;
  if (dx !== 0 || dy !== 0) PathFinder.calculateWalkRoute(npc, x + dx, y + dy);
}

function tendBees(run) {
  const player = run.player;
  const tile = playerAt(run);
  for (const bee of run.bees) {
    if (!alive(bee.npc)) {
      if (bee.npc) {
        removeHazard(run, bee.npc);
        bee.npc = null;
        bee.respawnAt = run.waveTicks + BEES.respawnTicks;
      }
      if (run.waveTicks >= bee.respawnAt) {
        bee.npc = spawnHazard(run, NPC.BEES, beeTile(run));
      }
      continue;
    }
    if (run.waveTicks % BEES.moveEvery === 0) stepTowards(bee.npc, tile);
    if (!covers(bee.npc, tile)) continue;
    const protectedFromPoison = !player.getCombat().getPoisonImmunityTimer().finished();
    const damage = randomInclusive(1, BEES.max);
    run.hurt(protectedFromPoison ? Math.max(1, Math.floor(damage / 2)) : damage, "GREEN");
    Shared.core().CombatFactory.poisonEntity(player, 1, 1);
  }
}

// ---------------------------------------------------------------- solarflare

/** The 16 tiles around a 3x3 pillar, clockwise from its south-west corner. */
function ring(pillar) {
  const minX = pillar.x - 1;
  const minY = pillar.y - 1;
  const maxX = pillar.x + 3;
  const maxY = pillar.y + 3;
  const tiles = [];
  for (let y = minY; y < maxY; y++) tiles.push({ x: minX, y });
  for (let x = minX; x < maxX; x++) tiles.push({ x, y: maxY });
  for (let y = maxY; y > minY; y--) tiles.push({ x: maxX, y });
  for (let x = maxX; x > minX; x--) tiles.push({ x, y: minY });
  return tiles.map((tile) => ({ ...tile, corner: (tile.x === minX || tile.x === maxX) && (tile.y === minY || tile.y === maxY) }));
}

function spawnSolarflare(run) {
  const around = run.wave + 1 >= Shared.FINAL_WAVE ? SOL_CORNERS : PILLARS;
  const path = ring(around[Math.floor(run.random() * around.length)]);
  const index = Math.floor(run.random() * path.length);
  const npc = spawnHazard(run, NPC.SOLAR_FLARE, path[index]);
  if (npc) run.solarflare = { npc, path, index, restUntil: 0, touching: false };
}

function tendSolarflare(run) {
  const flare = run.solarflare;
  const level = SOLARFLARE[tier(run, "solarflare")];
  if (!flare || !level) return;
  if (run.waveTicks >= flare.restUntil && run.waveTicks % level.moveEvery === 0) {
    flare.index = (flare.index + 1) % flare.path.length;
    const next = flare.path[flare.index];
    Shared.core().PathFinder.calculateWalkRoute(flare.npc, next.x, next.y);
    if (next.corner && level.cornerRest > 0) flare.restUntil = run.waveTicks + level.moveEvery + level.cornerRest;
  }
  const touching = covers(flare.npc, playerAt(run));
  if (touching && !flare.touching) {
    run.hurt(randomInclusive(1, level.max));
    if (level.disablesPrayer) Shared.core().PrayerHandler.deactivatePrayers(run.player);
  }
  flare.touching = touching;
}

// ---------------------------------------------------------------- molten sand

function addSand(run, tile, permanent, kind = "strong") {
  const key = `${tile.x},${tile.y}`;
  const existing = run.sand.get(key);
  if (existing) {
    existing.permanent ||= permanent;
    return;
  }
  const { GameObject, ObjectManager } = Shared.core();
  const object = new GameObject(MOLTEN_SAND, Shared.loc(tile), 10, 0, run.area);
  ObjectManager.register(object, true);
  run.sand.set(key, { object, permanent, kind });
}

function hasSand(run, tile) {
  return run.sand.has(`${tile.x},${tile.y}`);
}

/** A free tile without sand next to `tile`, for a pool whose own tile is blocked or taken. */
function nearbyFreeTile(run, tile) {
  const options = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const option = { x: tile.x + dx, y: tile.y + dy };
      if ((dx !== 0 || dy !== 0) && free(run, option.x, option.y) && !hasSand(run, option)) options.push(option);
    }
  }
  return options.length > 0 ? options[Math.floor(run.random() * options.length)] : null;
}

function placeOrNearby(run, tile) {
  return free(run, tile.x, tile.y) && !hasSand(run, tile) ? tile : nearbyFreeTile(run, tile);
}

/** Reentry: where a sky javelin lands. */
function javelinLanded(run, tile) {
  const level = tier(run, "reentry");
  if (!run || level === 0 || run.stage !== "wave") return;
  const permanent = level >= 2;
  addSand(run, tile, permanent);
  if (level < 2) return;
  const second = placeOrNearby(run, { x: tile.x - 1, y: tile.y - 1 });
  if (second) addSand(run, second, permanent);
  if (level < 3 || !second) return;
  const third = placeOrNearby(run, { x: second.x - 1, y: second.y });
  if (third) addSand(run, third, permanent);
}

function tendSand(run) {
  const tile = playerAt(run);
  const pool = run.sand.get(`${tile.x},${tile.y}`);
  if (!pool) return;
  const strength = SAND[pool.kind];
  if (run.waveTicks % strength.every === 0) run.hurt(randomInclusive(strength.min, strength.max));
}

function clearSand(run, all) {
  const { ObjectManager } = Shared.core();
  for (const [key, pool] of run.sand) {
    if (!all && pool.permanent) continue;
    ObjectManager.deregister(pool.object, true);
    run.sand.delete(key);
  }
}

// ---------------------------------------------------------------- totems

function totemTile(run, enemy) {
  const { x, y } = at(enemy);
  const southWest = { x: x - 1, y: y - 1 };
  return free(run, southWest.x, southWest.y) ? southWest : nearbyFreeTile(run, southWest);
}

function sendHeal(run, totem, enemy, amount) {
  const { Animation, Graphic, Projectile } = Shared.core();
  totem.performAnimation(new Animation(TOTEM.anim));
  Projectile.createProjectile(totem, enemy, TOTEM.projectile, 20, TOTEM.travel, 40, 40).sendProjectile();
  const ticks = Math.ceil(TOTEM.travel / 30);
  Shared.later(run, ticks, () => {
    if (!alive(totem) || !alive(enemy)) return;
    const max = enemy.getMaxHitpoints?.() ?? enemy.getHitpoints();
    enemy.setHitpoints(Math.min(max, enemy.getHitpoints() + amount));
    enemy.performGraphic(Object.assign(new Graphic(TOTEM.impact), { delay: 0, height: 0 }));
  });
}

function tendTotems(run) {
  if (tier(run, "totemic") === 0) return;
  for (const enemy of run.npcs) {
    if (!alive(enemy)) continue;
    const max = enemy.getMaxHitpoints?.() ?? enemy.getHitpoints();
    let record = run.totems.get(enemy);
    if (record?.totem && !alive(record.totem)) {
      removeHazard(run, record.totem);
      record.totem = null;
      record.respawnAt = run.waveTicks + TOTEM.respawnTicks;
    }
    const wounded = enemy.getHitpoints() * 2 <= max;
    if (!record?.totem && wounded && run.waveTicks >= (record?.respawnAt ?? 0)) {
      const tile = totemTile(run, enemy);
      const totem = tile ? spawnHazard(run, NPC.TOTEM, tile) : null;
      if (!totem) continue;
      record = { totem, nextHeal: run.waveTicks + TOTEM.firstHeal, respawnAt: 0 };
      run.totems.set(enemy, record);
    }
    if (!record?.totem || run.waveTicks < record.nextHeal) continue;
    if (enemy.getHitpoints() >= max) continue;
    const sol = enemy === run.solFight?.npc;
    sendHeal(run, record.totem, enemy, sol ? SOL_TOTEM.heal : Math.floor(max * TOTEM.healShare));
    record.nextHeal = run.waveTicks + (sol ? SOL_TOTEM.every : TOTEM.healEvery);
  }
}

// ---------------------------------------------------------------- volatility

function explosionGfx(kind) {
  if (kind === "sol") return EXPLOSION_GFX.sol;
  if (kind === "manticore") return EXPLOSION_GFX.manticore;
  if (kind === "javelin" || kind === "shockwave") return EXPLOSION_GFX.colossus;
  if (kind === "minotaur") return EXPLOSION_GFX.minotaur;
  return EXPLOSION_GFX.human;
}

/** An enemy has died: its totem goes, and under Volatility it explodes. */
function enemyDied(run, npc, kind) {
  const record = run.totems.get(npc);
  if (record) {
    removeHazard(run, record.totem);
    run.totems.delete(npc);
  }
  const level = tier(run, "volatility");
  if (level === 0) return;
  const { Animation, Graphic } = Shared.core();
  const { x, y } = at(npc);
  const size = npc.getSize?.() ?? 1;
  const reach = Math.min(level, 2);
  const centre = { x: x + Math.floor(size / 2), y: y + Math.floor(size / 2) };
  if (kind === "manticore") npc.performAnimation(new Animation(MANTICORE_EXPLODE_ANIM));
  Shared.later(run, EXPLOSION.delay, () => {
    if (run.stage === "ended") return;
    const graphic = Object.assign(new Graphic(explosionGfx(kind)), { delay: 0, height: 0 });
    run.player.getPacketSender().sendGraphic(graphic, Shared.loc(centre));
    const tile = playerAt(run);
    const inside = tile.x >= x - reach && tile.x < x + size + reach && tile.y >= y - reach && tile.y < y + size + reach;
    if (inside) run.hurt(randomInclusive(1, EXPLOSION.max));
    if (level >= 3 && free(run, centre.x, centre.y)) addSand(run, centre, tier(run, "reentry") >= 2);
  });
}

// ---------------------------------------------------------------- the run's hooks

function waveStarted(run) {
  for (let i = 0; i < tier(run, "bees"); i++) spawnBees(run);
  if (tier(run, "solarflare") > 0) spawnSolarflare(run);
}

function tick(run) {
  if (run.stage !== "wave") return;
  tendBees(run);
  tendSolarflare(run);
  tendSand(run);
  tendTotems(run);
}

/** A wave is over: swarms, the orb and totems go, and so does any sand that isn't permanent. */
function waveEnded(run) {
  for (const npc of [...run.hazards]) removeHazard(run, npc);
  run.bees = [];
  run.solarflare = null;
  run.totems.clear();
  clearSand(run, false);
}

function cleared(run) {
  waveEnded(run);
  clearSand(run, true);
}

module.exports = {
  NPC, PILLARS, SOL_CORNERS, ring, addSand, hasSand, javelinLanded, enemyDied, waveStarted, tick, waveEnded, cleared,
};
