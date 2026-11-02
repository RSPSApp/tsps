"use strict";

/**
 * Tombs of Amascut: the Wardens (Amascut's Promise).
 *
 * WARDENS_P1 holds phases one and two, WARDENS_P3 the final phase. Osmumten waits until everyone
 * chooses Begin, or two minutes after the first does. Phase one: the obelisk is attacked while
 * orbs feed the Wardens' platforms; a full platform calls blades or an energy ball. Phase two:
 * the stronger Warden fights while the obelisk casts its beams and skulls; breaking the shield
 * throws out the core. Phase three: the other Warden slams the floor, sends siphons at
 * 80/60/40/20% with phantoms joining, and at 5% heals while the floor really falls away.
 *
 * Where it comes from. Captures are cited "rec tick" (rec 14 is rev 223 on a normal world, 3429
 * rev 234-235; most others Leagues V). The invocations of every recorded raid were read from
 * script 6729's bitmaps on the party board, so "by invocation" below means that, over 40 fights.
 *
 * Wiki numbers (Tumeken's_Warden, Elidinis'_Warden, Obelisk, Core, Energy_Siphon, the phantoms'
 * pages, Strategies, Chest):
 * - Hitpoints: obelisk 260, shield 140, core phase 4500, final 880. Attack speed 7 Elidinis, 8
 *   Tumeken. Max hit 20 / 22 in phase two, 26 in phase three. Defence floors: obelisk 60, final
 *   120, 180 from the enrage. Melee on the core always hits its maximum; damage to it passes
 *   five-fold. Core out 21 ticks above 80%, 29 above 60%, else 37.
 * - Points: core 0, obelisk 1.5, phase two 2, phase three 2.5. Divine above 55%, entomb below.
 * - Phantoms: Akkha's starts on ranged and swaps every 3 attacks, or randomly under Stay Vigilant;
 *   Kephri's hits 3x3 for more under Aerial Assault. Siphons: 1 hitpoint, +1 at 4, 6 and 8
 *   players, by who's in the arena; melee always hits them, with no delay after. Success hurts
 *   the Warden; slams reset unless Insanity. Enrage heals 20% of the maximum.
 * Checked by capture: the pools come out exact over 40 fights, as 260/140/880 x (1 + 0.4% x raid
 * level) x the party factor, and 4500 x (1 + 0.1% x raid level) x the party factor, which is the
 * Wiki's "scaling reduced by 75%" (2 Sep 2022). The final phase's hits sum to 140% of its
 * hitpoints: 100, the 20% heal and 5% for each of four siphon sets.
 *
 * Captures:
 * - Ready up: 1852 19851 (first), 19872 (again). Start: 14 3586 (Osmumten's 5546, gone 2 later).
 * - Orbs: 14 3588-3632: spawn every 2 ticks from the start + 2; paths and order tile by tile; 10
 *   ticks to arrive; a player on the tile by the obelisk takes 3 and no orb comes (3590-3610).
 * - Charging: bars in 14 and 1759: 5/3% a tick, 3% an orb; Ancient Haste 2.43% and about 4% (fit,
 *   one raid's bars; first special at the start + 28 in every Haste raid). 4 ticks without
 *   charging after a special (14 3624-3628, 1759 2107-2111).
 * - Blades: 14 3624-3636: locs +3, +4, attack +7, leave +11, gone +12. Balls: 1852 24350: 420
 *   cycles, message at +3, landing 14 later. Every ball in the air when the obelisk fell (6 of 6,
 *   with 2 to 10 ticks left) did nothing, so the Wiki's "3 seconds" isn't followed.
 * - Phase two: 14 3631-3735: messages and wake 2 after the obelisk; walk +14 (5 tiles Elidinis;
 *   Tumeken further, 3429 1270); attackable +16; first attack +23. Attacks: projectile +2, landing
 *   +5; divine and entomb +2, +6 (14 3705, 3909). Kneel; +5 form and core throw; +7 core. Back at
 *   core +22, gone +23, stand-up +24, next attack +28 (14 3737-3766).
 * - Obelisk: 14, 1753 7081-7348, 1759 7235-7603, 101 18148-18397. Charges 36 then 30, under
 *   Acceleration 30 then 22 (by invocation); beam, windmill, skulls in turn from a random start.
 *   Beam 14 3671-3696, windmill 3717-3732 and 3915-3954, skulls 3790-3815. It pauses while the
 *   core's out. Skulls land at random within 10 tiles of the obelisk (474 landings).
 * - Phase three's start: 14 4010-4031. Slams: 7 ticks; Overclocked 5; Overclocked 2 4; Insanity 3,
 *   by invocation. Graphics 90 + 6 x tiles from (3936, 5157), or 60 + at 4 and under; hits with
 *   the graphic.
 * - Skulls: 14 4107-4129: projectiles +2, siphons +6, 2227 from the Warden every 2; it stays
 *   attackable for 0 (4109). Fail 101 18608, 553 11166: shockwave from (3936, 5161). Last siphon
 *   +1 removed, +2 stagger, +3 damage, next slam +11; fail +9.
 * - Phantoms: spawn 2 after the 2nd/3rd skulls, attack every 8, 5 from the enrage. Insanity (1753
 *   1750, 553 10924): Zebak 7 then 4, Ba-Ba 6 then 3. Rock 2251 only under Insanity; Zebak's
 *   2177/2179 only with a Crondis path level. Akkha and Kephri: 3429 only, one raid.
 * - Enrage: 14 4416-4507: rows at +6 then every 18 (12 under Insanity, 1753 2321): 40 raids.
 *   Thunder warns at +5, +6, +7 of each 6, up to 9 tiles a tick until the 2nd row, 20 after;
 *   strikes 3 later; the same under Insanity.
 * - The end: 14 4507, 1852 12909: at 0 health, in one tick, the messages, death NPCs and the Warden
 *   gone; phantoms 3 later (Attack off at 1); crystal +13; Amascut leaves +22.
 *
 * Estimates (fits say how many samples):
 * - The Warden's hit through prayer, 17%: 8 at Elidinis' cap, 9 at Tumeken's, 26 raids.
 * - Obelisk damage, base before scaling: beam 15-18, windmill 12-14, skulls 9-14; Penetration +2
 *   on the top: 6, 5 and 10 hits (3, 1 and 48 under Penetration).
 * - Blades 11-17 a tick (about 10 hits). Thunder 7-12 (213 hits mixed with phantoms').
 * - Ball base 18/12 solo (the Wiki's 45 and 30 at the cap) and 12 per player in a party (30, 14
 *   times). Tumeken's in a party: 69 alone, 22 in a pair, 7 in the stack, one ball (1852 32162):
 *   a pool of 12 x (1 + 26% an extra player), divided by 3 for each other player near.
 * - Siphon time: 3n - 3 from the spawn, 2n - 2 under Insanity (n siphons): 2 fails, the rest bounds.
 * - Tumeken steps 2 tiles 4 ticks after an attack (3429, 3 attacks). Core tile: 3 from the
 *   Warden's centre towards its target (about 40 kneels read, by eye).
 * - No recording shows the shield restoring; the Wiki says it does, so 1% per 5 ticks after 20.
 *
 * Unverified, kept working: entomb's 7 ticks, the divine sounds, the failed siphons' 11 x missing
 * (33 under Insanity), the rock's 19-24 and landing, Kephri's phantom 24 with 25% more for Aerial
 * Assault, and the thunder ring's 9-12 by the obelisk.
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");
const Data = require("./WardensData.TombsOfAmascut");

const Z = 1;

// ------------------------------------------------------------------ phases one and two

const OSMUMTEN_SPOT = { x: 3808, y: 5158, z: Z };
const OBELISK_SPOT = { x: 3807, y: 5153, z: Z };
const OBELISK_MIDDLE = { x: 3808, y: 5154 };
const WARDEN_SPOTS = { elidinis: { x: 3792, y: 5152, z: Z }, tumeken: { x: 3820, y: 5152, z: Z } };
/** The tile by the obelisk an orb starts on, and its route after that, one tile a tick. */
const ORB_SPAWNS = { elidinis: { x: 3806, y: 5154 }, tumeken: { x: 3810, y: 5154 } };
const ORB_PATHS = {
  elidinis: [[[3805, 5154], [3803, 5156], [3797, 5156]], [[3797, 5154]], [[3805, 5154], [3803, 5152], [3797, 5152]]],
  tumeken: [[[3819, 5154]], [[3811, 5154], [3813, 5152], [3819, 5152]], [[3811, 5154], [3813, 5156], [3819, 5156]]],
};
const READY_TIMEOUT = 200;
const READY_FIRST = "The challenge will either begin once everyone else in your party is ready or after 2 minutes have passed from the first ready up.";
const READY_WAITING = "The challenge will begin once everyone else in your party is ready.";
const WARDEN_POINTS = { OBELISK: 1.5, WARDEN: 2, CORE: 0, FINAL: 2.5 };
const HITPOINTS = { OBELISK: 260, SHIELD: 140, CORE: 4500, FINAL: 880 };
/** The core phase's hitpoints rise a quarter as fast with raid level. */
const CORE_LEVEL_SHARE = 0.25;
const CORE_DAMAGE = 5;
const DEFENCE = { OBELISK: 100, OBELISK_FLOOR: 60, FINAL: 150, FINAL_ENRAGED: 180, FINAL_FLOOR: 120 };
// Stab, slash, crush, magic, standard ranged: 11751 isn't in the generated monster data.
const OBELISK_BONUSES = [70, 70, 70, 50, 20];
/** Percent of a full platform: a tick and an orb, with and without Ancient Haste. */
const CHARGE = { TICK: 100 / 60, ORB: 3, HASTE_TICK: 100 / 41, HASTE_ORB: 4, PAUSE: 3 };
const ORB_DAMAGE = 3;
const ORB_INTERVAL = 2;
const PERCENT_PER_STAGE = 5;
const MAX_HIT = { elidinis: 20, tumeken: 22, FINAL: 26 };
const ATTACK_SPEED = { elidinis: 7, tumeken: 8 };
const PRAYER_THROUGH = 0.17;
const DIVINE_ABOVE = 0.55;
const SHIELD_RESTORE = { AFTER: 20, EVERY: 5, SHARE: 0.01 };
/** Core out: [Warden health share above which, ticks]. */
const CORE_EXPOSURE = [[0.8, 21], [0.6, 29], [0, 37]];
const STAGGERS_ALLOWED = 2;

/** Base damage before scaling: [lowest, highest]. Fits; see the header. */
const DAMAGE = {
  BEAM: [15, 18], WINDMILL: [12, 14], BOMB: [9, 14], LIGHTNING: [9, 12], PENETRATION: 2,
  BLADES: [11, 17], THUNDER: [7, 12], SLAM: [9, MAX_HIT.FINAL],
};
const BALL = { elidinis: { SOLO: 18, PARTY: 12 }, tumeken: { SOLO: 12, PER_EXTRA: 0.26, SPLIT: 3 } };

/** Stages of the obelisk's charge in ticks: first / later, with and without Acceleration. */
const OBELISK_CHARGE = {
  FIRST: [10, 16, 10], LATER: [8, 12, 10],
  FIRST_ACCELERATED: [8, 14, 8], LATER_ACCELERATED: [6, 8, 8],
};
const OBELISK_ATTACKS = ["BEAM", "WINDMILL", "SKULLS"];
/** Ticks from the obelisk opening until it closes, and from closing until it charges again. */
const OBELISK_CLOSES = { BEAM: 13, WINDMILL: 37, SKULLS: 21 };
const OBELISK_RESTART = 3;
const WARN_LIGHTNING = [6, 3, 3];
const SKULL_BOMB_COUNT = 10;
const SKULL_BOMB_AREA = { minX: 3798, maxX: 3818, minY: 5144, maxY: 5164 };
const OBELISK_CLEAR = 2;
const WARDEN_SIZE = 5;
const WHEEL_TURNS = 12;
const WHEEL_INTERVAL = 3;

/** Unnamed cache NPCs and objects with no identifier constant. */
const CHARGING_ORB = 11769;
const DEATH_WARDEN = { tumeken: 11765, elidinis: 11766 };
const AMASCUT = 11767;
const AMASCUT_ENRAGED = 11768;
const SPENT_SIPHON = 11773;
const ZEBAK_HELPER = 11744;
const TRAP_OBJECTS = { elidinis: 45748, tumeken: 45749 };
const PLATFORM_BASE = 45606;
const INVISIBLE_BLOCK = 26209;

const ANIMATION = {
  OSMUMTEN_FLY: 5546,
  OBELISK_ORBS: 9721, OBELISK_IDLE: 9723, OBELISK_EXPLODE: 9734,
  OBELISK_OPEN: 9728, OBELISK_SKULLS: 9727, OBELISK_BEAM: 9732, OBELISK_SWEEP: 9733,
  OBELISK_CLOSE: 9729, OBELISK_CHARGING: [9724, 9725, 9726],
  TRAP_START: 9524, TRAP_END: 9526,
  STONE: [9713, 9714, 9715], PUSHED: 1114,
  WARDEN_SPECIAL: 9667, WARDEN_DEATH: 9669, WARDEN_REVIVED: 9664,
  ORB_MOVE: 7571, ORB_CHARGE: 9735,
  AWAKE: 9663, MELEE: 9659, DOWN: 9670, REVIVE: 9672, THROW_MAGE: 9661, THROW_RANGED: 9660, EXPLODE: 9662,
  FLOOR_SLAM: 9674, SKULL_SEND: 9682, SKULL_RETURN: 9680, SKULL_FAIL: 9681, ENRAGED: 9685, LAST_PHASE: 9684,
  AMASCUT_ENRAGE: 9718, AMASCUT_LEAVE: 9719, DEATH_BASE: 9691,
  ZEBAK: 9626, AKKHA_RANGED: 9772, AKKHA_MAGE: 9774, AKKHA_SWITCH: 9777, AKKHA_DEATH: 9792, BABA: 9743, KEPHRI: 9577,
};

const GRAPHIC = {
  SPECIAL_TRAPS: 2214, SPECIAL_BALL: 2215, WARDEN_DEATH: 2216, WARDEN_LEGS: 2217, WARDEN_REVIVE: 2218, FINAL_AURA: 2219,
  BALL_LAND: 1605, CORE_EXPLODE: 2157, THUNDER: 2198, WHEEL_START: 2236, WHEEL_END: 2234,
  WARN: { BEAM: 2199, WINDMILL: 2200, SKULLS: 2198 },
  INCOMING: 1447, ISOLATION: 2235, IMPRISON_MISS: 2212, PATH: 2196, PATH_END: 2158,
  FLOOR_BASE: 2220, EXPLOSIONS: [2156, 2157, 2158, 2159], THUNDER_INCOMING: 1446, FINAL_THUNDER: 2197,
  ZEBAK_MAGE: 131, ZEBAK_RANGED: 1103, KEPHRI_EXPLODE: 2157, RUBBLE: 2250, RUBBLE_FASTER: 2251,
};

const PROJECTILE = {
  ELIDINIS_BALL: 2238, TUMEKEN_BALL: 2237, CORE: { elidinis: 2240, tumeken: 2239 }, SKULL_BOMB: 2225,
  MAGE: 2224, RANGED: 2241, IMPRISON: 2210, DIVINE: { melee: 2204, magic: 2208, ranged: 2206 },
  SIPHON: 2227, SKULL: 2226, FLOOR_REMOVAL: 2228,
  ZEBAK: { magic: 2176, ranged: 2178 }, ZEBAK_LEVELLED: { magic: 2177, ranged: 2179 }, ZEBAK_SPLIT: { magic: 2181, ranged: 2187 },
  AKKHA: { magic: 2253, ranged: 2255 }, KEPHRI_LAUNCH: 1481, KEPHRI_BOMB: 2266,
};

const SOUND = {
  START: 6081, TRAP_LAND: 6132, ELIDINIS_BALL: 6119, TUMEKEN_BALL: 6148, BALL_LAND: 6073,
  STONE: 4207, CORE_RETURN: 6083, REVIVE: 167, THUNDER: 6116, SKULL_SEND: 3614, SKULL_FAIL: 6179,
  LAST_PHASE: 1465, SELF_HEAL: 167,
};

const DIVINE = [
  { style: "melee", message: "<col=ff3045>The warden throws an arcane scimitar.</col>", sound: 217 },
  { style: "magic", message: "<col=a53fff>The warden launches an arcane spell.</col>", sound: 208 },
  { style: "ranged", message: "<col=229628>The warden fires an arcane arrow.</col>", sound: 129 },
];

// ------------------------------------------------------------------ phase three

const FINAL_WARDEN_SPOT = { x: 3934, y: 5152, z: Z };
const FACE_NORTH = 1;
const FINAL_ARRIVAL = { x: 3937, y: 5164, z: Z };
const FLOOR_BASE = { x: 3936, y: 5157 };
const SHOCKWAVE_CENTRE = { x: 3936, y: 5161 };
const FLOOR_MIN = { x: 3926, y: 5157 };
const FLOOR_TOP_ROW = 5165;
const FLOOR_VOID = { x: 3936, y: 5130 };
// Where the map keeps the collapsed floor's art, a plane above the final arena.
const VOID_ART = { minX: 3920, maxX: 3952, minY: 5130, maxY: 5190 };
const CRYSTAL_SPOT = { x: 3936, y: 5154, z: Z };
// The crystal stands over the void where the Warden was; it's used from the floor's south
// edge (y 5157, walkable from x 3932 to 3940), as no route reaches its tile.
const CRYSTAL_EDGE = { minX: 3932, maxX: 3940, y: 5157 };
const AMASCUT_SPOT = { x: 3932, y: 5127, z: Z };
const PHANTOM_SPOTS = [{ x: 3943, y: 5153, z: Z }, { x: 3925, y: 5153, z: Z }];
const ZEBAK_LAUNCH = { x: 3938, y: 5156 };
const ZEBAK_HELPER_TICKS = 3;
const KEPHRI_LAUNCH = { x: 3928, y: 5156 };
const DEATH_WARDEN_SPOTS = [5152, 5147, 5142, 5137, 5132].map((y) => ({ x: 3934, y, z: Z }));

/** Ticks between slams. The fast slam animations start at 4; their graphics a tick sooner. */
const SLAM_SPEED = { NONE: 7, OVERCLOCKED: 5, OVERCLOCKED_2: 4, INSANITY: 3 };
const FAST_SLAM_AT = 4;
const SLAM_GRAPHIC_DELAY = { SLOW: 90, FAST: 60 };
const FIRST_SLAM = 9;
const SLAM_AFTER_SIPHONS = 9;
const SIPHON_REFLECT = 0.05;
const THRESHOLDS = [0.8, 0.6, 0.4, 0.2];
const ENRAGE_AT = 0.05;
const ENRAGE_HEAL = 0.2;
const COLLAPSE = { FIRST: 6, EVERY: 18, EVERY_INSANITY: 12, TICKS: 4 };
const THUNDER = { FIRST: 5, EVERY: 6, WARNING_TICKS: 3, LAND: 3, TILES_EARLY: 9, TILES_LATE: 20 };
const FAILED_SIPHON_BASE = { NORMAL: 11, INSANITY: 33 };
const CRYSTAL_AFTER = 13;
const PHANTOMS_LEAVE = 3;
const AMASCUT_LEAVES = 22;
const AURA_EVERY = 3;
/** Ticks between a phantom's attacks: [before, from the enrage]. Zebak and Akkha / Ba-Ba and Kephri. */
const PHANTOM_SPEED = {
  NORMAL: { FIRST: [8, 5], SECOND: [8, 5] },
  INSANITY: { FIRST: [7, 4], SECOND: [6, 3] },
};
const PHANTOM_DAMAGE = { ZEBAK: 16, AKKHA: 22, BABA: [19, 24], KEPHRI: 24, AERIAL_ASSAULT: 1.25 };

const WARDEN_INVOCATIONS = ["ANCIENT_HASTE", "ACCELERATION", "PENETRATION", "OVERCLOCKED", "OVERCLOCKED_2", "INSANITY"];
const TASK = {
  PERFECT: "Perfect Wardens",
  SPECS: "Down Do Specs",
  MOVIN: "Better get movin'",
  FEET: "Fancy feet",
  BELIEVE: "Warden't you believe it",
};
const SOLO_TITLE_TALLY = "clutch";

function ids() {
  return Shared.core().NpcIdentifiers;
}

function tile(x, y) {
  return Shared.loc({ x, y }, Z);
}

function tileOf(entry) {
  return Array.isArray(entry) ? tile(entry[0], entry[1]) : tile(entry.x, entry.y);
}

function standingOn(player, location) {
  const at = player.getLocation();
  return at.getX() === location.getX() && at.getY() === location.getY();
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

function randomBetween([low, high]) {
  return Shared.random(low, high);
}

/** The tiles a straight-then-diagonal walk takes towards each waypoint, as the orbs move. */
function walkTiles(start, waypoints) {
  const tiles = [];
  let x = start.x;
  let y = start.y;
  for (const [tx, ty] of waypoints) {
    while (x !== tx || y !== ty) {
      x += Math.sign(tx - x);
      y += Math.sign(ty - y);
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/** Caps a pending hit's total at `allowed`, trimming its splats in order. */
function limitHit(hit, allowed) {
  let left = Math.max(0, allowed);
  for (const part of hit.getHits()) {
    const damage = Math.min(part.getDamage(), left);
    part.setDamage(damage);
    left -= damage;
  }
  hit.updateTotalDamage();
}

function zeroHit(hit) {
  for (const part of hit.getHits()) part.setDamage(0);
  hit.updateTotalDamage();
}

/** Shared bits of both Warden rooms. */
class WardenRoomBase extends Raid.Room {
  graphic(id, location, options) {
    const viewer = this.roomPlayers()[0];
    if (viewer) Shared.graphicAt(viewer, id, location.getX ? location : tileOf(location), options);
  }

  soundAll(id, delay = 0) {
    for (const player of this.roomPlayers()) Shared.sound(player, id, delay);
  }

  message(text) {
    for (const player of this.roomPlayers()) player.sendMessage(text);
  }

  alive(npc) {
    return !!npc && npc.getHitpoints() > 0 && npc.isRegistered?.() !== false;
  }

  onPlayerArrive() {
    this.updateBossHud();
  }

  /** A fixed NPC the raid scripts: no wandering and no ordinary attacks. */
  spawnFixed(id, spot, options) {
    const npc = this.spawn(id, spot, options);
    if (!npc) return null;
    npc.__toaScripted = true;
    npc.getMovementQueue().setBlockMovement(true);
    return npc;
  }

  /** Base hitpoints scaled as the raid scales them; the core's rise less with raid level. */
  scaledHitpoints(base, levelShare = 1) {
    const raid = this.raid;
    const level = 1 + 0.004 * raid.settings.raidLevel;
    const party = raid.hitpointFactor(0) / level;
    const hitpoints = base * (1 + 0.004 * raid.settings.raidLevel * levelShare) * party;
    if (hitpoints > 300) return Math.round(hitpoints / 10) * 10;
    if (hitpoints > 100) return Math.round(hitpoints / 5) * 5;
    return Math.max(1, Math.round(hitpoints));
  }

  setHealth(npc, hitpoints) {
    npc.setMaxHitpoints(hitpoints);
    npc.setHitpoints(hitpoints);
  }

  /** Unblockable tile damage: a scaled roll between two base values. */
  tileHit(player, [low, high], source) {
    this.avoidable(player, source);
    Shared.damage(player, Shared.random(this.maxHit(low), this.maxHit(high)));
  }

  /**
   * Perfect Wardens is gone once anyone takes damage they could have avoided. Only said where
   * it could be earned: no recording has the line, and most of them were out of the running.
   */
  avoidable(player, source) {
    if (this.raid.original.size < 2 || !WARDEN_INVOCATIONS.every((key) => this.settings.isActive(key))) return;
    this.raid.failTask(TASK.PERFECT, `${Shared.displayName(player)} was hit by ${source}.`);
  }

  disablePrayers(player) {
    const { PrayerHandler } = Shared.core();
    for (const prayer of PrayerHandler.PROTECTION_PRAYERS) PrayerHandler.deactivatePrayer(player, prayer);
    player.sendMessage("<col=ff3045>Your protection prayers have been disabled!</col>");
    player.getCombat().getPrayerBlockTimer().start(5);
  }

  /** Throws a player one tile (two if need be) off something landing on them. */
  shove(player, message) {
    const location = player.getLocation();
    for (let radius = 1; radius <= 2; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          if (!Shared.floorFree(this.area, location.transform(dx, dy))) continue;
          player.sendMessage(message);
          player.getMovementQueue().reset();
          Shared.knockback(player, dx, dy, { ticks: 1, animation: ANIMATION.PUSHED });
          return;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ WARDENS_P1

class WardensRoom extends WardenRoomBase {
  build() {
    const I = ids();
    const settings = this.settings;
    this.ancientHaste = settings.isActive("ANCIENT_HASTE");
    this.acceleration = settings.isActive("ACCELERATION");
    this.penetration = settings.isActive("PENETRATION");
    this.phase = 0;
    this.ready = new Set();
    this.readyDeadline = -1;
    this.orbs = new Set();
    this.orbIndex = { elidinis: 0, tumeken: 0 };
    this.orbTicks = 2;
    this.trapsLive = { elidinis: false, tumeken: false };
    this.stoned = new Map();
    this.moving = null;
    this.core = null;
    this.down = false;
    this.staggers = 0;
    this.obeliskFalling = false;
    this.osmumten = this.spawnFixed(I.OSMUMTEN_2, OSMUMTEN_SPOT, { scale: false, points: 0, face: 6 });
    this.obelisk = this.spawnFixed(I.COL_00FFFF_OBELISK_COL_3, OBELISK_SPOT, { points: WARDEN_POINTS.OBELISK, pathLevel: 0 });
    if (this.obelisk) {
      this.setHealth(this.obelisk, this.scaledHitpoints(HITPOINTS.OBELISK));
      this.obelisk.setDefenceLevel(DEFENCE.OBELISK);
      this.obelisk.setDefenceBonusOverrides(OBELISK_BONUSES);
      this.obelisk.setUntargetable(true);
    }
    this.wardens = {
      elidinis: this.spawnStaticWarden("elidinis", I.ELIDINIS_WARDEN, 4),
      tumeken: this.spawnStaticWarden("tumeken", I.TUMEKENS_WARDEN, 3),
    };
  }

  spawnStaticWarden(key, id, face) {
    const npc = this.spawnFixed(id, WARDEN_SPOTS[key], { scale: false, points: 0, face });
    npc?.setUntargetable(true);
    const warden = { key, npc, percent: 0, pause: 0, stage: -1, fullCharges: 0, legs: false };
    this.setPlatform(warden);
    return warden;
  }

  setPlatform(warden) {
    const stage = Math.floor(warden.percent / PERCENT_PER_STAGE);
    if (stage === warden.stage) return;
    warden.stage = stage;
    this.setObject(PLATFORM_BASE + stage, WARDEN_SPOTS[warden.key], 10, warden.key === "tumeken" ? 1 : 3);
  }

  // -------------------------------------------------------------- the start

  /**
   * Osmumten's Begin: the first to ready up starts the two minutes and is told so. Anyone else,
   * or the first again, hears the shorter line. Everyone still in the raid has to be ready.
   */
  setReady(player) {
    if (this.stage !== Raid.STAGE.IDLE) return;
    const first = this.readyDeadline < 0;
    this.ready.add(player);
    if (first) this.readyDeadline = Shared.cycle() + READY_TIMEOUT;
    if (this.raid.players.every((member) => this.ready.has(member))) {
      this.begin();
      return;
    }
    Shared.statement(player, first ? READY_FIRST : READY_WAITING);
  }

  begin() {
    if (this.stage !== Raid.STAGE.IDLE) return;
    this.start();
    this.message(`Challenge started: ${this.challengeName()}.`);
  }

  onStart() {
    const I = ids();
    const { Animation } = Shared.core();
    this.readyDeadline = -1;
    if (this.osmumten) {
      this.osmumten.performAnimation(new Animation(ANIMATION.OSMUMTEN_FLY));
      const osmumten = this.osmumten;
      this.osmumten = null;
      this.later(2, () => this.despawn(osmumten));
    }
    this.obelisk?.setNpcTransformationId(I.COL_00FFFF_OBELISK_COL_4);
    this.obelisk?.setUntargetable(false);
    this.wardens.elidinis.npc?.setNpcTransformationId(I.ELIDINIS_WARDEN_2);
    this.wardens.tumeken.npc?.setNpcTransformationId(I.TUMEKENS_WARDEN_2);
    this.soundAll(SOUND.START);
    if (this.obelisk) this.openBossHud(this.obelisk);
  }

  onReset() {
    for (const npc of [...this.npcs]) this.despawn(npc);
    this.resetObjects();
    for (const player of this.stoned.keys()) player.getMovementQueue().setBlockMovement(false);
    this.build();
  }

  passBarrier(player, object, quick) {
    if (this.stage === Raid.STAGE.IDLE && !this.raid.member(player).ghost) {
      Raid.walkThrough(player, object);
      return;
    }
    super.passBarrier(player, object, quick);
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (this.stage === Raid.STAGE.IDLE && this.readyDeadline > 0 && Shared.cycle() >= this.readyDeadline) this.begin();
    if (!this.isStarted()) return;
    if (this.phase === 0) {
      this.tickOrbSpawns();
      this.moveOrbs();
      if (!this.obeliskFalling) this.chargeWardens();
      this.checkTraps();
    } else if (this.phase === 1) {
      this.tickObelisk();
      this.tickShield();
      for (const warden of Object.values(this.wardens)) {
        if (warden.legs && this.alive(warden.npc)) warden.npc.performGraphic(Shared.gfx(GRAPHIC.WARDEN_LEGS));
      }
      this.checkTraps();
    }
  }

  tickPlayer(player) {
    const until = this.stoned.get(player);
    if (until === undefined) return;
    const { Animation } = Shared.core();
    const remaining = until - Shared.cycle();
    if (remaining > 0) {
      player.performAnimation(new Animation(remaining <= 6 ? ANIMATION.STONE[1] : ANIMATION.STONE[0]));
      return;
    }
    player.performAnimation(new Animation(ANIMATION.STONE[2]));
    player.getMovementQueue().setBlockMovement(false);
    this.stoned.delete(player);
  }

  /** Leaving while entombed: the stone goes with the room, or they reach the lobby unable to walk. */
  onPlayerLeave(player) {
    if (!this.stoned.delete(player)) return;
    player.getMovementQueue().setBlockMovement(false);
    player.performAnimation(new (Shared.core().Animation)(-1));
  }

  isStoned(player) {
    return (this.stoned.get(player) ?? -1) > Shared.cycle();
  }

  // -------------------------------------------------------------- phase one

  /** Each side sends an orb every 2 ticks. Someone on the tile by the obelisk takes it there. */
  tickOrbSpawns() {
    if (--this.orbTicks > 0) return;
    this.orbTicks = ORB_INTERVAL;
    this.obelisk?.performAnimation(new (Shared.core().Animation)(ANIMATION.OBELISK_ORBS));
    for (const key of ["elidinis", "tumeken"]) {
      const paths = ORB_PATHS[key];
      const path = walkTiles(ORB_SPAWNS[key], paths[this.orbIndex[key]]);
      this.orbIndex[key] = (this.orbIndex[key] + 1) % paths.length;
      const origin = tile(ORB_SPAWNS[key].x, ORB_SPAWNS[key].y);
      const blocker = this.challengePlayers().find((player) => standingOn(player, origin));
      if (blocker) {
        Shared.damage(blocker, ORB_DAMAGE);
        continue;
      }
      const npc = this.spawnFixed(CHARGING_ORB, { ...ORB_SPAWNS[key], z: Z }, { scale: false, points: 0, face: key === "elidinis" ? 3 : 4 });
      if (!npc) continue;
      npc.setUntargetable(true);
      this.orbs.add({ npc, path, index: 0, warden: this.wardens[key], charged: false });
    }
  }

  moveOrbs() {
    const { Animation } = Shared.core();
    for (const orb of [...this.orbs]) {
      const npc = orb.npc;
      if (orb.charged || !npc) {
        this.orbs.delete(orb);
        if (orb.charged) this.addCharge(orb.warden, this.ancientHaste ? CHARGE.HASTE_ORB : CHARGE.ORB);
        this.despawn(npc);
        continue;
      }
      if (orb.index >= orb.path.length) {
        npc.performAnimation(new Animation(ANIMATION.ORB_CHARGE));
        orb.charged = true;
        continue;
      }
      const victim = this.challengePlayers().find((player) => standingOn(player, npc.getLocation()));
      if (victim) {
        Shared.damage(victim, ORB_DAMAGE);
        this.orbs.delete(orb);
        this.despawn(npc);
        continue;
      }
      Shared.walkStraight(npc, tileOf(orb.path[orb.index++]));
      npc.performAnimation(new Animation(ANIMATION.ORB_MOVE));
    }
  }

  chargeWardens() {
    for (const warden of Object.values(this.wardens)) {
      if (warden.pause > 0) {
        warden.pause--;
        continue;
      }
      this.addCharge(warden, this.ancientHaste ? CHARGE.HASTE_TICK : CHARGE.TICK);
    }
  }

  /** A full platform fires the Warden's special: blades and the energy ball in turn. */
  addCharge(warden, amount) {
    if (this.phase !== 0 || this.obeliskFalling || !this.alive(warden.npc) || warden.pause > 0) return;
    warden.percent = Math.min(100, warden.percent + amount);
    this.setPlatform(warden);
    if (warden.percent < 100) return;
    const { Animation } = Shared.core();
    warden.npc.performAnimation(new Animation(ANIMATION.WARDEN_SPECIAL));
    if (warden.fullCharges % 2 === 0) {
      warden.npc.performGraphic(Shared.gfx(GRAPHIC.SPECIAL_TRAPS));
      this.sendTraps(warden.key);
    } else {
      warden.npc.performGraphic(Shared.gfx(GRAPHIC.SPECIAL_BALL));
      this.later(3, () => this.sendBall(warden));
    }
    warden.fullCharges++;
    warden.percent = 0;
    warden.pause = CHARGE.PAUSE;
    this.setPlatform(warden);
  }

  totalCharged(warden) {
    return warden.fullCharges * 100 + warden.percent;
  }

  /** Blades run to the end even if the obelisk falls under them (rec 14 3631-3636). */
  sendTraps(key) {
    const tiles = key === "elidinis" ? Data.ELIDINIS_TRAPS : Data.TUMEKEN_TRAPS;
    const id = TRAP_OBJECTS[key];
    this.later(3, () => {
      for (const [x, y] of tiles) this.setObject(id, { x, y, z: Z }, 10, 0);
      this.soundAll(SOUND.TRAP_LAND);
    });
    this.later(4, () => {
      for (const [x, y] of tiles) this.setObject(id + 2, { x, y, z: Z }, 10, 0);
    });
    this.later(7, () => {
      this.animateTraps(tiles, id + 2, ANIMATION.TRAP_START);
      this.trapsLive[key] = true;
    });
    this.later(11, () => {
      this.animateTraps(tiles, id + 2, ANIMATION.TRAP_END);
      this.trapsLive[key] = false;
    });
    this.later(12, () => {
      for (const [x, y] of tiles) this.setObject(-1, { x, y, z: Z }, 10, 0);
    });
  }

  animateTraps(tiles, id, animation) {
    const { GameObject, Animation } = Shared.core();
    for (const [x, y] of tiles) {
      const object = new GameObject(id, tile(x, y), 10, 0, null);
      for (const player of this.roomPlayers()) player.getPacketSender().sendObjectAnimation(object, new Animation(animation));
    }
  }

  checkTraps() {
    for (const key of ["elidinis", "tumeken"]) {
      if (!this.trapsLive[key]) continue;
      const tiles = key === "elidinis" ? Data.ELIDINIS_TRAPS : Data.TUMEKEN_TRAPS;
      for (const player of this.challengePlayers()) {
        const location = player.getLocation();
        const caught = tiles.some(([x, y]) => location.getX() >= x && location.getX() <= x + 2
          && location.getY() >= y && location.getY() <= y + 2);
        if (caught) this.tileHit(player, DAMAGE.BLADES, "the Warden's blades");
      }
    }
  }

  /** Elidinis' ball punishes standing near others; Tumeken's is shared by those near each other. */
  sendBall(warden) {
    const players = this.challengePlayers();
    if (players.length === 0 || this.phase !== 0 || this.obeliskFalling) return;
    const elidinis = warden.key === "elidinis";
    for (const player of players) {
      Shared.sound(player, elidinis ? SOUND.ELIDINIS_BALL : SOUND.TUMEKEN_BALL);
      player.sendMessage(`${elidinis ? "<col=3366ff>" : "<col=ff8e32>"}A large ball of energy is shot your way...</col>`);
      Shared.tileProjectile(this.area, warden.npc, player, elidinis ? PROJECTILE.ELIDINIS_BALL : PROJECTILE.TUMEKEN_BALL,
        { delay: 30, duration: 390, perTile: 0, startHeight: 87, endHeight: 20 });
    }
    this.later(14, () => this.ballLands(warden, players));
  }

  ballLands(warden, players) {
    // Every ball still in the air when the obelisk fell did nothing, even 10 ticks short.
    if (this.phase !== 0 || this.obeliskFalling) return;
    const targets = this.challengePlayers().filter((player) => players.includes(player));
    const solo = this.raid.original.size <= 1;
    for (const player of targets) {
      Shared.sound(player, SOUND.BALL_LAND);
      player.performGraphic(Shared.gfx(GRAPHIC.BALL_LAND));
      const near = targets.filter((other) => other !== player && chebyshev(other.getLocation(), player.getLocation()) <= 1).length;
      if (warden.key === "elidinis") {
        const base = this.maxHit(solo ? BALL.elidinis.SOLO : BALL.elidinis.PARTY);
        for (let splat = 0; splat <= near; splat++) Shared.damage(player, base);
      } else {
        const pool = this.maxHit(BALL.tumeken.SOLO) * (1 + BALL.tumeken.PER_EXTRA * (this.raid.original.size - 1));
        Shared.damage(player, Math.floor(pool / BALL.tumeken.SPLIT ** near));
      }
    }
  }

  // -------------------------------------------------------------- phase two

  /** The obelisk falls silent; 2 ticks later the more charged Warden rises, the other collapses. */
  startWardenPhase() {
    if (this.phase !== 0 || this.obeliskFalling) return;
    const I = ids();
    const { Animation } = Shared.core();
    this.obeliskFalling = true;
    this.obelisk.setNpcTransformationId(I.COL_00FFFF_OBELISK_COL_5);
    this.obelisk.setUntargetable(true);
    this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_IDLE));
    this.closeBossHud();
    this.elidinisStart = this.totalCharged(this.wardens.elidinis) > this.totalCharged(this.wardens.tumeken);
    this.sendPowerTrails();
    this.later(2, () => {
      this.phase = 1;
      for (const orb of this.orbs) this.despawn(orb.npc);
      this.orbs.clear();
      this.raiseWarden();
    });
  }

  /** Lines of energy from the obelisk to the fallen Warden's side (rec 14 3631). */
  sendPowerTrails() {
    const key = this.elidinisStart ? "tumeken" : "elidinis";
    const start = ORB_SPAWNS[key];
    for (const route of ORB_PATHS[key]) {
      const tiles = walkTiles(start, route);
      const end = tiles.pop();
      tiles.forEach((step, index) => this.graphic(GRAPHIC.PATH, step, { delay: 6 + index * 6 }));
      this.graphic(GRAPHIC.PATH_END, end, { delay: 6 + tiles.length * 6, height: 25 });
    }
  }

  raiseWarden() {
    const I = ids();
    const { Animation } = Shared.core();
    const alive = this.elidinisStart ? this.wardens.elidinis : this.wardens.tumeken;
    const fallen = this.elidinisStart ? this.wardens.tumeken : this.wardens.elidinis;
    this.forms = this.elidinisStart
      ? { magic: I.ELIDINIS_WARDEN_3, ranged: I.ELIDINIS_WARDEN_4, down: I.ELIDINIS_WARDEN_5, core: I.COL_00FFFF_CORE_COL_2 }
      : { magic: I.TUMEKENS_WARDEN_3, ranged: I.TUMEKENS_WARDEN_4, down: I.TUMEKENS_WARDEN_5, core: I.COL_00FFFF_CORE_COL };
    this.movingKey = alive.key;
    const firstForm = this.elidinisStart ? this.forms.magic : this.forms.ranged;
    const moving = this.spawn(firstForm, WARDEN_SPOTS[alive.key], { points: WARDEN_POINTS.WARDEN, pathLevel: 0, face: alive.key === "elidinis" ? 4 : 3 });
    if (!moving) return;
    this.despawn(alive.npc);
    alive.npc = null;
    alive.percent = 0;
    fallen.percent = 0;
    this.setPlatform(alive);
    this.setPlatform(fallen);
    this.moving = moving;
    moving.__toaWardenMoving = true;
    moving.__toaScripted = true;
    moving.setUntargetable(true);
    moving.getMovementQueue().setBlockMovement(true);
    moving.performAnimation(new Animation(ANIMATION.AWAKE));
    this.shieldHp = this.scaledHitpoints(HITPOINTS.SHIELD);
    this.setHealth(moving, this.shieldHp);
    this.realTotal = this.scaledHitpoints(HITPOINTS.CORE, CORE_LEVEL_SHARE);
    this.realHp = this.realTotal;
    this.down = false;
    this.movingCanAttack = false;
    this.lastShieldHit = Shared.cycle();
    if (fallen.npc) {
      fallen.npc.setNpcTransformationId(this.elidinisStart ? I.TUMEKENS_WARDEN_6 : I.ELIDINIS_WARDEN_6);
      fallen.npc.performAnimation(new Animation(ANIMATION.WARDEN_DEATH));
      fallen.npc.performGraphic(Shared.gfx(GRAPHIC.WARDEN_DEATH));
    }
    this.message(this.elidinisStart
      ? "<col=3366ff>As Tumeken's Warden falls, Elidinis' Warden powers up!</col>"
      : "<col=ff8e32>As Elidinis' Warden falls, Tumeken's Warden powers up!</col>");
    this.openBossHud(moving);
    this.startCharging(true);
    this.obeliskPaused = false;
    this.obeliskAttack = Shared.random(0, OBELISK_ATTACKS.length - 1);
    this.obeliskToken = 0;
    this.later(10, () => { fallen.legs = true; });
    this.later(14, () => {
      const location = moving.getLocation();
      Shared.walkStraight(moving, location.transform(this.elidinisStart ? 5 : -6, 0));
    });
    this.later(16, () => moving.setUntargetable(false));
    this.later(23, () => this.setMovingCanAttack(true));
  }

  setMovingCanAttack(value) {
    const moving = this.moving;
    this.movingCanAttack = value;
    if (!moving) return;
    moving.__toaScripted = !value;
    if (!value) return;
    moving.getMovementQueue().setBlockMovement(false);
    const target = this.nearestTo(moving);
    if (target) moving.getCombat().attack(target);
  }

  movingSpeed() {
    return ATTACK_SPEED[this.movingKey] - (this.acceleration ? 1 : 0);
  }

  movingCentre() {
    return this.moving.getLocation().transform(Math.floor(WARDEN_SIZE / 2), Math.floor(WARDEN_SIZE / 2));
  }

  nearestTo(npc) {
    const centre = npc.getLocation().transform(Math.floor(WARDEN_SIZE / 2), Math.floor(WARDEN_SIZE / 2));
    let best = null;
    let distance = Infinity;
    for (const player of this.challengePlayers()) {
      const d = chebyshev(centre, player.getLocation());
      if (d < distance) {
        best = player;
        distance = d;
      }
    }
    return best;
  }

  /** The Warden's turn: a slam when beside its target, a prayer-breaking throw or stone now and then, else bolts. */
  movingAttack(target) {
    const moving = this.moving;
    if (!moving || !this.movingCanAttack) return;
    const { Animation } = Shared.core();
    const tumeken = this.movingKey === "tumeken";
    const reach = Math.ceil(WARDEN_SIZE / 2);
    if (tumeken) this.later(4, () => this.pursue());
    if (target && chebyshev(this.movingCentre(), target.getLocation()) <= reach && (tumeken || Shared.random(0, 3) === 0)) {
      moving.performAnimation(new Animation(ANIMATION.MELEE));
      this.later(1, () => this.landMovingHit(target, "melee"));
      return;
    }
    const players = this.challengePlayers();
    if (players.length === 0) return;
    if (this.canDoSpecial && Shared.random(0, 5) === 0) {
      this.canDoSpecial = false;
      moving.performAnimation(new Animation(ANIMATION.THROW_MAGE));
      if (this.realHp / this.realTotal > DIVINE_ABOVE) this.later(2, () => this.sendDivine(Shared.randomOf(DIVINE)));
      else this.later(2, () => this.sendImprisonment());
      return;
    }
    const style = Shared.random(0, 1) === 0 ? "magic" : "ranged";
    moving.performAnimation(new Animation(style === "magic" ? ANIMATION.THROW_MAGE : ANIMATION.THROW_RANGED));
    this.later(2, () => {
      if (!this.moving) return;
      for (const player of players) {
        Shared.tileProjectile(this.area, moving, player, style === "magic" ? PROJECTILE.MAGE : PROJECTILE.RANGED,
          { delay: 0, duration: 90, perTile: 0, startHeight: 100, endHeight: 25, angle: 12 });
      }
    });
    // Rolled as it lands, so late prayers count (Wiki).
    this.later(5, () => {
      for (const player of this.challengePlayers().filter((member) => players.includes(member))) this.landMovingHit(player, style);
    });
    this.canDoSpecial = true;
  }

  landMovingHit(player, style) {
    if (!this.moving || player.getHitpoints() <= 0) return;
    const hit = this.strike(this.moving, player, null, style, MAX_HIT[this.movingKey], 0, { prayerMultiplier: PRAYER_THROUGH });
    if (hit.getTotalDamage() > 0 && !Shared.isProtected(player, style)) this.avoidable(player, "the Warden's attack");
  }

  /** Tumeken's closes on its target two tiles at a time; Elidinis' stands off (Wiki). */
  pursue() {
    const moving = this.moving;
    if (!moving || !this.movingCanAttack) return;
    const target = this.nearestTo(moving);
    if (!target) return;
    const centre = this.movingCentre();
    const reach = Math.ceil(WARDEN_SIZE / 2);
    const gapX = target.getLocation().getX() - centre.getX();
    const gapY = target.getLocation().getY() - centre.getY();
    const dx = Math.sign(gapX) * Math.min(2, Math.max(0, Math.abs(gapX) - reach));
    const dy = Math.sign(gapY) * Math.min(2, Math.max(0, Math.abs(gapY) - reach));
    if (dx !== 0 || dy !== 0) Shared.walkStraight(moving, moving.getLocation().transform(dx, dy));
  }

  /** Drops every protection prayer; only re-praying the right one in time stops the hit. */
  sendDivine(kind) {
    const moving = this.moving;
    if (!moving) return;
    const players = this.challengePlayers();
    for (const player of players) {
      Shared.tileProjectile(this.area, moving, player, PROJECTILE.DIVINE[kind.style], { delay: 0, duration: 120, perTile: 0, startHeight: 100, endHeight: 25, angle: 12 });
      const { PrayerHandler } = Shared.core();
      for (const prayer of PrayerHandler.PROTECTION_PRAYERS) PrayerHandler.deactivatePrayer(player, prayer);
      player.sendMessage(kind.message);
      player.sendMessage("<col=ff3045>Your protection prayers have been disabled!</col>");
    }
    this.later(4, () => {
      if (!this.movingCanAttack) return;
      for (const player of this.challengePlayers().filter((member) => players.includes(member))) {
        Shared.sound(player, kind.sound);
        if (Shared.isProtected(player, kind.style)) continue;
        this.avoidable(player, "the Warden's attack");
        Shared.damage(player, Shared.random(this.maxHit(Math.floor(MAX_HIT[this.movingKey] / 2)), this.maxHit(MAX_HIT[this.movingKey])));
      }
    });
  }

  sendImprisonment() {
    const moving = this.moving;
    if (!moving) return;
    const tiles = [];
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (tiles.some((other) => other.getX() === location.getX() && other.getY() === location.getY())) continue;
      tiles.push(location.clone());
    }
    for (const location of tiles) {
      Shared.tileProjectile(this.area, moving, location, PROJECTILE.IMPRISON, { delay: 0, duration: 120, perTile: 0, startHeight: 100, endHeight: 10, angle: 12 });
      this.graphic(GRAPHIC.INCOMING, location);
    }
    this.later(4, () => {
      if (!this.movingCanAttack) return;
      for (const location of tiles) {
        const victims = this.challengePlayers().filter((player) => standingOn(player, location));
        if (victims.length === 0) this.graphic(GRAPHIC.IMPRISON_MISS, location, { height: 10 });
        for (const victim of victims) this.entomb(victim);
      }
    });
  }

  entomb(player) {
    const { Animation } = Shared.core();
    this.avoidable(player, "the Warden's attack");
    player.sendMessage("<col=ff3045>You've been entombed in stone!</col>");
    Shared.sound(player, SOUND.STONE);
    player.performAnimation(new Animation(ANIMATION.STONE[0]));
    player.getMovementQueue().reset();
    player.getMovementQueue().setBlockMovement(true);
    player.getCombat().reset();
    this.stoned.set(player, Shared.cycle() + 7);
  }

  /** The shield breaks: the Warden kneels, and 5 ticks later throws out its core. */
  wardenDown() {
    const moving = this.moving;
    if (!moving || this.down || !this.movingCanAttack) return;
    const { Animation } = Shared.core();
    moving.performAnimation(new Animation(ANIMATION.DOWN));
    moving.setUntargetable(true);
    moving.getCombat().reset();
    moving.getMovementQueue().reset();
    moving.getMovementQueue().setBlockMovement(true);
    this.setMovingCanAttack(false);
    this.staggers++;
    if (this.staggers > STAGGERS_ALLOWED) this.raid.failTask(TASK.SPECS, "The Warden was staggered more than twice.");
    this.stopObeliskAttack();
    this.later(6, () => { this.obeliskPaused = true; });
    this.later(5, () => {
      this.down = true;
      this.previousForm = moving.getId();
      moving.setNpcTransformationId(this.forms.down);
      moving.setMaxHitpoints(this.realTotal);
      moving.setHitpoints(this.realHp);
      this.openBossHud(moving);
      const target = this.nearestTo(moving);
      const centre = this.movingCentre();
      const dx = target ? Math.sign(target.getLocation().getX() - centre.getX()) : 0;
      const dy = target ? Math.sign(target.getLocation().getY() - centre.getY()) : -1;
      const coreTile = this.freeTileNear(centre.transform(dx * 3, dy * 3));
      Shared.tileProjectile(this.area, moving, coreTile, PROJECTILE.CORE[this.movingKey], { delay: 0, duration: 60, perTile: 0, startHeight: 95, endHeight: 12, angle: 127 });
      this.later(2, () => this.spawnCore(coreTile));
    });
  }

  freeTileNear(location) {
    for (let radius = 0; radius < 10; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const next = location.transform(dx, dy);
          if (Shared.floorFree(this.area, next)) return next;
        }
      }
    }
    return location;
  }

  coreTicks() {
    const share = this.realHp / this.realTotal;
    return CORE_EXPOSURE.find(([above]) => share > above)?.[1] ?? CORE_EXPOSURE[CORE_EXPOSURE.length - 1][1];
  }

  /** Its own hitpoints never run out; the phase ends on the Warden's. */
  spawnCore(location) {
    if (!this.down) return;
    const spot = { x: location.getX(), y: location.getY(), z: Z };
    const core = this.spawnFixed(this.forms.core, spot, { scale: false, points: WARDEN_POINTS.CORE, inert: true });
    if (!core) return;
    this.setHealth(core, this.realTotal);
    core.__toaWardenCore = true;
    this.core = core;
    this.coreTile = spot;
    this.stopObeliskAttack();
    for (const player of this.challengePlayers()) if (standingOn(player, location)) this.shove(player, "You are pushed off the core.");
    this.setObject(INVISIBLE_BLOCK, spot, 10, 0);
    const exposure = this.coreTicks();
    this.later(exposure + 1, () => this.coreReturns(core));
  }

  /** Damage on the core passes to the kneeling Warden five-fold. */
  coreHit(hit) {
    const moving = this.moving;
    if (!moving || !this.down) return;
    const damage = hit.getTotalDamage();
    if (damage > 0) Shared.damage(moving, damage * CORE_DAMAGE);
  }

  coreReturns(core) {
    if (!core || this.core !== core || !this.moving) return;
    this.realHp = this.moving.getHitpoints();
    Shared.tileProjectile(this.area, core, this.moving, PROJECTILE.CORE[this.movingKey], { delay: 60, duration: 30, perTile: 0, startHeight: 20, endHeight: 62, angle: 20 });
    this.soundAll(SOUND.CORE_RETURN);
    this.later(1, () => core.setUntargetable(true));
    this.later(2, () => {
      this.removeCore();
      this.later(1, () => this.revive());
    });
  }

  removeCore() {
    if (!this.core) return;
    this.despawn(this.core);
    this.core = null;
    this.setObject(-1, this.coreTile, 10, 0);
  }

  revive() {
    const moving = this.moving;
    if (!moving || !this.down || !this.isStarted()) return;
    const { Animation } = Shared.core();
    this.down = false;
    this.realHp = moving.getHitpoints();
    moving.performAnimation(new Animation(ANIMATION.REVIVE));
    moving.setNpcTransformationId(this.previousForm === this.forms.ranged ? this.forms.magic : this.forms.ranged);
    this.setHealth(moving, this.shieldHp);
    this.lastShieldHit = Shared.cycle();
    this.openBossHud(moving);
    this.obeliskPaused = false;
    this.later(4, () => {
      moving.setUntargetable(false);
      this.setMovingCanAttack(true);
    });
  }

  /** Only the Warden's current form's style breaks its shield; the kneeling Warden takes no direct hits. */
  filterMovingHit(hit) {
    if (this.down) {
      zeroHit(hit);
      return;
    }
    if (hit.getCombatType?.() !== this.wantedStyle()) {
      zeroHit(hit);
      return;
    }
    this.lastShieldHit = Shared.cycle();
  }

  wantedStyle() {
    const { CombatType } = Shared.core();
    return this.moving?.getId() === this.forms?.magic ? CombatType.MAGIC : CombatType.RANGED;
  }

  /** Left alone, the shield slowly comes back (Wiki; no number anywhere). */
  tickShield() {
    const moving = this.moving;
    if (!moving || this.down || !this.movingCanAttack) return;
    const idle = Shared.cycle() - this.lastShieldHit;
    if (idle < SHIELD_RESTORE.AFTER || idle % SHIELD_RESTORE.EVERY !== 0) return;
    moving.setHitpoints(Math.min(moving.getMaxHitpoints(), moving.getHitpoints() + Math.ceil(moving.getMaxHitpoints() * SHIELD_RESTORE.SHARE)));
  }

  // -------------------------------------------------------------- the obelisk in phase two

  startCharging(first) {
    const stages = first
      ? (this.acceleration ? OBELISK_CHARGE.FIRST_ACCELERATED : OBELISK_CHARGE.FIRST)
      : (this.acceleration ? OBELISK_CHARGE.LATER_ACCELERATED : OBELISK_CHARGE.LATER);
    this.obeliskCharge = { stages, elapsed: 0, total: stages.reduce((sum, ticks) => sum + ticks, 0) };
    this.obeliskBusy = false;
  }

  /** It charges through three animations, sent every 2 ticks, then opens. The core's exposure pauses it. */
  tickObelisk() {
    if (this.obeliskBusy || this.obeliskPaused || !this.obelisk || !this.obeliskCharge) return;
    const { Animation } = Shared.core();
    const charge = this.obeliskCharge;
    if (charge.elapsed >= charge.total) {
      this.openObelisk();
      return;
    }
    if (charge.elapsed % 2 === 0) {
      let stage = 0;
      let reached = charge.stages[0];
      while (charge.elapsed >= reached && stage < charge.stages.length - 1) reached += charge.stages[++stage];
      this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_CHARGING[stage]));
    }
    charge.elapsed++;
  }

  openObelisk() {
    const { Animation } = Shared.core();
    this.obeliskBusy = true;
    this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_OPEN));
    const kind = OBELISK_ATTACKS[this.obeliskAttack];
    this.obeliskAttack = (this.obeliskAttack + 1) % OBELISK_ATTACKS.length;
    const token = ++this.obeliskToken;
    const live = () => token === this.obeliskToken;
    for (let tick = 0; tick < WARN_LIGHTNING.length; tick++) {
      this.later(1 + tick, () => live() && this.sendWarnLightning(GRAPHIC.WARN[kind], WARN_LIGHTNING[tick]));
    }
    if (kind === "BEAM") {
      this.later(1, () => live() && this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_BEAM)));
      this.later(8, () => live() && this.sendBeam(true, live));
      this.later(14, () => live() && this.sendBeam(false, live));
    } else if (kind === "WINDMILL") {
      this.later(1, () => live() && this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_SWEEP)));
      this.later(4, () => live() && this.sendWheel(live));
    } else {
      this.later(2, () => live() && this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_SKULLS)));
      this.later(3, () => live() && this.sendSkullBombs(live));
    }
    this.later(OBELISK_CLOSES[kind], () => live() && this.closeObelisk());
  }

  closeObelisk() {
    const { Animation } = Shared.core();
    this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_CLOSE));
    this.later(OBELISK_RESTART, () => this.startCharging(false));
  }

  /** A kneel or the core's arrival ends a running attack: it closes 2 ticks later (rec 14 3730, 3849). */
  stopObeliskAttack() {
    if (!this.obeliskBusy || !this.obelisk) return;
    this.obeliskToken++;
    this.obeliskBusy = true;
    this.later(OBELISK_CLEAR, () => this.closeObelisk());
  }

  /** Lightning around the obelisk as an attack begins, its colour naming the attack. */
  sendWarnLightning(graphic, count) {
    const ring = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) === 2 || Math.abs(dy) === 2) ring.push(tile(OBELISK_MIDDLE.x + dx, OBELISK_MIDDLE.y + dy));
      }
    }
    for (const location of Shared.shuffle(ring).slice(0, count)) {
      this.graphic(graphic, location);
      for (const player of this.challengePlayers()) if (standingOn(player, location)) this.obeliskHit(player, DAMAGE.LIGHTNING);
    }
  }

  obeliskHit(player, [low, high]) {
    const top = high + (this.penetration ? DAMAGE.PENETRATION : 0);
    this.tileHit(player, [low, top], "the obelisk's attack");
    if (this.penetration) this.disablePrayers(player);
  }

  /** Lines out from the obelisk that then close in: north-south first, east-west 6 ticks later. */
  sendBeam(vertical, live) {
    const reach = vertical ? 12 : 11;
    const middle = tile(OBELISK_MIDDLE.x, OBELISK_MIDDLE.y);
    for (let distance = 2; distance <= reach; distance++) {
      this.graphic(GRAPHIC.WHEEL_END, middle.transform(vertical ? 0 : distance, vertical ? distance : 0), { delay: distance * 2 });
      this.graphic(GRAPHIC.WHEEL_END, middle.transform(vertical ? 0 : -distance, vertical ? -distance : 0), { delay: distance * 2 });
    }
    let delta = reach;
    this.repeat(1, () => {
      if (!live() || delta < 1) return false;
      const first = middle.transform(vertical ? 0 : delta, vertical ? delta : 0);
      const second = middle.transform(vertical ? 0 : -delta, vertical ? -delta : 0);
      const tiles = [first, second];
      for (let spread = reach - delta; spread > 0; spread--) {
        if (vertical) {
          tiles.push(first.transform(-spread, spread), first.transform(spread, spread), second.transform(-spread, -spread), second.transform(spread, -spread));
        } else {
          tiles.push(first.transform(spread, spread), first.transform(spread, -spread), second.transform(-spread, spread), second.transform(-spread, -spread));
        }
      }
      for (const location of tiles) {
        this.graphic(GRAPHIC.ISOLATION, location);
        for (const player of this.challengePlayers()) if (standingOn(player, location)) this.obeliskHit(player, DAMAGE.BEAM);
      }
      delta--;
      return true;
    });
  }

  /** Ten skulls, one every 2 ticks, at random tiles clear of the obelisk and the Warden (Wiki). */
  sendSkullBombs(live) {
    let count = SKULL_BOMB_COUNT;
    const send = () => {
      if (!live() || count-- <= 0) return false;
      const target = this.skullBombTile();
      Shared.tileProjectile(this.area, this.obelisk, target, PROJECTILE.SKULL_BOMB, { delay: 23, duration: 97, perTile: 0, startHeight: 100, endHeight: 3 });
      this.graphic(GRAPHIC.INCOMING, target);
      this.later(4, () => live() && this.explodeSkullBomb(target));
      return true;
    };
    send();
    this.repeat(2, send);
  }

  skullBombTile() {
    const middle = tile(OBELISK_MIDDLE.x, OBELISK_MIDDLE.y);
    const warden = this.moving?.getLocation();
    for (let tries = 0; tries < 20; tries++) {
      const location = tile(Shared.random(SKULL_BOMB_AREA.minX, SKULL_BOMB_AREA.maxX), Shared.random(SKULL_BOMB_AREA.minY, SKULL_BOMB_AREA.maxY));
      const underObelisk = chebyshev(location, middle) <= 1;
      const underWarden = warden && location.getX() >= warden.getX() && location.getX() < warden.getX() + WARDEN_SIZE
        && location.getY() >= warden.getY() && location.getY() < warden.getY() + WARDEN_SIZE;
      if (!underObelisk && !underWarden) return location;
    }
    return tile(SKULL_BOMB_AREA.minX, SKULL_BOMB_AREA.minY);
  }

  explodeSkullBomb(centre) {
    const inner = [];
    const outer = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        // The two tiles out in each cardinal direction are safe (Wiki, rec 14 3797).
        if ((dx === 0 && dy !== 0 && Math.abs(dy) < 3) || (dy === 0 && dx !== 0 && Math.abs(dx) < 3)) continue;
        const location = centre.transform(dx, dy);
        (Math.abs(dx) === 3 || Math.abs(dy) === 3 ? outer : inner).push(location);
      }
    }
    for (const location of inner) this.graphic(GRAPHIC.THUNDER, location, { delay: chebyshev(centre, location) * 10 });
    for (const location of outer) this.graphic(GRAPHIC.THUNDER, location, { delay: 30 });
    const strike = (tiles) => {
      for (const location of tiles) {
        for (const player of this.challengePlayers()) if (standingOn(player, location)) this.obeliskHit(player, DAMAGE.BOMB);
      }
    };
    strike(inner);
    this.later(1, () => strike(outer));
  }

  /** Twelve turns, one every 3 ticks: a spoke set glows, and strikes as the next one glows. */
  sendWheel(live) {
    let previous = -1;
    let turns = 0;
    let index = 0;
    const middle = tile(OBELISK_MIDDLE.x, OBELISK_MIDDLE.y);
    const turn = () => {
      if (!live()) return false;
      if (previous !== -1) {
        for (const entry of Data.WHEELS[previous]) {
          const location = tileOf(entry);
          this.graphic(GRAPHIC.WHEEL_END, location, { delay: 2 * chebyshev(middle, location) });
          for (const player of this.challengePlayers()) if (standingOn(player, location)) this.obeliskHit(player, DAMAGE.WINDMILL);
        }
      }
      if (++turns > WHEEL_TURNS) return false;
      for (const entry of Data.WHEELS[index]) this.graphic(GRAPHIC.WHEEL_START, tileOf(entry), { delay: 30 });
      previous = index;
      index = (index + 1) % Data.WHEELS.length;
      return true;
    };
    turn();
    this.repeat(WHEEL_INTERVAL, turn);
  }

  // -------------------------------------------------------------- into phase three

  /** The kneeling Warden's last strength revives the other, who rises for the final phase. */
  killMovingWarden() {
    if (this.phase !== 1) return;
    this.phase = 2;
    this.obeliskToken++;
    const { Animation } = Shared.core();
    if (this.core) {
      this.graphic(GRAPHIC.PATH_END, this.core.getLocation());
      this.removeCore();
    }
    this.message(this.elidinisStart
      ? "<col=ff8e32>Elidinis' Warden uses the last of its power to restore Tumeken's Warden!</col>"
      : "<col=3366ff>Tumeken's Warden uses the last of its power to restore Elidinis' Warden!</col>");
    this.moving?.performAnimation(new Animation(ANIMATION.EXPLODE));
    this.moving?.setUntargetable(true);
    this.closeBossHud();
    const revived = this.elidinisStart ? this.wardens.tumeken : this.wardens.elidinis;
    revived.legs = false;
    revived.npc?.performAnimation(new Animation(ANIMATION.WARDEN_REVIVED, 120));
    revived.npc?.performGraphic(Shared.gfx(GRAPHIC.WARDEN_REVIVE, { delay: 120 }));
    this.later(6, () => {
      this.soundAll(SOUND.REVIVE);
      const middle = tile(OBELISK_MIDDLE.x, OBELISK_MIDDLE.y);
      const tiles = [];
      for (let dx = -4; dx <= 4; dx++) {
        for (let dy = -4; dy <= 4; dy++) if (Math.abs(dx) > 1 || Math.abs(dy) > 1) tiles.push(middle.transform(dx, dy));
      }
      Shared.shuffle(tiles).slice(0, 35).forEach((location, index) => {
        this.graphic(Shared.random(0, 1) === 0 ? GRAPHIC.CORE_EXPLODE : GRAPHIC.THUNDER, location, { delay: Math.floor(index / 5) * 30 + 30 });
      });
    });
    this.later(9, () => this.obelisk?.performAnimation(new Animation(ANIMATION.OBELISK_EXPLODE)));
    this.later(12, () => this.toFinalPhase());
  }

  toFinalPhase() {
    const raid = this.raid;
    const players = this.roomPlayers();
    const inside = new Set(this.challengePlayers());
    const handover = {
      startCycle: this.startCycle,
      wardenId: this.elidinisStart ? ids().TUMEKENS_WARDEN_7 : ids().ELIDINIS_WARDEN_7,
      diedBefore: new Set(this.diedHere),
    };
    for (const player of this.stoned.keys()) player.getMovementQueue().setBlockMovement(false);
    this.stoned.clear();
    const final = raid.buildRoom("WARDENS_P3");
    for (const player of players) {
      raid.member(player).roomKey = final.key;
      const destination = inside.has(player) ? tileOf(FINAL_ARRIVAL) : Shared.spread(final.def.spawn, final.def.spread);
      Shared.fadeMove(player, () => {
        player.getMovementQueue().reset();
        player.moveTo(destination);
      });
    }
    final.prepare(handover);
    raid.refreshHudStates();
  }
}

// ------------------------------------------------------------------ WARDENS_P3

class WardensFinalRoom extends WardenRoomBase {
  build() {
    const settings = this.settings;
    this.insanity = settings.isActive("INSANITY");
    this.attackSpeed = this.insanity ? SLAM_SPEED.INSANITY
      : settings.isActive("OVERCLOCKED_2") ? SLAM_SPEED.OVERCLOCKED_2
        : settings.isActive("OVERCLOCKED") ? SLAM_SPEED.OVERCLOCKED : SLAM_SPEED.NONE;
    this.stayVigilant = settings.isActive("STAY_VIGILANT");
    this.aerialAssault = settings.isActive("AERIAL_ASSAULT");
    this.phase = 2;
    this.warden = null;
    this.amascut = null;
    this.floorRotation = 0;
    this.skullAttack = false;
    this.attackTicks = FIRST_SLAM;
    this.siphons = [];
    this.siphonsLeft = 0;
    this.skullTimer = 0;
    this.nextThreshold = 0;
    this.phantoms = [];
    this.enragedTicks = 0;
    this.thunderClock = 0;
    this.thunderTaken = new Set();
    this.floorIndex = 0;
    this.floorTicks = COLLAPSE.FIRST;
    this.diedBefore = new Set();
    this.hideVoidArt();
  }

  /**
   * The map keeps the collapsed floor's "Void" pieces on the plane above the arena (z 2).
   * OSRS builds the room from template chunks without them; shown as-is they hang over the
   * fight before the floor falls, so they're cleared for this party.
   */
  hideVoidArt() {
    const { MapObjects } = Shared.core();
    const z = Z + 1;
    for (let x = VOID_ART.minX; x <= VOID_ART.maxX; x++) {
      for (let y = VOID_ART.minY; y <= VOID_ART.maxY; y++) {
        const object = MapObjects.getType(Shared.loc({ x, y }, z), 22, null);
        if (object?.getDefinition?.()?.getName?.() === "Void") this.setObject(-1, { x, y, z }, 22);
      }
    }
  }

  /** Picks up from WARDENS_P1 without a pause: the fight is already on. */
  prepare({ startCycle, wardenId, diedBefore }) {
    this.stage = Raid.STAGE.STARTED;
    this.startCycle = startCycle;
    this.teamSize = this.raid.original.size;
    this.diedBefore = diedBefore ?? new Set();
    // Faces north, over the floor the party stands on (6 was south, its back to them).
    const warden = this.spawnFixed(wardenId, FINAL_WARDEN_SPOT, { points: WARDEN_POINTS.FINAL, pathLevel: 0, face: FACE_NORTH });
    if (!warden) return;
    this.setHealth(warden, this.scaledHitpoints(HITPOINTS.FINAL));
    warden.setDefenceLevel(DEFENCE.FINAL);
    warden.__toaFinalWarden = true;
    this.warden = warden;
    this.baseId = wardenId;
    this.tumeken = wardenId === ids().TUMEKENS_WARDEN_7;
    this.amascut = this.spawnFixed(AMASCUT, AMASCUT_SPOT, { scale: false, points: 0, face: FACE_NORTH });
    this.amascut?.setUntargetable(true);
    this.openBossHud(warden);
  }

  /** The room is over the moment the Warden hits 0: the timer's stopped already (Wiki, rec 14 4507). */
  onComplete() {
    const { Animation } = Shared.core();
    this.phase = 4;
    this.awardTasks();
    for (const siphon of this.siphons) if (siphon) this.removeSiphon(siphon);
    this.siphons = [];
    const key = this.tumeken ? "tumeken" : "elidinis";
    DEATH_WARDEN_SPOTS.forEach((spot, index) => {
      const npc = this.spawnFixed(DEATH_WARDEN[key], spot, { scale: false, points: 0, face: FACE_NORTH });
      npc?.setUntargetable(true);
      npc?.performAnimation(new Animation(ANIMATION.DEATH_BASE + index));
    });
    if (this.warden) {
      this.despawn(this.warden);
      this.warden = null;
    }
    const phantoms = this.phantoms;
    this.phantoms = [];
    for (const phantom of phantoms) {
      if (phantom.id === ids().AKKHAS_PHANTOM) this.later(1, () => phantom.npc?.performAnimation(new Animation(ANIMATION.AKKHA_DEATH)));
      this.later(PHANTOMS_LEAVE, () => this.despawn(phantom.npc));
    }
    for (const player of this.roomPlayers()) this.raid.sendHud(player);
    this.later(CRYSTAL_AFTER, () => this.setObject(Shared.core().ObjectIdentifiers.TELEPORT_CRYSTAL_3, CRYSTAL_SPOT, 10, 0));
    this.later(AMASCUT_LEAVES, () => this.amascut?.performAnimation(new Animation(ANIMATION.AMASCUT_LEAVE)));
  }

  /** What the fight's end decides; failures were announced as they happened. */
  awardTasks() {
    const raid = this.raid;
    const settings = this.settings;
    const deathless = this.deathlessPlayers().filter((player) => !this.diedBefore.has(player));
    const party = raid.original.size >= 2;
    const allInvocations = WARDEN_INVOCATIONS.every((key) => settings.isActive(key));
    raid.completeTask(TASK.SPECS, deathless);
    if (allInvocations) raid.completeTask(TASK.BELIEVE, deathless);
    if (allInvocations && party) raid.completeTask(TASK.PERFECT);
    // The Wiki's text says Elidinis' Warden in phase three, but rec 1753 tick 2354 earned it on
    // Tumeken's, so which Warden isn't checked.
    if (settings.isActive("AERIAL_ASSAULT") && settings.isActive("STAY_VIGILANT") && this.insanity) raid.completeTask(TASK.MOVIN, deathless);
    if (this.insanity && party) raid.completeTask(TASK.FEET, deathless);
    const standing = this.challengePlayers();
    if (party && standing.length === 1) raid.tally(standing[0], SOLO_TITLE_TALLY);
  }

  /** A wiped party starts the Wardens over from the obelisk. */
  onReset() {
    const raid = this.raid;
    const players = this.roomPlayers();
    this.clearAdds();
    Shared.later(raid, 3, () => {
      for (const player of players) {
        if (raid.players.includes(player)) raid.enterRoom(player, "WARDENS_P1", { leaderOnly: false });
      }
    });
  }

  clearAdds() {
    for (const siphon of this.siphons) if (siphon) this.removeSiphon(siphon);
    this.siphons = [];
    for (const phantom of this.phantoms) this.despawn(phantom.npc);
    this.phantoms = [];
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (!this.isStarted() || !this.alive(this.warden)) return;
    if (this.phase === 2) {
      this.checkThresholds();
      if (!this.skullAttack) {
        if (this.attackTicks > 0 && --this.attackTicks <= 0) this.floorSlam();
      } else if (this.siphons.length > 0 && this.skullTimer > 0 && --this.skullTimer <= 0) {
        this.skullsFailed();
      }
    } else if (this.phase === 3) {
      if (++this.enragedTicks % 2 === 0) this.warden.performAnimation(new (Shared.core().Animation)(ANIMATION.ENRAGED));
      this.tickCollapse();
      this.tickThunder();
    }
    if (Shared.cycle() % AURA_EVERY === 0) this.warden.performGraphic(Shared.gfx(GRAPHIC.FINAL_AURA));
    this.tickPhantoms();
  }

  /** Should a row have fallen under someone, they stand on the floor still left. */
  tickPlayer(player) {
    if (this.phase !== 3 || !this.inChallenge(player)) return;
    const location = player.getLocation();
    if (location.getY() > this.floorEdge()) this.moveOffFallenRow(player);
  }

  /** The last row still standing. */
  floorEdge() {
    return FLOOR_TOP_ROW - Math.ceil(this.floorIndex / COLLAPSE.TICKS);
  }

  // -------------------------------------------------------------- floor slams

  floorSlam() {
    const { Animation } = Shared.core();
    this.attackTicks = this.attackSpeed;
    const fast = this.attackSpeed <= FAST_SLAM_AT;
    this.warden.performAnimation(new Animation(ANIMATION.FLOOR_SLAM + this.floorRotation * 2 + (fast ? 1 : 0)));
    const base = tileOf(FLOOR_BASE);
    const lands = new Map();
    Data.FLOOR_ATTACKS[this.floorRotation].forEach((group) => {
      for (const entry of group) {
        const location = tileOf(entry);
        const delay = (fast ? SLAM_GRAPHIC_DELAY.FAST : SLAM_GRAPHIC_DELAY.SLOW) + chebyshev(location, base) * 6;
        this.graphic(GRAPHIC.FLOOR_BASE + Shared.random(0, 3), location, { delay });
        const tick = Math.floor(delay / 30);
        if (!lands.has(tick)) lands.set(tick, []);
        lands.get(tick).push(location);
      }
    });
    this.floorRotation = (this.floorRotation + 1) % Data.FLOOR_ATTACKS.length;
    for (const [tick, tiles] of lands) {
      this.later(tick, () => {
        if (this.skullAttack || this.phase !== 2) return;
        for (const location of tiles) {
          for (const player of this.challengePlayers()) if (standingOn(player, location)) this.tileHit(player, DAMAGE.SLAM, "the Warden's attack");
        }
      });
    }
  }

  // -------------------------------------------------------------- skulls

  /** All three protection prayers while the skulls are out: hits land for nothing. */
  filterWardenHit(hit) {
    const { CombatType } = Shared.core();
    const attacker = hit.getAttacker?.();
    if (attacker?.isPlayer?.() && hit.getCombatType?.() !== CombatType.MELEE) {
      this.raid.failTask(TASK.FEET, "You hit with an attack style other than melee.", attacker);
    }
    if (this.warden.getDefenceLevel() < DEFENCE.FINAL_FLOOR) this.warden.setDefenceLevel(DEFENCE.FINAL_FLOOR);
    if (this.skullAttack) zeroHit(hit);
  }

  checkThresholds() {
    const warden = this.warden;
    const share = warden.getHitpoints() / warden.getMaxHitpoints();
    if (share <= ENRAGE_AT) {
      this.startLastPhase();
      return;
    }
    if (this.skullAttack || this.nextThreshold >= THRESHOLDS.length) return;
    if (share <= THRESHOLDS[this.nextThreshold]) this.sendSkulls(this.nextThreshold++);
  }

  sendSkulls(index) {
    const I = ids();
    const { Animation } = Shared.core();
    const warden = this.warden;
    this.skullAttack = true;
    this.siphons = [];
    // Everyone stops attacking the Warden, free to strike the siphons at once.
    for (const player of this.challengePlayers()) Shared.skipAttackDelay(player);
    if (!this.insanity) this.floorRotation = 0;
    warden.performAnimation(new Animation(ANIMATION.SKULL_SEND));
    warden.setNpcTransformationId(this.tumeken ? I.TUMEKENS_WARDEN_8 : I.ELIDINIS_WARDEN_8);
    const players = this.challengePlayers();
    for (const player of players) player.getCombat().reset();
    this.soundAll(SOUND.SKULL_SEND);
    const tiles = Data.SKULLS[players.length >= 2 ? 1 : 0][index].map(tileOf);
    this.later(2, () => {
      for (const location of tiles) {
        this.graphic(GRAPHIC.INCOMING, location);
        Shared.tileProjectile(this.area, warden, location, PROJECTILE.SKULL, { delay: 30, duration: 90, perTile: 0, startHeight: 87, endHeight: 20, angle: 20 });
      }
      if (index === 1) this.spawnPhantom(this.tumeken ? I.ZEBAKS_PHANTOM : I.AKKHAS_PHANTOM, PHANTOM_SPOTS[0], "FIRST");
      else if (index === 2) this.spawnPhantom(this.tumeken ? I.BA_BAS_PHANTOM : I.KEPHRIS_PHANTOM, PHANTOM_SPOTS[1], "SECOND");
    });
    this.later(6, () => this.spawnSiphons(tiles));
  }

  spawnSiphons(tiles) {
    if (this.phase !== 2) return;
    const I = ids();
    const players = this.challengePlayers();
    this.skullTimer = this.insanity ? tiles.length * 2 - 2 : tiles.length * 3 - 3;
    const hitpoints = players.length < 4 ? 1 : Math.floor(players.length / 2);
    this.siphonsLeft = tiles.length;
    this.siphons = tiles.map((location) => {
      const spot = { x: location.getX(), y: location.getY(), z: Z };
      const siphon = this.spawnFixed(I.COL_00FFFF_ENERGY_SIPHON_COL, spot, { scale: false, points: 0, inert: true });
      if (!siphon) return null;
      this.setHealth(siphon, hitpoints);
      siphon.__toaSiphon = { location, spent: false };
      for (const player of players) if (standingOn(player, location)) this.shove(player, "You are pushed off.");
      this.setObject(INVISIBLE_BLOCK, spot, 10, 0);
      return siphon;
    });
    this.repeatSiphonPulse();
  }

  /** The Warden feeds its siphons every 2 ticks while they stand. */
  repeatSiphonPulse() {
    const pulse = () => {
      if (!this.skullAttack || this.phase !== 2 || this.siphons.length === 0) return false;
      for (const siphon of this.siphons) {
        if (siphon && !siphon.__toaSiphon.spent) {
          Shared.tileProjectile(this.area, this.warden, siphon, PROJECTILE.SIPHON, { delay: 0, duration: 90, perTile: 0, startHeight: 100, endHeight: 5, angle: 0 });
        }
      }
      return true;
    };
    this.later(1, () => {
      pulse();
      this.repeat(2, pulse);
    });
  }

  removeSiphon(siphon) {
    const location = siphon.__toaSiphon.location;
    this.setObject(-1, { x: location.getX(), y: location.getY(), z: Z }, 10, 0);
    this.despawn(siphon);
  }

  /** Siphons only break to melee, one point a hit (Wiki); every other style does nothing. */
  filterSiphonHit(hit) {
    const { CombatType } = Shared.core();
    if (hit.getCombatType?.() !== CombatType.MELEE) {
      zeroHit(hit);
      return;
    }
    limitHit(hit, 1);
    if (hit.getTotalDamage() < 1) {
      const first = hit.getHits()[0];
      first?.setDamage(1);
      hit.updateTotalDamage();
    }
  }

  /** A spent siphon stays standing, turned red, until the whole set's done. */
  siphonBroken(siphon) {
    const state = siphon.__toaSiphon;
    if (state.spent || !this.skullAttack) return;
    state.spent = true;
    siphon.setHitpoints(1);
    siphon.setUntargetable(true);
    this.later(1, () => siphon.setNpcTransformationId(SPENT_SIPHON));
    if (--this.siphonsLeft > 0) return;
    this.skullTimer = 0;
    const I = ids();
    const { Animation } = Shared.core();
    const siphons = this.siphons;
    this.later(1, () => {
      for (const other of siphons) {
        if (!other) continue;
        Shared.tileProjectile(this.area, other.__toaSiphon.location, this.warden, PROJECTILE.SKULL, { delay: 0, duration: 58, perTile: 0, startHeight: 20, endHeight: 87, angle: 20 });
        this.removeSiphon(other);
      }
      this.siphons = [];
    });
    this.later(2, () => {
      this.warden.performAnimation(new Animation(ANIMATION.SKULL_RETURN));
      this.warden.setNpcTransformationId(this.tumeken ? I.TUMEKENS_WARDEN_7 : I.ELIDINIS_WARDEN_7);
      this.skullAttack = false;
      this.attackTicks = SLAM_AFTER_SIPHONS;
    });
    this.later(3, () => Shared.damage(this.warden, Math.floor(this.warden.getMaxHitpoints() * SIPHON_REFLECT)));
  }

  /** Siphons left standing: a shockwave from the arena's centre, harder for each one missed. */
  skullsFailed() {
    const missing = this.siphons.filter((siphon) => siphon && !siphon.__toaSiphon.spent).length;
    if (missing === 0) return;
    const I = ids();
    const { Animation } = Shared.core();
    this.warden.performAnimation(new Animation(ANIMATION.SKULL_FAIL));
    const centre = tileOf(SHOCKWAVE_CENTRE);
    const damage = this.maxHit((this.insanity ? FAILED_SIPHON_BASE.INSANITY : FAILED_SIPHON_BASE.NORMAL) * missing);
    const lands = new Map();
    Data.FULL_FLOOR_ATTACK.forEach((group) => {
      for (const entry of group) {
        const location = tileOf(entry);
        const delay = 30 + chebyshev(location, centre) * 6;
        this.graphic(GRAPHIC.FLOOR_BASE + Shared.random(0, 3), location, { delay });
        const tick = Math.floor(delay / 30);
        if (!lands.has(tick)) lands.set(tick, []);
        lands.get(tick).push(location);
      }
    });
    for (const siphon of this.siphons) {
      if (!siphon) continue;
      this.graphic(Shared.randomOf(GRAPHIC.EXPLOSIONS), siphon.getLocation());
      this.removeSiphon(siphon);
    }
    this.siphons = [];
    this.soundAll(SOUND.SKULL_FAIL);
    for (const [tick, tiles] of lands) {
      this.later(tick, () => {
        for (const location of tiles) {
          for (const player of this.challengePlayers()) {
            if (!standingOn(player, location)) continue;
            this.avoidable(player, "the Warden's skull attack");
            Shared.damage(player, damage);
          }
        }
      });
    }
    this.later(3, () => this.warden?.setNpcTransformationId(this.tumeken ? I.TUMEKENS_WARDEN_7 : I.ELIDINIS_WARDEN_7));
    this.later(4, () => {
      this.skullAttack = false;
      this.attackTicks = SLAM_AFTER_SIPHONS - 4;
    });
  }

  // -------------------------------------------------------------- phantoms

  spawnPhantom(id, spot, slot) {
    const npc = this.spawnFixed(id, spot, { scale: false, points: 0, face: FACE_NORTH });
    if (!npc) return;
    npc.setUntargetable(true);
    const speeds = (this.insanity ? PHANTOM_SPEED.INSANITY : PHANTOM_SPEED.NORMAL)[slot];
    const crondis = this.raid.pathLevels[Shared.PATH_BY_KEY.CRONDIS.index];
    this.phantoms.push({
      npc,
      id,
      speeds,
      ticks: Math.max(...speeds),
      magic: false,
      akkhaAttacks: 0,
      zebakLevelled: crondis > 0,
    });
  }

  phantomSpeed(phantom) {
    return phantom.speeds[this.phase === 3 ? 1 : 0];
  }

  tickPhantoms() {
    for (const phantom of this.phantoms) {
      if (phantom.ticks > 0 && --phantom.ticks <= 0) {
        this.phantomAttack(phantom);
        phantom.ticks = this.phantomSpeed(phantom);
      }
    }
  }

  phantomAttack(phantom) {
    const I = ids();
    if (phantom.id === I.ZEBAKS_PHANTOM) this.zebakAttack(phantom);
    else if (phantom.id === I.AKKHAS_PHANTOM) this.akkhaAttack(phantom);
    else if (phantom.id === I.BA_BAS_PHANTOM) this.babaAttack(phantom);
    else this.kephriAttack(phantom);
  }

  /** Up over 4 ticks to the split above the floor, then down on everyone, as his own volley goes. */
  zebakAttack(phantom) {
    const { Animation } = Shared.core();
    const npc = phantom.npc;
    if (Shared.random(0, 2) === 0) phantom.magic = !phantom.magic;
    const style = phantom.magic ? "magic" : "ranged";
    npc.performAnimation(new Animation(ANIMATION.ZEBAK));
    const launch = tileOf(ZEBAK_LAUNCH);
    Shared.tileProjectile(this.area, npc, launch, (phantom.zebakLevelled ? PROJECTILE.ZEBAK_LEVELLED : PROJECTILE.ZEBAK)[style],
      { delay: 30, duration: 90, perTile: 0, startHeight: 50, endHeight: 125, angle: 20 });
    this.later(4, () => {
      const helper = this.spawn(ZEBAK_HELPER, { ...ZEBAK_LAUNCH, z: Z }, { scale: false, points: 0, inert: true });
      if (helper) this.later(ZEBAK_HELPER_TICKS, () => this.despawn(helper));
      for (const player of this.challengePlayers()) {
        Shared.tileProjectile(this.area, launch, player, PROJECTILE.ZEBAK_SPLIT[style], { delay: 0, duration: 90, perTile: 0, startHeight: 125, endHeight: 22, angle: 127 });
        player.performGraphic(Shared.gfx(style === "magic" ? GRAPHIC.ZEBAK_MAGE : GRAPHIC.ZEBAK_RANGED, { delay: 90, height: 90 }));
      }
    });
    this.later(7, () => {
      for (const player of this.challengePlayers()) {
        const hit = this.strike(npc, player, null, style, PHANTOM_DAMAGE.ZEBAK, 0);
        if (hit.getTotalDamage() > 0) this.avoidable(player, "Zebak's Phantom");
      }
    });
  }

  /** Ranged first, three attacks a style with a turn to switch; randomly under Stay Vigilant (Wiki). */
  akkhaAttack(phantom) {
    const { Animation } = Shared.core();
    const npc = phantom.npc;
    if ((this.stayVigilant && Shared.random(0, 3) === 0) || (!this.stayVigilant && phantom.akkhaAttacks >= 3)) {
      phantom.akkhaAttacks = 0;
      npc.performAnimation(new Animation(ANIMATION.AKKHA_SWITCH));
      phantom.magic = !phantom.magic;
      return;
    }
    phantom.akkhaAttacks++;
    const style = phantom.magic ? "magic" : "ranged";
    npc.performAnimation(new Animation(phantom.magic ? ANIMATION.AKKHA_MAGE : ANIMATION.AKKHA_RANGED));
    const players = this.challengePlayers();
    this.later(2, () => {
      for (const player of players) {
        if (!this.challengePlayers().includes(player)) continue;
        Shared.tileProjectile(this.area, npc, player, PROJECTILE.AKKHA[style], { delay: 0, duration: 78, perTile: 0, startHeight: 101, endHeight: 34, angle: 12 });
        const hit = this.strike(npc, player, null, style, PHANTOM_DAMAGE.AKKHA, 3);
        if (hit.getTotalDamage() > 0) this.avoidable(player, "Akkha's Phantom");
      }
    });
  }

  babaAttack(phantom) {
    const { Animation } = Shared.core();
    phantom.npc.performAnimation(new Animation(ANIMATION.BABA));
    const tiles = [];
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (!tiles.some((other) => other.getX() === location.getX() && other.getY() === location.getY())) tiles.push(location.clone());
    }
    for (const location of tiles) this.graphic(this.insanity ? GRAPHIC.RUBBLE_FASTER : GRAPHIC.RUBBLE, location, { delay: 20 });
    this.later(this.insanity ? 3 : 5, () => {
      for (const location of tiles) {
        for (const player of this.challengePlayers()) {
          if (standingOn(player, location)) this.tileHit(player, PHANTOM_DAMAGE.BABA, "Ba-Ba's Phantom");
        }
      }
    });
  }

  kephriAttack(phantom) {
    const { Animation } = Shared.core();
    phantom.npc.performAnimation(new Animation(ANIMATION.KEPHRI));
    const launch = tileOf(KEPHRI_LAUNCH);
    Shared.tileProjectile(this.area, phantom.npc, launch, PROJECTILE.KEPHRI_LAUNCH, { delay: 39, duration: 51, perTile: 0, startHeight: 175, endHeight: 250, angle: 50 });
    this.later(3, () => {
      const tiles = [];
      const add = (location) => {
        if (!tiles.some((other) => other.getX() === location.getX() && other.getY() === location.getY())) tiles.push(location);
      };
      for (const player of this.challengePlayers()) {
        const location = player.getLocation().clone();
        Shared.tileProjectile(this.area, launch, location, PROJECTILE.KEPHRI_BOMB, { delay: 0, duration: 90, perTile: 0, startHeight: 250, endHeight: 9, angle: 115 });
        if (this.aerialAssault) {
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) add(location.transform(dx, dy));
        } else {
          add(location);
        }
      }
      for (const location of tiles) this.graphic(GRAPHIC.INCOMING, location);
      this.later(3, () => {
        const top = this.maxHit(PHANTOM_DAMAGE.KEPHRI) * (this.aerialAssault ? PHANTOM_DAMAGE.AERIAL_ASSAULT : 1);
        for (const location of tiles) {
          if (!Shared.floorFree(this.area, location)) continue;
          this.graphic(GRAPHIC.KEPHRI_EXPLODE, location, { height: 38 });
          for (const player of this.challengePlayers()) {
            if (!standingOn(player, location)) continue;
            this.avoidable(player, "Kephri's Phantom");
            const damage = Shared.random(Math.floor(top * 0.75), Math.floor(top));
            Shared.damage(player, Shared.isProtected(player, "magic") ? Math.floor(damage * 0.75) : damage);
          }
        }
      });
    });
  }

  // -------------------------------------------------------------- the last stand

  startLastPhase() {
    if (this.phase !== 2) return;
    const { Animation } = Shared.core();
    this.phase = 3;
    this.skullAttack = false;
    this.skullTimer = 0;
    const warden = this.warden;
    this.clearSiphons();
    this.soundAll(SOUND.SELF_HEAL);
    warden.setHitpoints(Math.min(warden.getMaxHitpoints(), warden.getHitpoints() + Math.floor(warden.getMaxHitpoints() * ENRAGE_HEAL)));
    warden.setDefenceLevel(DEFENCE.FINAL_ENRAGED);
    warden.performAnimation(new Animation(ANIMATION.LAST_PHASE));
    this.amascut?.performAnimation(new Animation(ANIMATION.AMASCUT_ENRAGE, 1));
    this.later(9, () => this.amascut?.setNpcTransformationId(AMASCUT_ENRAGED));
    for (const phantom of this.phantoms) phantom.ticks = Math.min(phantom.ticks, this.phantomSpeed(phantom));
    this.later(4, () => {
      for (const player of this.challengePlayers()) Shared.sound(player, SOUND.LAST_PHASE);
    });
  }

  clearSiphons() {
    for (const siphon of this.siphons) if (siphon) this.removeSiphon(siphon);
    this.siphons = [];
  }

  /**
   * A row falls every 18 ticks (12 under Insanity), over 4 ticks, furthest first. Its pieces
   * (toa_wardens_p3_brokentile*) are blockwalk ground decoration, so once placed the tile is
   * gone: no walking onto it, and no target of thunder or rock. Anyone on it steps to what's
   * left: no recording has a player standing on a falling row, and the Wiki says only that they
   * are "no longer forced into unwalkable terrain" (1 Sep 2022).
   */
  tickCollapse() {
    if (this.floorIndex >= Data.FLOOR_COLLAPSE.length || --this.floorTicks > 0) return;
    this.floorTicks = this.insanity ? COLLAPSE.EVERY_INSANITY : COLLAPSE.EVERY;
    const row = FLOOR_TOP_ROW - Math.floor(this.floorIndex / COLLAPSE.TICKS);
    let ticks = 0;
    const fall = () => {
      if (ticks++ >= COLLAPSE.TICKS || this.phase !== 3 || this.floorIndex >= Data.FLOOR_COLLAPSE.length) return false;
      for (const [id, type, rotation, x, y] of Data.FLOOR_COLLAPSE[this.floorIndex]) {
        const location = tile(x, y);
        if (y === row) {
          Shared.tileProjectile(this.area, location, tileOf(FLOOR_VOID), PROJECTILE.FLOOR_REMOVAL, { delay: 0, duration: 90, perTile: 0, startHeight: 0, endHeight: 200, angle: 20 });
          for (const player of this.challengePlayers()) if (standingOn(player, location)) this.moveOffFallenRow(player, row - 1);
        }
        this.setObject(id, { x, y, z: Z }, type, rotation);
      }
      this.floorIndex++;
      return true;
    };
    fall();
    this.repeat(1, fall);
  }

  /** Steps a player straight to the nearest floor south of the fallen row. */
  moveOffFallenRow(player, row = this.floorEdge()) {
    const location = player.getLocation();
    for (let radius = 0; radius <= 3; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const next = tile(location.getX() + dx, row);
        if (!Shared.floorFree(this.area, next)) continue;
        player.getMovementQueue().reset();
        Shared.knockback(player, next.getX() - location.getX(), next.getY() - location.getY(), { ticks: 1 });
        return;
      }
    }
  }

  /** Three ticks of warnings then three of strikes, every 6, wherever the last set didn't fall. */
  tickThunder() {
    const clock = this.thunderClock++;
    if (clock < THUNDER.FIRST - 1) return;
    const step = (clock - (THUNDER.FIRST - 1)) % THUNDER.EVERY;
    if (step >= THUNDER.WARNING_TICKS) return;
    if (step === 0) this.thunderTaken.clear();
    const open = [];
    for (let y = FLOOR_MIN.y; y <= this.floorEdge(); y++) {
      for (let x = 0; x <= 20; x++) {
        const location = tile(FLOOR_MIN.x + x, y);
        const key = `${location.getX()},${location.getY()}`;
        if (!this.thunderTaken.has(key) && Shared.floorFree(this.area, location)) open.push(location);
      }
    }
    const count = this.floorIndex > COLLAPSE.TICKS ? THUNDER.TILES_LATE : THUNDER.TILES_EARLY;
    const strikes = Shared.shuffle(open).slice(0, count);
    for (const location of strikes) {
      this.graphic(GRAPHIC.THUNDER_INCOMING, location);
      this.thunderTaken.add(`${location.getX()},${location.getY()}`);
    }
    this.later(THUNDER.LAND, () => {
      if (this.phase !== 3) return;
      this.soundAll(SOUND.THUNDER);
      for (const location of strikes) {
        this.graphic(GRAPHIC.FINAL_THUNDER, location);
        for (const player of this.challengePlayers()) if (standingOn(player, location)) this.tileHit(player, DAMAGE.THUNDER, "red lightning");
      }
    });
  }
}

// ------------------------------------------------------------------ hooks

function wardensRoom(entity) {
  const room = entity?.__toaRoom;
  return room instanceof WardensRoom && !room.destroyed ? room : null;
}

function finalRoom(entity) {
  const room = entity?.__toaRoom;
  return room instanceof WardensFinalRoom && !room.destroyed ? room : null;
}

function roomOfPlayer(player) {
  const room = Raid.raidOf(player)?.roomFor(player);
  return room && !room.destroyed ? room : null;
}

function beginWardens({ player }) {
  const room = roomOfPlayer(player);
  if (!(room instanceof WardensRoom)) return false;
  room.setReady(player);
  return true;
}

function talkToWardensOsmumten({ player, npc }) {
  const room = roomOfPlayer(player);
  if (!(room instanceof WardensRoom)) return false;
  Shared.npcSay(player, npc?.getId?.() ?? ids().OSMUMTEN_2, "Amascut's Wardens await beyond. Tell me when you are ready to begin, and we shall start once your whole party is.");
  return true;
}

function filterWardenDamage(event) {
  const npc = event.npc;
  const first = wardensRoom(npc);
  if (first) {
    if (npc === first.moving) first.filterMovingHit(event.hit);
    else if (npc === first.core) first.coreHit(event.hit);
    else if (npc === first.obelisk && npc.getDefenceLevel() < DEFENCE.OBELISK_FLOOR) npc.setDefenceLevel(DEFENCE.OBELISK_FLOOR);
    return;
  }
  const final = finalRoom(npc);
  if (!final) return;
  if (npc === final.warden) final.filterWardenHit(event.hit);
  else if (npc.__toaSiphon) final.filterSiphonHit(event.hit);
}

/** Melee on the core always hits its maximum; the right style always hits the shield; melee, a siphon. */
function wardenHitRolls(event) {
  const { attacker, target, combatType } = event;
  if (!attacker?.isPlayer?.() || !target) return;
  const { CombatType } = Shared.core();
  const first = wardensRoom(target);
  if (first) {
    if (target === first.core && combatType === CombatType.MELEE) {
      event.forceAccurate = true;
      event.forceMaxHit = true;
    } else if (target === first.moving && !first.down && combatType === first.wantedStyle()) {
      event.forceAccurate = true;
    }
    return;
  }
  if (target.__toaSiphon && finalRoom(target) && combatType === CombatType.MELEE) event.forceAccurate = true;
}

function wardenDowned(event) {
  const npc = event.npc;
  const first = wardensRoom(npc);
  if (first) {
    if (npc === first.obelisk) {
      event.preventDeath = true;
      npc.setHitpoints(1);
      first.startWardenPhase();
    } else if (npc === first.moving) {
      event.preventDeath = true;
      npc.setHitpoints(1);
      if (first.down) first.killMovingWarden();
      else first.wardenDown();
    } else if (npc === first.core) {
      event.preventDeath = true;
      npc.setHitpoints(npc.getMaxHitpoints());
    }
    return;
  }
  const final = finalRoom(npc);
  if (!final) return;
  if (npc === final.warden) {
    event.preventDeath = true;
    if (final.phase === 2) {
      npc.setHitpoints(1);
      final.startLastPhase();
    } else {
      final.complete();
    }
  } else if (npc.__toaSiphon) {
    event.preventDeath = true;
    final.siphonBroken(npc);
  }
}

/** Entombed players can't fight. */
function wardenAttackRules(event) {
  const attacker = event.attacker;
  if (!attacker?.isPlayer?.()) return;
  const room = roomOfPlayer(attacker);
  if (room instanceof WardensRoom && room.isStoned(attacker)) event.allow = false;
}

/** A melee hit on a siphon costs no attack delay (Wiki): the next one can be struck at once. */
function struckSiphon(event) {
  const { player, target, hit } = event;
  if (!target?.__toaSiphon || !finalRoom(target)) return;
  if (hit?.getCombatType?.() !== Shared.core().CombatType.MELEE) return;
  Shared.skipAttackDelay(player, target);
}

/** Walk to the edge of the floor nearest the crystal rather than to its unreachable tile. */
function routeToCrystal(event) {
  if (event.objectId !== Shared.core().ObjectIdentifiers.TELEPORT_CRYSTAL_3) return;
  if (!(roomOfPlayer(event.player) instanceof WardensFinalRoom)) return;
  const x = Math.min(CRYSTAL_EDGE.maxX, Math.max(CRYSTAL_EDGE.minX, event.player.getLocation().getX()));
  event.destination = { x, y: CRYSTAL_EDGE.y, z: Z };
}

module.exports = function registerWardens(api) {
  Shared.bind(api);
  Raid.registerRoom("WARDENS_P1", WardensRoom);
  Raid.registerRoom("WARDENS_P3", WardensFinalRoom);
  api.onNpcInteraction("Osmumten", { Begin: beginWardens, "Talk-to": talkToWardensOsmumten });
  api.onNpcHitModify(filterWardenDamage);
  api.onCombatHitRoll(wardenHitRolls);
  api.onNpcBeforeDeath(wardenDowned);
  Raid.onRaidArea("canAttack", wardenAttackRules);
  api.onObjectRoute(routeToCrystal);
  api.onPlayerDealtDamage(struckSiphon);
  registerWardenCombat(api);
};

function registerWardenCombat(api) {
  const { CombatMethod, CombatType, NpcIdentifiers } = api.core;

  class MovingWardenCombatMethod extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return 30;
    }

    attackSpeed(npc) {
      return wardensRoom(npc)?.movingSpeed() ?? ATTACK_SPEED.elidinis;
    }

    canAttack(npc) {
      const room = wardensRoom(npc);
      return !!room && room.isStarted() && room.moving === npc && room.movingCanAttack && !room.down;
    }

    start(npc, target) {
      wardensRoom(npc)?.movingAttack(target);
    }

    hits() {
      return [];
    }
  }

  api.registerNpcCombatMethodProvider([
    NpcIdentifiers.ELIDINIS_WARDEN_3, NpcIdentifiers.ELIDINIS_WARDEN_4,
    NpcIdentifiers.TUMEKENS_WARDEN_3, NpcIdentifiers.TUMEKENS_WARDEN_4,
  ], MovingWardenCombatMethod, { singleton: false });
}
