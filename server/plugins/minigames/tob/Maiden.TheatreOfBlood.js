"use strict";

/**
 * Wave 1: the Maiden of Sugadinti.
 *
 * Wiki (The Maiden of Sugadinti; "Theatre of Blood/Strategies"):
 * - Every 10 ticks she attacks: Blackstorm at the nearest player (ties by party order), always
 *   landing, for up to 36.5 + 3.5 x the Nylocas Matomenos that have reached her; Protect from
 *   Magic halves it. It drains the target's combat stats by (damage + 1) / 5 half the time,
 *   which stats by their highest attack bonus.
 * - Or blood: a splat on every player's tile and two more in the 5x5 round one of them. A splat
 *   hurts anyone on it for 10 + 2 x those Matomenos, heals her the same and drains prayer.
 *   She can't throw blood again for her next two attacks.
 * - A splat turns into a blood spawn (120 hitpoints) 10% of the time, 20% if someone stood on
 *   it; at most eight. Blood spawns wander leaving trails that hurt for 5-13 and heal her.
 * - At 70%, 50% and 30% she changes form and two Matomenos per player (at most ten) come from
 *   the north and south walls, walking straight to her; each one that reaches her heals her
 *   twice its remaining hitpoints. Freezing them stops them.
 * Cache: her forms 8360-8363, dying 8364/8365, Matomenos 8366, blood spawn 8367, the waiting
 * Maiden loc 32972, the pool of blood left after her (32973), the trail loc 32984.
 * RuneLite (gameval): her animations (8091 blood, 8092 Blackstorm, 8093/8094 dying) and the
 * projectiles and graphic (1577 shadow, 1578 blood, 1579 lingering blood).
 * Captured: the attacks every 10 ticks, the projectiles' timing and arcs, the sounds (176
 * Blackstorm, 3547 blood), the Matomenos' spawn tiles. Estimates: the blood-or-Blackstorm
 * odds (1 in 4; the captures show about one blood throw in five attacks), splats lasting 10
 * ticks and the blood-spawn roll 9 ticks in, prayer drained by half the splat damage, blood
 * spawns' wander, the trails' life.
 */

const Shared = require("./TobShared");
const Raid = require("./TobRaid");

const NPC = { FORMS: [8360, 8361, 8362, 8363], DYING: 8364, MATOMENOS: 8366, BLOOD_SPAWN: 8367 };
const OBJECT = { WAITING: 32972, POOL: 32973, TRAIL: 32984 };
const SPAWN = { x: 3162, y: 4444, z: 0 };
const ANIMATION = { BLOOD: 8091, BLACKSTORM: 8092 };
const GRAPHIC = { SHADOW: 1577, BLOOD: 1578, LINGERING: 1579 };
/** As captured: launch cycle, flight per tile, arc (angle), start offset (progress), heights. */
const PROJECTILE = {
  BLACKSTORM: { delay: 109, duration: 0, perTile: 10, startHeight: 0, endHeight: 0, angle: 0, progress: 11 },
  BLOOD: { delay: 20, duration: 0, perTile: 15, startHeight: 40, endHeight: 0, angle: 15, progress: 11 },
  /** The two splats thrown round a player leave later. */
  BLOOD_EXTRA: { delay: 45, duration: 0, perTile: 15, startHeight: 40, endHeight: 0, angle: 15, progress: 11 },
};
const SOUND = { BLACKSTORM: 176, BLOOD: 3547 };

const ATTACK_TICKS = 10;
const BLOOD_CHANCE = 4;
const BLOOD_COOLDOWN = 2;
const BLACKSTORM = { base: 36.5, perNylo: 3.5 };
const SPLAT = { base: 10, perNylo: 2, ticks: 10, spawnRoll: 9 };
const BLOOD_SPAWN = { max: 8, chance: 0.1, steppedChance: 0.2, radius: 10, wanderChance: 1 / 3 };
const TRAIL = { ticks: 40, min: 5, max: 13 };
const THRESHOLDS = [0.7, 0.5, 0.3];
const MAX_MATOMENOS = 10;
/** Five spawn tiles each side, N then S, as captured: four along the wall, one by the east end. */
const MATOMENOS_TILES = [
  { x: 3173, y: 4456 }, { x: 3177, y: 4456 }, { x: 3181, y: 4456 }, { x: 3185, y: 4456 }, { x: 3185, y: 4454 },
  { x: 3173, y: 4436 }, { x: 3177, y: 4436 }, { x: 3181, y: 4436 }, { x: 3185, y: 4436 }, { x: 3185, y: 4438 },
];

const key = (tile) => `${tile.x},${tile.y}`;

class MaidenRoom extends Raid.Room {
  onBuild() {
    this.maiden = null;
    this.waiting = this.placeObject(OBJECT.WAITING, SPAWN, 10, 3);
  }

  onStart() {
    const { ObjectManager } = Shared.core();
    ObjectManager.deregister(this.waiting, true);
    this.objects = this.objects.filter((object) => object !== this.waiting);
    this.maiden = this.spawn(NPC.FORMS[0], SPAWN, { face: Shared.facing("EAST"), scripted: true });
    if (!this.maiden) return;
    this.maiden.getMovementQueue().setBlockMovement(true);
    this.ticks = 0;
    this.form = 0;
    this.nylosAbsorbed = 0;
    this.bloodCooldown = 0;
    this.splats = new Map();
    this.trails = new Map();
    this.matomenos = new Set();
    this.bloodSpawns = new Set();
  }

  healthBar() {
    const maiden = this.maiden;
    return maiden ? { current: Math.max(0, maiden.getHitpoints()), maximum: maiden.getMaxHitpoints() } : null;
  }

  tick() {
    const maiden = this.maiden;
    if (!this.isStarted() || !maiden) return;
    if (maiden.getHitpoints() <= 0) {
      this.complete();
      return;
    }
    this.ticks++;
    this.checkForms();
    this.tickSplats();
    this.tickMatomenos();
    this.tickBloodSpawns();
    if (this.ticks % ATTACK_TICKS === 0) this.attack();
  }

  onComplete() {
    for (const npc of [...this.matomenos, ...this.bloodSpawns]) this.despawn(npc);
    for (const trail of this.trails.values()) Shared.core().ObjectManager.deregister(trail.object, true);
    this.trails.clear();
    this.splats.clear();
    this.placeObject(OBJECT.POOL, SPAWN, 10, 3);
  }

  // -------------------------------------------------------------- attacks

  attack() {
    const targets = this.fighters();
    if (targets.length === 0) return;
    if (this.bloodCooldown > 0) this.bloodCooldown--;
    if (this.bloodCooldown === 0 && Shared.random(1, BLOOD_CHANCE) === 1) this.throwBlood(targets);
    else this.blackstorm(targets);
  }

  /** The nearest player to her, ties going to the first in the party's order. */
  nearest(targets) {
    let best = null;
    for (const player of targets) {
      if (!best || Shared.distanceTo(this.maiden, player.getLocation()) < Shared.distanceTo(this.maiden, best.getLocation())) best = player;
    }
    return best;
  }

  blackstorm(targets) {
    const { Animation } = Shared.core();
    const target = this.nearest(targets);
    const maiden = this.maiden;
    maiden.setMobileInteraction?.(target);
    maiden.performAnimation(new Animation(ANIMATION.BLACKSTORM));
    Shared.areaSound(this.area, maiden, SOUND.BLACKSTORM);
    const ticks = Shared.projectile(this.area, maiden, target, GRAPHIC.SHADOW, PROJECTILE.BLACKSTORM);
    const maxHit = BLACKSTORM.base + BLACKSTORM.perNylo * this.nylosAbsorbed;
    const hit = this.strike(maiden, target, "magic", maxHit, Math.max(1, ticks - 1), { accurate: true, prayerMultiplier: 0.5 });
    if (hit.getTotalDamage() > 0 && Math.random() < 0.5) {
      this.later(Math.max(1, ticks - 1), () => drainStats(target, hit.getTotalDamage()));
    }
  }

  throwBlood(targets) {
    const { Animation } = Shared.core();
    this.bloodCooldown = BLOOD_COOLDOWN + 1;
    this.maiden.performAnimation(new Animation(ANIMATION.BLOOD));
    Shared.areaSound(this.area, this.maiden, SOUND.BLOOD);
    const tiles = targets.map((player) => Shared.tileOf(player));
    const centre = Shared.tileOf(Shared.randomOf(targets));
    for (let extra = 0; extra < 2; extra++) {
      tiles.push({ x: centre.x + Shared.random(-2, 2), y: centre.y + Shared.random(-2, 2), z: 0 });
    }
    const aimed = new Set();
    for (const [index, tile] of tiles.entries()) {
      if (aimed.has(key(tile)) || this.splats.has(key(tile)) || !Shared.floorFree(this.area, tile)) continue;
      aimed.add(key(tile));
      const ticks = Shared.projectile(this.area, this.maiden, tile, GRAPHIC.BLOOD, index < targets.length ? PROJECTILE.BLOOD : PROJECTILE.BLOOD_EXTRA);
      this.later(ticks, () => this.landSplat(tile));
    }
  }

  landSplat(tile) {
    if (this.splats.has(key(tile))) return;
    Shared.graphicAt(this.area, GRAPHIC.LINGERING, tile);
    const stepped = this.fighters().some((player) => Shared.tileOf(player).x === tile.x && Shared.tileOf(player).y === tile.y);
    this.splats.set(key(tile), { tile, ticks: SPLAT.ticks, stepped });
    this.later(SPLAT.spawnRoll, () => {
      const splat = this.splats.get(key(tile));
      this.rollBloodSpawn(tile, splat?.stepped || stepped);
    });
  }

  rollBloodSpawn(tile, stepped) {
    if (this.bloodSpawns.size >= BLOOD_SPAWN.max) return;
    if (Math.random() >= (stepped ? BLOOD_SPAWN.steppedChance : BLOOD_SPAWN.chance)) return;
    const spawn = this.spawn(NPC.BLOOD_SPAWN, tile, { scale: false, scripted: true });
    if (!spawn) return;
    spawn.__home = tile;
    this.bloodSpawns.add(spawn);
  }

  // -------------------------------------------------------------- the floor

  /** Splats and trails hurt whoever stands on them each tick, and heal her as much. */
  tickSplats() {
    for (const [tileKey, splat] of this.splats) {
      if (--splat.ticks <= 0) this.splats.delete(tileKey);
    }
    for (const [tileKey, trail] of this.trails) {
      if (--trail.ticks <= 0) {
        Shared.core().ObjectManager.deregister(trail.object, true);
        this.trails.delete(tileKey);
      }
    }
    for (const player of this.fighters()) {
      const here = key(Shared.tileOf(player));
      const splat = this.splats.get(here);
      if (splat) {
        splat.stepped = true;
        const damage = SPLAT.base + SPLAT.perNylo * this.nylosAbsorbed;
        Shared.damage(player, damage);
        Shared.heal(this.maiden, damage);
        const { Skill } = Shared.core();
        player.getSkillManager().decreaseCurrentLevel?.(Skill.PRAYER, Math.floor(damage / 2), 0);
      } else if (this.trails.has(here)) {
        const damage = Shared.random(TRAIL.min, TRAIL.max);
        Shared.damage(player, damage);
        Shared.heal(this.maiden, damage);
      }
    }
  }

  // -------------------------------------------------------------- forms and Matomenos

  checkForms() {
    const share = this.maiden.getHitpoints() / Math.max(1, this.maiden.getMaxHitpoints());
    while (this.form < THRESHOLDS.length && share <= THRESHOLDS[this.form]) {
      this.form++;
      this.maiden.setNpcTransformationId?.(NPC.FORMS[this.form]);
      this.spawnMatomenos();
    }
  }

  /** Two per player in the fight, at most ten; with fewer than five players, random tiles. */
  spawnMatomenos() {
    const count = Math.min(MAX_MATOMENOS, 2 * Math.max(1, this.fighters().length));
    const tiles = count >= MATOMENOS_TILES.length ? MATOMENOS_TILES : Shared.shuffle(MATOMENOS_TILES).slice(0, count);
    for (const tile of tiles) {
      // As captured: those from the north wall face south-west, those from the south north-west.
      const face = Shared.facing(tile.y > SPAWN.y ? "SOUTH_WEST" : "NORTH_WEST");
      const nylo = this.spawn(NPC.MATOMENOS, { ...tile, z: 0 }, { scripted: true, face });
      if (nylo) this.matomenos.add(nylo);
    }
  }

  /** Each walks to her unless frozen; one that reaches her heals her twice its hitpoints. */
  tickMatomenos() {
    const { PathFinder } = Shared.core();
    for (const nylo of [...this.matomenos]) {
      if (nylo.getHitpoints() <= 0 || !nylo.isRegistered()) {
        this.matomenos.delete(nylo);
        continue;
      }
      if (gap(nylo, this.maiden) <= 1) {
        Shared.heal(this.maiden, 2 * nylo.getHitpoints());
        this.nylosAbsorbed++;
        this.matomenos.delete(nylo);
        this.despawn(nylo);
        continue;
      }
      if (Shared.frozen(nylo) || nylo.getMovementQueue().hasRoute?.()) continue;
      const at = Shared.tileOf(nylo);
      PathFinder.calculateWalkRoute(nylo, SPAWN.x + 6, Math.max(SPAWN.y, Math.min(SPAWN.y + 4, at.y)));
    }
  }

  /** Blood spawns wander round where they appeared, leaving trails behind them. */
  tickBloodSpawns() {
    const { PathFinder } = Shared.core();
    for (const spawn of [...this.bloodSpawns]) {
      if (spawn.getHitpoints() <= 0 || !spawn.isRegistered()) {
        this.bloodSpawns.delete(spawn);
        continue;
      }
      this.leaveTrail(Shared.tileOf(spawn));
      if (Shared.frozen(spawn) || spawn.getMovementQueue().hasRoute?.() || Math.random() >= BLOOD_SPAWN.wanderChance) continue;
      const home = spawn.__home;
      PathFinder.calculateWalkRoute(spawn,
        home.x + Shared.random(-BLOOD_SPAWN.radius, BLOOD_SPAWN.radius),
        home.y + Shared.random(-BLOOD_SPAWN.radius, BLOOD_SPAWN.radius));
    }
  }

  leaveTrail(tile) {
    const existing = this.trails.get(key(tile));
    if (existing) {
      existing.ticks = TRAIL.ticks;
      return;
    }
    const { GameObject, ObjectManager } = Shared.core();
    const object = new GameObject(OBJECT.TRAIL, Shared.loc(tile), 10, Shared.random(0, 3), this.area);
    ObjectManager.register(object, true);
    this.trails.set(key(tile), { object, ticks: TRAIL.ticks });
  }

  destroy() {
    if (this.trails) {
      for (const trail of this.trails.values()) Shared.core().ObjectManager.deregister(trail.object, true);
      this.trails.clear();
    }
    super.destroy();
  }
}

/** Tiles between two actors' footprints (0 when they touch or overlap). */
function gap(a, b) {
  const box = (actor) => {
    const at = actor.getLocation();
    const size = actor.getSize?.() ?? 1;
    return { minX: at.getX(), minY: at.getY(), maxX: at.getX() + size - 1, maxY: at.getY() + size - 1 };
  };
  const first = box(a);
  const second = box(b);
  const dx = Math.max(0, second.minX - first.maxX, first.minX - second.maxX);
  const dy = Math.max(0, second.minY - first.maxY, first.minY - second.maxY);
  return Math.max(dx, dy);
}

/** Wiki: (damage + 1) / 5 off the stats behind the target's highest attack bonus. */
function drainStats(player, damage) {
  const { Skill } = Shared.core();
  const bonuses = player.getBonusManager?.()?.getAttackBonus?.() ?? [];
  let best = 0;
  for (let i = 1; i < 5; i++) if ((bonuses[i] ?? 0) > (bonuses[best] ?? 0)) best = i;
  const amount = Math.floor((damage + 1) / 5);
  if (amount <= 0) return;
  const skills = best <= 2 ? [Skill.ATTACK, Skill.STRENGTH] : best === 3 ? [Skill.MAGIC] : [Skill.RANGED];
  const manager = player.getSkillManager();
  for (const skill of skills) manager.decreaseCurrentLevel?.(skill, amount, 1);
  player.sendMessage("Your stats are drained.");
}

module.exports = function registerMaiden(api) {
  Shared.bind(api);
  Raid.registerRoom("MAIDEN", MaidenRoom);
};

Object.assign(module.exports, { MaidenRoom, NPC, MATOMENOS_TILES, gap, drainStats });
