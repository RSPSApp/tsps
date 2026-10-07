"use strict";

/**
 * Path of Crondis, Zebak (Jaws of Gluttony). Zebak lies in the water at the west end and
 * attacks with split ranged/magic volleys and bleeding bites. At 85/70/55/40% he alternates
 * two specials: boulders and jugs with a pushing scream (shelter behind a boulder, break
 * poison with jugs), and great waves sweeping the arena. Below 25% he attacks much faster.
 * Not Just a Head adds blood barrages and blood clouds.
 * Wiki: https://oldschool.runescape.wiki/w/Zebak
 *
 * A wave that pushes someone off the edge washes them into the water. Swimmers can't attack or
 * run, the crocodiles there bite them, and they climb back out by the rock steps.
 *
 * Checked against OpenRune-Server #274 (built against a live capture), Wiki first:
 * - Wiki: each roar wave hits each rock for 50 (150 HP); blood clouds lose 2 for each tile they
 *   move; his Defence drains at most 20; a barrage heals him twice the damage it deals; a
 *   special still queued when he enrages is dropped.
 * - OpenRune (the Wiki gives no figures): acid 6-10 and barrage 3-5 before scaling, the bite
 *   landing 2 ticks after it with Protect from Melee blocking half, his first attack after 10
 *   ticks, autos carrying on through the specials, the specials' timings, jugs rolling 8 tiles,
 *   only the first roar wave chipping jugs, the rock area and the camera shakes.
 * - The volley as OSRS draws it: the burst rides a helper NPC (SPOTANIM_ZEBAK_RANGED01_NPC) so it
 *   plays at height 750 where the rising projectile peaks (a tile graphic's height is a byte),
 *   and the rising projectile and fragments arc at 30 and 127.
 * - Enraged he becomes TOA_ZEBAK_ENRAGED, with the enraged attack animations and projectiles
 *   (named so in RuneLite's gameval; OpenRune uses the enraged melee only).
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

const SPAWN = { x: 3918, y: 5404, z: 0 };
const TAIL_SPAWN = { x: 3909, y: 5403, z: 0 };
const GROUND_MIN = { x: 3926, y: 5398 };
const GROUND_MAX = { x: 3942, y: 5418 };
const BOULDER_MIN = { x: 3925, y: 5401 };
const BOULDER_MAX = { x: 3935, y: 5415 };
const MIDDLE = { x: 3926, y: 5408 };
const PROJECTILE_START = { x: 3925, y: 5408 };
const PROJECTILE_SPLIT = { x: 3933, y: 5408 };
const WAVE_SOUTH = { x: 3923, y: 5397 };
const WAVE_NORTH = { x: 3923, y: 5419 };
const BLOOD_SPELL_TILES = [{ x: 3924, y: 5406 }, { x: 3925, y: 5410 }];
const BLOOD_CLOUD_TILES = [{ x: 3931, y: 5413 }, { x: 3934, y: 5401 }];
/** The volley's burst rides this 7x7 helper, centred on the split point (OSRS; OpenRune). */
const SPLIT_HELPER = { id: 11744, tile: { x: 3930, y: 5405 }, ticks: 3 };

const POISON = 45570; // 45570..45575
const BOULDER_BLOCK = 43876;
const BLOOD_FLOOR = 652; // 652..654
const ROCK_STEPS = "Rock steps";

// The water crocodiles' spawns (OpenRune). In the cache they're bubbles (swampbubs) with
// attack 250 and strength 70: a max hit of 8 before scaling. They bite every 2 ticks.
const WATER_CROC_TILES = [
  { x: 3948, y: 5408 }, { x: 3948, y: 5408 }, { x: 3935, y: 5422 }, { x: 3934, y: 5420 },
  { x: 3921, y: 5418 }, { x: 3937, y: 5396 }, { x: 3937, y: 5395 }, { x: 3919, y: 5403 },
];
const CROC_MAX_HIT = 8;
const CROC_BITE_TICKS = 2;
const CROC_HUNT_RANGE = 16;
// A wave that runs out of floor throws the player this many tiles on, into the water (OpenRune).
const WATER_JUMP = 5;

const ANIMATION = {
  SHOOT: 9624, TAIL_SHOOT: 9625, MELEE: 9620, TAIL_MELEE: 9621, DEATH: 9634, TAIL_DEATH: 9635,
  MELEE_ENRAGED: 9622, TAIL_MELEE_ENRAGED: 9623, SHOOT_ENRAGED: 9626, TAIL_SHOOT_ENRAGED: 9627,
  SCREAM: 9628, TAIL_SCREAM: 9629, CALL_WAVE: 9630, TAIL_CALL_WAVE: 9631, PUSHED: 4177, SLIDE: 1114, JUG_MOVE: 834,
  CROC_BITE: 9804,
};
// Stand, turn, walk, turn around, turn right, turn left, run: human_swim_ready / human_swim.
const SWIM_ANIMATIONS = [773, 772, 772, 772, 772, 772, 772];
const PROJECTILE = {
  POISON: 1555, BOULDER: 2172, JUG: 2173, POISON_BOULDER: 2194, MAGIC: 2176, MAGIC_SPLIT: 2181,
  RANGED: 2178, RANGED_SPLIT: 2187, POISON_SPREAD: 2194, JUG_SPREAD: 2193,
  MAGIC_ENRAGED: 2177, RANGED_ENRAGED: 2179,
};
const GRAPHIC = {
  MAGIC_BURST: 2186, RANGED_BURST: 2185, // ZEBAK_MAGE_SPLIT, ZEBAK_RANGED_SPLIT
  MAGIC_IMPACT: 131, RANGED_IMPACT: 1103, BLOOD: 377, ROCKS: 2195, SPLASH: 68, ROAR: 2184, JUG_BREAK: 2192, POISON_GONE: 95,
};
const SOUND = { MAGIC: 5823, RANGED: 5819, FINAL_PHASE: 3405, BARRAGE: 102, JUGS: 5908, POISON_LAND: 5909, BOULDER_LAND: 5913, PUSHED: 5888, RUMBLING: 1678, WAVE_HIT: 5868 };

// Wiki: max hits 38 melee, 16 magic and ranged; a wave hits for 6-10, all scaled by raid level.
const MAX_HIT = { BITE: 38, VOLLEY: 16, SCREAM: 20, WAVE: 10 };
const WAVE_MIN_HIT = 6;
/** Acid 6-10 a tick and the barrage 3-5, before scaling (OpenRune). */
const ACID = { MIN: 6, MAX: 10 };
const BARRAGE = { MIN: 3, SPREAD: 2, HEAL_PER_DAMAGE: 2 };
/** The bite lands 2 ticks after it, and Protect from Melee lets half through (OpenRune). */
const BITE = { HIT_TICKS: 2, THROUGH_PRAYER: 0.5 };
const VOLLEY = { SPLIT_TICKS: 4, BURST_HEIGHT: 750, FRAGMENT_CYCLES: 90, HIT_TICKS: 3, RISE_ANGLE: 30, FRAGMENT_ANGLE: 127 };
/** Wiki: each roar wave hits each rock for 50, and a rock has 150. */
const ROCK = { HITPOINTS: 150, ROAR_DAMAGE: 50 };
/** Wiki: his Defence drains by at most 20 (to 50). */
const MAX_DEFENCE_DRAIN = 20;
const FIRST_ATTACK_TICKS = 10;
const JUG_ROLL_TILES = 8;
/** OpenRune's camera shakes: [slot, random amplitude] (slot 0 left-right, 1 up-down, 2 forwards). */
const SHAKE = {
  DEATH: { delay: 2, axes: [[0, 5], [1, 5], [2, 2]], resetAfter: 4 },
  WAVES: { axes: [[0, [5, 7]], [1, [7, 8]], [2, [6, 6]]], resetAfter: 2 },
};
// A bite bleeds 1 time in 4 instead of hitting: 5-10 at once, then 1-8 each tick spent
// moving for 10 ticks (OpenRune; the Wiki only says moving makes it worse).
const BLEED = { CHANCE: 4, TICKS: 10, APPLY_MIN: 5, APPLY_MAX: 10, MOVING_MIN: 1, MOVING_MAX: 8 };
const ZEBAK_POINTS = 1.5;

class ZebakRoom extends Raid.Room {
  build() {
    const { NpcIdentifiers } = Shared.core();
    const level = this.pathLevel();
    this.attackSpeed = 7 - Math.min(2, Math.floor(level / 2));
    this.attackTicks = FIRST_ATTACK_TICKS;
    this.specialsDone = 0;
    this.queued = [];
    this.busy = false;
    this.lastPhase = false;
    this.jugNext = Shared.random(0, 1) === 0;
    this.useMagic = Shared.random(0, 1) === 0;
    this.barrageNext = Shared.random(0, 1) === 0;
    this.cloudsSouth = Shared.random(0, 1) === 0;
    this.wavesSouth = Shared.random(0, 1) === 0;
    this.bloodTicks = this.settings.isActive("NOT_JUST_A_HEAD") ? this.attackSpeed * 6 - 1 : -1;
    this.spreadBarrage = this.settings.isActive("ARTERIAL_SPRAY");
    this.multipleClouds = this.settings.isActive("BLOOD_THINNERS");
    this.upsetStomach = this.settings.isActive("UPSET_STOMACH");
    this.poison = new Map();
    this.activePoison = new Set();
    this.jugs = new Set();
    this.boulders = [];
    this.waves = new Set();
    this.clouds = new Set();
    this.bleeding = new Map();
    this.swimmers = new Map();
    this.crocodiles = [];
    this.zebak = this.spawn(NpcIdentifiers.ZEBAK_2, SPAWN, { points: ZEBAK_POINTS, face: 4 });
    if (this.zebak) {
      this.zebak.__toaScripted = true;
      this.zebak.__toaZebak = true;
      this.zebak.getMovementQueue().setBlockMovement(true);
    }
    this.tail = this.spawn(NpcIdentifiers.ZEBAKS_TAIL, TAIL_SPAWN, { scale: false, points: 0, face: 4 });
    if (this.tail) {
      this.tail.__toaScripted = true;
      this.tail.setUntargetable(true);
      this.tail.getMovementQueue().setBlockMovement(true);
    }
  }

  onStart() {
    this.raid.scale(this.zebak, this.pathLevel());
    this.openBossHud(this.zebak);
    this.spawnCrocodiles();
  }

  lootSource() {
    return this.zebak;
  }

  onComplete() {
    this.clearAll();
  }

  onReset() {
    this.clearAll();
    this.despawn(this.zebak);
    this.despawn(this.tail);
    this.build();
  }

  clearAll() {
    for (const set of [this.jugs, this.waves, this.clouds]) {
      for (const npc of set) this.despawn(npc);
      set.clear();
    }
    for (const boulder of this.boulders) this.removeBoulder(boulder);
    this.boulders = [];
    for (const key of [...this.poison.keys()]) this.removePoison(key);
    for (const crocodile of this.crocodiles) this.despawn(crocodile);
    this.crocodiles = [];
    for (const player of [...this.swimmers.keys()]) this.stopSwimming(player);
    this.bleeding.clear();
  }

  // -------------------------------------------------------------- health phases

  /**
   * Called after each hit on him: his Defence can't drain more than 20, specials queue at
   * 85/70/55/40%, and below 25% he enrages (a queued special is dropped).
   */
  checkPhases() {
    const zebak = this.zebak;
    if (!zebak) return;
    const floor = zebak.getCurrentDefinition().getStats()[2] - MAX_DEFENCE_DRAIN;
    if (zebak.getDefenceLevel() < floor) zebak.setDefenceLevel(floor);
    if (this.lastPhase) return;
    const ratio = zebak.getHitpoints() / zebak.getMaxHitpoints();
    const thresholds = [0.85, 0.7, 0.55, 0.4];
    while (this.specialsDone < thresholds.length && ratio <= thresholds[this.specialsDone]) {
      this.queued.push(this.jugNext ? "jugs" : "waves");
      this.jugNext = !this.jugNext;
      this.specialsDone++;
    }
    if (ratio <= 0.25) {
      const { NpcIdentifiers } = Shared.core();
      this.lastPhase = true;
      this.queued = [];
      this.attackSpeed = Math.max(2, this.attackSpeed - 3);
      zebak.setNpcTransformationId(NpcIdentifiers.ZEBAK_3);
      for (const player of this.challengePlayers()) Shared.sound(player, SOUND.FINAL_PHASE);
    }
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (!this.isStarted() || !this.zebak || this.zebak.getHitpoints() <= 0) return;
    const players = this.challengePlayers();
    for (const player of [...this.swimmers.keys()]) {
      if (!players.includes(player)) this.stopSwimming(player);
    }
    this.tickCrocodiles(players);
    this.tickBleeding(players);
    this.tickPoison(players);
    this.tickJugs();
    this.tickWaves(players);
    this.tickClouds(players);
    if (players.length === 0) return;
    if (!this.busy && this.bloodTicks !== -1 && --this.bloodTicks === 0) {
      this.bloodTicks = this.attackSpeed * (this.lastPhase ? 8 : 6) - 1;
      this.bloodSpell();
    }
    if (--this.attackTicks > 0) return;
    this.attackTicks = this.attackSpeed;
    // A special takes his attack's turn; his autos carry on while it plays out (OpenRune).
    if (!this.lastPhase && !this.busy && this.queued.length > 0) {
      const special = this.queued.shift();
      if (special === "jugs") this.boulderSpecial();
      else this.waveSpecial();
    } else {
      this.normalAttack(players);
    }
  }

  normalAttack(players) {
    const { Animation } = Shared.core();
    if (Shared.random(0, 2) === 0) this.useMagic = !this.useMagic;
    const inReach = players.filter((player) => withinReach(this.zebak, player));
    const enraged = this.lastPhase;
    if (inReach.length > 0 && Shared.random(0, 2) === 0) {
      this.zebak.performAnimation(new Animation(enraged ? ANIMATION.MELEE_ENRAGED : ANIMATION.MELEE));
      this.tail.performAnimation(new Animation(enraged ? ANIMATION.TAIL_MELEE_ENRAGED : ANIMATION.TAIL_MELEE));
      // Prayer counts when the bite lands, and only halves it.
      this.later(BITE.HIT_TICKS, () => {
        for (const player of inReach) {
          if (player.getHitpoints() <= 0 || !this.inChallenge(player)) continue;
          if (Shared.random(1, BLEED.CHANCE) === 1) this.bleed(player);
          else this.strike(this.zebak, player, null, "melee", MAX_HIT.BITE, 0, { prayerMultiplier: BITE.THROUGH_PRAYER });
        }
      });
      return;
    }
    const magic = this.useMagic;
    this.zebak.performAnimation(new Animation(enraged ? ANIMATION.SHOOT_ENRAGED : ANIMATION.SHOOT));
    this.tail.performAnimation(new Animation(enraged ? ANIMATION.TAIL_SHOOT_ENRAGED : ANIMATION.TAIL_SHOOT));
    for (const player of players) Shared.sound(player, magic ? SOUND.MAGIC : SOUND.RANGED);
    // The volley rises for 120 client cycles whatever the distance and bursts where it peaks,
    // four ticks in; its fragments take 90 cycles to land, so the hit comes three ticks after.
    const rising = enraged ? (magic ? PROJECTILE.MAGIC_ENRAGED : PROJECTILE.RANGED_ENRAGED) : (magic ? PROJECTILE.MAGIC : PROJECTILE.RANGED);
    Shared.tileProjectile(this.area, Shared.loc(PROJECTILE_START), Shared.loc(PROJECTILE_SPLIT), rising,
      { delay: 60, duration: 60, perTile: 0, startHeight: 50, endHeight: 175, angle: VOLLEY.RISE_ANGLE });
    this.later(VOLLEY.SPLIT_TICKS, () => {
      this.burst(magic ? GRAPHIC.MAGIC_BURST : GRAPHIC.RANGED_BURST);
      for (const player of this.challengePlayers()) {
        Shared.tileProjectile(this.area, Shared.loc(PROJECTILE_SPLIT), player, magic ? PROJECTILE.MAGIC_SPLIT : PROJECTILE.RANGED_SPLIT,
          { duration: VOLLEY.FRAGMENT_CYCLES, perTile: 0, startHeight: 175, endHeight: 22, angle: VOLLEY.FRAGMENT_ANGLE });
        player.performGraphic(Shared.gfx(magic ? GRAPHIC.MAGIC_IMPACT : GRAPHIC.RANGED_IMPACT, { delay: VOLLEY.FRAGMENT_CYCLES, height: 90 }));
      }
      this.later(VOLLEY.HIT_TICKS, () => {
        const style = magic ? "magic" : "ranged";
        for (const player of this.challengePlayers()) this.strike(this.zebak, player, null, style, MAX_HIT.VOLLEY, 0);
      });
    });
  }


  /** The volley's burst, played on a helper NPC so it can sit at the projectile's peak. */
  burst(graphicId) {
    const helper = this.spawn(SPLIT_HELPER.id, { ...SPLIT_HELPER.tile, z: 0 }, { scale: false, points: 0, inert: true });
    if (!helper) return;
    helper.__toaScripted = true;
    helper.setUntargetable(true);
    helper.getMovementQueue().setBlockMovement(true);
    helper.performGraphic(Shared.gfx(graphicId, { height: VOLLEY.BURST_HEIGHT }));
    this.later(SPLIT_HELPER.ticks, () => this.despawn(helper));
  }

  // -------------------------------------------------------------- blood magic

  bloodSpell() {
    for (const tile of BLOOD_SPELL_TILES) this.graphic(GRAPHIC.BLOOD, tile);
    this.later(2, () => {
      const players = this.challengePlayers();
      if (players.length === 0) return;
      if (this.barrageNext) this.bloodBarrage(players);
      else this.bloodClouds();
      this.barrageNext = !this.barrageNext;
    });
  }

  /** Blood barrage on everyone (and those next to them); he heals twice what it deals (Wiki). */
  bloodBarrage(players) {
    let heal = 0;
    const base = Math.floor(BARRAGE.MIN * this.raid.damageFactor(0));
    for (const player of players) {
      const damage = Shared.random(base, base + BARRAGE.SPREAD);
      for (const victim of players) {
        const near = victim === player || victim.getLocation().getDistance(player.getLocation()) <= (this.spreadBarrage ? 2 : 1);
        if (!near) continue;
        if (Shared.isProtected(victim, "magic")) continue;
        heal += damage * BARRAGE.HEAL_PER_DAMAGE;
        Shared.damage(victim, damage);
      }
      player.performGraphic(Shared.gfx(GRAPHIC.BLOOD));
      Shared.sound(player, SOUND.BARRAGE);
    }
    if (heal > 0) this.zebak.setHitpoints(Math.min(this.zebak.getMaxHitpoints(), this.zebak.getHitpoints() + heal));
  }

  bloodClouds() {
    const { NpcIdentifiers } = Shared.core();
    const base = BLOOD_CLOUD_TILES[this.cloudsSouth ? 1 : 0];
    const count = this.multipleClouds ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const tile = { x: base.x + i, y: base.y + (this.cloudsSouth ? Math.floor(i / 2) : -Math.floor(i / 2)), z: 0 };
      const cloud = this.spawn(this.multipleClouds ? NpcIdentifiers.BLOOD_CLOUD_2 : NpcIdentifiers.BLOOD_CLOUD, tile, { scale: false, points: 0 });
      if (!cloud) continue;
      cloud.__toaScripted = true;
      cloud.__toaCloud = { delay: 4, target: null, switchTicks: Shared.random(10, 20), last: cloud.getLocation().clone() };
      cloud.canWalkThroughNPCs = () => true;
      this.clouds.add(cloud);
    }
    this.cloudsSouth = !this.cloudsSouth;
  }

  /** Clouds chase someone, losing 2 for each tile they move (Wiki), and drain 2 a tick from anyone beside them. */
  tickClouds(players) {
    const { PathFinder } = Shared.core();
    for (const cloud of [...this.clouds]) {
      if (cloud.getHitpoints() <= 0) {
        this.clouds.delete(cloud);
        continue;
      }
      const state = cloud.__toaCloud;
      const here = cloud.getLocation();
      const moved = Math.max(Math.abs(here.getX() - state.last.getX()), Math.abs(here.getY() - state.last.getY()));
      state.last = here.clone();
      if (moved > 0) Shared.damage(cloud, 2 * moved);
      if (state.delay > 0) state.delay--;
      state.switchTicks = Math.max(0, state.switchTicks - 1);
      if (state.switchTicks === 0 || !state.target || !players.includes(state.target)) {
        state.switchTicks = Shared.random(10, 20);
        const candidates = players.filter((player) => player !== state.target);
        state.target = candidates.sort((a, b) => a.getLocation().getDistance(cloud.getLocation()) - b.getLocation().getDistance(cloud.getLocation()))[0] ?? state.target;
      }
      if (state.target && !withinReach(cloud, state.target) && cloud.getMovementQueue().size() === 0) {
        PathFinder.calculateWalkRoute(cloud, state.target.getLocation().getX(), state.target.getLocation().getY());
      }
      if (state.delay > 0) continue;
      for (const player of players) {
        if (!withinReach(cloud, player)) continue;
        Shared.damage(player, 2);
        cloud.setHitpoints(Math.min(cloud.getMaxHitpoints(), cloud.getHitpoints() + 2));
      }
    }
  }

  // -------------------------------------------------------------- poison

  /** Pools of poison: standing in one hurts and poisons. */
  tickPoison(players) {
    const { CombatFactory } = Shared.core();
    for (const player of players) {
      const location = player.getLocation();
      if (!this.activePoison.has(key(location.getX(), location.getY()))) continue;
      Shared.damage(player, this.maxHit(Shared.random(ACID.MIN, ACID.MAX)));
      CombatFactory.poisonEntity(player, 2);
    }
    // Pools placed last tick become harmful this tick.
    for (const tile of this.poison.keys()) this.activePoison.add(tile);
  }

  addPoison(tile, spread, guaranteed) {
    const tileKey = key(tile.x, tile.y);
    if (this.poison.has(tileKey)) return;
    this.poison.set(tileKey, tile);
    this.setObject(POISON + Shared.random(0, 5), { ...tile, z: 0 }, 10, Shared.random(0, 3));
    if (!spread) return;
    const range = this.upsetStomach ? 2 : 1;
    const spreads = [];
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (dx === 0 && dy === 0) continue;
        if ((!guaranteed || dy !== 0) && Shared.random(0, 2) !== 0) continue;
        const next = { x: tile.x + dx, y: tile.y + dy };
        if (this.objectAt({ ...next, z: 0 }, 10) || !Shared.floorFree(this.area, Shared.loc(next, 0)) || this.activePoison.has(key(next.x, next.y))) continue;
        Shared.tileProjectile(this.area, Shared.loc(tile, 0), Shared.loc(next, 0), PROJECTILE.POISON_SPREAD, { duration: 30, perTile: 10, startHeight: 0 });
        spreads.push(next);
      }
    }
    if (spreads.length > 0) this.later(1, () => spreads.forEach((next) => this.addPoison(next, false, false)));
  }

  removePoison(tileKey) {
    const tile = this.poison.get(tileKey);
    if (!tile) return;
    this.poison.delete(tileKey);
    this.activePoison.delete(tileKey);
    this.setObject(-1, { ...tile, z: 0 }, 10);
  }

  // -------------------------------------------------------------- bleeding

  bleed(player) {
    player.sendMessage("<col=ff3045>Zebak's fangs tear into your flesh, causing you to bleed.</col>");
    Shared.damage(player, Shared.random(this.maxHit(BLEED.APPLY_MIN), this.maxHit(BLEED.APPLY_MAX)));
    this.bleeding.set(player, { until: Shared.cycle() + BLEED.TICKS, moved: false });
  }

  onStep(player) {
    const bleed = this.bleeding.get(player);
    if (!bleed) return;
    bleed.moved = true;
    const location = player.getLocation();
    const tile = { x: location.getX(), y: location.getY(), z: 0 };
    if (!this.objectAt(tile, 22)) {
      this.setObject(BLOOD_FLOOR + Shared.random(0, 2), tile, 22, 0);
      this.later(10, () => this.setObject(-1, tile, 22));
    }
  }

  /** A bleeding player who moved this tick takes one hit, however many tiles they ran. */
  tickBleeding(players) {
    for (const [player, bleed] of [...this.bleeding]) {
      if (!players.includes(player) || bleed.until <= Shared.cycle()) {
        this.bleeding.delete(player);
        continue;
      }
      if (!bleed.moved) continue;
      bleed.moved = false;
      Shared.damage(player, Shared.random(this.maxHit(BLEED.MOVING_MIN), this.maxHit(BLEED.MOVING_MAX)));
    }
  }

  // -------------------------------------------------------------- water

  isSwimming(player) {
    return this.swimmers.has(player);
  }

  startSwimming(player) {
    if (this.swimmers.has(player)) return;
    this.swimmers.set(player, player.isRunningReturn());
    player.getCombat().reset();
    player.setRenderAnimations(SWIM_ANIMATIONS);
    player.getUpdateFlag().flag(Shared.core().Flag.APPEARANCE);
  }

  stopSwimming(player) {
    if (!this.swimmers.has(player)) return;
    const wasRunning = this.swimmers.get(player);
    this.swimmers.delete(player);
    player.setRenderAnimations(null);
    player.getUpdateFlag().flag(Shared.core().Flag.APPEARANCE);
    if (wasRunning && !player.isRunningReturn()) {
      player.setRunning(true);
      player.getPacketSender().sendRunStatus();
    }
  }

  /** Swimmers can only walk. */
  tickPlayer(player) {
    if (!this.swimmers.has(player) || !player.isRunningReturn()) return;
    player.setRunning(false);
    player.getPacketSender().sendRunStatus();
  }

  climbOut(player, rock) {
    if (!this.isSwimming(player)) {
      player.sendMessage("The eyes looking at you from below the surface make you reconsider going down there.");
      return;
    }
    // The steps face the island: walk up them onto its first free tile.
    const step = rock.y < MIDDLE.y ? 1 : -1;
    let landing = Shared.loc({ x: rock.x, y: rock.y + step }, 0);
    for (let i = 2; i <= 3 && !Shared.floorFree(this.area, landing); i++) landing = Shared.loc({ x: rock.x, y: rock.y + step * i }, 0);
    this.stopSwimming(player);
    player.moveTo(landing);
    player.sendMessage("You use the steps to get yourself back onto the island.");
  }

  /** One step toward a tile, never out of the water (a route could cross the island). */
  swimToward(crocodile, tile) {
    const location = crocodile.getLocation();
    const dx = Math.sign(tile.x - location.getX());
    const dy = Math.sign(tile.y - location.getY());
    for (const [sx, sy] of [[dx, dy], [dx, 0], [0, dy]]) {
      if (sx === 0 && sy === 0) continue;
      const next = location.transform(sx, sy);
      if (!isWater(next) || !Shared.floorFree(this.area, next)) continue;
      const movement = crocodile.getMovementQueue();
      movement.reset();
      movement.addSteps(next);
      return;
    }
  }

  spawnCrocodiles() {
    const { NpcIdentifiers } = Shared.core();
    for (const tile of WATER_CROC_TILES) {
      const crocodile = this.spawn(NpcIdentifiers.CROCODILE_7, { ...tile, z: 0 }, { scale: false, points: 0 });
      if (!crocodile) continue;
      crocodile.__toaScripted = true;
      crocodile.__toaCroc = { home: { ...tile }, nextBite: 0 };
      crocodile.setUntargetable(true);
      this.crocodiles.push(crocodile);
    }
  }

  /** Crocodiles drift about until someone is swimming, then go for the nearest swimmer. */
  tickCrocodiles(players) {
    const { Animation } = Shared.core();
    const swimmers = players.filter((player) => this.swimmers.has(player));
    for (const crocodile of this.crocodiles) {
      const state = crocodile.__toaCroc;
      const location = crocodile.getLocation();
      const prey = swimmers
        .filter((player) => player.getLocation().getDistance(location) < CROC_HUNT_RANGE)
        .sort((a, b) => a.getLocation().getDistance(location) - b.getLocation().getDistance(location))[0];
      if (!prey) {
        if (Shared.random(0, 7) === 0) {
          this.swimToward(crocodile, { x: state.home.x + Shared.random(-4, 4), y: state.home.y + Shared.random(-4, 4) });
        }
        continue;
      }
      crocodile.setPositionToFace(prey.getLocation());
      if (!withinReach(crocodile, prey)) {
        this.swimToward(crocodile, { x: prey.getLocation().getX(), y: prey.getLocation().getY() });
        continue;
      }
      if (state.nextBite > Shared.cycle()) continue;
      state.nextBite = Shared.cycle() + CROC_BITE_TICKS;
      crocodile.performAnimation(new Animation(ANIMATION.CROC_BITE));
      this.strike(crocodile, prey, null, "melee", CROC_MAX_HIT, 1);
    }
  }

  // -------------------------------------------------------------- boulders, jugs and scream

  freeTiles(min, max, exclude = []) {
    const tiles = [];
    for (let x = min.x; x <= max.x; x++) {
      for (let y = min.y; y <= max.y; y++) {
        if (exclude.some((tile) => tile.x === x && tile.y === y)) continue;
        if (this.objectAt({ x, y, z: 0 }, 10) || !Shared.floorFree(this.area, Shared.loc({ x, y }, 0)) || this.poison.has(key(x, y))) continue;
        tiles.push({ x, y });
      }
    }
    return Shared.shuffle(tiles);
  }

  /**
   * Boulders and jugs rain down, then he screams three times; only those behind a boulder stay
   * put. His next attack comes 10 ticks on and then as usual; the scream holds it 11 (OpenRune).
   */
  boulderSpecial() {
    const { Animation } = Shared.core();
    this.busy = true;
    this.attackTicks = 10;
    this.zebak.performAnimation(new Animation(ANIMATION.SHOOT));
    this.tail.performAnimation(new Animation(ANIMATION.TAIL_SHOOT));
    this.roaring = false;
    this.later(1, () => {
      this.roaring = this.throwBoulders();
      if (!this.roaring) this.busy = false;
    });
    this.later(33, () => {
      if (!this.roaring) return;
      this.zebak.performAnimation(new Animation(ANIMATION.SCREAM));
      this.tail.performAnimation(new Animation(ANIMATION.TAIL_SCREAM));
      this.attackTicks = Math.max(this.attackTicks, 11);
    });
    [36, 38, 40].forEach((tick, index) => this.later(tick, () => {
      if (this.roaring) this.scream(index === 0);
    }));
    this.later(58, () => {
      if (!this.roaring) return;
      this.roaring = false;
      for (const boulder of this.boulders) this.removeBoulder(boulder);
      this.boulders = [];
      this.busy = false;
    });
  }

  /** Throws the rocks, jugs and acid; false when there's no room for the rocks. */
  throwBoulders() {
    const { NpcIdentifiers } = Shared.core();
    const boulders = this.pickBoulders();
    if (!boulders) return false;
    const jugs = this.pickJugs(boulders);
    const pools = this.freeTiles(GROUND_MIN, GROUND_MAX, boulders).slice(0, 6);
    const boulderPools = boulders.map((tile) => ({ x: tile.x + 2, y: tile.y })).filter((tile) => !pools.some((pool) => pool.x === tile.x && pool.y === tile.y));
    const from = Shared.loc(PROJECTILE_START);
    for (const player of this.challengePlayers()) Shared.sound(player, SOUND.JUGS);
    for (const tile of pools) Shared.tileProjectile(this.area, from, Shared.loc(tile, 0), PROJECTILE.POISON, { delay: 30, duration: 120, startHeight: 62 });
    for (const tile of boulderPools) Shared.tileProjectile(this.area, from, Shared.loc(tile, 0), PROJECTILE.POISON_BOULDER, { delay: 30, duration: 120, startHeight: 62 });
    for (const tile of boulders) Shared.tileProjectile(this.area, from, Shared.loc(tile, 0), PROJECTILE.BOULDER, { delay: 30, duration: 120, startHeight: 62 });
    for (const tile of jugs) Shared.tileProjectile(this.area, from, Shared.loc(tile, 0), PROJECTILE.JUG, { delay: 30, duration: 120, startHeight: 62 });
    this.later(5, () => {
      for (const tile of boulders) {
        const boulder = this.spawn(NpcIdentifiers.COL_00FFFF_BOULDER_COL_4, { ...tile, z: 0 }, { scale: false, points: 0 });
        if (!boulder) continue;
        boulder.__toaScripted = true;
        boulder.__toaRock = true;
        boulder.setUntargetable(true);
        boulder.getMovementQueue().setBlockMovement(true);
        boulder.setMaxHitpoints(ROCK.HITPOINTS);
        boulder.setHitpoints(ROCK.HITPOINTS);
        this.removePoison(key(tile.x, tile.y));
        this.setObject(BOULDER_BLOCK, { ...tile, z: 0 }, 10, 0);
        this.boulders.push(boulder);
        for (const player of this.challengePlayers()) {
          if (player.getLocation().getX() === tile.x && player.getLocation().getY() === tile.y) {
            Shared.damage(player, Shared.random(2, 5));
            this.nudgeOff(player);
          }
        }
      }
      for (const tile of boulderPools) this.addPoison(tile, true, true);
      for (const tile of pools) this.addPoison(tile, true, false);
      this.spawnJugs(jugs);
    });
    return true;
  }

  /** One roar wave: those not sheltered are pushed, each rock takes 50, the first chips the jugs. */
  scream(first) {
    for (let x = GROUND_MIN.x; x <= GROUND_MAX.x; x++) {
      for (let y = GROUND_MIN.y; y <= GROUND_MAX.y; y++) {
        if (this.sheltered(x, y) || this.objectAt({ x, y, z: 0 }, 10)) continue;
        this.graphic(GRAPHIC.ROAR, { x, y }, { delay: 1 + Math.max(Math.abs(x - MIDDLE.x), Math.abs(y - MIDDLE.y)) });
      }
    }
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (this.isSwimming(player) || this.sheltered(location.getX(), location.getY())) continue;
      this.push(player, 1, 0, 2, MAX_HIT.SCREAM);
    }
    for (const boulder of [...this.boulders]) Shared.damage(boulder, ROCK.ROAR_DAMAGE);
    if (first) for (const jug of this.jugs) jug.setHitpoints(Math.max(0, jug.getHitpoints() - 5));
  }

  /** The three tiles east of a boulder are out of the scream. */
  sheltered(x, y) {
    return this.boulders.some((boulder) => {
      const location = boulder.getLocation();
      return y === location.getY() && x > location.getX() && x <= location.getX() + 3;
    });
  }

  removeBoulder(boulder) {
    const location = boulder.getLocation();
    this.setObject(-1, { x: location.getX(), y: location.getY(), z: 0 }, 10);
    this.despawn(boulder);
  }

  pickBoulders() {
    const free = this.freeTiles(BOULDER_MIN, BOULDER_MAX);
    if (free.length === 0) return null;
    const base = free[0];
    const has = (x, y) => free.some((tile) => tile.x === x && tile.y === y);
    const picks = [];
    for (let dy = -6; dy <= 6; dy++) {
      const row = [];
      for (let dx = -3; dx <= 3; dx++) {
        const x = base.x + dx;
        const y = base.y + dy;
        if (has(x, y) && has(x + 1, y)) row.push({ x, y });
      }
      if (row.length > 0) picks.push(Shared.randomOf(row));
    }
    if (picks.length === 0) return null;
    return Shared.shuffle(picks).slice(0, this.teamSize > 1 ? 2 : 3);
  }

  /** Jugs that can be pushed into a boulder (one per boulder), padded with a few random ones. */
  /** Jugs that can be pushed into a rock, then as many decoys at most, never on the floor's edge (OpenRune). */
  pickJugs(boulders) {
    const free = this.freeTiles(GROUND_MIN, GROUND_MAX, boulders)
      .filter((tile) => tile.x !== GROUND_MIN.x && tile.x !== GROUND_MAX.x && tile.y !== GROUND_MIN.y && tile.y !== GROUND_MAX.y);
    const useful = [];
    const others = [];
    for (const tile of free) {
      const lines = boulders.some((boulder) => {
        const dx = boulder.x - tile.x;
        const dy = boulder.y - tile.y;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return false;
        if ((dx === 0 || dx > 0) && dy === 0) return false;
        if (Math.abs(dy) < 2 && dx > -4 && dx < 0) return false;
        return Math.abs(Math.abs(dy) - Math.abs(dx)) < 2 || (dx >= -2 && dx <= 0) || Math.abs(dy) <= 1;
      });
      (lines ? useful : others).push(tile);
    }
    const jugs = useful.slice(0, boulders.length);
    return jugs.concat(others.slice(0, Math.min(jugs.length, Math.max(0, Shared.random(6, 8) - jugs.length))));
  }

  spawnJugs(tiles) {
    const { NpcIdentifiers } = Shared.core();
    for (const tile of tiles) {
      const jug = this.spawn(NpcIdentifiers.COL_00FFFF_JUG_COL, { ...tile, z: 0 }, { scale: false, points: 0, inert: true });
      if (!jug) continue;
      jug.__toaScripted = true;
      jug.__toaJug = { direction: null };
      jug.canWalkThroughNPCs = () => true;
      this.jugs.add(jug);
      this.graphic(GRAPHIC.ROAR, tile);
      for (const player of this.challengePlayers()) {
        if (player.getLocation().getX() === tile.x && player.getLocation().getY() === tile.y) Shared.damage(player, Shared.random(2, 5));
      }
    }
  }

  /** Push or pull a jug; it rolls until it hits a boulder (and shatters) or falls in the water. */
  moveJug(player, jug, push) {
    const { NpcIdentifiers, Animation } = Shared.core();
    const state = jug.__toaJug;
    if (!state || state.direction) return;
    const from = player.getLocation();
    const at = jug.getLocation();
    const dx = Math.sign(push ? at.getX() - from.getX() : from.getX() - at.getX());
    const dy = Math.sign(push ? at.getY() - from.getY() : from.getY() - at.getY());
    if (dx === 0 && dy === 0) return;
    state.direction = [dx, dy];
    state.left = JUG_ROLL_TILES;
    jug.setNpcTransformationId(NpcIdentifiers.COL_00FFFF_JUG_COL_2);
    player.performAnimation(new Animation(ANIMATION.JUG_MOVE));
  }

  tickJugs() {
    for (const jug of [...this.jugs]) {
      if (jug.getHitpoints() <= 0) {
        this.breakJug(jug);
        continue;
      }
      const state = jug.__toaJug;
      const direction = state.direction;
      if (!direction) continue;
      if (state.left !== undefined && state.left <= 0) {
        // A pushed jug stops after 8 tiles; one a wave carries keeps going.
        state.direction = null;
        state.left = undefined;
        jug.setNpcTransformationId(-1);
        continue;
      }
      const next = jug.getLocation().transform(direction[0], direction[1]);
      if (this.boulders.some((boulder) => boulder.getLocation().getX() === next.getX() && boulder.getLocation().getY() === next.getY())) {
        this.breakJug(jug);
        continue;
      }
      if (!Shared.floorFree(this.area, next)) {
        this.graphic(GRAPHIC.SPLASH, { x: next.getX(), y: next.getY() });
        this.jugs.delete(jug);
        this.despawn(jug);
        continue;
      }
      Shared.walkStraight(jug, next);
      if (state.left !== undefined) state.left--;
    }
  }

  /** A broken jug washes away the poison around it. */
  breakJug(jug) {
    if (!this.jugs.has(jug)) return;
    this.jugs.delete(jug);
    const location = jug.getLocation();
    this.graphic(GRAPHIC.JUG_BREAK, { x: location.getX(), y: location.getY() });
    const range = this.upsetStomach ? 1 : 2;
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        const tileKey = key(location.getX() + dx, location.getY() + dy);
        if (!this.poison.has(tileKey)) continue;
        Shared.tileProjectile(this.area, location, Shared.loc({ x: location.getX() + dx, y: location.getY() + dy }, 0), PROJECTILE.JUG_SPREAD, { duration: 10, startHeight: 7 });
        this.later(1, () => {
          this.removePoison(tileKey);
          this.graphic(GRAPHIC.POISON_GONE, { x: location.getX() + dx, y: location.getY() + dy });
        });
      }
    }
    this.despawn(jug);
  }

  // -------------------------------------------------------------- waves

  /** Three waves sweep the arena from one side, each with a gap or two to stand in. */
  /**
   * Waves: jugs and acid at tick 1, the tail slam at 5, rocks falling (and the camera shaking)
   * at 7, rows at 14, 21 and 28, done at 45. His next attack comes 15 ticks on (OpenRune).
   */
  waveSpecial() {
    const { Animation } = Shared.core();
    this.busy = true;
    this.attackTicks = 15;
    this.zebak.performAnimation(new Animation(ANIMATION.SHOOT));
    this.tail.performAnimation(new Animation(ANIMATION.TAIL_SHOOT));
    const jugs = this.freeTiles(GROUND_MIN, GROUND_MAX).slice(0, Shared.random(6, 8));
    const pools = this.freeTiles(GROUND_MIN, GROUND_MAX, jugs).slice(0, 16);
    const from = Shared.loc(PROJECTILE_START);
    this.later(1, () => {
      for (const tile of pools) Shared.tileProjectile(this.area, from, Shared.loc(tile, 0), PROJECTILE.POISON, { delay: 30, duration: 120, startHeight: 62 });
      for (const tile of jugs) Shared.tileProjectile(this.area, from, Shared.loc(tile, 0), PROJECTILE.JUG, { delay: 30, duration: 120, startHeight: 62 });
    });
    const south = this.wavesSouth;
    this.later(5, () => {
      this.zebak.performAnimation(new Animation(ANIMATION.CALL_WAVE));
      this.tail.performAnimation(new Animation(ANIMATION.TAIL_CALL_WAVE));
    });
    this.later(6, () => {
      for (const tile of pools) this.addPoison(tile, true, false);
      this.spawnJugs(jugs);
    });
    this.later(7, () => {
      const base = south ? WAVE_SOUTH : WAVE_NORTH;
      for (let x = 0; x < 7; x++) {
        this.graphic(GRAPHIC.SPLASH, { x: base.x + x * 3, y: base.y }, { delay: 200 });
        this.graphic(GRAPHIC.ROCKS, { x: base.x + x * 3, y: base.y });
      }
      for (const player of this.challengePlayers()) Shared.sound(player, SOUND.RUMBLING);
      this.shakeCameras(SHAKE.WAVES);
    });
    let skip = -1;
    const holes = 3 - Math.min(2, Math.floor(this.pathLevel() / 2));
    for (const tick of [14, 21, 28]) {
      this.later(tick, () => {
        const gap = skip === -1 ? Shared.random(0, 12) : 12 - skip;
        this.spawnWave(south, gap, holes);
        skip = skip === -1 ? gap : -1;
      });
    }
    this.later(45, () => {
      this.busy = false;
      this.wavesSouth = !this.wavesSouth;
    });
  }

  spawnWave(south, gap, holes) {
    const { NpcIdentifiers } = Shared.core();
    const base = south ? WAVE_SOUTH : WAVE_NORTH;
    for (let x = 0; x < 21; x++) {
      if (x >= 4) {
        let open = false;
        for (let hole = 0; hole < holes; hole++) {
          if (x - 4 === gap + (gap < 6 ? hole : -hole)) open = true;
        }
        if (open) continue;
      }
      const wave = this.spawn(NpcIdentifiers.COL_00FFFF_WAVE_COL, { x: base.x + x, y: base.y, z: 0 }, { scale: false, points: 0 });
      if (!wave) continue;
      wave.__toaScripted = true;
      wave.__toaWave = { north: south, tiles: 23 };
      wave.setUntargetable(true);
      wave.canWalkThroughNPCs = () => true;
      this.waves.add(wave);
    }
  }

  /** Waves push players, carry jugs, wash away some poison and smother blood clouds. */
  tickWaves(players) {
    const { NpcIdentifiers } = Shared.core();
    for (const wave of [...this.waves]) {
      const state = wave.__toaWave;
      if (--state.tiles <= 0) {
        this.waves.delete(wave);
        this.despawn(wave);
        continue;
      }
      const location = wave.getLocation();
      const step = state.north ? 1 : -1;
      for (const player of players) {
        if (player.getLocation().equals(location) && !this.isSwimming(player)) this.push(player, 0, step, 4, MAX_HIT.WAVE);
      }
      for (const jug of this.jugs) {
        if (jug.getLocation().getX() === location.getX() && jug.getLocation().getY() === location.getY() + step * 2 && !jug.__toaJug.direction) {
          jug.__toaJug.direction = [0, step];
          jug.__toaJug.left = undefined;
          jug.setNpcTransformationId(NpcIdentifiers.COL_00FFFF_JUG_COL_2);
        }
      }
      const here = key(location.getX(), location.getY());
      if (this.poison.has(here) && Shared.random(0, 3) === 0) this.removePoison(here);
      for (const cloud of [...this.clouds]) {
        if (!cloud.getLocation().equals(location)) continue;
        this.clouds.delete(cloud);
        this.despawn(cloud);
        wave.setNpcTransformationId(NpcIdentifiers.COL_00FFFF_BLOODY_WAVE_COL);
      }
      Shared.walkStraight(wave, location.transform(0, step));
    }
  }

  /** Pushed up to `distance` tiles as far as the floor allows, taking the hit. */
  push(player, dx, dy, distance, baseDamage) {
    const { Animation } = Shared.core();
    const location = player.getLocation();
    let moved = 0;
    while (moved < distance && Shared.floorFree(this.area, location.transform(dx * (moved + 1), dy * (moved + 1)))) moved++;
    // A wave that runs out of floor throws the player over the edge into the water.
    let intoWater = false;
    if (baseDamage === MAX_HIT.WAVE && moved < distance) {
      const water = location.transform(dx * WATER_JUMP, dy * WATER_JUMP);
      if (isWater(water) && Shared.floorFree(this.area, water)) {
        moved = WATER_JUMP;
        intoWater = true;
      }
    }
    if (moved > 0) Shared.knockback(player, dx * moved, dy * moved, { ticks: 1, speed: 30 });
    if (intoWater) this.startSwimming(player);
    else player.getMovementQueue().reset();
    player.performAnimation(new Animation(ANIMATION.PUSHED));
    Shared.sound(player, baseDamage === MAX_HIT.SCREAM ? SOUND.PUSHED : SOUND.WAVE_HIT);
    const damage = this.maxHit(baseDamage);
    if (baseDamage === MAX_HIT.WAVE) Shared.damage(player, Shared.random(this.maxHit(WAVE_MIN_HIT), damage));
    else Shared.damage(player, Shared.random(damage, damage + 10));
  }

  nudgeOff(player) {
    const location = player.getLocation();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const tile = location.transform(dx, dy);
        if (!Shared.floorFree(this.area, tile)) continue;
        player.performAnimation(new (Shared.core().Animation)(ANIMATION.SLIDE));
        Shared.knockback(player, dx, dy, { ticks: 1, speed: 30 });
        return;
      }
    }
  }

  died() {
    const { Animation, NpcIdentifiers } = Shared.core();
    this.zebak.setHitpoints(1);
    this.zebak.setUntargetable(true);
    this.zebak.performAnimation(new Animation(ANIMATION.DEATH));
    this.tail.performAnimation(new Animation(ANIMATION.TAIL_DEATH));
    this.complete();
    Shared.later(this.taskKey, SHAKE.DEATH.delay, () => this.shakeCameras(SHAKE.DEATH));
    Shared.later(this.taskKey, 3, () => {
      if (this.destroyed) return;
      this.zebak.setNpcTransformationId(NpcIdentifiers.ZEBAK_4);
      this.tail.setNpcTransformationId(NpcIdentifiers.ZEBAKS_TAIL_2);
    });
  }

  /** Shakes everyone's camera on each axis, then puts it back a few ticks later. */
  shakeCameras({ axes, resetAfter }) {
    const players = this.roomPlayers();
    const rolled = axes.map(([slot, amplitude]) => [slot, Array.isArray(amplitude) ? Shared.random(amplitude[0], amplitude[1]) : amplitude]);
    for (const player of players) {
      for (const [slot, amplitude] of rolled) player.getPacketSender().sendCameraShake(slot, amplitude);
    }
    Shared.later(this.taskKey, resetAfter, () => {
      for (const player of players) player.getPacketSender().sendCameraReset();
    });
  }

  graphic(id, tile, options = {}) {
    const viewer = this.roomPlayers()[0];
    if (viewer) Shared.graphicAt(viewer, id, Shared.loc({ x: tile.x, y: tile.y, z: 0 }), options);
  }
}

function key(x, y) {
  return `${x},${y}`;
}

function withinReach(npc, player) {
  const size = npc.getSize?.() ?? 1;
  const location = npc.getLocation();
  const target = player.getLocation();
  const dx = target.getX() < location.getX() ? location.getX() - target.getX() : Math.max(0, target.getX() - (location.getX() + size - 1));
  const dy = target.getY() < location.getY() ? location.getY() - target.getY() : Math.max(0, target.getY() - (location.getY() + size - 1));
  return Math.max(dx, dy) <= 1 && !(dx === 1 && dy === 1);
}

/** North and south of the island's floor is the water. */
function isWater(location) {
  return location.getY() < GROUND_MIN.y || location.getY() > GROUND_MAX.y;
}

function zebakRoom(npc) {
  const room = npc?.__toaRoom;
  return room instanceof ZebakRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ hooks

function afterZebakHit(event) {
  const room = zebakRoom(event.target);
  if (room && event.target.__toaZebak) room.checkPhases();
}

function zebakDowned(event) {
  const room = zebakRoom(event.npc);
  if (!room) return;
  if (event.npc.__toaZebak) {
    event.preventDeath = true;
    room.died();
  } else if (event.npc.__toaJug) {
    event.preventDeath = true;
    room.breakJug(event.npc);
  } else if (event.npc.__toaRock) {
    // A rock worn down by the roar crumbles (Wiki: 150 HP, 50 a wave).
    event.preventDeath = true;
    room.removeBoulder(event.npc);
    room.boulders = room.boulders.filter((boulder) => boulder !== event.npc);
  }
}

/** Jugs shatter at the first blow from a player. */
function jugStruck(event) {
  const room = zebakRoom(event.npc);
  if (!room || !event.npc.__toaJug) return;
  if (event.hit.getAttacker?.()?.isPlayer?.()) {
    for (const hit of event.hit.getHits()) hit.setDamage(0);
    event.hit.updateTotalDamage();
    // It shatters the tick after the blow (OpenRune).
    event.npc.__toaJug.direction = null;
    room.later(1, () => room.breakJug(event.npc));
  }
}

function pushJug(event) {
  const room = zebakRoom(event.npc);
  if (!room || !event.npc.__toaJug) return false;
  room.moveJug(event.player, event.npc, true);
  return true;
}

function pullJug(event) {
  const room = zebakRoom(event.npc);
  if (!room || !event.npc.__toaJug) return false;
  room.moveJug(event.player, event.npc, false);
  return true;
}

function hitJug(event) {
  if (!zebakRoom(event.npc) || !event.npc.__toaJug) return false;
  event.player.getCombat().attack(event.npc);
  return true;
}

/** Swimmers can't attack. */
function swimmerCantAttack(event) {
  const room = event.attacker?.isPlayer?.() ? Raid.roomOf(event.attacker) : null;
  if (room instanceof ZebakRoom && room.isSwimming(event.attacker)) event.allow = false;
}

function climbRockSteps(event) {
  const room = Raid.roomOf(event.player);
  if (!(room instanceof ZebakRoom) || room.destroyed) return false;
  room.climbOut(event.player, event.location);
  return true;
}

module.exports = function registerZebak(api) {
  Shared.bind(api);
  Raid.registerRoom("CRONDIS_BOSS", ZebakRoom);
  api.onPlayerDealtDamage(afterZebakHit);
  api.onNpcBeforeDeath(zebakDowned);
  api.onNpcHitModify(jugStruck);
  api.onNpcInteraction("<col=00ffff>Jug</col>", { Push: pushJug, Pull: pullJug, Hit: hitJug });
  Raid.onRaidArea("canAttack", swimmerCantAttack);
  Shared.onObject(api, ROCK_STEPS, climbRockSteps);
};
