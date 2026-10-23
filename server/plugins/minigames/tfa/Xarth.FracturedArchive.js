"use strict";

/**
 * Xarth (section 3, east), a fire demon that never moves. First it burns down the rubble the
 * party shelters behind; then the arena catches fire and corpses walk in to feed it.
 *
 * Captured as a spectator in four fights (docs/fractured-archive.md):
 * - Xarth (16684, 3x3) at 4190,5534, facing west; 2,600/3,770/4,860/5,950 hitpoints for two to
 *   five. Three rubble heaps (2x2) at 4193,5530, 4196,5536 and 4193,5540. Music 896.
 * - Phase one is three cycles of 31 ticks:
 *   - five magic attacks four ticks apart (fireball 4034 at a player);
 *   - an AoE (aoe_01, sounds 9221, 9335, 9215): projanim 4378 at each player's tile, with a
 *     shadow and its hit 120 cycles later;
 *   - three ticks later the flame blast (flame_blast_01, sounds 9224, 9210, 9215, 9259, and 9240
 *     for each player a tick later). Three ticks after it a fire wave (ennius_fire_explosion,
 *     sound 10579) rolls out a cycle a tile from his footprint: a 90-degree wedge from it at the
 *     heap that falls (the south or north heap first, at random, then the east, then the last),
 *     all round in the third cycle.
 *   - That heap collapses in the same tick (the rubble NPC destroyed, collapse anim and graphic;
 *     invisible_type8_nonblocking and invisible_type8_blockrange_size2 on it) and shelters the
 *     wave as it falls: a tile it hides from his centre tile (projectile line of sight) is spared,
 *     and one it hides only from his nearest tile gets the smaller explosion (2,065 of 2,093
 *     captured tiles).
 * - Phase two starts on the third wave's tick:
 *   - seven arena fires (one to seven tiles from him, mostly two to five) and the eight corpse
 *     piles on the edge burning;
 *   - ranged attacks (projectile 4374 at a player) seven and eleven ticks in, then a 21-tick
 *     cycle from fifteen: two magic attacks (three for five players) two ticks apart at edge
 *     tiles, four ranged attacks four ticks apart from five ticks in, three more fires at twelve;
 *   - three ticks after each magic attack a Corpse (16687, 62 hitpoints) fades in on that tile and
 *     walks a tile a tick towards him. One that reaches him is absorbed and heals him twice the
 *     hitpoints it had left (hitsplat 6); one killed is doused and goes four ticks later.
 * - At 0: death_01 with its graphic; six ticks later he and the corpses go, his footprint is
 *   walkable again, and the room is won.
 * Estimates (a spectator sees no damage on players): every damage figure, what the fires do
 * (a burn each tick), whether the smaller explosions hurt (here they don't), where the corpses
 * rise on the edge.
 */

const Shared = require("./Shared.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");

const { named, anim, spot } = Shared;

const LAYOUT = {
  boss: { x: 4190, y: 5534, z: 0 },
  arena: { minX: 4183, maxX: 4199, minY: 5527, maxY: 5543 },
  rubble: [{ x: 4193, y: 5530 }, { x: 4196, y: 5536 }, { x: 4193, y: 5540 }],
  /** The corpse piles round the edge (the map's tfa_xarth01_corpse_pile01-08). */
  piles: [[4191, 5545], [4201, 5535], [4191, 5524], [4181, 5535], [4180, 5544], [4200, 5544], [4200, 5524], [4180, 5524]],
};
const HITPOINTS = { 2: 2600, 3: 3770, 4: 4860, 5: 5950 };

const TIME = {
  CYCLE_ONE: 31,
  MAGIC_GAP: 4,
  MAGICS: 5,
  AOE_TO_BLAST: 3,
  BLAST_WAVE: 3,
  CYCLE_TWO: 21,
  /** Phase two from the third wave: two ranged attacks, then the cycle. */
  FIRST_RANGED: [7, 11],
  FIRST_CYCLE: 15,
  MAGIC_PAIR: 2,
  RANGED_FROM: 5,
  RANGED_GAP: 4,
  FIRES_AT: 12,
  CORPSE_RISES: 3,
  CORPSE_GONE: 4,
  HEAP_GONE: 3,
  DEATH: 6,
};
const DAMAGE = { MAGIC: 30, AOE: 35, WAVE: 45, RANGED: 25, FIRE: 6 };
/** How far from his footprint the arena fires land (captured: 107 fires). */
const FIRE_DISTANCES = [[1, 4], [2, 15], [3, 31], [4, 28], [5, 21], [6, 6], [7, 2]];
/** The heaps, by index into LAYOUT.rubble: south and north first (one at random), east second. */
const HEAP = { SOUTH: 0, EAST: 1, NORTH: 2 };
const FIRES_AT_START = 7;
const FIRES_PER_CYCLE = 3;
const CORPSE_HP = 62;

class XarthRoom extends Raid.Room {
  onBuild() {
    this.boss = this.spawn(named("npc", "tfa_xarth"), LAYOUT.boss, { scripted: true, face: Shared.core().Direction.WEST.getId() });
    const blocker = named("loc", "invisible_type8_blocking");
    this.blockers = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) this.blockers.push(this.placeObject(blocker, { x: LAYOUT.boss.x + x, y: LAYOUT.boss.y + y, z: 0 }));
    this.heaps = LAYOUT.rubble.map((tile) => ({ tile, npc: this.spawn(named("npc", "tfa_xarth_rubble_npc"), { ...tile, z: 0 }, { scripted: true }), down: false }));
    const first = Math.random() < 0.5 ? HEAP.SOUTH : HEAP.NORTH;
    this.order = [first, HEAP.EAST, first === HEAP.SOUTH ? HEAP.NORTH : HEAP.SOUTH].map((index) => this.heaps[index]);
    this.fires = new Map();
    this.corpses = new Set();
    this.cycles = 0;
    this.dead = false;
  }

  onStart() {
    this.setHitpoints(this.boss, this.scaled(HITPOINTS));
    this.showBar(this.boss.getId(), this.boss.getMaxHitpoints());
    this.phaseOneCycle();
  }

  tick() {
    if (!this.isStarted() || this.dead) return;
    this.barTo(this.boss.getHitpoints());
    this.burn();
    this.walkCorpses();
  }

  // ---------------------------------------------------------------- phase one

  phaseOneCycle() {
    if (this.dead) return;
    const cycle = this.cycles++;
    for (let i = 0; i < TIME.MAGICS; i++) this.later(i * TIME.MAGIC_GAP, () => this.magic());
    const aoeAt = TIME.MAGICS * TIME.MAGIC_GAP;
    this.later(aoeAt, () => this.aoe());
    this.later(aoeAt + TIME.AOE_TO_BLAST, () => this.blast(cycle));
    if (cycle < this.order.length - 1) this.later(TIME.CYCLE_ONE, () => this.phaseOneCycle());
  }

  magic() {
    const player = Shared.randomOf(this.fighters());
    if (!player || this.dead) return;
    this.boss.setPositionToFace(player.getLocation());
    this.boss.performAnimation(anim("xarth_attack_magic_01"));
    Shared.projectile(this.area, this.boss, player, named("spotanim", "luc2_undead_demon_fireball_proj_big"), { delay: 30, end: 90, angle: 0, progress: 160, startHeight: 470, endHeight: 120 });
    this.strike(this.boss, player, "magic", DAMAGE.MAGIC, 3, { prayerMultiplier: 0 });
  }

  aoe() {
    if (this.dead) return;
    this.boss.performAnimation(anim("xarth_attack_aoe_01"));
    for (const sound of [9221, 9335, 9215]) Shared.areaSound(this.area, this.boss, sound);
    for (const player of this.fighters()) {
      const tile = Shared.tileOf(player);
      Shared.projectile(this.area, this.boss, tile, named("spotanim", "vfx_xarth_aoe_projanim_01"), { delay: 60, end: 120, angle: 30, progress: 128, startHeight: 470, endHeight: 0 });
      Shared.graphicAt(this.area, named("spotanim", "gargboss_debris_shadow_90"), tile, { delay: 30 });
      Shared.graphicAt(this.area, named("spotanim", "vfx_xarth_aoe_hitanim_01"), tile, { delay: 120 });
      this.later(4, () => this.hitOn([tile], DAMAGE.AOE));
    }
  }

  /**
   * The flame blast, and three ticks later the wave (captured): a cycle a tile from his
   * footprint, a 90-degree wedge at the heap that falls (all round in the third cycle), the heap
   * sheltering the tiles behind it as it falls.
   */
  blast(cycle) {
    if (this.dead) return;
    this.boss.performAnimation(anim("xarth_attack_flame_blast_01"));
    this.boss.performGraphicInSlot(5, spot("vfx_xarth_attack_flame_blast_01", { delay: 30 }));
    for (const sound of [9224, 9210, 9215, 9259]) Shared.areaSound(this.area, this.boss, sound);
    this.later(1, () => {
      for (const player of this.fighters()) Shared.sound(player, 9240);
    });
    const heap = this.order[cycle] ?? null;
    this.later(TIME.BLAST_WAVE, () => {
      if (this.dead) return;
      const all = cycle >= this.order.length - 1;
      const full = [];
      const { arena } = LAYOUT;
      for (let x = arena.minX; x <= arena.maxX; x++) {
        for (let y = arena.minY; y <= arena.maxY; y++) {
          const tile = { x, y, z: 0 };
          const distance = Shared.distanceTo(this.boss, tile);
          if (distance === 0 || (!all && heap && !inWedge(tile, heap.tile))) continue;
          const cover = heap ? shelter(tile, heap.tile) : "none";
          if (cover === "full") continue;
          const smaller = cover === "partial";
          Shared.graphicAt(this.area, named("spotanim", smaller ? "vfx_vmq4_ennius_fire_explosion_smaller" : "vfx_vmq4_ennius_fire_explosion"), tile, { delay: distance });
          if (!smaller) full.push(tile);
        }
      }
      Shared.areaSound(this.area, this.boss, 10579);
      this.hitOn(full, DAMAGE.WAVE);
      if (heap) this.collapse(heap);
      if (all) this.startPhaseTwo();
    });
  }

  /**
   * A heap collapsing (captured): the heap NPC goes, a destroyed one plays the collapse with its
   * graphic and goes three ticks later, and the heap's loc is replaced by an invisible one, so
   * the 2x2 is clear and walkable.
   */
  collapse(heap) {
    heap.down = true;
    const tile = { ...heap.tile, z: 0 };
    if (heap.npc) this.despawn(heap.npc);
    const destroyed = this.spawn(named("npc", "tfa_xarth_rubble_npc_destroyed"), tile, { scripted: true });
    if (destroyed) {
      destroyed.performAnimation(anim("loc_xarth_rubble_collapse_01"));
      destroyed.performGraphic(spot("vfx_xarth_rubble_collapse_01"));
      this.later(TIME.HEAP_GONE, () => this.despawn(destroyed));
    }
    this.placeObject(named("loc", "invisible_type8_nonblocking"), tile);
    this.placeObject(named("loc", "invisible_type8_blockrange_size2"), tile);
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) this.area.setClip(Shared.loc({ x: tile.x + dx, y: tile.y + dy, z: 0 }), 0);
  }

  // ---------------------------------------------------------------- phase two

  /** On the third wave's tick (captured): the fires and piles, two ranged attacks, then the cycle. */
  startPhaseTwo() {
    if (this.dead || this.phaseTwo) return;
    this.phaseTwo = true;
    for (let i = 0; i < FIRES_AT_START; i++) this.addFire();
    LAYOUT.piles.forEach(([x, y], index) => this.placeObject(named("loc", `tfa_xarth01_corpse_pile_fire0${index + 1}`), { x, y, z: 0 }));
    for (const at of TIME.FIRST_RANGED) this.later(at, () => this.ranged());
    this.later(TIME.FIRST_CYCLE, () => this.phaseTwoCycle());
  }

  /** Magic attacks two ticks apart (corpses), four ranged attacks from five, fires at twelve. */
  phaseTwoCycle() {
    if (this.dead) return;
    const magics = this.size >= 5 ? 3 : 2;
    for (let i = 0; i < magics; i++) this.later(i * TIME.MAGIC_PAIR, () => this.summon());
    for (let i = 0; i < 4; i++) this.later(TIME.RANGED_FROM + i * TIME.RANGED_GAP, () => this.ranged());
    this.later(TIME.FIRES_AT, () => {
      for (let i = 0; i < FIRES_PER_CYCLE; i++) this.addFire();
    });
    this.later(TIME.CYCLE_TWO, () => this.phaseTwoCycle());
  }

  ranged() {
    const player = Shared.randomOf(this.fighters());
    if (!player || this.dead) return;
    this.boss.setPositionToFace(player.getLocation());
    this.boss.performAnimation(anim("xarth_attack_ranged_01"));
    this.boss.performGraphic(spot("vfx_xarth_attack_ranged_spotanim_01"));
    Shared.projectile(this.area, this.boss, player, named("spotanim", "vfx_xarth_attack_ranged_projectile_01"), { delay: 60, end: 120, angle: 10, progress: 200, startHeight: 470, endHeight: 120 });
    this.strike(this.boss, player, "ranged", DAMAGE.RANGED, 4, { prayerMultiplier: 0 });
  }

  /** A magic attack at an edge tile, where a corpse rises three ticks later. */
  summon() {
    if (this.dead) return;
    const tile = edgeTile();
    this.boss.performAnimation(anim("xarth_attack_magic_01"));
    Shared.projectile(this.area, this.boss, tile, named("spotanim", "luc2_undead_demon_fireball_proj_big"), { delay: 30, end: 90, angle: 0, progress: 160, startHeight: 470, endHeight: 50 });
    this.later(TIME.CORPSE_RISES, () => {
      if (this.dead) return;
      const corpse = this.spawn(named("npc", "tfa_xarth_corpse"), tile, { scripted: true, fadeIn: 30 });
      if (!corpse) return;
      this.setHitpoints(corpse, CORPSE_HP);
      corpse.performGraphic(spot("vfx_xarth_corpse_walk_fire_01"));
      this.corpses.add(corpse);
    });
  }

  walkCorpses() {
    for (const corpse of [...this.corpses]) {
      if (corpse.__dying) continue;
      if (Shared.distanceTo(this.boss, corpse.getLocation()) <= 1) {
        this.absorb(corpse);
        continue;
      }
      const at = corpse.getLocation();
      const step = Shared.loc({ x: at.getX() + Math.sign(LAYOUT.boss.x + 1 - at.getX()), y: at.getY() + Math.sign(LAYOUT.boss.y + 1 - at.getY()), z: 0 });
      corpse.getMovementQueue().reset().addSteps(step);
    }
  }

  absorb(corpse) {
    corpse.__dying = true;
    corpse.performAnimation(anim("xarth_corpse_absorbed_01"));
    corpse.performGraphicInSlot(2, spot("vfx_xarth_corpse_absorbed_01"));
    this.boss.performGraphic(spot("vfx_xarth_absorb_corpse_fire_01"));
    const heal = Math.min(corpse.getHitpoints() * 2, this.boss.getMaxHitpoints() - this.boss.getHitpoints());
    this.boss.setHitpoints(this.boss.getHitpoints() + heal);
    if (heal > 0) this.boss.showHitsplat(heal, { mine: 6, others: 6 });
    this.later(2, () => {
      this.corpses.delete(corpse);
      this.despawn(corpse);
    });
  }

  /** A fire one to seven tiles from him, mostly two to five (captured). */
  addFire() {
    const { arena } = LAYOUT;
    for (let tries = 0; tries < 40; tries++) {
      const distance = weighted(FIRE_DISTANCES);
      const tile = { x: Shared.random(LAYOUT.boss.x - distance, LAYOUT.boss.x + 2 + distance), y: Shared.random(LAYOUT.boss.y - distance, LAYOUT.boss.y + 2 + distance), z: 0 };
      if (Shared.distanceTo(this.boss, tile) !== distance) continue;
      if (tile.x < arena.minX || tile.x > arena.maxX || tile.y < arena.minY || tile.y > arena.maxY) continue;
      const key = `${tile.x},${tile.y}`;
      if (this.fires.has(key) || !Shared.floorFree(this.area, tile)) continue;
      this.fires.set(key, this.placeObject(named("loc", "tfa_xarth_arenafire"), tile));
      return;
    }
  }

  burn() {
    if (this.fires.size === 0) return;
    for (const player of this.fighters()) {
      const at = player.getLocation();
      if (this.fires.has(`${at.getX()},${at.getY()}`)) Shared.damage(player, DAMAGE.FIRE);
    }
  }

  hitOn(tiles, damage) {
    for (const player of this.fighters()) {
      const at = Shared.tileOf(player);
      if (tiles.some((tile) => tile.x === at.x && tile.y === at.y)) Shared.damage(player, Shared.random(Math.floor(damage / 2), damage));
    }
  }

  // ---------------------------------------------------------------- deaths

  holdsOn(npc) {
    if (npc === this.boss) {
      this.fall();
      return true;
    }
    if (this.corpses.has(npc)) {
      npc.__dying = true;
      npc.performAnimation(anim("xarth_corpse_death_01"));
      npc.performGraphic(spot("vfx_xarth_corpse_death_01"));
      npc.performGraphicInSlot(2, spot("vfx_xarth_corpse_walk_doused_01"));
      npc.getMovementQueue().reset();
      this.later(TIME.CORPSE_GONE, () => {
        this.corpses.delete(npc);
        this.despawn(npc);
      });
      return true;
    }
    return this.heaps.some((heap) => heap.npc === npc);
  }

  fall() {
    if (this.dead) return;
    this.dead = true;
    this.boss.setHitpoints(1);
    this.boss.performAnimation(anim("xarth_death_01"));
    this.boss.performGraphic(spot("vfx_xarth_death_01"));
    this.hideBars();
    for (const corpse of this.corpses) {
      corpse.__dying = true;
      corpse.getMovementQueue().reset();
    }
    this.later(TIME.DEATH, () => {
      this.despawn(this.boss);
      for (const corpse of [...this.corpses]) this.despawn(corpse);
      this.corpses.clear();
      const nonblocking = named("loc", "invisible_type8_nonblocking");
      for (const blocker of this.blockers) this.replaceObject(blocker, nonblocking);
      this.complete();
    });
  }

  canAttack(attacker, target) {
    if (attacker?.isPlayer?.() && (target?.__dying || (target === this.boss && this.dead))) return false;
    return null;
  }
}

/** A tile on the arena's edge (estimate: where the corpses were seen rising). */
function edgeTile() {
  const { arena } = LAYOUT;
  const side = Shared.random(0, 3);
  if (side === 0) return { x: Shared.random(arena.minX, arena.maxX), y: arena.minY, z: 0 };
  if (side === 1) return { x: Shared.random(arena.minX, arena.maxX), y: arena.maxY, z: 0 };
  if (side === 2) return { x: arena.minX, y: Shared.random(arena.minY, arena.maxY), z: 0 };
  return { x: arena.maxX, y: Shared.random(arena.minY, arena.maxY), z: 0 };
}

function weighted(table) {
  let roll = Math.random() * table.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of table) if ((roll -= weight) < 0) return value;
  return table[table.length - 1][0];
}

/** In the 90-degree wedge out of his footprint towards a heap: a row out it is the footprint and a tile each side. */
function inWedge(tile, heap) {
  const { x: bx, y: by } = LAYOUT.boss;
  const dx = heap.x + 1 - (bx + 1.5);
  const dy = heap.y + 1 - (by + 1.5);
  if (Math.abs(dy) > Math.abs(dx)) {
    const out = dy < 0 ? by - tile.y : tile.y - (by + 2);
    return out >= 1 && tile.x >= bx - out && tile.x <= bx + 2 + out;
  }
  const out = dx > 0 ? tile.x - (bx + 2) : bx - tile.x;
  return out >= 1 && tile.y >= by - out && tile.y <= by + 2 + out;
}

/**
 * How a falling heap shelters a tile from the wave (fitted to the captures): "full" when it is
 * the heap or the heap blocks the line of sight from his centre tile, "partial" (the smaller
 * explosion) when it only blocks it from his footprint's tile nearest the tile, else "none".
 */
function shelter(tile, heap) {
  const onHeap = (x, y) => x >= heap.x && x <= heap.x + 1 && y >= heap.y && y <= heap.y + 1;
  if (onHeap(tile.x, tile.y)) return "full";
  const { x: bx, y: by } = LAYOUT.boss;
  if (!lineOfSight(bx + 1, by + 1, tile.x, tile.y, onHeap)) return "full";
  const nx = Math.max(bx, Math.min(bx + 2, tile.x));
  const ny = Math.max(by, Math.min(by + 2, tile.y));
  return lineOfSight(nx, ny, tile.x, tile.y, onHeap) ? "none" : "partial";
}

/** OSRS's projectile line of sight between tiles (16.16 fixed point along the long axis). */
function lineOfSight(sx, sy, tx, ty, blocked) {
  const dx = tx - sx;
  const dy = ty - sy;
  if (Math.abs(dx) > Math.abs(dy)) {
    const step = Math.sign(dx);
    const slope = Math.trunc((dy * 65536) / Math.abs(dx));
    let frac = sy * 65536 + 32768;
    for (let x = sx; x !== tx;) {
      x += step;
      frac += slope;
      const y = Math.floor(frac / 65536);
      if ((x !== tx || y !== ty) && blocked(x, y)) return false;
    }
    return true;
  }
  if (dy === 0) return true;
  const step = Math.sign(dy);
  const slope = Math.trunc((dx * 65536) / Math.abs(dy));
  let frac = sx * 65536 + 32768;
  for (let y = sy; y !== ty;) {
    y += step;
    frac += slope;
    const x = Math.floor(frac / 65536);
    if ((x !== tx || y !== ty) && blocked(x, y)) return false;
  }
  return true;
}

module.exports = function registerXarth(api) {
  Shared.bind(api);
  Raid.registerRoom("XARTH", XarthRoom);
};

Object.assign(module.exports, { XarthRoom, LAYOUT, HITPOINTS, TIME, DAMAGE, inWedge, shelter });
