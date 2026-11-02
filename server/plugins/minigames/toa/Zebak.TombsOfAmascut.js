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
 * Captured (ticks are offsets from the attack "T"; 44 fights, revs 223-235):
 * - First attack 10 after the start (44 of 44). Speed 7 at path 0-1, 6 at 2-3, 5 at 4+; enraged 4,
 *   3, 2 (gaps in 44 fights: 223/00014, 227/00554 tick 12290 path 5, 227/01757 tick 24326 path 4).
 * - Volley: launch at T with 5823/5819 and 5878/5896 delayed 120; burst at T+4 on the helper
 *   (11744, 3 ticks, height 750) with 5884 delayed 90; fragments 90 cycles; the hit at T+8 (223/00014
 *   ticks 361-369, 234/03280, 235/03431).
 * - Enraged: seq 9626/9627 and rising 2177/2179 (227 on; 223/00014 still shows 9624/2178).
 * - Bite: 9620/9621, the hit at T+1 (227/01838 tick 420 and three more).
 * - Acid: the hitsplat is poison's (65), "You have been poisoned!" with it. It ramps: 5-16 at first,
 *   up to 29 in a few ticks at the damage cap, 6, 4, 7 at raid level 310 (227/00553 tick 10020).
 * - Tidal waves (223/00014 T=390): seq 9624 alone at T, throws at T+1 with 5908, tail slam T+5, jugs
 *   and pools T+6, rock falls with shake, pillars, sounds T+7, rows T+14/21/28 of 21 tiles at 1 a tick,
 *   25 ticks each, next attack T+15. Always south first (35 of 35). The gap: 3 tiles at path 0-1, 2 at
 *   2-3, 1 at 4+ (all 44; 227/01757 tick 24326), rolled for each row. A hit pushes 3 tiles (18 samples),
 *   or from the edge into the water, always landing on y 5420 / 5396 (227/01852 tick 22050).
 * - Great Roar (223/00014 T=437): throws at T+1, first rock T+5, the rest with jugs and pools T+6,
 *   autos at T+10, 9628/9629 with 5860 at T+33, dust at T+36/38/40, hits a tick later: rocks 50, and
 *   the first breaks every jug; rocks go at T+42 (7717) and T+45 (2191).
 * - Jugs and pools land on fixed tiles for each iteration (ROAR_FIRST etc: 37, 7, 35 and 5 specials),
 *   with 2 or 3 rocks in the first roar's chain (x 3927-3929, y 5405-5411, north by 1, wrapping) and
 *   the second's (x 3932-3934, y 5403-5413, south by 1-2). A pushed jug rolls 11 tiles (45 rolls).
 *   A broken jug throws 2193 over its whole area from a helper (11745) and clears a tick later.
 * - Blood: 377 on two tiles at S, the barrage or clouds at S+3, its hit S+4 and his heal at S+3. S first
 *   comes at about 77 (77-89, path 3), then every 45 (39-45), enraged 8 attacks.
 * - Clouds spawn around (3933, 5415) or (3933, 5401) on the sides (14 tiles over 13 raids).
 * - Water crocodiles' spawns (227/01759 tick 510). Death: 9634, shake at +2, then dead forms and
 *   "Challenge complete" at +4 (235/03431 ticks 195-199).
 * Wiki (numbers):
 * - Max hits 38 melee, 16 magic and ranged, 6-10 a wave, all scaled. Rock 150 HP, 50 a roar wave; jug 5x5
 *   (3x3 Upset Stomach), acid 3x3 (5x5); Defence drains at most 20; a queued special is dropped on enrage.
 * - Clouds lose 2 for each tile moved, drain 2 a tick. Three with Blood Thinners.
 * - Barrage 8-11, always hits unless prayed against. He heals ~66% of it (invocations table), 2x with
 *   Arterial Spray (strategies; captures show 12 -> 23, 10 -> 19, 7 -> 13).
 * Estimates:
 * - The acid's ramp: 2-6 on the first tick, 2-11.7 after, remembered for 30 ticks without a hit (fit:
 *   about 130 hits at raid levels 500-555; 8 at lower levels agree; gaps of 2-20 ticks keep it high,
 *   40+ don't).
 * - Blood timing is a fit from 13 raids, Arterial's radius 2 and its 2x reading a guess at two Wiki lines.
 * - The size 2 cloud's spawn: no capture has Not Just a Head without Blood Thinners.
 * - Failure wording for waves, clouds and jugs in Perfect Zebak: no capture.
 * - How a wave's "smarter" pushback (June 2025) differs: no recording in current revs has a push.
 * Still only from OpenRune: the bite's half through prayer, bleeding (1 in 4; 5-10; 1-8 a tick moving;
 * 10 ticks), the scream's hit, and the water crocodiles' bites (max 8, every 2 ticks).
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");

const SPAWN = { x: 3918, y: 5404, z: 0 };
const TAIL_SPAWN = { x: 3909, y: 5403, z: 0 };
const GROUND_MIN = { x: 3926, y: 5398 };
const GROUND_MAX = { x: 3942, y: 5418 };
const MIDDLE = { x: 3926, y: 5408 };
const PROJECTILE_START = { x: 3925, y: 5408 };
const PROJECTILE_SPLIT = { x: 3933, y: 5408 };
const WAVE_SOUTH = { x: 3923, y: 5397 };
const WAVE_NORTH = { x: 3923, y: 5419 };
const BLOOD_SPELL_TILES = [{ x: 3924, y: 5406 }, { x: 3925, y: 5410 }];
/** Blood clouds spawn around these on either side (three random tiles of the 3x3; 13 raids). */
const BLOOD_CLOUD_CENTRES = [{ x: 3933, y: 5415 }, { x: 3933, y: 5401 }];
const ZEBAK_HIT_SOUND_TILE = { x: 3922, y: 5408 };
const JUG_SOUND_TILE = { x: 3927, y: 5408 };
/** The volley's burst rides this 7x7 helper, centred on the split point (223/00014 tick 365). */
const SPLIT_HELPER = { id: 11744, tile: { x: 3930, y: 5405 }, ticks: 3 };

/** A jug's break plays on this helper, a tile south-west of it, for 2 ticks (223/00014 tick 111). */
const JUG_BREAK_HELPER = { id: 11745, ticks: 2 };
const PILLARS = [{ x: 3907, y: 5406, face: 2, back: 8 }, { x: 3907, y: 5410, face: 0, back: 6 }];
const PILLAR = { STILL: 45530, SHAKING: 45531 };
const ROCK_GONE = { CRUMBLE: 42, CLEARED: 45, SEQ: 7717 };

const POISON = 45570; // 45570..45575
const BOULDER_BLOCK = 43876;
const BLOOD_FLOOR = 652; // 652..654
const ROCK_STEPS = "Rock steps";

// The water crocodiles' spawns (227/01759 tick 510). In the cache they're bubbles (swampbubs) with
// attack 250 and strength 70: a max hit of 8 before scaling. They bite every 2 ticks (OpenRune).
const WATER_CROC_TILES = [
  { x: 3948, y: 5408 }, { x: 3948, y: 5408 }, { x: 3936, y: 5422 }, { x: 3941, y: 5420 },
  { x: 3921, y: 5418 }, { x: 3936, y: 5395 }, { x: 3938, y: 5395 }, { x: 3919, y: 5403 },
];
const CROC_MAX_HIT = 8;
const CROC_BITE_TICKS = 2;
const CROC_HUNT_RANGE = 16;
/** A wave that runs out of floor throws the player into the water, on these rows (227/01852 tick 22050, 227/01759 tick 637). */
const WATER_ROW = { NORTH: 5420, SOUTH: 5396 };
const WAVE_PUSH_TILES = 3;
const WAVE_LIFE_TICKS = 25;

const ANIMATION = {
  SHOOT: 9624, TAIL_SHOOT: 9625, MELEE: 9620, TAIL_MELEE: 9621, DEATH: 9634, TAIL_DEATH: 9635,
  MELEE_ENRAGED: 9622, TAIL_MELEE_ENRAGED: 9623, SHOOT_ENRAGED: 9626, TAIL_SHOOT_ENRAGED: 9627,
  SCREAM: 9628, TAIL_SCREAM: 9629, CALL_WAVE: 9630, TAIL_CALL_WAVE: 9631, PUSHED: 4177, SLIDE: 1114, JUG_MOVE: 834,
  CROC_BITE: 9804,
};
// Stand, turn, walk, turn around, turn right, turn left, run: human_swim_ready / human_swim.
const SWIM_ANIMATIONS = [773, 772, 772, 772, 772, 772, 772];
const PROJECTILE = {
  POISON: [1555, 2194], BOULDER: 2172, JUG: 2173, MAGIC: 2176, MAGIC_SPLIT: 2181,
  RANGED: 2178, RANGED_SPLIT: 2187, POISON_SPREAD: 2194, JUG_SPREAD: 2193,
  MAGIC_ENRAGED: 2177, RANGED_ENRAGED: 2179,
};
/** Everything he spits (223/00014 tick 391): t30-150 at angle 35; one rock lands a tick sooner. */
const THROW = { delay: 30, duration: 120, perTile: 0, startHeight: 62, angle: 35 };
const THROW_FAST = { ...THROW, duration: 90 };
const POOL_SPREAD_THROW = { duration: 30, perTile: 0, startHeight: 0, angle: 20 };
const JUG_WATER_THROW = { delay: 10, duration: 10, perTile: 0, startHeight: 7, angle: 20 };
const GRAPHIC = {
  MAGIC_BURST: 2186, RANGED_BURST: 2185, // ZEBAK_MAGE_SPLIT, ZEBAK_RANGED_SPLIT
  MAGIC_IMPACT: 131, RANGED_IMPACT: 1103, BLOOD: 377, ROCKS: 2195, SPLASH: 68, ROAR: 2184, JUG_BREAK: 2192, POISON_GONE: 95,
  DUST: 2174, ROCK_BREAK: 2191,
};
const SOUND = {
  MAGIC: 5823, RANGED: 5819, MAGIC_SPLIT: 5878, RANGED_SPLIT: 5896, IMPACT: 5884, FINAL_PHASE: 3405, BARRAGE: 102, JUGS: 5908,
  POISON_LAND: 5909, BOULDER_LAND: 5913, ROAR: 5860, PUSHED: 5888, RUMBLING: 1678, WAVE_HIT: 5868, ZEBAK_HIT: 6590,
};
const SOUND_DELAY = { SPLIT: 120, IMPACT: 90, ROAR: 16, PUSHED: 1, POISON_LAND: 1 };
const SOUND_RADIUS = { ZEBAK_HIT: 14, JUGS: 15, BOULDER_LAND: 5, POISON_LAND: 15 };
/** The falling rocks' sounds [id, delay] (223/00014 tick 397). */
const WAVE_ROCK_SOUNDS = [[1678, 0], [5882, 0], [5843, 200], [5852, 200], [5852, 530], [5852, 920]];

// Where each iteration's jugs and pools land: fixed tiles, plus some pools at random (37, 7, 35 and 5 specials).
const ROAR_JUG_COUNT = [6, 8];
const ROAR_FIRST = {
  jugs: [[3940, 5409], [3939, 5407], [3929, 5403], [3931, 5402], [3938, 5414], [3936, 5406], [3939, 5413], [3939, 5402], [3929, 5414], [3940, 5408]],
  pools: [[3929, 5406], [3929, 5409], [3929, 5412], [3931, 5405], [3931, 5408], [3931, 5411]],
  rocks: { minX: 3927, maxX: 3929, minY: 5405, maxY: 5411 },
};
const ROAR_SECOND = {
  jugs: [[3940, 5406], [3932, 5414], [3940, 5409], [3936, 5414], [3931, 5412], [3937, 5402], [3935, 5401], [3931, 5407]],
  pools: [[3934, 5404], [3934, 5410], [3936, 5403], [3936, 5406], [3936, 5409], [3936, 5412], [3934, 5407], [3934, 5413]],
  rocks: { minX: 3932, maxX: 3934, minY: 5403, maxY: 5413 },
};
const ROAR_EXTRA_POOLS = [2, 10];
const WAVE_JUGS = [[3930, 5408], [3934, 5401], [3931, 5408], [3935, 5402], [3937, 5414]];
const WAVE_POOLS = [
  [[3929, 5404], [3929, 5417], [3935, 5408], [3937, 5405], [3938, 5411], [3939, 5402], [3941, 5413], [3931, 5414], [3932, 5406], [3933, 5411]],
  [[3928, 5403], [3928, 5406], [3928, 5410], [3928, 5416], [3931, 5404], [3937, 5399], [3937, 5402], [3937, 5414], [3937, 5417], [3940, 5404], [3942, 5404]],
];
const WAVE_EXTRA_POOLS = [3, 10];

// Wiki: max hits 38 melee, 16 magic and ranged; a wave hits for 6-10, all scaled by raid level.
const MAX_HIT = { BITE: 38, VOLLEY: 16, SCREAM: 20, WAVE: 10 };
const WAVE_MIN_HIT = 6;
/** The acid before scaling, by hits in the last while (fit, see the header). */
const ACID = { MIN: 2, FIRST_MAX: 6, MAX: 11.7, MEMORY_TICKS: 30 };
/** Wiki: 8-11, healing ~66% of it, or twice it with Arterial Spray. */
const BARRAGE = { MIN: 8, MAX: 11, HEAL: 0.66, HEAL_ARTERIAL: 2, RADIUS: 1, RADIUS_ARTERIAL: 2, EFFECT_TICKS: 3, HIT_TICKS: 1 };
/** Blood spells: the first, then between them, then enraged as attacks at his speed (fit from 13 raids). */
const BLOOD_TIMING = { FIRST: 77, NORMAL: 45, ENRAGED_ATTACKS: 8 };
/** The bite lands the tick after it (4 of 4); Protect from Melee lets half through (OpenRune). */
const BITE = { HIT_TICKS: 1, THROUGH_PRAYER: 0.5 };
const VOLLEY = { SPLIT_TICKS: 4, BURST_HEIGHT: 750, FRAGMENT_CYCLES: 90, HIT_TICKS: 4, RISE_ANGLE: 30, FRAGMENT_ANGLE: 127 };
/** Wiki: each roar wave hits each rock for 50, and a rock has 150. */
const ROCK = { HITPOINTS: 150, ROAR_DAMAGE: 50 };
/** Wiki: his Defence drains by at most 20 (to 50). */
const MAX_DEFENCE_DRAIN = 20;
const FIRST_ATTACK_TICKS = 10;
const JUG_ROLL_TILES = 11;
/** Camera shakes: [slot, random amplitude]; 223/00014 ticks 397 and 503; 235/03431 tick 197. */
const SHAKE = {
  DEATH: { delay: 2, axes: [[0, [3, 5]], [1, [3, 5]], [2, [2, 4]]], resetAfter: 1 },
  WAVES: { axes: [[0, [5, 7]], [1, [5, 7]], [2, [5, 8]]], resetAfter: 2 },
};
const DEATH_FORM_TICKS = 4;
// A bite bleeds 1 time in 4 instead of hitting: 5-10 at once, then 1-8 each tick spent
// moving for 10 ticks (OpenRune; the Wiki only says moving makes it worse).
const BLEED = { CHANCE: 4, TICKS: 10, APPLY_MIN: 5, APPLY_MAX: 10, MOVING_MIN: 1, MOVING_MAX: 8 };
const ZEBAK_POINTS = 1.5;
const INVOCATIONS = ["NOT_JUST_A_HEAD", "ARTERIAL_SPRAY", "BLOOD_THINNERS", "UPSET_STOMACH"];
const TASK = { PERFECT: "Perfect Zebak", MELEE_ONLY: "Chompington", ROCKIN: "Rockin' around the croc", PRAISE: "All Praise Zebak" };
const ROCKIN_PATH_LEVEL = 4;
const PERFECT_JUG_PUSHES = 2;

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
    this.wavesSouth = true;
    this.roarsDone = 0;
    this.wavesDone = 0;
    this.jugPushes = 0;
    this.dying = false;
    this.acidRamp = new Map();
    this.prayerSeen = new Map();
    this.bloodTicks = this.settings.isActive("NOT_JUST_A_HEAD") ? BLOOD_TIMING.FIRST : -1;
    this.spreadBarrage = this.settings.isActive("ARTERIAL_SPRAY");
    this.multipleClouds = this.settings.isActive("BLOOD_THINNERS");
    this.upsetStomach = this.settings.isActive("UPSET_STOMACH");
    this.arterialSpray = this.spreadBarrage;
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
    const survivors = this.deathlessPlayers();
    this.raid.completeTask(TASK.MELEE_ONLY, survivors);
    if (!INVOCATIONS.every((key) => this.settings.isActive(key))) return;
    this.raid.completeTask(TASK.PERFECT);
    if (this.pathLevel() < ROCKIN_PATH_LEVEL) return;
    this.raid.completeTask(TASK.ROCKIN, survivors);
    this.raid.completeTask(TASK.PRAISE, survivors);
  }

  /** For Perfect Zebak: `${name} was hit by ...` the tick after, as 227/00553 tick 10021. */
  failPerfect(player, what) {
    this.later(1, () => this.raid.failTask(TASK.PERFECT, `${Shared.displayName(player)} ${what}`));
  }

  soundAll(id, delay = 0) {
    for (const player of this.challengePlayers()) Shared.sound(player, id, delay);
  }

  areaSound(id, tile, delay, radius) {
    for (const player of this.roomPlayers()) player.getPacketSender().sendAreaSound(id, tile.x, tile.y, 0, 1, delay, radius);
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
    if (this.pillarsShaken) {
      for (const pillar of PILLARS) this.setObject(PILLAR.STILL, { x: pillar.x, y: pillar.y, z: 0 }, 10, pillar.face);
      this.pillarsShaken = false;
    }
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
      this.soundAll(SOUND.FINAL_PHASE);
    }
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (!this.isStarted() || !this.zebak || this.zebak.getHitpoints() <= 0 || this.dying) return;
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
      this.bloodTicks = this.lastPhase ? this.attackSpeed * BLOOD_TIMING.ENRAGED_ATTACKS : BLOOD_TIMING.NORMAL;
      this.bloodSpell();
    }
    if (--this.attackTicks > 0) return;
    this.attackTicks = this.attackSpeed;
    // A special takes his attack's turn; his autos carry on while it plays out (223/00014: T+10, T+15).
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
          else this.basicHit(player, "melee", MAX_HIT.BITE, { prayerMultiplier: BITE.THROUGH_PRAYER });
        }
      });
      return;
    }
    const magic = this.useMagic;
    this.zebak.performAnimation(new Animation(enraged ? ANIMATION.SHOOT_ENRAGED : ANIMATION.SHOOT));
    this.tail.performAnimation(new Animation(enraged ? ANIMATION.TAIL_SHOOT_ENRAGED : ANIMATION.TAIL_SHOOT));
    this.soundAll(magic ? SOUND.MAGIC : SOUND.RANGED);
    this.soundAll(magic ? SOUND.MAGIC_SPLIT : SOUND.RANGED_SPLIT, SOUND_DELAY.SPLIT);
    // The volley rises for 120 client cycles whatever the distance and bursts where it peaks,
    // four ticks in; its fragments take 90 cycles to land, so the hit comes three ticks after.
    const rising = enraged ? (magic ? PROJECTILE.MAGIC_ENRAGED : PROJECTILE.RANGED_ENRAGED) : (magic ? PROJECTILE.MAGIC : PROJECTILE.RANGED);
    Shared.tileProjectile(this.area, Shared.loc(PROJECTILE_START), Shared.loc(PROJECTILE_SPLIT), rising,
      { delay: 60, duration: 60, perTile: 0, startHeight: 50, endHeight: 175, angle: VOLLEY.RISE_ANGLE });
    this.later(VOLLEY.SPLIT_TICKS, () => {
      this.burst(magic ? GRAPHIC.MAGIC_BURST : GRAPHIC.RANGED_BURST);
      this.soundAll(SOUND.IMPACT, SOUND_DELAY.IMPACT);
      for (const player of this.challengePlayers()) {
        Shared.tileProjectile(this.area, Shared.loc(PROJECTILE_SPLIT), player, magic ? PROJECTILE.MAGIC_SPLIT : PROJECTILE.RANGED_SPLIT,
          { duration: VOLLEY.FRAGMENT_CYCLES, perTile: 0, startHeight: 175, endHeight: 22, angle: VOLLEY.FRAGMENT_ANGLE });
        player.performGraphic(Shared.gfx(magic ? GRAPHIC.MAGIC_IMPACT : GRAPHIC.RANGED_IMPACT, { delay: VOLLEY.FRAGMENT_CYCLES, height: 90 }));
      }
      this.later(VOLLEY.HIT_TICKS, () => {
        const style = magic ? "magic" : "ranged";
        for (const player of this.challengePlayers()) this.basicHit(player, style, MAX_HIT.VOLLEY);
      });
    });
  }

  /** A basic attack lands; one that goes through off-prayer costs Perfect Zebak. */
  basicHit(player, style, maxHit, options) {
    const hit = this.strike(this.zebak, player, null, style, maxHit, 0, options);
    if (hit.getTotalDamage() > 0 && !Shared.isProtected(player, style)) this.failPerfect(player, `didn't pray against a ${style} attack.`);
    return hit;
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
    this.later(BARRAGE.EFFECT_TICKS, () => {
      const players = this.challengePlayers();
      if (players.length === 0) return;
      if (this.barrageNext) this.bloodBarrage(players);
      else this.bloodClouds();
      this.barrageNext = !this.barrageNext;
    });
  }

  /**
   * Blood barrage on everyone (and those next to them, a hit for each neighbour). It always hits
   * unless prayed against (Wiki); he heals as it goes out and the hit lands the tick after.
   */
  bloodBarrage(players) {
    let heal = 0;
    const radius = this.arterialSpray ? BARRAGE.RADIUS_ARTERIAL : BARRAGE.RADIUS;
    const healRate = this.arterialSpray ? BARRAGE.HEAL_ARTERIAL : BARRAGE.HEAL;
    const hits = [];
    for (const player of players) {
      const damage = Shared.random(BARRAGE.MIN, BARRAGE.MAX);
      for (const victim of players) {
        if (victim !== player && victim.getLocation().getDistance(player.getLocation()) > radius) continue;
        if (Shared.isProtected(victim, "magic")) continue;
        heal += damage * healRate;
        hits.push([victim, damage]);
      }
      player.performGraphic(Shared.gfx(GRAPHIC.BLOOD));
      Shared.sound(player, SOUND.BARRAGE);
    }
    if (heal > 0) this.zebak.setHitpoints(Math.min(this.zebak.getMaxHitpoints(), this.zebak.getHitpoints() + Math.floor(heal)));
    this.later(BARRAGE.HIT_TICKS, () => hits.forEach(([victim, damage]) => Shared.damage(victim, damage)));
  }

  bloodClouds() {
    const { NpcIdentifiers } = Shared.core();
    const centre = BLOOD_CLOUD_CENTRES[this.cloudsSouth ? 1 : 0];
    const count = this.multipleClouds ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const tile = this.multipleClouds
        ? { x: centre.x + Shared.random(-1, 1), y: centre.y + Shared.random(-1, 1), z: 0 }
        : { ...centre, z: 0 };
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
        this.failPerfect(player, "was hit by a blood spawn.");
        cloud.setHitpoints(Math.min(cloud.getMaxHitpoints(), cloud.getHitpoints() + 2));
      }
    }
  }

  // -------------------------------------------------------------- poison

  /**
   * Pools of poison: standing in one hurts, more the longer you've been at it, and poisons. Its
   * hitsplat is poison's, not a hit's (227/00553 ticks 10020-10022).
   */
  tickPoison(players) {
    const { CombatFactory, HitDamage, HitMask } = Shared.core();
    const now = Shared.cycle();
    for (const player of players) {
      const location = player.getLocation();
      if (!this.activePoison.has(key(location.getX(), location.getY()))) continue;
      const ramp = this.acidRamp.get(player);
      const hits = ramp && now - ramp.last <= ACID.MEMORY_TICKS ? ramp.hits : 0;
      this.acidRamp.set(player, { hits: hits + 1, last: now });
      const top = hits === 0 ? ACID.FIRST_MAX : ACID.MAX;
      const damage = Shared.random(this.maxHit(ACID.MIN), Math.floor(top * this.damageFactor()));
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.GREEN)]);
      CombatFactory.poisonEntity(player, 2);
      this.failPerfect(player, "was hit by vomit damage.");
    }
    // Pools placed last tick become harmful this tick.
    for (const tile of this.poison.keys()) this.activePoison.add(tile);
  }

  addPoison(tile, spread) {
    const tileKey = key(tile.x, tile.y);
    if (this.poison.has(tileKey)) return;
    this.poison.set(tileKey, tile);
    this.setObject(POISON + Shared.random(0, 5), { ...tile, z: 0 }, 10, Shared.random(0, 3));
    if (!spread) return;
    this.areaSound(SOUND.POISON_LAND, tile, SOUND_DELAY.POISON_LAND, SOUND_RADIUS.POISON_LAND);
    const range = this.upsetStomach ? 2 : 1;
    const spreads = [];
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (Shared.random(0, 2) !== 0) continue;
        const next = { x: tile.x + dx, y: tile.y + dy };
        if (this.objectAt({ ...next, z: 0 }, 10) || !Shared.floorFree(this.area, Shared.loc(next, 0)) || this.activePoison.has(key(next.x, next.y))) continue;
        Shared.tileProjectile(this.area, Shared.loc(tile, 0), Shared.loc(next, 0), PROJECTILE.POISON_SPREAD, POOL_SPREAD_THROW);
        spreads.push(next);
      }
    }
    if (spreads.length > 0) this.later(1, () => spreads.forEach((next) => this.addPoison(next, false)));
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

  /** Leaving from the pool: swimming's walk and its blocked run go with the room. */
  onPlayerLeave(player) {
    this.stopSwimming(player);
  }

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

  /** Swimmers can only walk, and the raid summary counts their time in the pool. */
  tickPlayer(player) {
    this.watchPrayer(player);
    if (!this.swimmers.has(player)) return;
    this.raid.tally(player, "swimTicks");
    if (!player.isRunningReturn()) return;
    player.setRunning(false);
    player.getPacketSender().sendRunStatus();
  }

  /** All Praise Zebak: not one prayer point lost, by whatever means (227/00553 tick 5664). */
  watchPrayer(player) {
    if (!this.isStarted()) return;
    const { Skill } = Shared.core();
    const level = player.getSkillManager().getCurrentLevel(Skill.PRAYER);
    const seen = this.prayerSeen.get(player);
    if (seen !== undefined && level < seen) this.raid.failTask(TASK.PRAISE, "You lost a prayer point.", player);
    this.prayerSeen.set(player, level);
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
   * put. His next attack comes 10 ticks on and then as usual; the scream holds it 11 (223/00014).
   */
  boulderSpecial() {
    const { Animation } = Shared.core();
    this.busy = true;
    this.attackTicks = 10;
    this.zebak.performAnimation(new Animation(ANIMATION.SHOOT));
    this.roaring = false;
    this.later(1, () => {
      this.roaring = this.throwBoulders();
      if (!this.roaring) this.busy = false;
    });
    this.later(33, () => {
      if (!this.roaring) return;
      this.zebak.performAnimation(new Animation(ANIMATION.SCREAM));
      this.tail.performAnimation(new Animation(ANIMATION.TAIL_SCREAM));
      this.soundAll(SOUND.ROAR, SOUND_DELAY.ROAR);
      this.attackTicks = Math.max(this.attackTicks, 11);
    });
    [36, 38, 40].forEach((tick, index) => {
      this.later(tick, () => {
        if (this.roaring) this.screamDust();
      });
      this.later(tick + 1, () => {
        if (this.roaring) this.scream(index === 0);
      });
    });
    this.later(40, () => {
      if (this.roaring) this.soundAll(SOUND.PUSHED, SOUND_DELAY.PUSHED);
    });
    this.later(ROCK_GONE.CRUMBLE, () => {
      if (!this.roaring) return;
      for (const boulder of this.boulders) boulder.performAnimation(new Animation(ROCK_GONE.SEQ));
    });
    this.later(ROCK_GONE.CLEARED, () => {
      if (!this.roaring) return;
      for (const boulder of this.boulders) {
        const location = boulder.getLocation();
        this.graphic(GRAPHIC.ROCK_BREAK, { x: location.getX(), y: location.getY() });
        this.removeBoulder(boulder);
      }
      this.boulders = [];
    });
    this.later(58, () => {
      if (!this.roaring) return;
      this.roaring = false;
      this.busy = false;
    });
  }

  /** Throws the rocks, jugs and acid onto this roar's tiles. */
  throwBoulders() {
    const { NpcIdentifiers } = Shared.core();
    const plan = this.roarsDone++ === 0 ? ROAR_FIRST : ROAR_SECOND;
    const boulders = this.pickBoulders(plan);
    if (!boulders) return false;
    const jugs = Shared.shuffle(plan.jugs).slice(0, Shared.random(ROAR_JUG_COUNT[0], ROAR_JUG_COUNT[1])).map(asTile);
    const pools = this.pickPools(plan.pools, ROAR_EXTRA_POOLS, [...jugs, ...boulders]);
    const from = Shared.loc(PROJECTILE_START);
    this.areaSound(SOUND.JUGS, JUG_SOUND_TILE, 0, SOUND_RADIUS.JUGS);
    for (const tile of pools) Shared.tileProjectile(this.area, from, Shared.loc(tile, 0), Shared.randomOf(PROJECTILE.POISON), THROW);
    for (const tile of jugs) Shared.tileProjectile(this.area, from, Shared.loc(tile, 0), PROJECTILE.JUG, THROW);
    boulders.forEach((tile, index) => Shared.tileProjectile(this.area, from, Shared.loc(tile, 0), PROJECTILE.BOULDER, index === 0 ? THROW_FAST : THROW));
    const placeRock = (tile) => {
      const boulder = this.spawn(NpcIdentifiers.COL_00FFFF_BOULDER_COL_4, { ...tile, z: 0 }, { scale: false, points: 0 });
      if (!boulder) return;
      boulder.__toaScripted = true;
      boulder.__toaRock = true;
      boulder.setUntargetable(true);
      boulder.getMovementQueue().setBlockMovement(true);
      boulder.setMaxHitpoints(ROCK.HITPOINTS);
      boulder.setHitpoints(ROCK.HITPOINTS);
      this.removePoison(key(tile.x, tile.y));
      this.setObject(BOULDER_BLOCK, { ...tile, z: 0 }, 10, 0);
      this.boulders.push(boulder);
      this.graphic(GRAPHIC.ROAR, tile);
      this.areaSound(SOUND.BOULDER_LAND, tile, 0, SOUND_RADIUS.BOULDER_LAND);
      for (const player of this.challengePlayers()) {
        if (player.getLocation().getX() === tile.x && player.getLocation().getY() === tile.y) {
          Shared.damage(player, Shared.random(2, 5));
          this.nudgeOff(player);
        }
      }
    };
    // Sent at T+1: the first rock lands 4 ticks on, all else 5.
    this.later(4, () => placeRock(boulders[0]));
    this.later(5, () => {
      boulders.slice(1).forEach(placeRock);
      for (const tile of pools) this.addPoison(tile, true);
      this.spawnJugs(jugs);
    });
    return true;
  }

  /** A roar wave's dust, over every tile the rocks don't shelter, the tick before it lands. */
  screamDust() {
    for (let x = GROUND_MIN.x; x <= GROUND_MAX.x; x++) {
      for (let y = GROUND_MIN.y; y <= GROUND_MAX.y; y++) {
        if (this.sheltered(x, y) || this.objectAt({ x, y, z: 0 }, 10)) continue;
        this.graphic(GRAPHIC.ROAR, { x, y }, { delay: 1 + Math.max(Math.abs(x - MIDDLE.x), Math.abs(y - MIDDLE.y)) });
      }
    }
  }

  /** One roar wave lands: those not sheltered are pushed, each rock takes 50, the first breaks the jugs. */
  scream(first) {
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (this.isSwimming(player) || this.sheltered(location.getX(), location.getY())) continue;
      this.push(player, 1, 0, 2, MAX_HIT.SCREAM);
    }
    for (const boulder of [...this.boulders]) Shared.damage(boulder, ROCK.ROAR_DAMAGE);
    if (first) for (const jug of [...this.jugs]) this.later(1, () => this.breakJug(jug));
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

  /** Two or three rocks in a chain: the first roar's north by one, wrapping; the second's south by 1-2. */
  pickBoulders(plan) {
    const count = Shared.random(2, 3);
    const { minX, maxX, minY, maxY } = plan.rocks;
    const span = maxY - minY + 1;
    const picks = [];
    let y = Shared.random(minY, maxY);
    for (let i = 0; i < count; i++) {
      const tile = { x: Shared.random(minX, maxX), y };
      if (Shared.floorFree(this.area, Shared.loc(tile, 0))) picks.push(tile);
      y = plan === ROAR_FIRST ? minY + ((y - minY + 1) % span) : Math.max(minY, y - Shared.random(1, 2));
    }
    return picks.length > 0 ? picks : null;
  }

  /** The iteration's fixed pools and some at random, off jugs and rocks. */
  pickPools(fixed, extra, exclude) {
    const pools = fixed.map(asTile).filter((tile) => !exclude.some((other) => other.x === tile.x && other.y === tile.y));
    return pools.concat(this.freeTiles(GROUND_MIN, GROUND_MAX, [...exclude, ...pools]).slice(0, Shared.random(extra[0], extra[1])));
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
      this.areaSound(SOUND.BOULDER_LAND, tile, 0, SOUND_RADIUS.BOULDER_LAND);
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
    // Perfect Zebak allows two pushes on the roar attack; stationary jugs may still be broken.
    if (this.roaring && ++this.jugPushes > PERFECT_JUG_PUSHES) this.raid.failTask(TASK.PERFECT, `${Shared.displayName(player)} pushed too many jugs.`);
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
    const helper = this.spawn(JUG_BREAK_HELPER.id, { x: location.getX() - 1, y: location.getY() - 1, z: 0 }, { scale: false, points: 0, inert: true });
    if (helper) {
      helper.__toaScripted = true;
      helper.setUntargetable(true);
      helper.getMovementQueue().setBlockMovement(true);
      helper.performGraphic(Shared.gfx(GRAPHIC.JUG_BREAK));
      this.later(JUG_BREAK_HELPER.ticks, () => this.despawn(helper));
    }
    const range = this.upsetStomach ? 1 : 2;
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        const tile = { x: location.getX() + dx, y: location.getY() + dy };
        Shared.tileProjectile(this.area, location, Shared.loc(tile, 0), PROJECTILE.JUG_SPREAD, JUG_WATER_THROW);
        const tileKey = key(tile.x, tile.y);
        if (!this.poison.has(tileKey)) continue;
        this.later(1, () => {
          this.removePoison(tileKey);
          this.graphic(GRAPHIC.POISON_GONE, tile);
        });
      }
    }
    this.despawn(jug);
  }

  // -------------------------------------------------------------- waves

  /**
   * Waves: seq 9624 at T, jugs and acid thrown at T+1, the tail slam at T+5, landing at T+6, rocks
   * falling (camera, pillars) at T+7, rows at T+14, T+21 and T+28, done at T+45. His next attack
   * comes at T+15 (223/00014 T=390).
   */
  waveSpecial() {
    const { Animation } = Shared.core();
    this.busy = true;
    this.attackTicks = 15;
    this.zebak.performAnimation(new Animation(ANIMATION.SHOOT));
    const jugs = WAVE_JUGS.map(asTile);
    const pools = this.pickPools(WAVE_POOLS[Math.min(this.wavesDone, WAVE_POOLS.length - 1)], WAVE_EXTRA_POOLS, jugs);
    this.wavesDone++;
    const from = Shared.loc(PROJECTILE_START);
    this.later(1, () => {
      this.areaSound(SOUND.JUGS, JUG_SOUND_TILE, 0, SOUND_RADIUS.JUGS);
      for (const tile of pools) Shared.tileProjectile(this.area, from, Shared.loc(tile, 0), Shared.randomOf(PROJECTILE.POISON), THROW);
      for (const tile of jugs) Shared.tileProjectile(this.area, from, Shared.loc(tile, 0), PROJECTILE.JUG, THROW);
    });
    const south = this.wavesSouth;
    this.later(5, () => {
      this.zebak.performAnimation(new Animation(ANIMATION.CALL_WAVE));
      this.tail.performAnimation(new Animation(ANIMATION.TAIL_CALL_WAVE));
    });
    this.later(6, () => {
      for (const tile of pools) this.addPoison(tile, true);
      this.spawnJugs(jugs);
    });
    this.later(7, () => {
      const base = south ? WAVE_SOUTH : WAVE_NORTH;
      for (let x = 0; x < 7; x++) {
        this.graphic(GRAPHIC.SPLASH, { x: base.x + x * 3, y: base.y }, { delay: 200 });
        this.graphic(GRAPHIC.ROCKS, { x: base.x + x * 3, y: base.y });
      }
      for (const [id, delay] of WAVE_ROCK_SOUNDS) this.soundAll(id, delay);
      this.shakeCameras(SHAKE.WAVES);
      this.pillarsShaken = true;
      for (const pillar of PILLARS) {
        const tile = { x: pillar.x, y: pillar.y, z: 0 };
        this.setObject(PILLAR.SHAKING, tile, 10, pillar.face);
        this.graphic(GRAPHIC.DUST, { x: pillar.x + 1, y: pillar.y }, { height: 30 });
        this.later(pillar.back, () => this.setObject(PILLAR.STILL, tile, 10, pillar.face));
      }
    });
    const holes = 3 - Math.min(2, Math.floor(this.pathLevel() / 2));
    for (const tick of [14, 21, 28]) {
      this.later(tick, () => this.spawnWave(south, Shared.random(0, 12 - holes), holes));
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
      if (x - 4 >= gap && x - 4 < gap + holes) continue;
      const wave = this.spawn(NpcIdentifiers.COL_00FFFF_WAVE_COL, { x: base.x + x, y: base.y, z: 0 }, { scale: false, points: 0 });
      if (!wave) continue;
      wave.__toaScripted = true;
      wave.__toaWave = { north: south, tiles: WAVE_LIFE_TICKS };
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
        if (!player.getLocation().equals(location) || this.isSwimming(player)) continue;
        this.push(player, 0, step, WAVE_PUSH_TILES, MAX_HIT.WAVE);
        this.failPerfect(player, "was hit by a wave.");
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
      // Wiki: a wave turns bloody on a bleeding player's splatters.
      if (this.objectAt({ x: location.getX(), y: location.getY(), z: 0 }, 22)) wave.setNpcTransformationId(NpcIdentifiers.COL_00FFFF_BLOODY_WAVE_COL);
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
    // A wave that runs out of floor throws the player over the edge, onto the water's row.
    let intoWater = false;
    if (baseDamage === MAX_HIT.WAVE && moved < distance) {
      const row = dy > 0 ? WATER_ROW.NORTH : WATER_ROW.SOUTH;
      const water = Shared.loc({ x: location.getX(), y: row }, location.getZ());
      if (isWater(water) && Shared.floorFree(this.area, water)) {
        moved = Math.abs(row - location.getY());
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
    this.dying = true;
    this.later(SHAKE.DEATH.delay, () => this.shakeCameras(SHAKE.DEATH));
    // "Challenge complete" comes as he settles (235/03431 ticks 195-199).
    this.later(DEATH_FORM_TICKS, () => {
      this.zebak.setNpcTransformationId(NpcIdentifiers.ZEBAK_4);
      this.tail.setNpcTransformationId(NpcIdentifiers.ZEBAKS_TAIL_2);
      this.complete();
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

function asTile([x, y]) {
  return { x, y };
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
  if (!room || !event.target.__toaZebak) return;
  room.checkPhases();
  room.areaSound(SOUND.ZEBAK_HIT, ZEBAK_HIT_SOUND_TILE, 0, SOUND_RADIUS.ZEBAK_HIT);
  const { CombatType } = Shared.core();
  if (event.hit.getTotalDamage() > 0 && event.hit.getCombatMethod().type() !== CombatType.MELEE) {
    room.raid.failTask(TASK.MELEE_ONLY, "You damaged Zebak with an attack style other than melee.", event.player);
  }
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
    // It shatters the tick after the blow (223/00014 ticks 461-462).
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
