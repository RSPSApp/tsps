"use strict";

/**
 * Wave 1: the Maiden of Sugadinti.
 *
 * Wiki (The Maiden of Sugadinti; "Theatre of Blood/Strategies"; Blood spawn):
 * - Every 10 ticks she attacks: Blackstorm at the nearest player (ties to those on her north or
 *   east side, then party order), always landing, for up to 36.5 + 3.5 x the Nylocas Matomenos
 *   that have reached her; Protect from Magic halves it. It drains the target's combat stats by
 *   (damage + 1) / 5 half the time, which stats by their highest attack bonus.
 * - Or blood: a splat on every player's tile and two more in the 5x5 round the furthest of them
 *   (captured too). A splat hurts anyone on it for 10 + 2 x those Matomenos, heals her the same
 *   and drains prayer. She can't throw blood again for her next two attacks.
 * - A splat turns into a blood spawn (120 hitpoints, scaled) 10% of the time, 20% if someone
 *   stood on the volley; at most eight, and at most one from a volley everyone dodged. Blood
 *   spawns wander leaving trails that hurt for 5-13 and heal her.
 * - At 70%, 50% and 30% she changes form and two Matomenos per player (at most ten) come from
 *   the north and south walls, walking straight to her; each one that reaches her heals her
 *   twice its remaining hitpoints. Freezing them stops them.
 * - Hard Mode: all ten Matomenos every time (captured; the Hard Mode page says eight), each that
 *   reaches her speeds her up, blood spawns take no damage, trails stay, and a third attack in
 *   a row on one player hits harder ("You take additional damage from the repeated attacks.").
 * - Entry Mode: her maximum hit is 18, trails hurt for 2-5; one Matomenos per player (captured
 *   rsprox 101 solo, 554 duo).
 * Cache: her forms by mode, the dying forms, Matomenos and blood spawn (NPCS), the waiting
 * Maiden loc 32972, the pool of blood left after her (32973), the trail loc 32984.
 * RuneLite (gameval): her animations (8091 blood, 8092 Blackstorm, 8093/8094 dying) and the
 * projectiles and graphic (1577 shadow, 1578 blood, 1579 lingering blood).
 * Captured (rsprox 1764, 1852, 1837, 101, 554): the first attack 9 ticks after she appears, the
 * projectiles' timing and arcs, the sounds and blood graphic sent at the throw and delayed to
 * the landing, a splat acting from the whole tick before its landing and rolling its blood
 * spawn 10 ticks on, trails' 29 ticks, the Matomenos' spawn tiles and walk, 8097 as one reaches
 * her and its removal 2 ticks later, her death (7 ticks, the wave ending as she vanishes).
 * Fits: the blood odds (86 of 276 attacks she could throw it, 12 raids); Hard Mode's attack
 * speed, 10 - (reached + 1) / 2 down to 6 (10 raids); an attack lost and 10 ticks waited when her
 * last target has fallen (9 samples). Estimates: splats lasting 10 ticks, prayer drained by half
 * the splat damage, the repeated attacks' extra (the captures' highest hits run some 10-25% above
 * the rest, few samples), Entry Mode's Blackstorm and splat growth (half of Normal's).
 */

const Shared = require("./Shared.TheatreOfBlood");
const Raid = require("./RaidState.TheatreOfBlood");

/** Per mode, from the cache and captures (101, 554 Entry; 1764, 1852, 1837 Hard). */
const NPCS = {
  entry: { FORMS: [10814, 10815, 10816, 10817], DYING: [10818, 10819], MATOMENOS: 10820, BLOOD_SPAWN: 10821 },
  normal: { FORMS: [8360, 8361, 8362, 8363], DYING: [8364, 8365], MATOMENOS: 8366, BLOOD_SPAWN: 8367 },
  hard: { FORMS: [10822, 10823, 10824, 10825], DYING: [10826, 10827], MATOMENOS: 10828, BLOOD_SPAWN: 10829 },
};
const NPC = NPCS.normal;
const OBJECT = { WAITING: 32972, POOL: 32973, TRAIL: 32984 };
const SPAWN = { x: 3162, y: 4444, z: 0 };
/** Her size is 6: projectiles leave from this tile (captured). */
const CENTRE = { x: SPAWN.x + 3, y: SPAWN.y + 3 };
const SIZE = 6;
const ANIMATION = { BLOOD: 8091, BLACKSTORM: 8092, DYING: [8093, 8094], MATOMENOS_REACHED: 8097 };
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
const FIRST_ATTACK_TICKS = 9;
/** Hard Mode: faster by a tick for every other Matomenos that reached her (fit, see above). */
const FASTEST_ATTACK_TICKS = 6;
const BLOOD_CHANCE = 0.3;
const BLOOD_COOLDOWN = 2;
const BLACKSTORM = { entry: { base: 18.25, perNylo: 1.75 }, normal: { base: 36.5, perNylo: 3.5 } };
/** Repeated attacks: captured only with teams of three or fewer (none in 4 four-player raids). */
const REPEATS = { after: 2, multiplier: 1.15, largestTeam: 3 };
const SPLAT = { entry: { base: 5, perNylo: 1 }, normal: { base: 10, perNylo: 2 } };
const SPLAT_TICKS = 10;
const SPLAT_SPAWN_ROLL = 10;
const BLOOD_SPAWN = { max: 8, chance: 0.1, steppedChance: 0.2 };
/** Wiki: 120 hitpoints (scaled, captured 18 damage = 6/30 of the bar at 75%), 7 in Entry Mode. */
const BLOOD_SPAWN_HITPOINTS = { entry: 7, normal: 120 };
const TRAIL = { entry: { ticks: 29, min: 2, max: 5 }, normal: { ticks: 29, min: 5, max: 13 }, hard: { ticks: Infinity, min: 5, max: 13 } };
const THRESHOLDS = [0.7, 0.5, 0.3];
const MATOMENOS = { entry: { perPlayer: 1, max: 5 }, normal: { perPlayer: 2, max: 10 }, hard: { perPlayer: 10, max: 10 } };
/** A Matomenos that reached her stays this long, as captured. */
const MATOMENOS_REMOVAL_TICKS = 2;
const DEATH = { secondForm: 3, clearFloor: 4, gone: 7 };
/** Five spawn tiles each side, N then S, as captured: four along the wall, one by the east end. */
const MATOMENOS_TILES = [
  { x: 3173, y: 4456 }, { x: 3177, y: 4456 }, { x: 3181, y: 4456 }, { x: 3185, y: 4456 }, { x: 3185, y: 4454 },
  { x: 3173, y: 4436 }, { x: 3177, y: 4436 }, { x: 3181, y: 4436 }, { x: 3185, y: 4436 }, { x: 3185, y: 4438 },
];
/** Combat Achievements: 10 seconds of a blood spawn's life (Wiki), trails made (Wiki). */
const ANTICOAGULANTS_TICKS = 17;
const STOP_RIGHT_THERE_TRAILS = 15;
const TASK = { ANTICOAGULANTS: "Anticoagulants", CANT_DRAIN: "Can't Drain This", PERFECT: "Perfect Maiden", STOP_RIGHT_THERE: "Stop Right There!" };
const STAT_DRAIN_CHANCE = 0.5;

const key = (tile) => `${tile.x},${tile.y}`;

class MaidenRoom extends Raid.Room {
  onBuild() {
    this.maiden = null;
    this.dying = false;
    this.ids = Shared.byMode(this.raid, NPCS);
    this.splats = new Map();
    this.trails = new Map();
    this.matomenos = new Set();
    this.bloodSpawns = new Set();
    this.prayers = new Map();
    this.trailsMade = 0;
    this.waiting = this.placeObject(OBJECT.WAITING, SPAWN, 10, 3);
  }

  onStart() {
    const { ObjectManager } = Shared.core();
    ObjectManager.deregister(this.waiting, true);
    this.objects = this.objects.filter((object) => object !== this.waiting);
    this.maiden = this.spawn(this.ids.FORMS[0], SPAWN, { face: Shared.facing("EAST"), scripted: true });
    if (!this.maiden) return;
    this.maiden.getMovementQueue().setBlockMovement(true);
    this.ticks = 0;
    this.attackAt = Shared.cycle() + FIRST_ATTACK_TICKS;
    this.form = 0;
    this.nylosAbsorbed = 0;
    this.bloodCooldown = 0;
    this.lastTarget = null;
    this.repeats = 0;
  }

  healthBar() {
    const maiden = this.maiden;
    return maiden ? { current: Math.max(0, maiden.getHitpoints()), maximum: maiden.getMaxHitpoints() } : null;
  }

  /** Her hitpoints running out starts her death; the wave ends as she vanishes (captured). */
  holdsOn(npc) {
    return npc === this.maiden && this.isStarted();
  }

  /** Hard Mode: blood spawns can be attacked but take no damage. */
  modifyHit(npc, hit) {
    if (!this.raid.isHard || !this.bloodSpawns.has(npc)) return;
    for (const part of hit.getHits?.() ?? []) part.setDamage(0);
    hit.updateTotalDamage?.();
  }

  tick() {
    const maiden = this.maiden;
    if (!this.isStarted() || !maiden || this.dying) return;
    if (maiden.getHitpoints() <= 0) {
      this.die();
      return;
    }
    this.ticks++;
    this.checkForms();
    // Attack first: a Matomenos reaching her this tick counts from her next attack (captured).
    if (Shared.cycle() >= this.attackAt) this.attack();
    this.tickSplats();
    this.tickMatomenos();
    this.tickBloodSpawns();
    this.checkPrayer();
  }

  die() {
    const { Animation } = Shared.core();
    const maiden = this.maiden;
    this.dying = true;
    maiden.setNpcTransformationId?.(this.ids.DYING[0]);
    maiden.performAnimation(new Animation(ANIMATION.DYING[0]));
    this.later(DEATH.secondForm, () => {
      maiden.setNpcTransformationId?.(this.ids.DYING[1]);
      maiden.performAnimation(new Animation(ANIMATION.DYING[1]));
    });
    this.later(DEATH.clearFloor, () => this.clearNpcs());
    this.later(DEATH.gone, () => {
      this.despawn(maiden);
      this.maiden = null;
      this.complete();
    });
  }

  clearNpcs() {
    for (const npc of [...this.matomenos, ...this.bloodSpawns]) this.despawn(npc);
    this.matomenos.clear();
    this.bloodSpawns.clear();
  }

  onComplete() {
    this.clearNpcs();
    this.clearTrails();
    this.splats.clear();
    this.placeObject(OBJECT.POOL, SPAWN, 10, 3);
    for (const task of Object.values(TASK)) if (this.raid.taskLive(task)) this.raid.completeTask(task);
  }

  // -------------------------------------------------------------- attacks

  attackTicks() {
    if (!this.raid.isHard) return ATTACK_TICKS;
    return Math.max(FASTEST_ATTACK_TICKS, ATTACK_TICKS - Math.ceil(this.nylosAbsorbed / 2));
  }

  attack() {
    const targets = this.fighters();
    if (this.lastTarget && !targets.includes(this.lastTarget)) {
      // Her last target has fallen: this attack is lost and she takes a full 10 ticks (fit).
      this.lastTarget = null;
      this.attackAt = Shared.cycle() + ATTACK_TICKS;
      return;
    }
    this.attackAt = Shared.cycle() + this.attackTicks();
    if (targets.length === 0) return;
    if (this.bloodCooldown > 0) this.bloodCooldown--;
    if (this.bloodCooldown === 0 && Math.random() < BLOOD_CHANCE) this.throwBlood(targets);
    else this.blackstorm(targets);
  }

  /** The nearest player to her; ties to her north or east side, then the party's order. */
  nearest(targets) {
    const rank = (player) => {
      const at = Shared.tileOf(player);
      return Shared.distanceTo(this.maiden, player.getLocation()) * 2
        + (at.x >= SPAWN.x + SIZE || at.y >= SPAWN.y + SIZE ? 0 : 1);
    };
    let best = null;
    for (const player of targets) if (!best || rank(player) < rank(best)) best = player;
    return best;
  }

  /** The player furthest from her, whom the two extra splats land round. */
  furthest(targets) {
    let best = null;
    for (const player of targets) {
      if (!best || Shared.distanceTo(this.maiden, player.getLocation()) > Shared.distanceTo(this.maiden, best.getLocation())) best = player;
    }
    return best;
  }

  /** Cycles a projectile of hers takes to land on a tile, as captured. */
  landingCycles(projectile, tile) {
    return projectile.delay + projectile.perTile * Math.max(Math.abs(tile.x - CENTRE.x), Math.abs(tile.y - CENTRE.y));
  }

  blackstorm(targets) {
    const { Animation } = Shared.core();
    const target = this.nearest(targets);
    const maiden = this.maiden;
    maiden.setMobileInteraction?.(target);
    maiden.performAnimation(new Animation(ANIMATION.BLACKSTORM));
    Shared.areaSound(this.area, maiden, SOUND.BLACKSTORM, this.landingCycles(PROJECTILE.BLACKSTORM, Shared.tileOf(target)));
    const ticks = Shared.projectile(this.area, maiden, target, GRAPHIC.SHADOW, PROJECTILE.BLACKSTORM);
    const repeated = this.countRepeat(target);
    const { base, perNylo } = Shared.byMode(this.raid, BLACKSTORM);
    const maxHit = (base + perNylo * this.nylosAbsorbed) * (repeated ? REPEATS.multiplier : 1);
    const hit = this.strike(maiden, target, "magic", maxHit, Math.max(1, ticks - 1), { accurate: true, prayerMultiplier: 0.5 });
    const damage = hit.getTotalDamage();
    if (damage <= 0) return;
    if (repeated) target.sendMessage("You take additional damage from the repeated attacks.");
    if (!Shared.isProtected(target, "magic")) {
      this.raid.failTask(TASK.PERFECT, `${Shared.displayName(target)} did not protect from magic against The Maiden's attacks.`);
    }
    // Captured: the drain's message comes with the attack, not its landing.
    if (Math.random() < STAT_DRAIN_CHANCE) drainStats(target, damage);
  }

  /**
   * Hard Mode, small teams: whether this is at least her third attack in a row on one player.
   * Captured: a target falling doesn't reset the count (25079 on rsprox 1764 hits harder on the
   * very next player); blood between attacks doesn't either.
   */
  countRepeat(target) {
    if (this.lastTarget && this.lastTarget !== target) this.repeats = 0;
    this.lastTarget = target;
    this.repeats++;
    return this.raid.isHard && this.raid.size <= REPEATS.largestTeam && this.repeats > REPEATS.after;
  }

  throwBlood(targets) {
    const { Animation } = Shared.core();
    this.bloodCooldown = BLOOD_COOLDOWN + 1;
    this.maiden.performAnimation(new Animation(ANIMATION.BLOOD));
    const tiles = targets.map((player) => Shared.tileOf(player));
    const centre = Shared.tileOf(this.furthest(targets));
    for (let extra = 0; extra < 2; extra++) {
      tiles.push({ x: centre.x + Shared.random(-2, 2), y: centre.y + Shared.random(-2, 2), z: 0 });
    }
    const volley = { stepped: false, spawned: false };
    const aimed = new Set();
    for (const [index, tile] of tiles.entries()) {
      if (aimed.has(key(tile)) || this.splats.has(key(tile)) || !Shared.floorFree(this.area, tile)) continue;
      aimed.add(key(tile));
      const projectile = index < targets.length ? PROJECTILE.BLOOD : PROJECTILE.BLOOD_EXTRA;
      Shared.projectile(this.area, this.maiden, tile, GRAPHIC.BLOOD, projectile);
      // Captured: the graphic and sound are sent now, delayed to the landing.
      const cycles = this.landingCycles(projectile, tile);
      Shared.graphicAt(this.area, GRAPHIC.LINGERING, tile, { delay: cycles });
      Shared.areaSound(this.area, tile, SOUND.BLOOD, cycles);
      this.later(Math.floor(cycles / 30), () => this.landSplat(tile, volley));
    }
  }

  landSplat(tile, volley) {
    if (this.splats.has(key(tile)) || !this.isStarted() || this.dying) return;
    this.splats.set(key(tile), { tile, ticks: SPLAT_TICKS, volley });
    this.later(SPLAT_SPAWN_ROLL, () => this.rollBloodSpawn(tile, volley));
  }

  rollBloodSpawn(tile, volley) {
    if (this.bloodSpawns.size >= BLOOD_SPAWN.max || !this.isStarted() || this.dying) return;
    // Wiki: a volley everyone dodged makes one blood spawn at most.
    if (!volley.stepped && volley.spawned) return;
    if (Math.random() >= (volley.stepped ? BLOOD_SPAWN.steppedChance : BLOOD_SPAWN.chance)) return;
    const spawn = this.spawn(this.ids.BLOOD_SPAWN, tile, { scale: false, scripted: true });
    if (!spawn) return;
    const base = Shared.byMode(this.raid, BLOOD_SPAWN_HITPOINTS);
    const hitpoints = Math.max(1, Math.floor(base * Shared.MODES[this.raid.mode].hitpoints(this.raid.size)));
    spawn.setMaxHitpoints?.(hitpoints);
    spawn.setHitpoints(hitpoints);
    spawn.__bornAt = this.ticks;
    volley.spawned = true;
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
        splat.volley.stepped = true;
        const { base, perNylo } = Shared.byMode(this.raid, SPLAT);
        const damage = base + perNylo * this.nylosAbsorbed;
        Shared.damage(player, damage);
        Shared.heal(this.maiden, damage);
        const { Skill } = Shared.core();
        player.getSkillManager().decreaseCurrentLevel?.(Skill.PRAYER, Math.floor(damage / 2), 0);
        this.raid.failTask(TASK.PERFECT, `${Shared.displayName(player)} failed to dodge the blood.`);
      } else if (this.trails.has(here)) {
        const { min, max } = Shared.byMode(this.raid, TRAIL);
        const damage = Shared.random(min, max);
        Shared.damage(player, damage);
        Shared.heal(this.maiden, damage);
        this.raid.failTask(TASK.PERFECT, `${Shared.displayName(player)} stepped on a blood trail.`);
      }
    }
  }

  /** Can't Drain This: any fall in a fighter's prayer points, the splats' or their own prayers'. */
  checkPrayer() {
    const { Skill } = Shared.core();
    for (const player of this.fighters()) {
      const prayer = player.getSkillManager().getCurrentLevel(Skill.PRAYER);
      if (prayer < (this.prayers.get(player) ?? prayer)) {
        this.raid.failTask(TASK.CANT_DRAIN, `${Shared.displayName(player)} has lost a prayer point.`);
      }
      this.prayers.set(player, prayer);
    }
  }

  // -------------------------------------------------------------- forms and Matomenos

  checkForms() {
    const share = this.maiden.getHitpoints() / Math.max(1, this.maiden.getMaxHitpoints());
    while (this.form < THRESHOLDS.length && share <= THRESHOLDS[this.form]) {
      this.form++;
      this.maiden.setNpcTransformationId?.(this.ids.FORMS[this.form]);
      this.spawnMatomenos();
    }
  }

  /** By mode, per player in the fight (at least one); random tiles unless it takes them all. */
  spawnMatomenos() {
    const { perPlayer, max } = Shared.byMode(this.raid, MATOMENOS);
    const count = Math.min(max, perPlayer * Math.max(1, this.fighters().length));
    const tiles = count >= MATOMENOS_TILES.length ? MATOMENOS_TILES : Shared.shuffle(MATOMENOS_TILES).slice(0, count);
    for (const tile of tiles) {
      // As captured: those from the north wall face south-west, those from the south north-west.
      const face = Shared.facing(tile.y > SPAWN.y ? "SOUTH_WEST" : "NORTH_WEST");
      const nylo = this.spawn(this.ids.MATOMENOS, { ...tile, z: 0 }, { scripted: true, face });
      if (nylo) this.matomenos.add(nylo);
    }
  }

  /** Each walks to her unless frozen; one that reaches her heals her twice its hitpoints. */
  tickMatomenos() {
    const { Animation } = Shared.core();
    for (const nylo of [...this.matomenos]) {
      if (nylo.getHitpoints() <= 0 || !nylo.isRegistered()) {
        this.matomenos.delete(nylo);
        continue;
      }
      if (gap(nylo, this.maiden) <= 1) {
        Shared.heal(this.maiden, 2 * nylo.getHitpoints());
        this.nylosAbsorbed++;
        this.matomenos.delete(nylo);
        nylo.getMovementQueue().reset();
        nylo.setUntargetable?.(true);
        nylo.performAnimation(new Animation(ANIMATION.MATOMENOS_REACHED));
        this.later(MATOMENOS_REMOVAL_TICKS, () => this.despawn(nylo));
        this.raid.failTask(TASK.PERFECT, "A Nylocas Matomenos healed The Maiden.");
        continue;
      }
      if (Shared.frozen(nylo) || nylo.getMovementQueue().hasRoute?.()) continue;
      Shared.walkStraight(nylo, { ...reachTile(Shared.tileOf(nylo)), z: 0 });
    }
  }

  /** Blood spawns step to a random neighbouring tile each tick, leaving trails (captured). */
  tickBloodSpawns() {
    const { PathFinder } = Shared.core();
    for (const spawn of [...this.bloodSpawns]) {
      if (spawn.getHitpoints() <= 0 || !spawn.isRegistered()) {
        this.bloodSpawns.delete(spawn);
        continue;
      }
      if (this.ticks - spawn.__bornAt > ANTICOAGULANTS_TICKS) {
        this.raid.failTask(TASK.ANTICOAGULANTS, "A blood spawn lived for longer than 10 seconds.");
      }
      const at = Shared.tileOf(spawn);
      this.leaveTrail(at);
      if (Shared.frozen(spawn) || spawn.getMovementQueue().hasRoute?.()) continue;
      const next = { x: at.x + Shared.random(-1, 1), y: at.y + Shared.random(-1, 1), z: 0 };
      if (Shared.floorFree(this.area, next)) PathFinder.calculateWalkRoute(spawn, next.x, next.y);
    }
  }

  leaveTrail(tile) {
    const { ticks } = Shared.byMode(this.raid, TRAIL);
    const existing = this.trails.get(key(tile));
    if (existing) {
      existing.ticks = ticks;
      return;
    }
    const { GameObject, ObjectManager } = Shared.core();
    const object = new GameObject(OBJECT.TRAIL, Shared.loc(tile), 10, Shared.random(0, 3), this.area);
    ObjectManager.register(object, true);
    this.trails.set(key(tile), { object, ticks });
    if (++this.trailsMade > STOP_RIGHT_THERE_TRAILS) {
      this.raid.failTask(TASK.STOP_RIGHT_THERE, `Blood spawns created more than ${STOP_RIGHT_THERE_TRAILS} blood trails.`);
    }
  }

  clearTrails() {
    for (const trail of this.trails.values()) Shared.core().ObjectManager.deregister(trail.object, true);
    this.trails.clear();
  }

  destroy() {
    if (this.trails) this.clearTrails();
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

/**
 * Where a Matomenos (size 2) walking from `from` stops. As captured they head for her
 * south-west tile, diagonally then straight, and stop on first touching her.
 */
function reachTile(from) {
  const touching = (x, y) => Math.max(
    Math.max(0, SPAWN.x - (x + 1), x - (SPAWN.x + SIZE - 1)),
    Math.max(0, SPAWN.y - (y + 1), y - (SPAWN.y + SIZE - 1)),
  ) <= 1;
  let { x, y } = from;
  while (!touching(x, y)) {
    x += Math.sign(SPAWN.x - x);
    y += Math.sign(SPAWN.y - y);
  }
  return { x, y };
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

Object.assign(module.exports, { MaidenRoom, NPC, NPCS, MATOMENOS_TILES, gap, reachTile, drainStats });
