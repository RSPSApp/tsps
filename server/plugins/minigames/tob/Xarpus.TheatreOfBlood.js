"use strict";

/**
 * Wave 5: Xarpus.
 *
 * Wiki (Xarpus; "Theatre of Blood/Strategies", Xarpus):
 * - Recovery: it starts at 75% of its hitpoints and doesn't attack. Exhumed rise from the floor
 *   and heal it until they sink back, unless someone stands on them; 12 of them for a trio,
 *   15 for four (18 for five, an estimate).
 * - Poison: it spits at one player every 4 ticks. The splat lightly poisons the 3x3 round where
 *   it lands, splashes on to another player, and stays for the rest of the fight: standing on
 *   it hurts for 4-8 every tick. Standing under Xarpus hurts for up to 9 every tick.
 * - Counter: at 25% it screeches ("Screeeeech!"), stops spitting and stares at one quadrant,
 *   turning to another every 8 ticks. Each hitsplat from a player in that quadrant comes back
 *   as 50-75 poison.
 * Cache: Xarpus (8338 waiting, 8339 feeding, 8340 fighting), the exhumed (32743) and the
 * acidic miasma (32744). RuneLite (gameval): its animations (8059 spit, 8061 rising), the
 * exhumed's (8065) and the splat's (8068), its graphics (1549 exhumed sinking, 1550 the
 * exhumed's orb, 1555 the spit, 1556 the splash, 1557 pebbles).
 * Captured: the spit every 4 ticks with its sound (4018), the projectiles' timing and arcs,
 * "Screeeeech!". Estimates: its tiles, how fast the exhumed come (every 13/8/8/4/4 ticks for 1-5 players)
 * and how long they stay (11 ticks, the first 3 rising), their heals per tick (20/16/12/9/6),
 * the splat splashing on or to 1-2 nearby tiles, the four-second pauses round the phases, the
 * quadrants' corners.
 * Not done: the exhumed it absorbs don't raise its stats or poison damage.
 */

const Shared = require("./TobShared");
const Raid = require("./TobRaid");

const NPC = { WAITING: 8338, FEEDING: 8339, FIGHTING: 8340 };
const OBJECT = { EXHUMED: 32743, MIASMA: 32744 };
const PLANE = 1;
const SPAWN = { x: 3169, y: 4386, z: PLANE };
const ARENA = { minX: 3163, maxX: 3177, minY: 4380, maxY: 4394 };
const CENTRE = { x: 3170, y: 4387 };
const QUADRANTS = {
  SE: { corner: { x: 3177, y: 4380 }, inside: (t) => t.x > CENTRE.x && t.y <= CENTRE.y },
  SW: { corner: { x: 3163, y: 4380 }, inside: (t) => t.x <= CENTRE.x && t.y <= CENTRE.y },
  NW: { corner: { x: 3163, y: 4394 }, inside: (t) => t.x <= CENTRE.x && t.y > CENTRE.y },
  NE: { corner: { x: 3177, y: 4394 }, inside: (t) => t.x > CENTRE.x && t.y > CENTRE.y },
};

const ANIMATION = { SPIT: 8059, RISE: 8061, EXHUMED: 8065, SPLAT: 8068 };
const GRAPHIC = { EXHUMED_GONE: 1549, ORB: 1550, SPIT: 1555, SPLASH: 1556, PEBBLES: 1557 };
/** As captured: the exhumed's orb, the spit and its splashes, the guano under Xarpus. */
const PROJECTILE = {
  ORB: { delay: 0, duration: 0, perTile: 10, startHeight: 0, endHeight: 67, angle: 50, progress: 0 },
  SPIT: { delay: 30, duration: -60, perTile: 30, minDuration: 30, startHeight: 100, endHeight: 0, angle: 16, progress: 32 },
  SPLASH: { delay: 15, duration: 15, perTile: 30, startHeight: 0, endHeight: 0, angle: 45, progress: 32 },
  GUANO: { delay: 0, duration: 20, perTile: 0, startHeight: 40, endHeight: 24, angle: 0, progress: 0 },
};
const SOUND = { SPIT: 4018 };

/** Per party size (index 1-5): exhumed count, heal per tick, ticks between them. */
const EXHUMED = {
  count: [0, 7, 8, 12, 15, 18],
  heal: [0, 20, 16, 12, 9, 6],
  every: [0, 13, 8, 8, 4, 4],
  lifespan: 11, rising: 3,
};
const PAUSE = 7;
const START_SHARE = 0.75;
const POISON = { every: 4, splat: [2, 6], pool: [4, 8], under: 9 };
const COUNTER = { below: 0.25, turnTicks: 8, min: 50, max: 75 };

const key = (tile) => `${tile.x},${tile.y}`;

class XarpusRoom extends Raid.Room {
  onBuild() {
    this.xarpus = this.spawn(NPC.WAITING, SPAWN, { scripted: true });
    this.xarpus?.getMovementQueue().setBlockMovement(true);
    this.phase = "waiting";
    this.exhumed = [];
    this.pools = new Map();
  }

  onStart() {
    const npc = this.xarpus;
    if (!npc) return;
    npc.setHitpoints(Math.floor(npc.getMaxHitpoints() * START_SHARE));
    npc.setNpcTransformationId?.(NPC.FEEDING);
    const size = Math.max(1, Math.min(5, this.raid.size));
    this.recovery = { after: 0, left: EXHUMED.count[size], heal: EXHUMED.heal[size], every: EXHUMED.every[size] };
    this.phase = "recovery";
    this.ticks = 0;
  }

  healthBar() {
    const npc = this.xarpus;
    if (!npc) return null;
    const kind = this.phase === "recovery" ? Shared.HEALTH_BAR.DISABLED : Shared.HEALTH_BAR.REGULAR;
    return { kind, current: Math.max(0, npc.getHitpoints()), maximum: npc.getMaxHitpoints() };
  }

  tick() {
    const npc = this.xarpus;
    if (!this.isStarted() || !npc) return;
    if (npc.getHitpoints() <= 0) {
      this.complete();
      return;
    }
    this.ticks++;
    if (this.phase === "recovery") this.tickRecovery();
    else if (this.phase === "poison") this.tickPoison();
    else if (this.phase === "counter") this.tickCounter();
    if (this.phase === "poison" || this.phase === "counter") this.tickFloor();
  }

  onComplete() {
    const { ObjectManager } = Shared.core();
    for (const pool of this.pools.values()) ObjectManager.deregister(pool, true);
    this.pools.clear();
  }

  // -------------------------------------------------------------- recovery

  tickRecovery() {
    const recovery = this.recovery;
    if (this.ticks > PAUSE && recovery.left > 0 && this.ticks % recovery.every === 0) this.raiseExhumed();
    for (const exhumed of [...this.exhumed]) this.tickExhumed(exhumed);
    if (recovery.left === 0 && this.exhumed.length === 0 && ++recovery.after >= PAUSE) this.rise();
  }

  raiseExhumed() {
    this.recovery.left--;
    const tile = this.randomFloor();
    const object = this.placeObject(OBJECT.EXHUMED, tile, 22, 0);
    this.exhumed.push({ object, tile, age: 0 });
    this.later(1, () => this.animateObject(object, ANIMATION.EXHUMED));
  }

  /** After rising, it heals Xarpus every tick nobody stands on it. */
  tickExhumed(exhumed) {
    exhumed.age++;
    if (exhumed.age > EXHUMED.lifespan) {
      Shared.core().ObjectManager.deregister(exhumed.object, true);
      this.exhumed = this.exhumed.filter((entry) => entry !== exhumed);
      Shared.graphicAt(this.area, GRAPHIC.EXHUMED_GONE, exhumed.tile);
      return;
    }
    if (exhumed.age <= EXHUMED.rising) return;
    if (this.fighters().some((player) => key(Shared.tileOf(player)) === key(exhumed.tile))) return;
    const ticks = Shared.projectile(this.area, exhumed.tile, this.xarpus, GRAPHIC.ORB, PROJECTILE.ORB);
    const heal = this.recovery.heal;
    this.later(Math.max(0, ticks - 1), () => Shared.heal(this.xarpus, heal));
  }

  /** It takes to the air and fights. */
  rise() {
    const npc = this.xarpus;
    const { Animation } = Shared.core();
    npc.setNpcTransformationId?.(NPC.FIGHTING);
    npc.moveTo(Shared.loc({ x: SPAWN.x - 1, y: SPAWN.y - 1, z: PLANE }));
    npc.performAnimation(new Animation(ANIMATION.RISE));
    this.phase = "poison";
    this.ticks = 0;
    this.lastTarget = null;
    this.raid.refreshHealthBars();
  }

  // -------------------------------------------------------------- poison

  tickPoison() {
    const npc = this.xarpus;
    if (npc.getHitpoints() / Math.max(1, npc.getMaxHitpoints()) <= COUNTER.below) {
      this.startCounter();
      return;
    }
    if (this.ticks < PAUSE || this.ticks % POISON.every !== 0) return;
    const fighters = this.fighters();
    if (fighters.length === 0) return;
    const others = fighters.filter((player) => player !== this.lastTarget);
    const target = Shared.randomOf(others.length ? others : fighters);
    this.lastTarget = target;
    const { Animation } = Shared.core();
    npc.setMobileInteraction(target);
    npc.performAnimation(new Animation(ANIMATION.SPIT));
    Shared.areaSound(this.area, npc, SOUND.SPIT, 30);
    this.spit(npc, Shared.tileOf(target), target, true);
  }

  /** A splat lands, poisons round it, stays, and the first one splashes on. */
  spit(from, tile, target, first) {
    const ticks = Shared.projectile(this.area, from, tile, GRAPHIC.SPIT, first ? PROJECTILE.SPIT : PROJECTILE.SPLASH);
    this.later(ticks, () => {
      if (!this.isStarted()) return;
      this.placePool(tile);
      Shared.graphicAt(this.area, GRAPHIC.SPLASH, tile);
      for (const player of this.fighters()) {
        if (Math.max(Math.abs(Shared.tileOf(player).x - tile.x), Math.abs(Shared.tileOf(player).y - tile.y)) <= 1) {
          Shared.damage(player, Shared.random(...POISON.splat), "GREEN");
        }
      }
      if (!first) return;
      const others = this.fighters().filter((player) => player !== target);
      if (others.length && Math.random() < 0.5) {
        this.spit(Shared.loc({ ...tile, z: PLANE }), Shared.tileOf(Shared.randomOf(others)), null, false);
        return;
      }
      for (let i = Shared.random(1, 2); i > 0; i--) this.spit(Shared.loc({ ...tile, z: PLANE }), this.randomFloor(), null, false);
    });
  }

  placePool(tile) {
    if (this.pools.has(key(tile))) return;
    const pool = this.placeObject(OBJECT.MIASMA, { ...tile, z: PLANE }, 22, quadrantFace(tile));
    this.pools.set(key(tile), pool);
    this.later(1, () => this.animateObject(pool, ANIMATION.SPLAT));
  }

  /** The pools and the pebbles under Xarpus, every tick. */
  tickFloor() {
    const npc = this.xarpus;
    for (const player of this.fighters()) {
      const at = Shared.tileOf(player);
      if (this.pools.has(key(at))) Shared.damage(player, Shared.random(...POISON.pool), "GREEN");
      if (Shared.covers(npc, at)) {
        Shared.projectile(this.area, npc, player, GRAPHIC.PEBBLES, PROJECTILE.GUANO);
        this.later(1, () => Shared.damage(player, Shared.random(1, POISON.under)));
      }
    }
  }

  // -------------------------------------------------------------- counter

  startCounter() {
    const npc = this.xarpus;
    this.phase = "counter";
    this.ticks = 0;
    npc.setMobileInteraction(null);
    npc.forceChat("Screeeeech!");
    this.turn(Shared.randomOf(Object.keys(QUADRANTS)));
  }

  tickCounter() {
    if (this.ticks % COUNTER.turnTicks === 0) {
      this.turn(Shared.randomOf(Object.keys(QUADRANTS).filter((name) => name !== this.staring)));
    }
  }

  turn(name) {
    this.staring = name;
    this.xarpus.setPositionToFace?.(Shared.loc({ ...QUADRANTS[name].corner, z: PLANE }));
  }

  /** A hit from the quadrant it's staring at comes back as poison, per hitsplat. */
  modifyHit(npc, hit) {
    if (npc !== this.xarpus || this.phase !== "counter" || this.ticks === 0) return;
    const attacker = hit.getAttacker?.();
    if (!attacker?.isPlayer?.() || !this.fighters().includes(attacker)) return;
    if (!QUADRANTS[this.staring].inside(Shared.tileOf(attacker))) return;
    const splats = Math.max(1, (hit.getHits?.() ?? []).length);
    for (let i = 0; i < splats; i++) Shared.damage(attacker, Shared.random(COUNTER.min, COUNTER.max), "GREEN");
  }

  // -------------------------------------------------------------- helpers

  randomFloor() {
    for (let tries = 0; tries < 50; tries++) {
      const tile = { x: Shared.random(ARENA.minX, ARENA.maxX), y: Shared.random(ARENA.minY, ARENA.maxY), z: PLANE };
      if (!Shared.covers(this.xarpus, tile)) return tile;
    }
    return { x: ARENA.minX, y: ARENA.minY, z: PLANE };
  }

  animateObject(object, id) {
    const { Animation } = Shared.core();
    for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendObjectAnimation(object, new Animation(id));
  }
}

/** Each pool's art faces its quadrant (estimate). */
function quadrantFace(tile) {
  if (QUADRANTS.SE.inside(tile)) return 0;
  if (QUADRANTS.SW.inside(tile)) return 1;
  if (QUADRANTS.NW.inside(tile)) return 2;
  return 3;
}

module.exports = function registerXarpus(api) {
  Shared.bind(api);
  Raid.registerRoom("XARPUS", XarpusRoom);
};

Object.assign(module.exports, { XarpusRoom, QUADRANTS, EXHUMED });
