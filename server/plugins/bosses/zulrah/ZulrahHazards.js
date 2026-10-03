"use strict";

/**
 * What Zulrah leaves on the shrine: venom clouds and snakelings.
 *
 * Wiki ("Zulrah/Strategies"):
 * - A cloud covers 3x3 tiles and hurts whoever stands in it every tick, with venom damage that
 *   does not envenom.
 * - Snakelings attack with melee or magic, never both, and envenom like Zulrah. They have 1
 *   hitpoint, die after 40 seconds and die with Zulrah.
 * Wiki ("Snakeling"): melee (2045) max 15, magic (2046) max 13, attack speed 3.
 * Near-Reality: the cloud lasts 30 ticks and hits for 1-4 a tick; a snakeling is magic one time
 * in four, rises with anim 2413 and attacks 3 ticks after landing, from up to 6 tiles away
 * when it is magic. The magic snakeling's projectile is 1230; melee hits land at once. Their
 * sound effects.
 */

const Shared = require("./ZulrahShared");

const CLOUD = { ticks: 30, damage: [1, 4] };
const SNAKELING = {
  lifeTicks: 67,
  wakeTicks: 3,
  magicChance: 0.25,
  speed: 3,
  melee: { max: 15, range: 1 },
  magic: { max: 13, range: 6, projectile: { id: 1230, start: 30, duration: 18, perTile: 5, from: 15, to: 16 } },
  anim: { attack: 1741, spawn: 2413 },
  venom: 6,
};

let SnakelingMethod = null;

/** Zulrah and its snakelings envenom whenever an attack lands, prayer or not (Wiki). */
function envenom(hit) {
  const target = hit.getTarget();
  if (!hit.isAccurate() || !target || target.getHitpoints() <= 0) return;
  Shared.core().CombatFactory.poisonEntity(target, SNAKELING.venom, 2);
}

function snakelingMethod() {
  if (SnakelingMethod) return SnakelingMethod;
  const { Animation, CombatFactory, CombatMethod, CombatType, PendingHit, Projectile } = Shared.core();
  SnakelingMethod = class extends CombatMethod {
    constructor(magic) {
      super();
      this.magic = magic;
      this.def = magic ? SNAKELING.magic : SNAKELING.melee;
      this.hitDelay = 1;
    }

    type() {
      return this.magic ? CombatType.MAGIC : CombatType.MELEE;
    }

    attackSpeed() {
      return SNAKELING.speed;
    }

    attackDistance() {
      return this.def.range;
    }

    start(npc, target) {
      npc.performAnimation(new Animation(SNAKELING.anim.attack));
      this.hitDelay = 0;
      if (!this.magic) {
        Shared.sound(target, Shared.SOUND.SNAKELING_MELEE);
        return;
      }
      const p = this.def.projectile;
      const end = p.start + p.duration + npc.getLocation().getDistance(target.getLocation()) * p.perTile;
      Projectile.createProjectile(npc, target, p.id, p.start, end, p.from, p.to).sendProjectile();
      Shared.sound(target, Shared.SOUND.SNAKELING_MAGIC);
      Shared.sound(target, Shared.SOUND.SNAKELING_MAGIC_IMPACT, end);
      this.hitDelay = Math.max(1, Math.ceil(end / 30));
    }

    hits(npc, target) {
      const hit = new PendingHit(npc, target, this, this.hitDelay);
      CombatFactory.applyStyleDamage(hit, this.def.max);
      return [hit];
    }

    handleAfterHitEffects(hit) {
      envenom(hit);
    }
  };
  return SnakelingMethod;
}

const MeleeSnakeling = () => class extends snakelingMethod() { constructor() { super(false); } };
const MagicSnakeling = () => class extends snakelingMethod() { constructor() { super(true); } };

class Hazards {
  constructor(fight) {
    this.fight = fight;
    this.clouds = [];
    this.snakelings = new Set();
  }

  // ---------------------------------------------------------------- clouds

  /** A cloud centred on `centre`; the 3x3 loc sits on the tile south-west of it. */
  addCloud(centre) {
    const { GameObject, ObjectManager, Location } = Shared.core();
    // A second cloud on the same centre is the same loc: it just lasts from now.
    const existing = this.clouds.find((cloud) => cloud.centre.x === centre.x && cloud.centre.y === centre.y);
    if (existing) {
      existing.left = CLOUD.ticks;
      return;
    }
    const object = new GameObject(Shared.OBJECT.VENOM_CLOUD, new Location(centre.x - 1, centre.y - 1, 0), 10, 0, this.fight.area);
    ObjectManager.register(object, true);
    Shared.sound(this.fight.player, Shared.SOUND.CLOUD_LAND);
    this.clouds.push({ object, centre, left: CLOUD.ticks });
  }

  tickClouds(player) {
    const { HitDamage, HitMask } = Shared.core();
    const here = player.getLocation();
    for (const cloud of [...this.clouds]) {
      if (cloud.left-- <= 0) {
        this.removeCloud(cloud);
        Shared.sound(player, Shared.SOUND.CLOUD_GONE[Math.floor(this.fight.random() * 2)]);
        continue;
      }
      if (player.getHitpoints() <= 0) continue;
      if (Math.abs(here.getX() - cloud.centre.x) > 1 || Math.abs(here.getY() - cloud.centre.y) > 1) continue;
      const damage = Shared.randomInt(this.fight.random, ...CLOUD.damage);
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.GREEN)]);
    }
  }

  removeCloud(cloud) {
    const { ObjectManager } = Shared.core();
    this.clouds.splice(this.clouds.indexOf(cloud), 1);
    ObjectManager.deregister(cloud.object, true);
  }

  // ---------------------------------------------------------------- snakelings

  addSnakeling(tile) {
    const { Animation } = Shared.core();
    const magic = this.fight.random() < SNAKELING.magicChance;
    const id = magic ? Shared.NPC.SNAKELING_MAGIC : Shared.NPC.SNAKELING_MELEE;
    const npc = this.fight.spawnNpc(id, tile);
    if (!npc) return null;
    npc.__zulrahLeft = SNAKELING.lifeTicks;
    npc.performAnimation(new Animation(SNAKELING.anim.spawn));
    Shared.sound(this.fight.player, Shared.SOUND.SNAKELING_LAND);
    npc.getCombat().setAttackDelay?.(SNAKELING.wakeTicks);
    npc.getCombat().attack(this.fight.player);
    this.snakelings.add(npc);
    return npc;
  }

  tickSnakelings(player) {
    for (const npc of [...this.snakelings]) {
      if (npc.getHitpoints() <= 0 || !npc.isRegistered()) {
        this.snakelings.delete(npc);
        continue;
      }
      if (--npc.__zulrahLeft <= 0) {
        this.kill(npc);
        continue;
      }
      const target = npc.getCombat().getTarget();
      if (target !== player && player.getHitpoints() > 0) npc.getCombat().attack(player);
    }
  }

  /** A snakeling dies as if hit for its last hitpoint. */
  kill(npc) {
    const { HitDamage, HitMask } = Shared.core();
    this.snakelings.delete(npc);
    if (npc.getHitpoints() <= 0) return;
    npc.getCombat().getHitQueue().addPendingDamage([new HitDamage(npc.getHitpoints(), HitMask.RED)]);
  }

  // ---------------------------------------------------------------- the fight

  tick(player) {
    this.tickClouds(player);
    this.tickSnakelings(player);
  }

  /** Zulrah is dead: its snakelings die with it and its clouds clear. */
  clearOnDeath() {
    for (const npc of [...this.snakelings]) this.kill(npc);
    for (const cloud of [...this.clouds]) this.removeCloud(cloud);
  }

  /** The fight is over without a kill: everything just goes. */
  remove() {
    for (const npc of [...this.snakelings]) Shared.api().removeNpc(npc);
    this.snakelings.clear();
    for (const cloud of [...this.clouds]) this.removeCloud(cloud);
  }
}

module.exports = { Hazards, CLOUD, SNAKELING, envenom, MeleeSnakeling, MagicSnakeling };
