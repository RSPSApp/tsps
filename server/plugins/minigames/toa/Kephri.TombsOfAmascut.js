"use strict";

/**
 * Path of Scabaras, Kephri (A Mother's Curse). Kephri never moves; she bombards players' tiles,
 * throws eggs and flings players back through a trail of dung. Twice she falls asleep while
 * scarab swarms crawl in to heal her and her overlords (spitting, soldier, arcane) join the
 * fight; the third time she is down for good.
 * Wiki: https://oldschool.runescape.wiki/w/Kephri
 *
 * Tiles are template coordinates; captures compared by offset from her spawn (3549, 5406).
 * From captures (44 Kephri fights, revs 223-235; rev/rec/tick; rev 234-235 are the current ones):
 * - Autos: 9577 every 6 ticks from 6 after the start at every path level (all 44). The rising
 *   fireball is 1481 from (3551,5408) to the next tile towards the target, 39 to 90 cycles, heights
 *   175-250, angle 50. 3 ticks later: synth 5896, the falling 2266 for the flight time, heights
 *   250-9, angle 115, and a shadow on the tile (223/00014 tick 892-899).
 * - Path levels: "faster" is the fireball's flight, not her attack speed. Levels 0-1: 120 cycles,
 *   4 ticks, shadow 1447. 2-3: 90, 3, 1446. 4-5: 60, 2, 2111 (from all 44; levels read from
 *   toa_client_scabaras_level). Level 6 isn't captured.
 * - Trios: at 2-3 every 8th swarm of an intermission, at 4-5 every 6th (the same in every run); on
 *   all three tiles of its spawn point. Never at 0-1.
 * - Specials: three autos, then 5 autos between specials, Dung Strike first, then eggs in turn.
 *   Flies (2146) on the target, the throw 5 ticks later, the next auto 8 after the throw
 *   (223/00014 tick 910-923). Eggs: 9578, the next auto 6 later (tick 953-959). In 223/00014 alone,
 *   the final phase has only 2 autos between specials; later ones have 5 (227/01753 tick 5633-).
 * - Thrown: "<col=ff289d>Kephri throws you back!</col>", player seq 9799, synth 6442; the move
 *   starts at cycle 5 and ends at 30, or 60 for 5 tiles (132 throws). Distance 8 - her ring's
 *   distance; straight when the smaller offset is under half the larger, else diagonal: 130/132
 *   throws. Dung falls from the thrown-from tile to the landing tile: 2145 2 ticks later, 10 cycles
 *   apart, then loc 45504 at 4 ticks (first 3) and 5 (the rest).
 * - Sleep: seq 9579 and transform to 11720 on the same tick; seq 9581 and back to 11719 at wake. No
 *   graphics. Lengths: 54 then 51; with Medic 51 then 48 at path 2+, or 51 then 60 at path 0-1.
 * - Swarms: first 5 ticks into a 54-long sleep, else 6 in; 4 at 4 ticks apart, 4 at 3, 4 at 2, then
 *   every tick to the end: the Wiki's 28 and 24 (234/03280 tick 5415-5463). Clockwise over the
 *   Wiki's six points (NE, SE, S, SW, NW, N), sometimes skipping one. They wait 3 ticks, then walk
 *   a tile a tick (2 ticks with Medic), and heal with hitmark 11 and synth 6462 on reaching her. All
 *   but Medic's fade at wake. Medic's come at 12, 10, 8 ticks apart by phase (227/01757 tick
 *   26928-), first 18 in, and heal while she's awake until the final phase.
 * - Overlords spawn the tick she sleeps (the second on the next): spitter (3556,5413), soldier
 *   (3556,5407), arcane (3556,5401). Spitter: seq 9588, 5 after spawning then every 3. Soldier's
 *   heal: 2150 at 8 after spawning, every 6. Arcane: charges from 5 after spawning, one more every
 *   3 ticks, on the 9th step it fires 2149 (115 cycles, angle 20), seq 9597, 2151 on its charges,
 *   and lands on the next tile 2 ticks later, seq 9596 (223/00014 tick 1238-1274).
 * - Bombers: 2147 from her centre to each player, heights 450-38 (rev 235), 120 cycles, shadow
 *   1447 whatever the path, explosion 2148 at 4 ticks, first 7 after her first sleep, then every 12
 *   until the final phase, through her wake (234/03280 tick 5417-5525).
 * - Eggs land 4 ticks after her throw and go off 15 later (135 samples): 2156-2159 with synth
 *   6436, brown 2166. Projectiles 70 to 120 cycles, heights 86-0, angle 14.
 * - Death: seq 9582 and 11722 on the same tick, the challenge complete 3 ticks later.
 * - The third down: 11721, and a throw on everyone on the same tick; the next auto 8 later.
 * - All out of medics: "Kephri was healed above 25% of her hitpoints." (223/00014 tick 1074) at
 *   every mode, Medic or not; the CA unit decides who it counts for.
 * From the Wiki: her hitpoints (150 shield, 80 final), max hit 24, 66% off with Protect from Magic;
 * defence never under 60, restored for the final phase; heal cap ~115%; swarm 10 hitpoints; egg 35,
 * always takes a max hit; agile 5 max hit and unscaled, soldier 17 and speed 7, spitter 10, poison 6,
 * arcane relocates at 39+ in a hit or after 2 + players hits, misses counting (dated 25 June 2025);
 * Lively Larvae, More Overlords, Blowing Mud; Aerial's 3x3 (bombers too).
 * Estimates:
 * - Level 6's flight: uses 4-5's, because no capture reaches 6.
 * - A swarm heals 8-11% of her maximum: fit from about 700 hits at raid levels 0-750.
 * - The soldier's heal: 1.5-1.8% of her maximum x its health share: about 10 samples, full health.
 * - Egg explosion: up to 11 x the damage factor, at least a fifth. 8 samples, raid levels 500-530.
 * - Dung underfoot: 3.2 x the factor. 2 samples, both 8 at raid level 500+.
 * - Aerial Assault's "more damage": x1.25, no number anywhere.
 * - Brown eggs in parties of 5+: double. 3 samples of 8-10 at 5p; 6p shows 5-10.
 * - The first auto after waking: 7 ticks, the most common (38 of 69); 8, 10 and 11 are also seen,
 *   cause not found.
 * - Perfect Kephri's failure wording: no capture fails it, so its reasons copy Perfect Scabaras'.
 * Still only from Near-Reality:
 * - More than 4 + team agile scarabs turning eggs into dung (the Wiki says "too many").
 * - An egg landing on a player for 2 x the factor.
 * - Spitter damage through Protect from Missiles (x0.2; the Wiki only says it hits through).
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");

const SPAWN = { x: 3549, y: 5406, z: 0 };
const CENTRE = { x: 3551, y: 5408, z: 0 };
/** Clockwise from north-east; each spans three tiles. */
const SWARM_POINTS = [
  [{ x: 3559, y: 5411 }, { x: 3559, y: 5412 }, { x: 3559, y: 5413 }],
  [{ x: 3559, y: 5403 }, { x: 3559, y: 5404 }, { x: 3559, y: 5405 }],
  [{ x: 3551, y: 5400 }, { x: 3552, y: 5400 }, { x: 3553, y: 5400 }],
  [{ x: 3543, y: 5403 }, { x: 3543, y: 5404 }, { x: 3543, y: 5405 }],
  [{ x: 3543, y: 5411 }, { x: 3543, y: 5412 }, { x: 3543, y: 5413 }],
  [{ x: 3551, y: 5416 }, { x: 3552, y: 5416 }, { x: 3553, y: 5416 }],
];
const EGG_TILES = [
  { x: 3551, y: 5404 }, { x: 3549, y: 5402 }, { x: 3545, y: 5406 }, { x: 3551, y: 5412 }, { x: 3549, y: 5414 },
  { x: 3545, y: 5410 }, { x: 3547, y: 5408 }, { x: 3553, y: 5402 }, { x: 3557, y: 5406 }, { x: 3553, y: 5414 },
  { x: 3555, y: 5408 }, { x: 3557, y: 5410 },
];
const SOLDIER_SPAWN = { x: 3556, y: 5407 };
const SPITTER_SPAWN = { x: 3556, y: 5413 };
const ARCANE_TILES = [{ x: 3556, y: 5401 }, { x: 3544, y: 5413 }, { x: 3550, y: 5401 }, { x: 3556, y: 5413 }];
const ARCANE_CHARGE_OFFSETS = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0], [1, 0]];

const DUNG = 45504;
const INVISIBLE_BLOCK = 32740;
const FINAL_PHASE_HITPOINTS = 80;
const BASE_DEFENCE = 80;
const MIN_DEFENCE = 60;
const ATTACK_SPEED = 6;
const FIRST_SPECIAL_AFTER = 3;
const AUTOS_BETWEEN_SPECIALS = 5;
const THROW_WARNING = 5;
const AFTER_THROW = 8;
const AFTER_WAKE = 7;
const FIREBALL_FALL_DELAY = 3;
const FIREBALL_MAX_HIT = 24;
const AERIAL_FACTOR = 1.25;
const SLEEP_TICKS = [54, 51];
const SLEEP_TICKS_MEDIC = [51, 48];
const SLEEP_TICKS_MEDIC_LOW_PATH = [51, 60];
const SWARM_MOVE_DELAY = 3;
const SWARM_FIRST_LONG_SLEEP = 5;
const SWARM_FIRST = 6;
const EGG_LAND_DELAY = 4;
const EGG_FUSE = 15;
const EGG_HATCH_MAX_HIT = 11;
const DUNG_FLOOR_HIT = 3.2;
const HEAL_CAP = 1.15;
const SWARM_HEAL = [0.08, 0.11];
const SOLDIER_HEAL = [0.015, 0.018];
const MEDICS_HEAL_LIMIT = 0.25;
const MEDIC_INTERVALS = [12, 10, 8, 8];
const MEDIC_FIRST_EXTRA = 6;
const BOMBER_FIRST = 7;
const BOMBER_INTERVAL = 12;
const BOMBER_FLIGHT = 4;
const DEATH_TICKS = 3;
const SPITTER_RANGE = 10;
const SPITTER_POISON = 6;
const SPIT_PRAYER_FACTOR = 0.2;
const SPIT_MAX_HIT = 10;
const SPITTER_SPEED = 3;
const SPITTER_FIRST = 5;
const SOLDIER_MAX_HIT = 17;
const SOLDIER_SPEED = 7;
const SOLDIER_FIRST_HEAL = 8;
const SOLDIER_HEAL_INTERVAL = 6;
const AGILE_MAX_HIT = 5;
const AGILE_SPEED = 4;
const AGILE_RANGE = 6;
const AGILE_RETREAT_AT = 3;
const AGILE_RETREAT_TILES = 4;
const ARCANE_MAX_HIT = 66;
const ARCANE_STEPS = 9;
const ARCANE_CHARGE_FIRST = 5;
const ARCANE_CHARGE_INTERVAL = 3;
const ARCANE_RELOCATE_DAMAGE = 39;
const ARCANE_RELOCATE_HITS = 2;
const ARCANE_LAND_TICKS = 2;
const SCARAB_POINTS = 0.5;
const PRAYER_THIRD = 3;

const FLIGHT = [
  { from: 4, cycles: 60, ticks: 2, shadow: 2111 },
  { from: 2, cycles: 90, ticks: 3, shadow: 1446 },
  { from: 0, cycles: 120, ticks: 4, shadow: 1447 },
];
const TRIO_EVERY = [{ from: 4, every: 6 }, { from: 2, every: 8 }];

const TASK = { PERFECT: "Perfect Kephri", MEDICS: "All out of medics", BUG: "Doesn't bug me" };
const BUG_PATH_LEVEL = 4;

const ANIMATION = {
  THROW: 9577, THROW_EGGS: 9578, SUMMON: 9579, AWAKE: 9581, DEATH: 9582, EGG_SPAWN: 8630,
  PLAYER_THROWN: 9799, PLAYER_SLIDE: 1114, SCARAB_SPAWN: 9589, SCARAB_ATTACK: 9587, SPIT: 9588,
  AGILE_ATTACK: 9594, ARCANE_UP: 9597, ARCANE_DOWN: 9596, SWARM_SPAWN: 9605, SWARM_FADE: 9607,
};
const GRAPHIC = {
  BOMBER_SHADOW: 1447, EXPLOSIONS: [2156, 2157, 2158, 2159], BOMBER_EXPLODE: 2148, PLAYER_FLIES: 2146,
  PLAYER_STUN: 245, EGG_BREAK: 2166, DUNG: 2145, ARCANE_CHARGE: 2149, ARCANE_DISPERSE: 2151,
};
const EXPLOSION_HEIGHT = 38;
const PROJECTILE = {
  THROW_RISE: 1481, THROW_FALL: 2266, BROWN_EGG: 2164, EGG: 2165, BOMBER: 2147, HEAL: 2150, SPIT: 2152, ARCANE: 2149,
};
const SOUND = { FIREBALL: 5896, EXPLODE: 6475, EGG_EXPLODE: 6436, THROW: 6442, HEAL: 6462 };

class KephriRoom extends Raid.Room {
  build() {
    const { NpcIdentifiers } = Shared.core();
    const settings = this.settings;
    this.aerialAssault = settings.isActive("AERIAL_ASSAULT");
    this.blowingMud = settings.isActive("BLOWING_MUD");
    this.livelyLarvae = settings.isActive("LIVELY_LARVAE");
    this.moreOverlords = settings.isActive("MORE_OVERLORDS");
    this.medic = settings.isActive("MEDIC");
    this.phase = 0;
    this.dead = false;
    this.shieldTicks = 0;
    this.attackTicks = ATTACK_SPEED;
    this.specialCycle = FIRST_SPECIAL_AFTER;
    this.dungNext = true;
    this.playerIndex = 0;
    this.eggFuse = 0;
    this.medicTicks = MEDIC_INTERVALS[0] + MEDIC_FIRST_EXTRA;
    this.bomberTicks = 0;
    this.swarmPoint = Shared.random(0, SWARM_POINTS.length - 1);
    this.swarmTicks = 0;
    this.swarmCount = 0;
    this.dung = new Set();
    this.eggs = new Set();
    this.agile = new Set();
    this.swarms = new Set();
    this.overlords = new Set();
    this.kephri = this.spawn(NpcIdentifiers.KEPHRI, SPAWN, { points: 1 });
    if (this.kephri) {
      this.kephri.__toaScripted = true;
      this.kephri.__toaKephri = true;
      this.kephri.getMovementQueue().setBlockMovement(true);
    }
    this.setObject(INVISIBLE_BLOCK, SPAWN, 10, 0);
  }

  onStart() {
    this.raid.scale(this.kephri, this.pathLevel());
    this.openBossHud(this.kephri);
  }

  lootSource() {
    return this.kephri;
  }

  onComplete() {
    this.clearAdds();
    this.clearDung();
    const { raid } = this;
    if (this.teamSize >= 2) raid.completeTask(TASK.PERFECT);
    const survivors = this.deathlessPlayers();
    if (this.medic) raid.completeTask(TASK.MEDICS, survivors);
    const allFive = this.aerialAssault && this.blowingMud && this.livelyLarvae && this.moreOverlords && this.medic;
    if (allFive && this.pathLevel() >= BUG_PATH_LEVEL) raid.completeTask(TASK.BUG, survivors);
  }

  onReset() {
    this.clearAdds();
    this.clearDung();
    this.despawn(this.kephri);
    this.build();
  }

  clearAdds() {
    for (const set of [this.eggs, this.agile, this.swarms, this.overlords]) {
      for (const npc of set) this.despawn(npc);
      set.clear();
    }
  }

  clearDung() {
    for (const key of this.dung) {
      const [x, y] = key.split(",").map(Number);
      this.setObject(-1, { x, y, z: 0 }, 10);
    }
    this.dung.clear();
  }

  alive(npc) {
    return npc && npc.getHitpoints() > 0 && npc.isRegistered?.() !== false;
  }

  /** Whatever of hers hurt `player`: Perfect Kephri goes (only ever a group's task). */
  failPerfect(player, what) {
    if (this.teamSize < 2) return;
    this.raid.failTask(TASK.PERFECT, `${Shared.displayName(player)} was hit by ${what}.`);
  }

  tick() {
    const kephri = this.kephri;
    if (!this.isStarted() || this.dead || !this.alive(kephri)) return;
    this.prune();
    const players = this.challengePlayers();
    if (players.length === 0) return;
    this.dungDamage(players);
    if (this.eggFuse > 0 && --this.eggFuse === 0) {
      for (const egg of [...this.eggs]) this.hatch(egg);
    }
    this.tickOverlords(players);
    this.tickSwarms();
    this.tickAgile();
    this.tickBombers();
    if (this.shieldTicks > 0) {
      this.tickShield();
      return;
    }
    if (this.medic && --this.medicTicks <= 0) {
      this.medicTicks = MEDIC_INTERVALS[this.phase];
      this.spawnSwarm(true);
    }
    if (--this.attackTicks > 0) return;
    this.attackTicks = ATTACK_SPEED;
    if (this.specialCycle === 0) {
      this.specialCycle = AUTOS_BETWEEN_SPECIALS;
      if (this.dungNext || this.agile.size > 4 + this.teamSize) {
        this.dungNext = false;
        this.prepareDung(players);
      } else {
        this.dungNext = true;
        this.throwEggs();
      }
    } else {
      this.specialCycle--;
      this.regularAttack(players);
    }
  }

  /** Path levels shorten the fireball's fall (every two levels), not her attack speed. */
  flight() {
    const level = this.pathLevel();
    return FLIGHT.find((flight) => level >= flight.from);
  }

  prune() {
    for (const set of [this.eggs, this.agile, this.swarms, this.overlords]) {
      for (const npc of set) {
        if (!this.alive(npc)) set.delete(npc);
      }
    }
  }

  tickBombers() {
    if (this.bomberTicks <= 0 || this.phase >= 3) return;
    if (--this.bomberTicks === 0) {
      this.bomberTicks = BOMBER_INTERVAL;
      this.bombers();
    }
  }

  tickShield() {
    const { NpcIdentifiers, Animation } = Shared.core();
    const kephri = this.kephri;
    if (--this.shieldTicks === 0) {
      kephri.setNpcTransformationId(NpcIdentifiers.KEPHRI);
      kephri.setUntargetable(false);
      kephri.performAnimation(new Animation(ANIMATION.AWAKE));
      this.attackTicks = AFTER_WAKE;
      this.medicTicks = MEDIC_INTERVALS[this.phase] + MEDIC_FIRST_EXTRA;
      for (const swarm of [...this.swarms]) {
        if (!swarm.__toaSwarm.medic) this.fadeSwarm(swarm);
      }
      return;
    }
    if (--this.swarmTicks <= 0) {
      this.swarmCount++;
      this.swarmTicks = this.swarmGap(this.swarmCount);
      this.spawnSwarm(false);
    }
  }

  /** 4 at 4 ticks apart, 4 at 3, 4 at 2, then every tick. */
  swarmGap(spawned) {
    if (spawned < 4) return 4;
    if (spawned < 8) return 3;
    if (spawned < 12) return 2;
    return 1;
  }

  sleepLength() {
    const index = this.phase - 1;
    if (!this.medic) return SLEEP_TICKS[index];
    return (this.pathLevel() >= 2 ? SLEEP_TICKS_MEDIC : SLEEP_TICKS_MEDIC_LOW_PATH)[index];
  }

  /** Her health reaching zero: the first two times she sleeps; the third, she's up for good. */
  onDowned() {
    const { Animation, NpcIdentifiers } = Shared.core();
    const kephri = this.kephri;
    this.phase++;
    if (this.phase === 4) return false;
    if (this.phase === 3) {
      const scaled = Math.round(FINAL_PHASE_HITPOINTS * this.raid.hitpointFactor(this.pathLevel()));
      kephri.setNpcTransformationId(NpcIdentifiers.KEPHRI_3);
      kephri.setMaxHitpoints(scaled);
      kephri.setHitpoints(scaled);
      kephri.setDefenceLevel(BASE_DEFENCE);
      this.specialCycle = AUTOS_BETWEEN_SPECIALS;
      this.attackTicks = AFTER_THROW;
      this.dungNext = false;
      for (const player of this.challengePlayers()) this.dungAttack(player);
      return true;
    }
    const length = this.sleepLength();
    this.shieldTicks = length;
    this.swarmTicks = length === SLEEP_TICKS[0] ? SWARM_FIRST_LONG_SLEEP : SWARM_FIRST;
    this.swarmCount = 0;
    if (this.phase === 1) this.bomberTicks = BOMBER_FIRST;
    kephri.setNpcTransformationId(NpcIdentifiers.KEPHRI_2);
    kephri.setUntargetable(true);
    kephri.getCombat().reset();
    kephri.performAnimation(new Animation(ANIMATION.SUMMON));
    kephri.setHitpoints(1);
    const overlords = this.phase === 1
      ? ["spitting", ...(this.moreOverlords ? ["soldier"] : [])]
      : ["soldier", "arcane", ...(this.moreOverlords ? ["spitting"] : [])];
    overlords.forEach((kind, index) => {
      if (index === 0) this.spawnOverlord(kind);
      else this.later(index, () => this.spawnOverlord(kind));
    });
    return true;
  }

  /** Seq and body on the same tick; the challenge completes a little later. */
  finalDeath() {
    const { Animation, NpcIdentifiers } = Shared.core();
    this.dead = true;
    this.kephri.setHitpoints(1);
    this.kephri.setUntargetable(true);
    this.kephri.getCombat().reset();
    this.kephri.performAnimation(new Animation(ANIMATION.DEATH));
    this.kephri.setNpcTransformationId(NpcIdentifiers.KEPHRI_4);
    this.later(DEATH_TICKS, () => this.complete());
  }

  /** Heals her by a share of her health, up to 115%; her final phase takes no healing. */
  heal(minShare, maxShare) {
    if (this.phase >= 3) return 0;
    const kephri = this.kephri;
    const maximum = kephri.getMaxHitpoints();
    const room = Math.floor(maximum * HEAL_CAP) - kephri.getHitpoints();
    if (room <= 0) return 0;
    const amount = Math.min(room, Math.max(1, Shared.random(Math.floor(maximum * minShare), Math.floor(maximum * maxShare))));
    kephri.setHitpoints(kephri.getHitpoints() + amount);
    if (this.phase >= 1 && kephri.getHitpoints() > maximum * MEDICS_HEAL_LIMIT) {
      this.raid.failTask(TASK.MEDICS, "Kephri was healed above 25% of her hitpoints.");
    }
    return amount;
  }

  // -------------------------------------------------------------- attacks

  /** The fireball rises to the tile beside her towards each target, and falls 3 ticks after her throw. */
  regularAttack(players) {
    const { Animation } = Shared.core();
    this.kephri.performAnimation(new Animation(ANIMATION.THROW));
    for (const player of players) {
      Shared.tileProjectile(this.area, Shared.loc(CENTRE), Shared.loc(this.besideHer(player.getLocation())), PROJECTILE.THROW_RISE,
        { delay: 39, duration: 51, perTile: 0, startHeight: 175, endHeight: 250, angle: 50 });
    }
    this.later(FIREBALL_FALL_DELAY, () => {
      if (this.shieldTicks > 0 || this.dead) return;
      this.soundAll(SOUND.FIREBALL);
      const flight = this.flight();
      this.falling((location) => ({ from: Shared.loc(this.besideHer(location)), id: PROJECTILE.THROW_FALL, cycles: flight.cycles, startHeight: 250, endHeight: 9 }),
        flight.shadow, flight.ticks, null, "Kephri's attack");
    });
  }

  besideHer(location) {
    return {
      x: CENTRE.x + Math.sign(location.getX() - CENTRE.x),
      y: CENTRE.y + Math.sign(location.getY() - CENTRE.y),
      z: 0,
    };
  }

  /** Exploding scarabs: her auto's damage and area, a fixed flight, from her centre. */
  bombers() {
    this.falling(() => ({ from: Shared.loc(CENTRE), id: PROJECTILE.BOMBER, cycles: BOMBER_FLIGHT * 30, startHeight: 450, endHeight: 38 }),
      GRAPHIC.BOMBER_SHADOW, BOMBER_FLIGHT, GRAPHIC.BOMBER_EXPLODE, "an exploding scarab");
  }

  /** Something falling on every player's tile (3x3 with Aerial Assault). */
  falling(projectile, shadow, ticks, explosion, what) {
    const centres = [];
    const tiles = new Map();
    const mark = (x, y) => tiles.set(`${x},${y}`, { x, y });
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      const key = `${location.getX()},${location.getY()}`;
      if (tiles.has(key)) continue;
      mark(location.getX(), location.getY());
      centres.push(key);
      const { from, id, cycles, startHeight, endHeight } = projectile(location);
      Shared.tileProjectile(this.area, from, location.clone(), id, { duration: cycles, perTile: 0, startHeight, endHeight, angle: 115 });
    }
    if (this.aerialAssault) {
      for (const key of centres) {
        const [x, y] = key.split(",").map(Number);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) mark(x + dx, y + dy);
      }
    }
    for (const tile of tiles.values()) this.graphic(shadow, tile);
    this.later(ticks, () => {
      if (this.dead) return;
      const hit = [];
      for (const tile of tiles.values()) {
        const height = centres.includes(`${tile.x},${tile.y}`) && !this.aerialAssault ? EXPLOSION_HEIGHT : 0;
        this.graphic(explosion ?? Shared.randomOf(GRAPHIC.EXPLOSIONS), tile, 0, height);
        this.soundAll(SOUND.EXPLODE);
        for (const player of this.challengePlayers()) {
          const location = player.getLocation();
          if (location.getX() === tile.x && location.getY() === tile.y) hit.push(player);
        }
      }
      // The hit shows a tick after the explosion (227/01759, 01753: 6 of 6).
      this.later(1, () => {
        for (const player of hit) {
          if (player.getHitpoints() > 0 && this.inChallenge(player)) this.fireballHit(player, what);
        }
      });
    });
  }

  /** Wiki: max hit 24, a third of it through Protect from Magic. */
  fireballHit(player, what) {
    const top = this.maxHit(FIREBALL_MAX_HIT * (this.aerialAssault ? AERIAL_FACTOR : 1));
    let damage = Shared.random(Math.floor(top / 2), top);
    if (Shared.isProtected(player, "magic")) damage = Math.floor(damage / PRAYER_THIRD);
    Shared.damage(player, damage);
    if (damage > 0) this.failPerfect(player, what);
  }

  throwEggs() {
    const { Animation } = Shared.core();
    this.kephri.performAnimation(new Animation(ANIMATION.THROW_EGGS));
    const bigParty = this.teamSize >= 5 ? 2 : 1;
    const brown = (this.livelyLarvae ? Shared.random(3, 5) : 2) * bigParty;
    const tiles = Shared.shuffle(EGG_TILES);
    tiles.forEach((tile, index) => {
      if (this.dung.has(`${tile.x},${tile.y}`)) return;
      Shared.tileProjectile(this.area, Shared.loc(CENTRE), Shared.loc(tile, 0), index < brown ? PROJECTILE.BROWN_EGG : PROJECTILE.EGG,
        { delay: 70, duration: 50, perTile: 0, startHeight: 86, endHeight: 0, angle: 14 });
    });
    this.later(EGG_LAND_DELAY, () => {
      if (this.dead || this.challengePlayers().length === 0) return;
      tiles.forEach((tile, index) => this.placeEgg(tile, index < brown));
      this.eggFuse = EGG_FUSE;
    });
  }

  placeEgg(tile, brown) {
    if (this.dung.has(`${tile.x},${tile.y}`)) return;
    const { NpcIdentifiers, Animation } = Shared.core();
    const egg = this.spawn(brown ? NpcIdentifiers.COL_00FFFF_EGG_COL_2 : NpcIdentifiers.COL_00FFFF_EGG_COL, { ...tile, z: 0 }, { scale: false, points: 0, inert: true });
    if (!egg) return;
    egg.__toaScripted = true;
    egg.__toaEgg = brown ? "brown" : "plain";
    egg.getMovementQueue().setBlockMovement(true);
    egg.performAnimation(new Animation(ANIMATION.EGG_SPAWN));
    this.eggs.add(egg);
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (location.getX() === tile.x && location.getY() === tile.y) {
        Shared.damage(player, this.maxHit(2));
        this.failPerfect(player, "an egg");
      }
    }
  }

  /** An egg left too long: plain eggs explode, brown ones hatch an agile scarab. */
  hatch(egg) {
    if (!this.alive(egg)) return;
    const location = egg.getLocation().clone();
    this.eggs.delete(egg);
    this.despawn(egg);
    if (egg.__toaEgg === "plain") {
      this.graphic(Shared.randomOf(GRAPHIC.EXPLOSIONS), location);
      this.soundAll(SOUND.EGG_EXPLODE);
      for (const player of this.challengePlayers()) {
        if (player.getLocation().getDistance(location) <= 1) {
          player.sendMessage("You are damaged by a nearby egg explosion!");
          const top = this.maxHit(EGG_HATCH_MAX_HIT);
          Shared.damage(player, Shared.random(Math.floor(top / 5), top));
          this.failPerfect(player, "an egg explosion");
        }
      }
      return;
    }
    this.graphic(GRAPHIC.EGG_BREAK, location);
    if (this.teamSize >= 2) this.raid.failTask(TASK.PERFECT, "An egg hatched.");
    const { NpcIdentifiers } = Shared.core();
    const scarab = this.spawn(NpcIdentifiers.AGILE_SCARAB, { x: location.getX(), y: location.getY(), z: 0 }, { scale: false, points: SCARAB_POINTS });
    if (!scarab) return;
    scarab.__toaAgile = true;
    this.agile.add(scarab);
    const target = Shared.randomOf(this.challengePlayers());
    if (target) scarab.getCombat().attack(target);
  }

  eggBroken(egg) {
    this.eggs.delete(egg);
    this.graphic(GRAPHIC.EGG_BREAK, egg.getLocation());
  }

  prepareDung(players) {
    const { Graphic } = Shared.core();
    this.attackTicks += THROW_WARNING + AFTER_THROW - ATTACK_SPEED;
    const first = players[this.playerIndex % players.length];
    const second = players[(this.playerIndex + 1) % players.length];
    first.performGraphic(new Graphic(GRAPHIC.PLAYER_FLIES));
    if (this.blowingMud && second !== first) second.performGraphic(new Graphic(GRAPHIC.PLAYER_FLIES));
    this.later(THROW_WARNING, () => {
      if (this.dead || this.shieldTicks > 0) return;
      this.dungAttack(first);
      if (this.blowingMud && second !== first) this.dungAttack(second);
    });
    this.playerIndex += this.blowingMud ? 2 : 1;
  }

  /** Throws a player away from her and leaves a trail of dung where they flew. */
  dungAttack(player) {
    if (this.shieldTicks > 0) return;
    const { Animation } = Shared.core();
    this.kephri.performAnimation(new Animation(ANIMATION.THROW_EGGS));
    this.soundAll(SOUND.THROW);
    if (player.getHitpoints() <= 0 || !this.inChallenge(player)) return;
    const location = player.getLocation();
    const dx = location.getX() - CENTRE.x;
    const dy = location.getY() - CENTRE.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    let stepX = Math.sign(dx);
    let stepY = Math.sign(dy);
    if (Math.min(adx, ady) * 2 < Math.max(adx, ady)) {
      if (adx > ady) stepY = 0;
      else stepX = 0;
    }
    if (stepX === 0 && stepY === 0) stepX = 1;
    let end = location.clone();
    for (let i = 0; i < 8 - Math.max(adx, ady); i++) {
      const next = end.transform(stepX, stepY);
      if (!Shared.floorFree(this.area, next) || this.dung.has(`${next.getX()},${next.getY()}`)) break;
      end = next;
    }
    player.sendMessage("<col=ff289d>Kephri throws you back!</col>");
    player.performAnimation(new Animation(ANIMATION.PLAYER_THROWN));
    player.performGraphic(Shared.gfx(GRAPHIC.PLAYER_STUN, { height: 124 }));
    player.getCombat().reset();
    const distance = end.getDistance(location);
    Shared.knockback(player, end.getX() - location.getX(), end.getY() - location.getY(), { ticks: 2, speed: distance >= 5 ? 60 : 30 });
    const path = [{ x: location.getX(), y: location.getY() }, ...line({ x: location.getX(), y: location.getY() }, { x: end.getX(), y: end.getY() })];
    this.later(2, () => path.forEach((tile, index) => this.graphic(GRAPHIC.DUNG, tile, index * 10)));
    this.later(4, () => path.slice(0, 3).forEach((tile) => this.addDung(tile)));
    this.later(5, () => path.slice(3).forEach((tile) => this.addDung(tile)));
  }

  addDung(tile) {
    const key = `${tile.x},${tile.y}`;
    if (this.dung.has(key)) return;
    this.dung.add(key);
    this.setObject(DUNG, { ...tile, z: 0 }, 10, Shared.random(0, 3));
  }

  /** Standing in dung hurts and slides you off it; agile scarabs drown in it. */
  dungDamage(players) {
    if (this.dung.size === 0) return;
    for (const player of players) {
      const location = player.getLocation();
      if (!this.dung.has(`${location.getX()},${location.getY()}`)) continue;
      Shared.damage(player, this.maxHit(DUNG_FLOOR_HIT));
      this.failPerfect(player, "dung");
      const free = this.freeTileNear(location);
      if (!free) continue;
      const { Animation } = Shared.core();
      player.forceChat?.("Ouch!");
      player.performAnimation(new Animation(ANIMATION.PLAYER_SLIDE));
      Shared.knockback(player, free.getX() - location.getX(), free.getY() - location.getY(), { ticks: 1, speed: 29 });
    }
    for (const scarab of this.agile) {
      const location = scarab.getLocation();
      if (this.dung.has(`${location.getX()},${location.getY()}`)) Shared.kill(scarab);
    }
  }

  freeTileNear(location) {
    for (let radius = 1; radius <= 10; radius++) {
      for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
          if (Math.abs(x) !== radius && Math.abs(y) !== radius) continue;
          const tile = location.transform(x, y);
          if (Shared.floorFree(this.area, tile) && !this.dung.has(`${tile.getX()},${tile.getY()}`)) return tile;
        }
      }
    }
    return null;
  }

  // -------------------------------------------------------------- swarms & overlords

  /** Every Nth swarm of an intermission, from path level 2 (more often from 4), is a trio. */
  trioDue() {
    const level = this.pathLevel();
    const rule = TRIO_EVERY.find((entry) => level >= entry.from);
    return rule ? this.swarmCount % rule.every === 0 : false;
  }

  spawnSwarm(medic) {
    const point = SWARM_POINTS[this.swarmPoint];
    if (!medic && this.trioDue()) {
      for (const tile of point) this.addSwarm(tile, medic);
    } else {
      this.addSwarm(Shared.randomOf(point), medic);
    }
    this.swarmPoint = (this.swarmPoint + Shared.random(1, 2)) % SWARM_POINTS.length;
  }

  addSwarm(tile, medic) {
    const { NpcIdentifiers, Animation } = Shared.core();
    const swarm = this.spawn(NpcIdentifiers.SCARAB_SWARM_6, { ...tile, z: 0 }, { scale: false, points: SCARAB_POINTS });
    if (!swarm) return;
    swarm.__toaScripted = true;
    swarm.__toaSwarm = { medic, delay: SWARM_MOVE_DELAY, fading: false, wait: false };
    swarm.canWalkThroughNPCs = () => true;
    swarm.performAnimation(new Animation(ANIMATION.SWARM_SPAWN));
    this.swarms.add(swarm);
  }

  /** Swarms crawl to her; reaching her heals her. Medic's move every other tick. */
  tickSwarms() {
    const { PathFinder } = Shared.core();
    const target = this.kephri.getLocation();
    for (const swarm of this.swarms) {
      const state = swarm.__toaSwarm;
      if (state.fading) continue;
      if (state.delay > 0) {
        state.delay--;
        continue;
      }
      const location = swarm.getLocation();
      if (location.getDistance(Shared.loc(CENTRE)) <= 3) {
        this.heal(SWARM_HEAL[0], SWARM_HEAL[1]);
        this.soundAll(SOUND.HEAL);
        this.fadeSwarm(swarm);
        continue;
      }
      if (state.medic) {
        state.wait = !state.wait;
        if (!state.wait) {
          const next = { x: location.getX() + Math.sign(CENTRE.x - location.getX()), y: location.getY() + Math.sign(CENTRE.y - location.getY()), z: 0 };
          Shared.walkStraight(swarm, next);
        }
        continue;
      }
      if (swarm.getMovementQueue().size() === 0) PathFinder.calculateWalkRoute(swarm, target.getX() + 2, target.getY() + 2);
    }
  }

  fadeSwarm(swarm) {
    if (!this.alive(swarm) || swarm.__toaSwarm.fading) return;
    const { Animation } = Shared.core();
    swarm.__toaSwarm.fading = true;
    swarm.getMovementQueue().reset();
    swarm.performAnimation(new Animation(ANIMATION.SWARM_FADE));
    this.later(2, () => {
      this.swarms.delete(swarm);
      this.despawn(swarm);
    });
  }

  /** Wiki: they run from anyone who comes close. */
  tickAgile() {
    const { PathFinder } = Shared.core();
    for (const scarab of this.agile) {
      if (scarab.getMovementQueue().size() > 0) continue;
      const location = scarab.getLocation();
      for (const player of this.challengePlayers()) {
        const at = player.getLocation();
        if (at.getDistance(location) > AGILE_RETREAT_AT) continue;
        PathFinder.calculateWalkRoute(scarab,
          location.getX() + Math.sign(location.getX() - at.getX()) * AGILE_RETREAT_TILES,
          location.getY() + Math.sign(location.getY() - at.getY()) * AGILE_RETREAT_TILES);
        break;
      }
    }
  }

  spawnOverlord(kind) {
    if (!this.isStarted() || this.dead) return;
    const { NpcIdentifiers, Animation } = Shared.core();
    const id = { soldier: NpcIdentifiers.SOLDIER_SCARAB, spitting: NpcIdentifiers.SPITTING_SCARAB, arcane: NpcIdentifiers.ARCANE_SCARAB }[kind];
    const tile = { soldier: SOLDIER_SPAWN, spitting: SPITTER_SPAWN, arcane: ARCANE_TILES[0] }[kind];
    // Wiki (25 June 2025): their Defence no longer scales with the raid level.
    const npc = this.spawn(id, { ...tile, z: 0 }, { points: SCARAB_POINTS, scaleDefence: false });
    if (!npc) return;
    npc.__toaOverlord = {
      kind, healTicks: SOLDIER_FIRST_HEAL, attackTicks: SPITTER_FIRST, chargeDelay: ARCANE_CHARGE_FIRST,
      charges: 0, tileIndex: 1, flying: 0, hits: 0,
    };
    npc.performAnimation(new Animation(kind === "arcane" ? ANIMATION.ARCANE_DOWN : ANIMATION.SCARAB_SPAWN));
    if (kind !== "soldier") {
      npc.__toaScripted = true;
      npc.getMovementQueue().setBlockMovement(true);
    } else {
      const target = Shared.randomOf(this.challengePlayers());
      if (target) npc.getCombat().attack(target);
    }
    this.overlords.add(npc);
  }

  tickOverlords(players) {
    for (const npc of this.overlords) {
      const state = npc.__toaOverlord;
      if (state.kind === "soldier") this.tickSoldier(npc, state, players);
      else if (state.kind === "spitting") this.tickSpitter(npc, state, players);
      else this.tickArcane(npc, state, players);
    }
  }

  /** The soldier fights in melee and keeps topping her up, by how healthy it is. */
  tickSoldier(npc, state, players) {
    const target = npc.getCombat().getTarget?.();
    if (!target || target.getHitpoints() <= 0 || !this.inChallenge(target)) {
      const next = Shared.randomOf(players);
      if (next) npc.getCombat().attack(next);
    }
    if (--state.healTicks > 0) return;
    state.healTicks = SOLDIER_HEAL_INTERVAL;
    Shared.tileProjectile(this.area, npc, this.kephri, PROJECTILE.HEAL, { duration: 30, perTile: 0, startHeight: 25, endHeight: 62, angle: 2 });
    this.later(1, () => {
      if (!this.alive(npc) || this.dead) return;
      const share = npc.getHitpoints() / npc.getMaxHitpoints();
      this.heal(SOLDIER_HEAL[0] * share, SOLDIER_HEAL[1] * share);
      this.soundAll(SOUND.HEAL);
    });
  }

  /** The spitter spits at everyone in range every three ticks, poisoning them. */
  tickSpitter(npc, state, players) {
    if (--state.attackTicks > 0) return;
    state.attackTicks = SPITTER_SPEED;
    const { Animation, CombatFactory } = Shared.core();
    npc.performAnimation(new Animation(ANIMATION.SPIT));
    for (const player of players) {
      if (player.getLocation().getDistance(npc.getLocation()) > SPITTER_RANGE) continue;
      const ticks = Shared.tileProjectile(this.area, npc, player, PROJECTILE.SPIT, { delay: 36, duration: 14, perTile: 5, startHeight: 24, endHeight: 31 });
      this.later(ticks, () => {
        if (!this.inChallenge(player) || player.getHitpoints() <= 0) return;
        let damage = Shared.random(0, this.maxHit(SPIT_MAX_HIT));
        if (Shared.isProtected(player, "ranged")) damage = Math.floor(damage * SPIT_PRAYER_FACTOR);
        Shared.damage(player, damage);
        if (damage > 0) this.failPerfect(player, "a bodyguard");
        CombatFactory.poisonEntity(player, SPITTER_POISON);
      });
    }
  }

  /** The arcane scarab charges a blast at everyone, then relocates, as it does when hit enough. */
  tickArcane(npc, state, players) {
    const { Animation } = Shared.core();
    if (state.flying > 0) {
      if (--state.flying === 0) {
        npc.performAnimation(new Animation(ANIMATION.ARCANE_DOWN));
        npc.moveTo(Shared.loc(ARCANE_TILES[state.tileIndex++ % ARCANE_TILES.length], 0));
        npc.setVisible(true);
        state.chargeDelay = ARCANE_CHARGE_FIRST;
      }
      return;
    }
    if (state.chargeDelay <= 0 || --state.chargeDelay > 0) return;
    state.chargeDelay = ARCANE_CHARGE_INTERVAL;
    state.charges++;
    if (state.charges >= ARCANE_STEPS) {
      const origin = npc.getLocation().transform(1, 1);
      for (const player of players) {
        const ticks = Shared.tileProjectile(this.area, origin, player, PROJECTILE.ARCANE, { duration: 115, perTile: 0, startHeight: 0, endHeight: 0, angle: 20 });
        this.later(ticks, () => {
          if (!this.inChallenge(player) || player.getHitpoints() <= 0) return;
          const top = this.maxHit(ARCANE_MAX_HIT);
          let damage = Shared.random(Math.floor(top / 2), top);
          if (Shared.isProtected(player, "magic")) damage = Math.floor(damage / PRAYER_THIRD);
          Shared.damage(player, damage);
          if (damage > 0) this.failPerfect(player, "a bodyguard");
        });
      }
      this.arcaneFlyAway(npc, state);
      return;
    }
    for (let i = 0; i < state.charges && i < ARCANE_CHARGE_OFFSETS.length; i++) {
      const [dx, dy] = ARCANE_CHARGE_OFFSETS[i];
      this.graphic(GRAPHIC.ARCANE_CHARGE, { x: npc.getLocation().getX() + dx, y: npc.getLocation().getY() + dy });
    }
  }

  arcaneFlyAway(npc, state) {
    const { Animation } = Shared.core();
    npc.performAnimation(new Animation(ANIMATION.ARCANE_UP));
    for (let i = 0; i < state.charges && i < ARCANE_CHARGE_OFFSETS.length; i++) {
      const [dx, dy] = ARCANE_CHARGE_OFFSETS[i];
      this.graphic(GRAPHIC.ARCANE_DISPERSE, { x: npc.getLocation().getX() + dx, y: npc.getLocation().getY() + dy });
    }
    state.charges = 0;
    state.flying = ARCANE_LAND_TICKS;
    state.hits = 0;
  }

  graphic(id, tile, delay = 0, height = 0) {
    const location = tile.getX ? tile : Shared.loc({ x: tile.x, y: tile.y, z: 0 });
    const viewer = this.roomPlayers()[0];
    if (viewer) Shared.graphicAt(viewer, id, location, { delay, height });
  }

  /** The room is small enough that its area sounds reach everyone in it. */
  soundAll(id) {
    for (const player of this.roomPlayers()) Shared.sound(player, id);
  }
}

/** Tiles from `from` (exclusive) to `to` (inclusive), as straight as the grid allows. */
function line(from, to) {
  const tiles = [];
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 1; i <= steps; i++) {
    tiles.push({ x: Math.round(from.x + ((to.x - from.x) * i) / steps), y: Math.round(from.y + ((to.y - from.y) * i) / steps) });
  }
  return tiles;
}

function kephriRoomOf(npc) {
  const room = npc?.__toaRoom;
  return room instanceof KephriRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ hooks

/** Her defence floor, an egg always taking a max hit, and the arcane scarab's relocating. */
function kephriHit(event) {
  const room = kephriRoomOf(event.npc);
  if (!room) return;
  const { npc, hit } = event;
  if (npc.__toaKephri) {
    if (room.shieldTicks > 0) {
      for (const part of hit.getHits()) part.setDamage(0);
      hit.updateTotalDamage();
    }
    if (npc.getDefenceLevel() < MIN_DEFENCE) npc.setDefenceLevel(MIN_DEFENCE);
    return;
  }
  const attacker = hit.getAttacker?.();
  if (npc.__toaEgg) {
    if (!attacker?.isPlayer?.()) return;
    const { DamageFormulas } = Shared.core();
    const top = DamageFormulas.sourceMaxHit(attacker, hit.getCombatType());
    hit.getHits().forEach((part, index) => part.setDamage(index === 0 ? top : 0));
    hit.updateTotalDamage();
    return;
  }
  const overlord = npc.__toaOverlord;
  if (overlord?.kind === "arcane" && overlord.flying === 0 && attacker?.isPlayer?.()) {
    overlord.hits++;
    if (hit.getTotalDamage() >= ARCANE_RELOCATE_DAMAGE || overlord.hits >= ARCANE_RELOCATE_HITS + room.teamSize) {
      room.arcaneFlyAway(npc, overlord);
    }
  }
}

/** A bodyguard's own melee, the one attack that doesn't go through the room's scripts. */
function bodyguardHit(event) {
  const attacker = event.hit.getAttacker?.();
  if (!attacker?.__toaOverlord) return;
  const room = kephriRoomOf(attacker);
  if (room && event.hit.getTotalDamage() > 0) room.failPerfect(event.player, "a bodyguard");
}

function kephriDowned(event) {
  const { npc } = event;
  const room = kephriRoomOf(npc);
  if (!room) return;
  if (npc.__toaKephri) {
    // She stays where she fell, as a corpse, rather than despawning.
    event.preventDeath = true;
    if (!room.onDowned()) room.finalDeath();
    return;
  }
  if (npc.__toaEgg) {
    room.eggBroken(npc);
    return;
  }
  if (npc.__toaAgile || npc.__toaSwarm || npc.__toaOverlord) {
    const killer = npc.getCombat().getKiller?.(false);
    if (killer) room.raid.tally(killer, "scarabsKilled");
  }
}

module.exports = function registerKephri(api) {
  Shared.bind(api);
  Raid.registerRoom("SCABARAS_BOSS", KephriRoom);
  api.onNpcHitModify(kephriHit);
  api.onPlayerHitModify(bodyguardHit);
  api.onNpcBeforeDeath(kephriDowned);
  registerScarabCombat(api);
};

function registerScarabCombat(api) {
  const { CombatMethod, CombatType, Animation, Projectile, NpcIdentifiers } = api.core;
  /** The agile scarab's spit: from 60 client cycles, 10 a tile; its hit waits for it (#1862). */
  const spitEnd = (npc, target) => Projectile.arrivalCycles(npc, target, 60);

  class AgileScarabCombatMethod extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    attackDistance() {
      return AGILE_RANGE;
    }

    attackSpeed() {
      return AGILE_SPEED;
    }

    start(npc, target) {
      npc.performAnimation(new Animation(ANIMATION.AGILE_ATTACK));
      Projectile.createProjectile(npc, target, PROJECTILE.SPIT, 60, spitEnd(npc, target), 10, 31).sendProjectile();
    }

    hits(npc, target) {
      const room = kephriRoomOf(npc);
      if (!room) return [];
      return [room.styledHit(npc, target, this, "ranged", AGILE_MAX_HIT, Projectile.ticksToLand(spitEnd(npc, target)), { scale: false })];
    }
  }

  class SoldierScarabCombatMethod extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    attackSpeed() {
      return SOLDIER_SPEED;
    }

    start(npc) {
      npc.performAnimation(new Animation(ANIMATION.SCARAB_ATTACK));
    }

    hits(npc, target) {
      const room = kephriRoomOf(npc);
      if (!room) return [];
      return [room.styledHit(npc, target, this, "melee", SOLDIER_MAX_HIT, 0)];
    }
  }

  api.registerNpcCombatMethodProvider(NpcIdentifiers.AGILE_SCARAB, AgileScarabCombatMethod);
  api.registerNpcCombatMethodProvider(NpcIdentifiers.SOLDIER_SCARAB, SoldierScarabCombatMethod);
}
