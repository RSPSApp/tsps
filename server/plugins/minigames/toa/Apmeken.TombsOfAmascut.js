"use strict";

/**
 * Path of Apmeken, Test of Companionship: eight waves of baboons while one player at a time holds
 * Apmeken's Sight. The sighted player sees which vents will erupt, which roof supports are failing
 * or who is being corrupted; the party fixes it with neutralising potions and hammers from the
 * crates, or the whole room pays for it.
 *
 * Where the numbers come from. Captures are rsprox <rev>/<rec>, ticks as recorded. 234-235 (3280,
 * 844, 3429, 3431) are after the 25 June 2025 changes; 227 (1852, 1845, 1838, 1759, 1753, 581) are
 * before them, with ten waves, and are used for what parties do.
 *
 * Wiki (Strategies, the Baboon pages, Changes):
 * - Eight waves (June 2025 removed two; 234/00844 and 235/03429 show eight, 227/00553 ten). The
 *   table below. An extra combat baboon in any party.
 * - Baboon hitpoints don't scale (May 2024): 25/30, 30/35, 20/25, shaman 40, cursed 20, volatile 8.
 *   Each dies at exactly that much damage in 3280, 844, 3429 and 3431 (131 kills).
 * - A guaranteed max hit from the opposing style: brawler magic, thrower melee, mage ranged, and
 *   ranged on shamans, cursed and volatile baboons (June 2025).
 * - One fix per player in the party, up to the four there are; corruption only in parties, cured by
 *   the sighted player's potion or a potion used on the player; each missed fix hurts everyone; a
 *   needless fix hurts whoever made it; a hammer or a dragon warhammer repairs. Volatile baboons
 *   pick a random player and kill baboons beside them. Poison or venom stops a shaman summoning.
 *   Thralls per shaman at once: 4 or 5. Venom pools last 20 seconds and do 6-8 a tick.
 *
 * Captures:
 * - Hazards: warned 30 ticks in, judged 20 later, then the next warning 30, 26, 24, 22 ticks after
 *   each judgement (all of 234/03280, 227/00101, 227/01757). In a party Sight passes 22 ticks after
 *   the second judgement and the warning is 10 ticks after that (227/01852, 227/01759, every party room).
 * - Sight is first granted 2 ticks in. Messages and colours: 234/03280 ticks 5963-6061, 227/01759
 *   ticks 6906-6936, 227/00581 tick 2554 ("overwhelmed"). The warnings' graphics are sent to the
 *   sighted player alone: 234/03280 ticks 5991 and 6041.
 * - A failed vent shows gas on each vent left and a failed roof shakes each support left: 4 when solo
 *   whatever the fix needed, 2 for one missed of three, 1 for one missed of four (1757 tick 30500,
 *   581 ticks 2452 and 2502, 1852 tick 23846). The supports settle 4 ticks later.
 * - Corruption: the sighted player sees spot 2137 on each other player, and a tint (227/01759 tick
 *   6916); the others see nothing until it clears (227/01852 tick 12047). Everyone within a tile of
 *   the sighted player is cured by one pour, each with sound 6576: 227/01845 tick 2150 (4 players,
 *   same tile), 227/01759 tick 6928 (2 players, next tile), 227/01753 tick 6720.
 * - Waves: the first 16 ticks in, then checked every 2 ticks (every gap in every recording is even).
 *   No timer: 223/00014 waits 114 ticks. The room ends 3 ticks after the last baboon falls
 *   (234/03280 ticks 6154, 6157).
 * - Baboon animations, projectiles and sounds: 234/03280 ticks 5987-5997. Volatile: seq 9756, the blast
 *   2 ticks later (234/03280 ticks 6054, 6056).
 *
 * Estimates (fits, and what they rest on):
 * - Baboons alive when the next wave comes: solo 2, 2, 2, 2, 2, 2, 3 for waves 1-7, up to 4 in the
 *   largest parties, the largest number seen alive across 41 rooms. Least gap between waves: 8.
 * - Damage of a missed fix before the raid's factor, shared out by what was missed: vents 20 (20 at
 *   level 0, 50 at the cap; 12 and 17 for one of four and three: fits exactly, 6 samples), roof 22 (55
 *   at the cap, solo, 1 sample; for one and two of three this gives 18 and 36 against 15 and 35,
 *   3 samples), corruption 13 (32 for all of two, 7 for one of five, 2 samples).
 * - Volatile blast 17-21 before the factor: 41-52 near the cap, 11 hits.
 * - Thrall hitpoints: 2 x raid level factor x party share (solo 2, 6, 8 at raid levels 0, 500, 750;
 *   9, 15, 24, 27, 33 for 2, 3, 5, 6, 8 players; 137 kills; 4 and 7 players interpolated).
 * - Who holds Sight after the second holder: one more switch is captured nowhere; every third hazard.
 *
 * Not captured, kept as they were: damage for a needless fix and its messages, thralls' prayer drain
 * of 2, and how much a cursed baboon's pool hurts after the factor (the Wiki's 6-8 is scaled here).
 * Perfect Apmeken's failure lines: no recording has one, so they are written in the style of Perfect
 * Het's.
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");

const SPAWNS = [{ x: 3800, y: 5288 }, { x: 3808, y: 5288 }, { x: 3816, y: 5288 }, { x: 3816, y: 5272 }, { x: 3808, y: 5272 }, { x: 3800, y: 5272 }];
const VENTS = [{ x: 3800, y: 5284 }, { x: 3816, y: 5284 }, { x: 3816, y: 5276 }, { x: 3800, y: 5276 }];
const ROOF_SKULLS = [{ x: 3804, y: 5288 }, { x: 3812, y: 5288 }, { x: 3812, y: 5272 }, { x: 3804, y: 5272 }];
const ROOFS = [{ x: 3803, y: 5289 }, { x: 3811, y: 5289 }, { x: 3811, y: 5269 }, { x: 3803, y: 5269 }];
const BARRIER_BASE = { x: 3820, y: 5279 };
const ROOM = { minX: 3798, maxX: 3818, minY: 5270, maxY: 5290 };

const ROOF = 45494;
const ROOF_DAMAGED = 45495;
const VENOM_POOL = 45493;
const HAMMER_CRATE = 45497;
const POTION_CRATE = 45498;
const ROOF_ROTATION = 3;

const GRAPHIC = { SIGHT_GRANTED: 2132, SIGHT_LOST: 2133, SENSE_NORTH: 2134, SENSE_SOUTH: 2135, CORRUPTED: 2137, VENT: 2138, ROOF: 2139, THRALL: 2017, EXPLODE_BODY: 2249, EXPLODE_FIRE: 131 };
const GRAPHIC_HEIGHT = { SIGHT: 180, CORRUPTED: 180, VENT_SENSE: 46, ROOF_SENSE: 96 };
const ANIMATION = { REPAIR: 3676, POUR: 2295, TAKE: 827, MELEE: 9742, RANGED: 9745, MAGIC: 9746, SUMMON: 9747, EXPLODE: 9756 };
const PROJECTILE = { RANGED: 2242, MAGIC: 2247 };
const SOUND = { CYCLE: 6574, DONE: 2655, REPAIR: 938, VENT: 6569, ROOF: 6573, POUR: 2401, NEUTRALISED: 6577, CURED: 6576, CORRUPTED: 2843, TAKE: 2582, THRALL_SUMMON: 100, THRALL_BORN: 6579, EXPLODE: 156, POOL: 3308 };
const SOUND_RADIUS = { THRALL: 6, POOL: 4, EXPLODE: 6 };
const COLOUR = { SENSE: "a53fff", SIGHT: "3366ff", FIXED: "229628", FAILED: "ff3045" };

const SIGHT_DELAY = 2;
const FIRST_WARNING = 30;
const HAZARD_JUDGED_AFTER = 20;
/** Ticks from a judgement to the next warning. */
const WARNING_GAPS = [30, 26, 24, 22];
const SIGHT_PASSES_AFTER = 22;
const WARNING_AFTER_SIGHT = 10;
const FIRST_SIGHT_HAZARDS = 2;
const LATER_SIGHT_HAZARDS = 3;
const ROOF_SETTLES = 4;
const MAX_FIXES = 4;
const CORRUPTED_REFRESH = 2;
const CURE_RADIUS = 1;

const FIRST_WAVE = 16;
const WAVE_CHECK_INTERVAL = 2;
const WAVE_MIN_GAP = 8;
const END_DELAY = 3;
/** Baboons (not thralls) that may be alive for wave n + 1 to come, by party size. */
const WAVE_THRESHOLDS = { SOLO: [2, 2, 2, 2, 2, 2, 3], SMALL: [2, 2, 2, 2, 2, 3, 3], LARGE: [3, 2, 2, 2, 3, 4, 4] };
const LARGE_PARTY = 5;

const VENT_DAMAGE = 20;
const ROOF_DAMAGE = 22;
const CORRUPTION_DAMAGE = 13;
const VENOM_DAMAGE = [6, 8];
const VENOM_POOL_TICKS = 33; // Wiki: 20 seconds. Captured: 30.
const BLAST_DAMAGE = [17, 21];
const BLAST_TICKS = 2;
const BLAST_RADIUS = 1;
const BABOON_POINTS = 1.2;
const THRALL_BASE_HITPOINTS = 2;
const THRALL_PARTY_SHARE = [1, 1.5, 2.4, 3.2, 3.9, 4.4, 5, 5.5];
const THRALL_DRAIN = 2;
const THRALLS_AT_ONCE = [4, 5];
const PERFECT_TICKS = 300;
const TASK = "Perfect Apmeken";

const HAZARD = { VENTS: "vents", ROOF: "roof", CORRUPTION: "corruption" };

function waves(I) {
  const MELEE = I.BABOON_BRAWLER;
  const RANGED = I.BABOON_THROWER;
  const MAGE = I.BABOON_MAGE;
  const MELEE2 = I.BABOON_BRAWLER_2;
  const RANGED2 = I.BABOON_THROWER_2;
  const MAGE2 = I.BABOON_MAGE_2;
  const SHAMAN = I.BABOON_SHAMAN;
  const VOLATILE = I.VOLATILE_BABOON;
  const CURSED = I.CURSED_BABOON;
  return {
    special: [SHAMAN, VOLATILE, CURSED],
    // -1 is any of the special three. Wiki's table; 3280, 844, 3429 and 3431 agree in every wave.
    waves: [
      [MELEE, MELEE, SHAMAN], [RANGED, RANGED, VOLATILE], [MAGE, MAGE, CURSED], [RANGED2, RANGED2, -1, -1, -1],
      [MAGE2, MAGE2, SHAMAN, -1, -1], [MELEE2, MELEE2, SHAMAN, -1, -1], [MELEE2, RANGED2, SHAMAN, CURSED, CURSED], [SHAMAN, VOLATILE, VOLATILE, -1, -1],
    ],
    // A party's extra baboon, wave by wave (227/01852, 01759, 01845, 01838: the same for 2 to 8 players).
    extra: [MELEE, RANGED, MAGE, RANGED2, MAGE2, MELEE2, SHAMAN, -1],
  };
}

class ApmekenPuzzleRoom extends Raid.Room {
  build() {
    this.wave = 0;
    this.nextWaveCheck = 0;
    this.lastWave = 0;
    this.ending = false;
    this.baboons = new Set();
    this.sight = null;
    this.sightDue = 0;
    this.nextEvent = 0;
    this.hazard = null;
    this.hazards = 0;
    this.sightHazards = 0;
    this.sightHazardLimit = FIRST_SIGHT_HAZARDS;
    this.required = 0;
    this.done = [false, false, false, false];
    this.corrupted = new Set();
    this.corruptedAtStart = 0;
    this.pools = new Map();
    this.roofTicks = 0;
    this.perfectDue = 0;
    this.nextCorruptedGlow = 0;
    this.passDue = false;
    this.needless = false;
  }

  onStart() {
    const now = Shared.cycle();
    this.sightDue = now + SIGHT_DELAY;
    this.nextEvent = now + FIRST_WARNING;
    this.nextWaveCheck = now + FIRST_WAVE;
    this.perfectDue = now + PERFECT_TICKS;
  }

  onPlayerArrive(player) {
    this.sendSight(player);
  }

  onComplete() {
    for (const player of this.challengePlayers()) player.setVenomed?.(false);
    this.clearPools();
    this.resetRoofs();
    for (let y = 0; y < 2; y++) this.setObject(-1, { x: BARRIER_BASE.x, y: BARRIER_BASE.y + y, z: 0 }, 10);
    const { ItemIdentifiers } = Shared.core();
    for (const player of this.roomPlayers()) {
      player.getInventory().delete(ItemIdentifiers.NEUTRALISING_POTION, 10000);
      player.getInventory().delete(ItemIdentifiers.HAMMER, 28);
    }
    this.setSight(null);
    if (this.teamSize >= 2 && Shared.cycle() - this.startCycle < PERFECT_TICKS) this.raid.completeTask(TASK);
  }

  onReset() {
    for (const baboon of this.baboons) this.despawn(baboon);
    this.clearPools();
    this.resetRoofs();
    this.setSight(null);
    this.build();
  }

  clearPools() {
    for (const pool of this.pools.values()) this.setObject(-1, pool, 10);
    this.pools.clear();
  }

  resetRoofs() {
    for (const tile of ROOFS) this.setObject(ROOF, { ...tile, z: 0 }, 10, ROOF_ROTATION);
  }

  setSight(player) {
    if (this.sight) this.sight.__toaSight = false;
    this.sight = player;
    if (player) player.__toaSight = true;
    this.raid.refreshHudStates();
    for (const viewer of this.raid.players) this.sendSight(viewer);
  }

  sendSight(viewer) {
    this.raid.players.forEach((member, index) => {
      viewer.getPacketSender().sendVarbit(Shared.VARBIT.HUD_PLAYER_SIGHT_BASE + index, member === this.sight ? 1 : 0);
    });
  }

  /** The party's chance at the task goes; a solo player has none to lose. */
  failPerfect(reason) {
    if (this.teamSize >= 2) this.raid.failTask(TASK, reason);
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (!this.isStarted()) return;
    const players = this.challengePlayers();
    const now = Shared.cycle();
    if (now >= this.perfectDue) {
      this.perfectDue = Infinity;
      this.failPerfect("The room wasn't completed fast enough.");
    }
    if (this.sightDue && now >= this.sightDue && players.length > 0) {
      this.sightDue = 0;
      this.passSight();
    }
    if (now >= this.nextWaveCheck) {
      this.nextWaveCheck = now + WAVE_CHECK_INTERVAL;
      this.checkWave(now);
    }
    if (now >= this.nextEvent) this.nextHazardEvent(now, players);
    if (this.corrupted.size > 0 && now >= this.nextCorruptedGlow) this.glowCorrupted(now);
    for (const pool of this.pools.values()) {
      for (const player of players) {
        if (player.getLocation().getX() !== pool.x || player.getLocation().getY() !== pool.y) continue;
        this.hurt(player, Shared.random(VENOM_DAMAGE[0], VENOM_DAMAGE[1]));
        player.setVenomed?.(true);
        this.failPerfect(`${Shared.displayName(player)} stood in venom.`);
      }
    }
    if (this.roofTicks > 0 && --this.roofTicks <= 0) this.resetRoofs();
    this.tickBaboons(players);
  }

  /** Warnings and judgements alternate; Sight passes between them, on its own timer. */
  nextHazardEvent(now, players) {
    if (this.hazard) {
      this.judge(now, players);
      return;
    }
    if (this.passDue) {
      this.passDue = false;
      this.passSight();
      this.nextEvent = now + WARNING_AFTER_SIGHT;
      return;
    }
    this.warn(now, players);
  }

  // -------------------------------------------------------------- Sight

  passSight() {
    const previous = this.sight;
    if (previous && previous.getHitpoints() > 0 && this.inChallenge(previous)) {
      previous.sendMessage(`<col=${COLOUR.SIGHT}>You no longer have Apmeken's Sight.`);
      previous.performGraphic(Shared.gfx(GRAPHIC.SIGHT_LOST, { height: GRAPHIC_HEIGHT.SIGHT }));
    }
    const candidates = this.challengePlayers((player) => player !== previous);
    // Wiki: the first in gets it first; afterwards it goes to someone at random.
    const next = previous ? (candidates.length > 0 ? Shared.randomOf(candidates) : previous) : candidates[0] ?? null;
    this.setSight(next);
    if (next) next.performGraphic(Shared.gfx(GRAPHIC.SIGHT_GRANTED, { height: GRAPHIC_HEIGHT.SIGHT }));
    for (const player of this.challengePlayers()) {
      Shared.sound(player, SOUND.CYCLE);
      if (next) player.sendMessage(`<col=${COLOUR.SIGHT}>${player === next ? "You have" : `${Shared.displayName(next)} has`} been granted Apmeken's Sight.`);
    }
    this.sightHazards = 0;
  }

  /** A hazard begins: only the sighted player is told which. */
  warn(now, players) {
    if (!this.sight || this.sight.getHitpoints() <= 0 || !this.inChallenge(this.sight)) this.passSight();
    if (!this.sight) {
      this.nextEvent = now + 1;
      return;
    }
    const party = players.length > 1;
    this.hazard = Shared.randomOf(party ? [HAZARD.VENTS, HAZARD.ROOF, HAZARD.CORRUPTION] : [HAZARD.VENTS, HAZARD.ROOF]);
    this.required = Math.min(MAX_FIXES, players.length);
    this.done.fill(false);
    for (const player of players) {
      Shared.sound(player, SOUND.CYCLE);
      if (player !== this.sight) player.sendMessage(`<col=${COLOUR.SENSE}>You sense an issue somewhere in the room.`);
    }
    if (this.hazard === HAZARD.VENTS) {
      this.sight.sendMessage(`<col=${COLOUR.SENSE}>You sense some strange fumes coming from holes in the floor.`);
      VENTS.forEach((tile, index) => this.sightGraphic(index < 2 ? GRAPHIC.SENSE_NORTH : GRAPHIC.SENSE_SOUTH, tile, GRAPHIC_HEIGHT.VENT_SENSE));
    } else if (this.hazard === HAZARD.ROOF) {
      this.sight.sendMessage(`<col=${COLOUR.SENSE}>You sense an issue with the roof supports.`);
      ROOF_SKULLS.forEach((tile, index) => this.sightGraphic(index < 2 ? GRAPHIC.SENSE_NORTH : GRAPHIC.SENSE_SOUTH, tile, GRAPHIC_HEIGHT.ROOF_SENSE));
    } else {
      this.sight.sendMessage(`<col=${COLOUR.SENSE}>You sense Amascut's corruption beginning to take hold.`);
      this.corrupted = new Set(players.filter((player) => player !== this.sight));
      this.corruptedAtStart = this.corrupted.size;
      Shared.sound(this.sight, SOUND.CORRUPTED, 20);
      this.glowCorrupted(now);
    }
    this.nextEvent = now + HAZARD_JUDGED_AFTER;
  }

  /**
   * The sighted player alone sees who is corrupted. OSRS draws it on the player (spot 2137 and a
   * tint, for that viewer only); PacketSender has neither, so it is a tile graphic that keeps up.
   */
  glowCorrupted(now) {
    this.nextCorruptedGlow = now + CORRUPTED_REFRESH;
    for (const player of this.corrupted) {
      this.sight?.getPacketSender().sendGraphic(Shared.gfx(GRAPHIC.CORRUPTED, { height: GRAPHIC_HEIGHT.CORRUPTED }), player.getLocation());
    }
  }

  /** Only the sighted player sees the warning skulls. */
  sightGraphic(id, tile, height) {
    this.sight?.getPacketSender().sendGraphic(Shared.gfx(id, { height }), Shared.loc(tile, 0));
  }

  /** The hazard's time is up: fixed, or everyone is hurt by the share that was missed. */
  judge(now, players) {
    const hazard = this.hazard;
    this.hazard = null;
    const missed = hazard === HAZARD.CORRUPTION
      ? [...this.corrupted].filter((player) => players.includes(player)).length
      : Math.max(0, this.required - this.done.filter(Boolean).length);
    if (missed === 0) this.hazardFixed(hazard, players);
    else this.hazardFailed(hazard, missed, players);
    this.corrupted.clear();
    this.hazards++;
    this.sightHazards++;
    this.done.fill(false);
    if (players.length > 1 && this.sightHazards >= this.sightHazardLimit) {
      this.sightHazardLimit = LATER_SIGHT_HAZARDS;
      this.passDue = true;
      this.nextEvent = now + SIGHT_PASSES_AFTER;
    } else {
      this.nextEvent = now + WARNING_GAPS[Math.min(this.hazards - 1, WARNING_GAPS.length - 1)];
    }
  }

  hazardFixed(hazard, players) {
    const who = players.length > 1 ? "your group" : "you";
    const done = { [HAZARD.VENTS]: "neutralising some dangerous fumes", [HAZARD.ROOF]: "repairing the roof supports", [HAZARD.CORRUPTION]: "overcoming Amascut's corruption" }[hazard];
    for (const player of players) {
      player.sendMessage(`<col=${COLOUR.SIGHT}>Apmeken's Sight guides ${who} into ${done}.`);
      Shared.sound(player, SOUND.DONE);
    }
  }

  hazardFailed(hazard, missed, players) {
    if (hazard === HAZARD.VENTS) {
      this.erupt(this.undone(), players, this.shareOf(VENT_DAMAGE, missed, this.required));
    } else if (hazard === HAZARD.ROOF) {
      this.collapse(this.undone(), players, this.shareOf(ROOF_DAMAGE, missed, this.required));
    } else {
      const amount = this.shareOf(CORRUPTION_DAMAGE, missed, this.corruptedAtStart);
      for (const player of players) {
        player.sendMessage(`<col=${COLOUR.FAILED}>Your group is overwhelmed by Amascut's corruption!`);
        Shared.damage(player, amount);
      }
    }
    this.failPerfect("A danger was allowed to trigger.");
  }

  undone() {
    return [0, 1, 2, 3].filter((index) => !this.done[index]);
  }

  /** The scaled damage, by the part of the fixes that were missed. */
  shareOf(base, missed, of) {
    return Math.ceil(this.maxHit(base) * missed / Math.max(1, of) - 0.5);
  }

  erupt(indices, players, amount) {
    for (const player of players) {
      Shared.sound(player, SOUND.VENT);
      player.sendMessage(this.needless
        ? `<col=${COLOUR.FAILED}>Some toxic fumes errupt out of the hole! There was clearly nothing to neutralise.`
        : `<col=${COLOUR.FAILED}>The fumes filling the room suddenly ignite!`);
      Shared.damage(player, amount);
    }
    for (const index of indices) this.graphic(GRAPHIC.VENT, VENTS[index]);
  }

  collapse(indices, players, amount) {
    for (const player of players) {
      Shared.sound(player, SOUND.ROOF);
      this.graphic(GRAPHIC.ROOF, player.getLocation());
      player.sendMessage(this.needless
        ? `<col=${COLOUR.FAILED}>Some debris falls on you! The roof support clearly didn't need repairing.`
        : `<col=${COLOUR.FAILED}>Damaged roof supports cause some debris to fall on you!`);
      Shared.damage(player, amount);
    }
    this.roofTicks = ROOF_SETTLES;
    for (const index of indices) this.setObject(ROOF_DAMAGED, { ...ROOFS[index], z: 0 }, 10, ROOF_ROTATION);
  }

  // -------------------------------------------------------------- fixing

  /** A fix nobody needed: whoever made it pays alone. */
  needlessFix(hurtBy) {
    this.needless = true;
    hurtBy();
    this.needless = false;
  }

  repairRoof(player, object) {
    const location = object.getLocation();
    const index = ROOFS.findIndex((tile) => tile.x === location.getX() && tile.y === location.getY());
    if (index === -1) return;
    const { Animation } = Shared.core();
    if (!hasHammer(player)) {
      player.sendMessage("You need a hammer to repair this roof support.");
    } else if (this.hazard !== HAZARD.ROOF) {
      this.needlessFix(() => this.collapse([index], [player], this.maxHit(ROOF_DAMAGE)));
      this.failPerfect(`${Shared.displayName(player)} repaired a roof support needlessly.`);
    } else if (this.done[index]) {
      player.sendMessage("This roof support has already been repaired.");
    } else {
      player.sendMessage(`<col=${COLOUR.FIXED}>You repair the damaged roof support.`);
      player.performAnimation(new Animation(ANIMATION.REPAIR));
      Shared.sound(player, SOUND.REPAIR);
      this.done[index] = true;
    }
  }

  pourPotion(player) {
    const { ItemIdentifiers, Animation } = Shared.core();
    const location = player.getLocation();
    const index = VENTS.findIndex((tile) => tile.x === location.getX() && tile.y === location.getY());
    player.performAnimation(new Animation(ANIMATION.POUR));
    Shared.sound(player, SOUND.POUR);
    player.getInventory().delete(ItemIdentifiers.NEUTRALISING_POTION, 1);
    if (this.hazard === HAZARD.CORRUPTION && player === this.sight) {
      const cured = [...this.corrupted].filter((other) => player.getLocation().getDistance(other.getLocation()) <= CURE_RADIUS);
      if (cured.length > 0) {
        for (const other of cured) this.cure(player, other);
        return;
      }
    }
    if (index === -1) {
      player.sendMessage("You pour the potion on the floor, but nothing happens.");
    } else if (this.hazard !== HAZARD.VENTS) {
      this.needlessFix(() => this.erupt([index], [player], this.maxHit(VENT_DAMAGE)));
      this.failPerfect(`${Shared.displayName(player)} poured a potion needlessly.`);
    } else if (this.done[index]) {
      player.sendMessage("The fumes from this hole have already been neutralised.");
    } else {
      player.sendMessage(`<col=${COLOUR.FIXED}>You neutralise the fumes coming from the hole.`);
      Shared.sound(player, SOUND.NEUTRALISED);
      this.done[index] = true;
    }
  }

  cure(healer, player) {
    this.corrupted.delete(player);
    healer.sendMessage(`<col=${COLOUR.FIXED}>You neutralise ${Shared.displayName(player)}'s corruption.`);
    player.sendMessage(`<col=${COLOUR.FIXED}>${Shared.displayName(healer)} neutralises your corruption.`);
    Shared.sound(healer, SOUND.CURED);
    Shared.sound(player, SOUND.CURED);
  }

  /** Wiki: instead of gathering, the sighted player can use the potion on someone. */
  potionOnPlayer(player, target) {
    const { ItemIdentifiers, Animation } = Shared.core();
    if (player !== this.sight || this.hazard !== HAZARD.CORRUPTION || !this.corrupted.has(target)) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    player.performAnimation(new Animation(ANIMATION.POUR));
    Shared.sound(player, SOUND.POUR);
    player.getInventory().delete(ItemIdentifiers.NEUTRALISING_POTION, 1);
    this.cure(player, target);
  }

  // -------------------------------------------------------------- baboons

  /** A new wave once few enough of the last are left; the room ends with the last wave's end. */
  checkWave(now) {
    const alive = [...this.baboons].filter((baboon) => baboon.__toaBaboon.kind !== "thrall").length;
    const table = waves(Shared.core().NpcIdentifiers);
    if (this.wave >= table.waves.length) {
      if (this.baboons.size === 0 && !this.ending) {
        this.ending = true;
        this.later(END_DELAY, () => this.complete());
      }
      return;
    }
    if (this.wave > 0) {
      if (now - this.lastWave < WAVE_MIN_GAP) return;
      if (alive > waveThreshold(this.teamSize)[this.wave - 1]) return;
    }
    this.lastWave = now;
    this.spawnWave(table);
  }

  spawnWave(table) {
    const order = Shared.shuffle(SPAWNS.map((_, index) => index));
    const ids = [...table.waves[this.wave]];
    if (this.teamSize > 1) ids.push(table.extra[this.wave]);
    ids.forEach((id, index) => {
      const spawnIndex = order[index % order.length];
      const npcId = id === -1 ? Shared.randomOf(table.special) : id;
      const baboon = this.spawnBaboon(npcId, { ...SPAWNS[spawnIndex], z: 0 }, spawnIndex < 3 ? 6 : 1);
      if (!baboon) return;
      baboon.__toaBaboon = { kind: kindOf(npcId), thrallCap: Shared.random(THRALLS_AT_ONCE[0], THRALLS_AT_ONCE[1]), blastTicks: 0 };
      if (baboon.__toaBaboon.kind === "cursed") baboon.__toaScripted = true;
      this.baboons.add(baboon);
      this.engage(baboon);
    });
    this.wave++;
  }

  /** Baboons' hitpoints don't scale; the raid's accuracy and defence do. */
  spawnBaboon(id, tile, face) {
    const baboon = this.spawn(id, tile, { points: BABOON_POINTS, scale: false, face });
    baboon?.setRollFactor(1 + this.settings.raidLevel / 250);
    return baboon;
  }

  engage(baboon) {
    if (baboon.__toaBaboon.kind === "cursed") return;
    const target = Shared.randomOf(this.challengePlayers());
    if (target) baboon.getCombat().attack(target);
  }

  baboonDied(baboon) {
    this.baboons.delete(baboon);
  }

  /** Volatile baboons blow up; cursed ones wander leaving venom; the rest find someone to fight. */
  tickBaboons(players) {
    for (const baboon of [...this.baboons]) {
      const state = baboon.__toaBaboon;
      if (baboon.getHitpoints() <= 0 || baboon.isRegistered?.() === false) continue;
      if (state.kind !== "cursed" && !baboon.getCombat().getTarget?.() && state.blastTicks === 0) this.engage(baboon);
      if (state.blastTicks > 0 && --state.blastTicks === 0) this.blast(baboon, players);
      if (state.kind === "cursed") this.wander(baboon);
    }
  }

  /** Hurts anyone within a tile and kills any baboon there, whatever its health. */
  blast(baboon, players) {
    const location = baboon.getLocation();
    this.graphic(GRAPHIC.EXPLODE_FIRE, location);
    this.graphic(GRAPHIC.EXPLODE_BODY, location);
    this.areaSound(SOUND.EXPLODE, location, SOUND_RADIUS.EXPLODE);
    for (const player of players) {
      if (player.getLocation().getDistance(location) > BLAST_RADIUS) continue;
      this.hurt(player, Shared.random(BLAST_DAMAGE[0], BLAST_DAMAGE[1]));
      this.failPerfect(`${Shared.displayName(player)} was hit by a volatile baboon.`);
    }
    for (const other of this.baboons) {
      if (other !== baboon && other.getLocation().getDistance(location) <= BLAST_RADIUS) Shared.kill(other);
    }
    this.baboonDied(baboon);
    this.despawn(baboon);
  }

  /** Wiki: never over a vent or the tile in front of a pillar, venom on the rest of its way. */
  wander(baboon) {
    const { PathFinder } = Shared.core();
    const location = baboon.getLocation();
    if (!isKeptClear(location.getX(), location.getY())) this.placePool(location);
    if (baboon.getMovementQueue().size() !== 0) return;
    const x = Shared.random(ROOM.minX, ROOM.maxX);
    const y = Shared.random(ROOM.minY, ROOM.maxY);
    if (!isKeptClear(x, y)) PathFinder.calculateWalkRoute(baboon, x, y);
  }

  placePool(location) {
    const tileKey = `${location.getX()},${location.getY()}`;
    if (this.pools.has(tileKey)) return;
    const tile = { x: location.getX(), y: location.getY(), z: 0 };
    this.pools.set(tileKey, tile);
    this.setObject(VENOM_POOL, tile, 10, Shared.random(0, 3));
    this.areaSound(SOUND.POOL, location, SOUND_RADIUS.POOL);
    this.later(VENOM_POOL_TICKS, () => {
      if (this.pools.get(tileKey) !== tile) return;
      this.pools.delete(tileKey);
      this.setObject(-1, tile, 10);
    });
  }

  areaSound(id, location, radius) {
    for (const player of this.roomPlayers()) {
      if (player.getLocation().getDistance(location) <= radius) Shared.sound(player, id);
    }
  }

  freeTileAround(location) {
    const tiles = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const tile = location.transform(dx, dy);
        // The barriers are walls, not blocked floor: a thrall in one's doorway can't be reached.
        if (Shared.floorFree(this.area, tile) && Shared.inBox(tile, ROOM)) tiles.push(tile);
      }
    }
    return Shared.randomOf(tiles);
  }

  /** One thrall, up beside its shaman a tick after the summoning. */
  summonThrall(shaman, target) {
    const { NpcIdentifiers } = Shared.core();
    const tile = this.freeTileAround(shaman.getLocation());
    if (!tile) return;
    const thrall = this.spawnBaboon(NpcIdentifiers.BABOON_THRALL, { x: tile.getX(), y: tile.getY(), z: 0 });
    if (!thrall) return;
    const hitpoints = Math.round(THRALL_BASE_HITPOINTS * (1 + 0.004 * this.settings.raidLevel) * THRALL_PARTY_SHARE[Math.min(this.teamSize, THRALL_PARTY_SHARE.length) - 1]);
    thrall.setMaxHitpoints(hitpoints);
    thrall.setHitpoints(hitpoints);
    thrall.__toaBaboon = { kind: "thrall", shaman, blastTicks: 0 };
    thrall.performGraphic(Shared.gfx(GRAPHIC.THRALL));
    this.areaSound(SOUND.THRALL_BORN, tile, SOUND_RADIUS.THRALL);
    this.baboons.add(thrall);
    if (target) thrall.getCombat().attack(target);
  }

  thrallsOf(shaman) {
    return [...this.baboons].filter((baboon) => baboon.__toaBaboon.shaman === shaman).length;
  }

  /** One baboon swing, by kind. Returns the hits for the combat engine. */
  baboonAttack(npc, target, method) {
    const { Animation, Skill } = Shared.core();
    const state = npc.__toaBaboon;
    const base = npc.getDefinition()?.getMaxHit?.() ?? 4;
    if (state.kind === "volatile") {
      if (state.blastTicks > 0) return [];
      npc.getCombat().reset();
      npc.setUntargetable(true);
      npc.getMovementQueue().setBlockMovement(true);
      npc.performAnimation(new Animation(ANIMATION.EXPLODE));
      state.blastTicks = BLAST_TICKS;
      return [];
    }
    if (state.kind === "shaman" && !npc.isPoisoned?.() && !npc.isVenomed?.() && this.thrallsOf(npc) < state.thrallCap) {
      npc.performAnimation(new Animation(ANIMATION.SUMMON));
      this.areaSound(SOUND.THRALL_SUMMON, npc.getLocation(), SOUND_RADIUS.THRALL);
      this.later(1, () => {
        if (npc.getHitpoints() > 0 && this.baboons.has(npc)) this.summonThrall(npc, target);
      });
      return [];
    }
    if (state.kind === "melee" || state.kind === "thrall") {
      npc.performAnimation(new Animation(ANIMATION.MELEE));
      const hit = this.styledHit(npc, target, method, "melee", base, 0);
      if (state.kind === "thrall" && hit.isAccurate()) target.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, THRALL_DRAIN, 0);
      return [hit];
    }
    if (state.kind === "ranged") {
      npc.performAnimation(new Animation(ANIMATION.RANGED));
      const ticks = Shared.tileProjectile(this.area, npc, target, PROJECTILE.RANGED, { delay: 67, duration: 20, perTile: 4, startHeight: 17, endHeight: 36, angle: 14 });
      return [this.styledHit(npc, target, method, "ranged", base, ticks)];
    }
    npc.performAnimation(new Animation(ANIMATION.MAGIC));
    const ticks = Shared.tileProjectile(this.area, npc, target, PROJECTILE.MAGIC, { delay: 30, duration: 20, perTile: 4, startHeight: 20, endHeight: 34 });
    const hit = this.styledHit(npc, target, method, "magic", base, ticks);
    if (state.kind === "shaman") target.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, hit.getTotalDamage(), 0);
    return [hit];
  }

  graphic(id, tile, options = {}) {
    const viewer = this.roomPlayers()[0];
    if (!viewer) return;
    const location = tile.getX ? tile : Shared.loc({ x: tile.x, y: tile.y, z: 0 });
    Shared.graphicAt(viewer, id, location, options);
  }
}

function waveThreshold(teamSize) {
  if (teamSize <= 1) return WAVE_THRESHOLDS.SOLO;
  return teamSize < LARGE_PARTY ? WAVE_THRESHOLDS.SMALL : WAVE_THRESHOLDS.LARGE;
}

function isKeptClear(x, y) {
  return VENTS.some((tile) => tile.x === x && tile.y === y) || ROOF_SKULLS.some((tile) => tile.x === x && tile.y === y);
}

function hasHammer(player) {
  const { ItemIdentifiers, Equipment } = Shared.core();
  if (player.getInventory().contains(ItemIdentifiers.HAMMER) || player.getInventory().contains(ItemIdentifiers.DRAGON_WARHAMMER)) return true;
  return player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.() === ItemIdentifiers.DRAGON_WARHAMMER;
}

function kindOf(id) {
  const I = Shared.core().NpcIdentifiers;
  if (id === I.BABOON_BRAWLER || id === I.BABOON_BRAWLER_2) return "melee";
  if (id === I.BABOON_THROWER || id === I.BABOON_THROWER_2) return "ranged";
  if (id === I.BABOON_MAGE || id === I.BABOON_MAGE_2) return "magic";
  if (id === I.BABOON_SHAMAN) return "shaman";
  if (id === I.VOLATILE_BABOON) return "volatile";
  if (id === I.CURSED_BABOON) return "cursed";
  return "thrall";
}

function apmekenRoom(player) {
  const room = Raid.roomOf(player);
  return room instanceof ApmekenPuzzleRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ hooks

function takeSupplies(event) {
  const room = apmekenRoom(event.player);
  if (!room || (event.objectId !== HAMMER_CRATE && event.objectId !== POTION_CRATE)) return false;
  const { player } = event;
  const { ItemIdentifiers, Animation } = Shared.core();
  const hammer = event.objectId === HAMMER_CRATE;
  const id = hammer ? ItemIdentifiers.HAMMER : ItemIdentifiers.NEUTRALISING_POTION;
  if (player.getInventory().getFreeSlots() < 1 && (hammer || !player.getInventory().contains(id))) {
    player.sendMessage("You need more space in your inventory to do that.");
    return true;
  }
  player.getInventory().adds(id, hammer ? 1 : 100);
  player.sendMessage(`You take ${hammer ? "a hammer." : "some potions."}`);
  player.performAnimation(new Animation(ANIMATION.TAKE));
  Shared.sound(player, SOUND.TAKE);
  return true;
}

function repairRoof(event) {
  const room = apmekenRoom(event.player);
  if (!room || event.objectId !== ROOF) return false;
  room.repairRoof(event.player, event.object);
  return true;
}

function pourPotion({ player }) {
  const room = apmekenRoom(player);
  if (!room) return false;
  room.pourPotion(player);
  return true;
}

function potionOnPlayer(event) {
  const { ItemIdentifiers } = Shared.core();
  if (event.itemId !== ItemIdentifiers.NEUTRALISING_POTION) return;
  const room = apmekenRoom(event.player);
  if (!room) return;
  event.handled = true;
  room.potionOnPlayer(event.player, event.target);
}

function baboonDowned(event) {
  const room = event.npc?.__toaRoom;
  if (room instanceof ApmekenPuzzleRoom && event.npc.__toaBaboon) room.baboonDied(event.npc);
}

/** Wiki: the opposing style always lands the attacker's max hit, thralls excepted. */
function baboonWeakness(event) {
  const kind = event.target?.__toaBaboon?.kind;
  if (!kind || !event.attacker?.isPlayer?.()) return;
  const { CombatType } = Shared.core();
  const weakTo = { melee: CombatType.MAGIC, ranged: CombatType.MELEE, magic: CombatType.RANGED, shaman: CombatType.RANGED, cursed: CombatType.RANGED, volatile: CombatType.RANGED }[kind];
  if (weakTo !== undefined && event.combatType === weakTo) {
    event.forceAccurate = true;
    event.forceMaxHit = true;
  }
}

module.exports = function registerApmekenPuzzle(api) {
  Shared.bind(api);
  Raid.registerRoom("APMEKEN_PUZZLE", ApmekenPuzzleRoom);
  Raid.registerRaidItems(api.core.ItemIdentifiers.NEUTRALISING_POTION);
  api.onObjectClick([HAMMER_CRATE, POTION_CRATE], 1, takeSupplies);
  api.onObjectClick(ROOF, 1, repairRoof);
  api.onItemAction("Neutralising potion", { Pour: pourPotion });
  api.onItemOnPlayer(potionOnPlayer);
  api.onNpcBeforeDeath(baboonDowned);
  api.onCombatHitRoll(baboonWeakness);
  registerBaboonCombat(api);
};

function registerBaboonCombat(api) {
  const { CombatMethod, CombatType, NpcIdentifiers: I } = api.core;

  class BaboonCombatMethod extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    attackDistance(npc) {
      const kind = npc.__toaBaboon?.kind;
      return kind === "melee" || kind === "thrall" || kind === "volatile" ? 1 : 8;
    }

    hits(npc, target) {
      const room = npc.__toaRoom;
      if (!(room instanceof ApmekenPuzzleRoom) || !npc.__toaBaboon) return [];
      return room.baboonAttack(npc, target, Raid.styleMethod(styleOf(npc.__toaBaboon.kind)));
    }
  }

  api.registerNpcCombatMethodProvider([
    I.BABOON_BRAWLER, I.BABOON_THROWER, I.BABOON_MAGE, I.BABOON_BRAWLER_2, I.BABOON_THROWER_2, I.BABOON_MAGE_2,
    I.BABOON_SHAMAN, I.VOLATILE_BABOON, I.BABOON_THRALL,
  ], BaboonCombatMethod);
}

function styleOf(kind) {
  if (kind === "ranged") return "ranged";
  if (kind === "magic" || kind === "shaman") return "magic";
  return "melee";
}
