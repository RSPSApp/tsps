"use strict";

/**
 * Dreadnoth the Jellied (section 2, east): a great jelly that crawls after the party and spits
 * out jellies, then bounces round the room below a quarter of its health.
 *
 * Captured as a spectator in five fights (docs/fractured-archive.md):
 * - Dreadnoth (16665, 5x5) at 4189,5661, facing west; 2,100/3,050/3,930/4,810 hitpoints for
 *   two to five. No "Challenge started"; its bar and music (895) start a few ticks in.
 * - It crawls a tile every two ticks after its target (live's crawl steps, which clients play
 *   over the two ticks), and hits whoever is beside it (melee01). Its headbar is 66 (90 wide).
 * - Volleys (jump01) at 85, 65 and 45% (one, two, three volleys, six ticks apart). Each puts
 *   three damage tiles (tfa_jelly_boss_damage_tile) in or by its footprint with a splat, and
 *   three ranged_proj01 at each player. Where they land, a splat and jelly_spawning_idle, sent
 *   again every tick until the jellies (16666, 75 hitpoints) rise eight ticks after the last
 *   volley: three per player per volley, twelve at most.
 * - A jelly that dies (jelly_death) leaves a damage tile and goes three ticks later. The damage
 *   tiles stay for the whole fight.
 * - Below 25%: "*glub glub*". Five ticks later, then every eight, it jumps at its target (jump02,
 *   a 90-cycle exact move, with tfa_boss_jelly_5x5_jump where it lands): centred on the player's
 *   tile when they are within five tiles, else five tiles the nearest of eight ways towards them
 *   (every captured jump). A player still under it is slammed and it heals by the damage (Wiki;
 *   hitsplat 6). As it lands, one to three tiles in its footprint, and at each player a proj01
 *   and a proj02 at their tile, which is a damage tile six ticks later.
 * - At 0: death01, gone four ticks later. Three ticks into the death it splits into seven small
 *   jellies (37 hitpoints); the room is won when the last of them dies.
 * - It faces its target as an entity. The jellies are ordinary combat NPCs that always go for
 *   the nearest fighter, and they and it pass through other NPCs.
 * Estimates (a spectator sees no damage on players): every damage figure, what a damage tile
 * does (a burn each tick), a jelly's damage and speed (the cache's), its melee rate.
 */

const Shared = require("./Shared.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");

const { named, anim, spot } = Shared;

const LAYOUT = {
  boss: { x: 4189, y: 5661, z: 0 },
  arena: { minX: 4181, maxX: 4198, minY: 5656, maxY: 5670 },
  /** Its jumps land no further west than this (captured: never west of the arrival's edge). */
  jumpMinX: 4184,
};
const HITPOINTS = { 2: 2100, 3: 3050, 4: 3930, 5: 4810 };
/** Volleys at these shares of its health (captured), and how many volleys each wave has. */
const WAVES = [[0.85, 1], [0.65, 2], [0.45, 3]];
const PHASE_TWO = 0.25;

const TIME = {
  CRAWL: 2,
  MELEE: 5,
  VOLLEY_GAP: 6,
  JELLIES_AFTER: 8,
  JELLY_GONE: 3,
  FIRST_JUMP: 5,
  JUMP: 8,
  JUMP_CYCLES: 90,
  JUMP_REACH: 5,
  PROJ02_TILE: 6,
  DEATH_SPLIT: 3,
  DEATH_GONE: 4,
  JELLY_ATTACK: 4,
};
const DAMAGE = { MELEE: 35, SPIT: 20, TILE: 8, SLAM: 40, HEAL_SHARE: 0.01 };
/** Lets it and the jellies pass other NPCs (the jellies stack, and never block it). */
const WALK_THROUGH = "movement:walk-through-entities";
const PROJ01 = [{ delay: 10, end: 90 }, { delay: 12, end: 120 }, { delay: 14, end: 150 }];
const MAX_JELLIES = 12;
const JELLY_HP = 75;
const SMALL_JELLY_HP = 37;
const SPLIT = 7;
const HEADBAR = { id: 66, width: 90 };
const HEAL_SPLAT = { mine: 6, others: 6 };

class DreadnothRoom extends Raid.Room {
  onBuild() {
    this.boss = this.spawn(named("npc", "tfa_jelly_boss"), LAYOUT.boss, { scripted: true, face: Shared.core().Direction.WEST.getId() });
    this.boss.setFlag(WALK_THROUGH);
    this.boss.setCrawling(true);
    this.boss.setHealthBar(HEADBAR);
    /** Landed spit, where jelly_spawning_idle plays (again every tick) until the jellies rise. */
    this.spawning = [];
    this.tiles = new Map();
    this.jellies = new Set();
    this.wave = 0;
    this.phaseTwo = false;
    this.dead = false;
  }

  onStart() {
    this.setHitpoints(this.boss, this.scaled(HITPOINTS));
    this.showBar(this.boss.getId(), this.boss.getMaxHitpoints());
    this.nextCrawl = Shared.cycle() + TIME.CRAWL;
    this.nextMelee = Shared.cycle() + TIME.MELEE;
  }

  tick() {
    if (!this.isStarted()) return;
    const now = Shared.cycle();
    this.burn();
    for (const tile of this.spawning) Shared.graphicAt(this.area, named("spotanim", "jelly_spawning_idle"), tile);
    this.jelliesAct(now);
    if (this.dead) {
      if (this.jellies.size === 0 && this.split) this.complete();
      return;
    }
    this.barTo(this.boss.getHitpoints());
    const share = this.boss.getHitpoints() / Math.max(1, this.boss.getMaxHitpoints());
    if (!this.phaseTwo && share <= PHASE_TWO) this.enterPhaseTwo(now);
    if (this.phaseTwo) {
      if (now >= this.nextJump) this.jump(now);
      return;
    }
    while (this.wave < WAVES.length && share <= WAVES[this.wave][0]) this.volleys(WAVES[this.wave++][1]);
    if (now >= this.nextCrawl) {
      this.nextCrawl = now + TIME.CRAWL;
      this.crawl();
    }
    if (now >= this.nextMelee) this.melee(now);
  }

  /** Its target, faced as an entity (captured), so its crawl doesn't turn it with every step. */
  target() {
    if (!this.fighters().includes(this.chased)) {
      this.chased = Shared.randomOf(this.fighters());
      this.boss.setMobileInteraction(this.chased ?? null);
    }
    return this.chased;
  }

  /** A tile a step at a time after its target (captured: one tile every two ticks). */
  crawl() {
    const target = this.target();
    if (!target || Shared.distanceTo(this.boss, target.getLocation()) <= 1) return;
    const at = this.boss.getLocation();
    const goal = target.getLocation();
    const step = Shared.loc({ x: at.getX() + Math.sign(goal.getX() - (at.getX() + 2)), y: at.getY() + Math.sign(goal.getY() - (at.getY() + 2)), z: 0 });
    if (!inArena(step, 5)) return;
    this.boss.getMovementQueue().reset();
    this.boss.getMovementQueue().addSteps(step);
  }

  melee(now) {
    const beside = this.fighters().filter((player) => Shared.distanceTo(this.boss, player.getLocation()) === 1);
    if (beside.length === 0) return;
    this.nextMelee = now + TIME.MELEE;
    this.boss.performAnimation(anim("dreadnoth_melee01"));
    for (const player of beside) this.strike(this.boss, player, "melee", DAMAGE.MELEE, 1, { prayerMultiplier: 0 });
  }

  // ---------------------------------------------------------------- volleys and jellies

  volleys(count) {
    const landed = [];
    for (let i = 0; i < count; i++) this.later(i * TIME.VOLLEY_GAP, () => this.volley(landed));
    this.later((count - 1) * TIME.VOLLEY_GAP + TIME.JELLIES_AFTER, () => {
      this.spawning = this.spawning.filter((tile) => !landed.includes(tile));
      for (const tile of landed.slice(0, MAX_JELLIES)) this.raiseJelly(tile, JELLY_HP);
    });
  }

  volley(landed) {
    if (this.dead) return;
    this.boss.performAnimation(anim("dreadnoth_jump01"));
    this.later(1, () => {
      for (const tile of this.footprintTiles(3)) this.addDamageTile(tile);
      Shared.areaSound(this.area, this.boss, 12361);
      for (const player of this.fighters()) {
        for (const flight of PROJ01) {
          const tile = this.freeTileNear(Shared.tileOf(player), 2, landed);
          if (!tile) continue;
          landed.push(tile);
          Shared.projectile(this.area, this.boss, tile, named("spotanim", "vfx_dreadnoth_ranged_proj01"), { ...flight, angle: 25, progress: 200, startHeight: 450, endHeight: 30 });
          this.later(Math.ceil(flight.end / 30), () => {
            if (this.dead) return;
            Shared.graphicAt(this.area, named("spotanim", "tob_bloat_blood_splat"), tile);
            this.spawning.push(tile);
            this.hitOn(tile, DAMAGE.SPIT);
          });
        }
      }
    });
  }

  /** A jelly: an ordinary combat NPC that goes for the nearest player, through other NPCs. */
  raiseJelly(tile, hitpoints) {
    if (this.jellies.size >= MAX_JELLIES * 2) return;
    const jelly = this.spawn(named("npc", "tfa_jelly_minion"), tile);
    if (!jelly) return;
    this.setHitpoints(jelly, hitpoints);
    jelly.setFlag(WALK_THROUGH);
    jelly.setFlag("combat:no-regen");
    jelly.performAnimation(anim("jelly_spawn"));
    jelly.__awakeAt = Shared.cycle() + TIME.JELLY_ATTACK;
    this.jellies.add(jelly);
    return jelly;
  }

  /** Always aggressive: each jelly keeps on the nearest fighter (the engine paths and attacks). */
  jelliesAct(now) {
    for (const jelly of this.jellies) {
      if (jelly.__dying || now < jelly.__awakeAt) continue;
      const current = jelly.getCombat().getTarget?.();
      if (current && this.fighters().includes(current)) continue;
      const target = nearest(jelly, this.fighters());
      if (target) jelly.getCombat().attack(target);
    }
  }

  // ---------------------------------------------------------------- damage tiles

  addDamageTile(tile) {
    const key = `${tile.x},${tile.y}`;
    if (this.tiles.has(key) || !inArena(tile, 1)) return;
    this.tiles.set(key, this.placeObject(named("loc", "tfa_jelly_boss_damage_tile"), { ...tile, z: 0 }));
    Shared.graphicAt(this.area, named("spotanim", "tob_bloat_blood_splat"), tile);
    Shared.areaSound(this.area, tile, 12387);
  }

  burn() {
    if (this.tiles.size === 0) return;
    for (const player of this.fighters()) {
      const at = player.getLocation();
      if (this.tiles.has(`${at.getX()},${at.getY()}`)) Shared.damage(player, DAMAGE.TILE);
    }
  }

  hitOn(tile, damage) {
    for (const player of this.fighters()) {
      const at = player.getLocation();
      if (at.getX() === tile.x && at.getY() === tile.y) Shared.damage(player, Shared.random(damage / 2, damage));
    }
  }

  /** `count` free tiles in or beside its footprint. */
  footprintTiles(count) {
    const at = this.boss.getLocation();
    const tiles = [];
    for (let x = at.getX() - 1; x <= at.getX() + 5; x++) for (let y = at.getY() - 1; y <= at.getY() + 5; y++) tiles.push({ x, y, z: 0 });
    return Shared.shuffle(tiles).filter((tile) => inArena(tile, 1)).slice(0, count);
  }

  freeTileNear(centre, radius, taken) {
    const tiles = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const tile = { x: centre.x + dx, y: centre.y + dy, z: 0 };
        if (!inArena(tile, 1) || Shared.distanceTo(this.boss, tile) === 0) continue;
        if (taken.some((other) => other.x === tile.x && other.y === tile.y)) continue;
        if (!Shared.floorFree(this.area, tile)) continue;
        tiles.push(tile);
      }
    }
    return Shared.randomOf(tiles) ?? null;
  }

  // ---------------------------------------------------------------- the second phase

  enterPhaseTwo(now) {
    this.phaseTwo = true;
    this.boss.forceChat("*glub glub*");
    this.nextJump = now + TIME.FIRST_JUMP;
  }

  /**
   * A jump at its target (captured, every jump): centred on the player's tile when they are within
   * five tiles, else five tiles the nearest of eight ways towards them, with the shadow
   * tfa_boss_jelly_5x5_jump where it lands. A player still under it when it lands is slammed and
   * it heals by the damage (Wiki and guides; the amount is an estimate); it spits as it lands.
   */
  jump(now) {
    this.nextJump = now + TIME.JUMP;
    const target = this.target();
    const at = this.boss.getLocation();
    const goal = target ? Shared.tileOf(target) : { x: at.getX() + 2, y: at.getY() + 2 };
    let dx = goal.x - 2 - at.getX();
    let dy = goal.y - 2 - at.getY();
    if (Math.max(Math.abs(dx), Math.abs(dy)) > TIME.JUMP_REACH) {
      const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
      dx = Math.round(Math.cos((octant * Math.PI) / 4)) * TIME.JUMP_REACH;
      dy = Math.round(Math.sin((octant * Math.PI) / 4)) * TIME.JUMP_REACH;
    }
    const landing = Shared.loc({ x: clamp(at.getX() + dx, LAYOUT.jumpMinX, LAYOUT.arena.maxX - 4), y: clamp(at.getY() + dy, LAYOUT.arena.minY, LAYOUT.arena.maxY - 4), z: 0 });
    this.boss.performAnimation(anim("dreadnoth_jump02"));
    Shared.graphicAt(this.area, named("spotanim", "tfa_boss_jelly_5x5_jump"), { x: landing.getX() + 2, y: landing.getY() + 2, z: 0 });
    this.boss.exactMove(landing, { endCycles: TIME.JUMP_CYCLES });
    this.later(Math.ceil(TIME.JUMP_CYCLES / 30), () => {
      this.slam(landing);
      this.spit();
    });
  }

  spit() {
    if (this.dead) return;
    for (const tile of this.footprintTiles(Shared.random(1, 3))) this.addDamageTile(tile);
    for (const player of this.fighters()) {
      const tile = Shared.tileOf(player);
      Shared.projectile(this.area, this.boss, player, named("spotanim", "vfx_dreadnoth_ranged_proj01"), { end: 90, angle: 25, progress: 200, startHeight: 450, endHeight: 30 });
      this.strike(this.boss, player, "ranged", DAMAGE.SPIT, 3, { prayerMultiplier: 0 });
      Shared.projectile(this.area, this.boss, tile, named("spotanim", "vfx_dreadnoth_ranged_proj02"), { end: 180, angle: 30, startHeight: 650, endHeight: 60 });
      Shared.areaSound(this.area, this.boss, 12362);
      this.later(TIME.PROJ02_TILE, () => this.addDamageTile(tile));
    }
  }

  heal(amount = Math.round(this.boss.getMaxHitpoints() * DAMAGE.HEAL_SHARE)) {
    const healed = Math.min(amount, this.boss.getMaxHitpoints() - this.boss.getHitpoints());
    if (healed <= 0) return;
    this.boss.setHitpoints(this.boss.getHitpoints() + healed);
    this.boss.showHitsplat(healed, HEAL_SPLAT);
  }

  slam(landing) {
    if (this.dead) return;
    let dealt = 0;
    for (const player of this.fighters()) {
      const at = Shared.tileOf(player);
      if (at.x < landing.getX() || at.x > landing.getX() + 4 || at.y < landing.getY() || at.y > landing.getY() + 4) continue;
      const amount = Math.min(player.getHitpoints(), Shared.random(DAMAGE.SLAM / 2, DAMAGE.SLAM));
      Shared.damage(player, amount);
      dealt += amount;
    }
    if (dealt > 0) this.heal(dealt);
  }

  // ---------------------------------------------------------------- deaths

  holdsOn(npc) {
    if (npc === this.boss) {
      this.fall();
      return true;
    }
    if (this.jellies.has(npc)) {
      this.jellyDies(npc);
      return true;
    }
    return false;
  }

  jellyDies(jelly) {
    if (jelly.__dying) return;
    jelly.__dying = true;
    jelly.getCombat().reset();
    jelly.setHitpoints(1);
    jelly.performAnimation(anim("jelly_death"));
    this.addDamageTile(Shared.tileOf(jelly));
    this.later(TIME.JELLY_GONE, () => {
      this.jellies.delete(jelly);
      this.despawn(jelly);
    });
  }

  /** It splits into seven small jellies; the room is won once they're gone (captured). */
  fall() {
    if (this.dead) return;
    this.dead = true;
    this.boss.setHitpoints(1);
    this.boss.performAnimation(anim("dreadnoth_death01"));
    this.spawning = [];
    this.hideBars();
    const centre = Shared.tileOf(this.boss);
    this.later(TIME.DEATH_SPLIT, () => {
      for (let i = 0; i < SPLIT; i++) {
        const tile = { x: centre.x + Shared.random(0, 4), y: centre.y + Shared.random(0, 4), z: 0 };
        const jelly = this.raiseJelly(tile, SMALL_JELLY_HP);
        jelly?.performAnimation(anim("npc_jelly_jump_1"));
      }
      this.split = true;
    });
    this.later(TIME.DEATH_GONE, () => this.despawn(this.boss));
  }

  canAttack(attacker, target) {
    if (attacker?.isPlayer?.() && ((target === this.boss && this.dead) || target?.__dying)) return false;
    return null;
  }

  onComplete() {
    const nonblocking = named("loc", "invisible_type8_nonblocking");
    for (const object of this.tiles.values()) this.replaceObject(object, nonblocking);
    this.tiles.clear();
  }
}

function nearest(npc, players) {
  let best = null;
  for (const player of players) {
    if (!best || Shared.distanceTo(npc, player.getLocation()) < Shared.distanceTo(npc, best.getLocation())) best = player;
  }
  return best;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inArena(tile, size) {
  const x = tile.getX ? tile.getX() : tile.x;
  const y = tile.getY ? tile.getY() : tile.y;
  const { arena } = LAYOUT;
  return x >= arena.minX && y >= arena.minY && x + size - 1 <= arena.maxX && y + size - 1 <= arena.maxY;
}

module.exports = function registerDreadnoth(api) {
  Shared.bind(api);
  Raid.registerRoom("DREADNOTH", DreadnothRoom);
};

Object.assign(module.exports, { DreadnothRoom, LAYOUT, HITPOINTS, WAVES, TIME, DAMAGE });
