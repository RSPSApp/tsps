"use strict";

/**
 * Path of Het, Akkha (Sands of Time). Wiki: https://oldschool.runescape.wiki/w/Akkha
 *
 * Akkha cycles melee, ranged and magic, praying against the style he attacks with, and runs a
 * special every few attacks: the memory of glowing quadrants, a trail of orbs behind every
 * player, or (with company) detonations. At 80/60/40/20% his shadows appear and fill an
 * hourglass; while he stands on a quadrant whose shadow lives he is immune. Out of health he
 * makes a final stand from one of four shadow tiles, only hurt in melee, among unstable orbs.
 *
 * Where the numbers come from. Captures are rev/rec/tick; 234-235 (3280, 844, 3429, 3431) are
 * after the 25 June 2025 rework, 223/227 (14, 553, 554, 1757...) before it.
 *
 * Wiki:
 * - Melee max 22: the infobox's 55 is that at the +150% damage cap (22 x 2.5). The Shadow's
 *   infobox and his stats (strength 140, +30) give 22; no captured hit is above 22 x its factor.
 * - Protection lets through about a quarter of melee and 10-20% of ranged and magic.
 * - Only prays against the style he attacks with (June 2025). The style changes at a special,
 *   and after 60 seconds without one; players stop attacking when it does.
 * - Specials every 7 attacks, every 6 with Stay Vigilant (June 2025).
 * - Unstable orbs cap at 25; Protect from Magic takes 25% off before the cap; shared on a tile.
 * - Three successful hits (one more per extra player) move him in the final stand; thralls
 *   don't count. He heals to 20%. Fire burns for 5; darkness drains combat stats by 3.
 * - Memory iterations: one more every two path levels. Detonate: group only; 3 tiles in a plus
 *   (Feeling Special: maybe a cross). Feeling Special: 2 ticks between blasts, an orb in front.
 *
 * Captures:
 * - Autos before a special: 7 (234/03280 ticks 5778-5818, 5856-5892), 5 with Stay Vigilant
 *   (235/00844 943-967, 03429 824-852, 03431 636-661). Rev 223 shows the old 6 (00014 2058-2088).
 *   The style swap lands on the special's first tick (03280 5824, 5898).
 * - Melee lands 1 tick after 9770; ranged and magic send their projectile 2 ticks after the
 *   animation, 30 cycles flat at any distance, landing a tick later (03280 5856-5859).
 * - Thresholds: "immune" on the hit that crosses, the shadows the tick after (03280 5780-5781).
 *   Every threshold makes four new shadows; those dispelled before come back immune, and only
 *   the last dispelled plays its spawn (03280 5805, 5824, 5874). A kill makes the rest immune.
 * - Hourglass: helper NPC 11805 in each corner shows bar 36, 2 per tick to 100 (00014 2193),
 *   the corner loc is _empty02, then the base loc at 50, _full01 at 100, _empty01 when
 *   dispelled. At 100 the shadow plays 9777, blasts next tick, refills 4 ticks later. Paused
 *   during the memory (03280 5827-5850).
 * - Memory: 9777, message +2, vanish +3, glows from +4 two ticks apart, each lit till the next;
 *   blasts from the last glow +2, 4 ticks apart, back 2 after the last on one of the four middle
 *   tiles (03280 5824-5850; 24+18+16+15 samples). Feeling Special has the first blast on the
 *   last glow, then every 2 (227/00553 10256-10271).
 * - Blasts: quadrant in 75 tiles; delay 30 + 3 per tile by Manhattan distance, from the middle
 *   out for the memory and from the outer edge in for a shadow (03280 5836, 00014 2194).
 * - Trail: 9778, message +2, ends 20 later (00844 973-995). An orb appears a tick after each move
 *   on the tile left, one a tick however far the run went (00553 8196-8197), and with Feeling
 *   Special another one tile ahead (00553 10320). Lives 7 ticks (every orb in 553/554).
 * - Detonate: message +2, tiles 8 after that (227/01753 1066-1074), 245-cycle white tint.
 * - Final stand: 9779 and 11793 at once, 11794 and the heal at +2, vanish +4, 11795 and 11798s
 *   appear +5, orbs from +7 every 3, death plays 9792, all gone +1, room over +2 (03280 5908-5924).
 * - Unstable orb starts and directions: 160, all seen 11-56 times in 3,500 orbs across 41 fights.
 *
 * Estimates (fits, from captures only):
 * - Element hits (memory, shadow, trail, detonate) roll 12-16 x the damage factor: 35 hits with an
 *   element message at raid level 0-555, all 12-16 once divided. Orbs and detonate have few.
 * - Ranged and magic max 18: his stats (ranged 100, +40) by the standard formula; the Wiki says
 *   only that melee hits hardest. No hit in ~15 unprotected samples is above 14 x factor.
 * - Darkness 2 x factor a tick for 5 ticks: 00101 12353-5 (rl 0), 01757 30047-9 (cap), 00553 (rl 310).
 * - Unstable orb base 13: 25 at raid level 300+ (15 hits), and 9 at raid level 0 with Protect
 *   from Magic (00014, one sample: 13 x 0.75).
 * - Post-rework batches of 3-6 unstable orbs: 20 batches in 03280, 03429, 03431, 00844 (old 5-8).
 *
 * Still only from Near-Reality: the element cooldowns in applyEffect, and how long lightning
 * blocks prayer.
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");

/** Every start tile and direction an unstable orb was captured with. */
const UNSTABLE_ORB_PATHS = [
  [3670, 5404, "EAST"], [3670, 5404, "NORTH_EAST"], [3670, 5405, "EAST"], [3670, 5405, "NORTH_EAST"],
  [3670, 5405, "SOUTH_EAST"], [3670, 5406, "EAST"], [3670, 5406, "NORTH_EAST"],
  [3670, 5406, "SOUTH_EAST"], [3670, 5407, "EAST"], [3670, 5407, "NORTH_EAST"],
  [3670, 5407, "SOUTH_EAST"], [3670, 5408, "EAST"], [3670, 5408, "NORTH_EAST"],
  [3670, 5408, "SOUTH_EAST"], [3670, 5409, "EAST"], [3670, 5409, "NORTH_EAST"],
  [3670, 5409, "SOUTH_EAST"], [3670, 5410, "EAST"], [3670, 5410, "NORTH_EAST"],
  [3670, 5410, "SOUTH_EAST"], [3670, 5411, "EAST"], [3670, 5411, "SOUTH_EAST"], [3671, 5403, "EAST"],
  [3671, 5403, "NORTH"], [3671, 5403, "NORTH_EAST"], [3671, 5412, "EAST"], [3671, 5412, "SOUTH"],
  [3671, 5412, "SOUTH_EAST"], [3672, 5402, "EAST"], [3672, 5402, "NORTH"], [3672, 5402, "NORTH_EAST"],
  [3672, 5413, "EAST"], [3672, 5413, "SOUTH"], [3672, 5413, "SOUTH_EAST"], [3673, 5401, "EAST"],
  [3673, 5401, "NORTH"], [3673, 5401, "NORTH_EAST"], [3673, 5414, "EAST"], [3673, 5414, "SOUTH"],
  [3673, 5414, "SOUTH_EAST"], [3674, 5400, "EAST"], [3674, 5400, "NORTH"], [3674, 5400, "NORTH_EAST"],
  [3674, 5415, "EAST"], [3674, 5415, "SOUTH"], [3674, 5415, "SOUTH_EAST"], [3675, 5399, "EAST"],
  [3675, 5399, "NORTH"], [3675, 5399, "NORTH_EAST"], [3675, 5416, "EAST"], [3675, 5416, "SOUTH"],
  [3675, 5416, "SOUTH_EAST"], [3676, 5398, "EAST"], [3676, 5398, "NORTH"], [3676, 5398, "NORTH_EAST"],
  [3676, 5417, "EAST"], [3676, 5417, "SOUTH"], [3676, 5417, "SOUTH_EAST"], [3677, 5397, "NORTH"],
  [3677, 5397, "NORTH_EAST"], [3677, 5418, "SOUTH"], [3677, 5418, "SOUTH_EAST"], [3678, 5397, "NORTH"],
  [3678, 5397, "NORTH_EAST"], [3678, 5397, "NORTH_WEST"], [3678, 5418, "SOUTH"],
  [3678, 5418, "SOUTH_EAST"], [3678, 5418, "SOUTH_WEST"], [3679, 5397, "NORTH"],
  [3679, 5397, "NORTH_EAST"], [3679, 5397, "NORTH_WEST"], [3679, 5418, "SOUTH"],
  [3679, 5418, "SOUTH_EAST"], [3679, 5418, "SOUTH_WEST"], [3680, 5397, "NORTH"],
  [3680, 5397, "NORTH_EAST"], [3680, 5397, "NORTH_WEST"], [3680, 5418, "SOUTH"],
  [3680, 5418, "SOUTH_EAST"], [3680, 5418, "SOUTH_WEST"], [3681, 5397, "NORTH"],
  [3681, 5397, "NORTH_EAST"], [3681, 5397, "NORTH_WEST"], [3681, 5418, "SOUTH"],
  [3681, 5418, "SOUTH_EAST"], [3681, 5418, "SOUTH_WEST"], [3682, 5397, "NORTH"],
  [3682, 5397, "NORTH_EAST"], [3682, 5397, "NORTH_WEST"], [3682, 5418, "SOUTH"],
  [3682, 5418, "SOUTH_EAST"], [3682, 5418, "SOUTH_WEST"], [3683, 5397, "NORTH"],
  [3683, 5397, "NORTH_EAST"], [3683, 5397, "NORTH_WEST"], [3683, 5418, "SOUTH"],
  [3683, 5418, "SOUTH_EAST"], [3683, 5418, "SOUTH_WEST"], [3684, 5397, "NORTH"],
  [3684, 5397, "NORTH_WEST"], [3684, 5418, "SOUTH"], [3684, 5418, "SOUTH_WEST"], [3685, 5398, "NORTH"],
  [3685, 5398, "NORTH_WEST"], [3685, 5398, "WEST"], [3685, 5417, "SOUTH"], [3685, 5417, "SOUTH_WEST"],
  [3685, 5417, "WEST"], [3686, 5399, "NORTH"], [3686, 5399, "NORTH_WEST"], [3686, 5399, "WEST"],
  [3686, 5416, "SOUTH"], [3686, 5416, "SOUTH_WEST"], [3686, 5416, "WEST"], [3687, 5400, "NORTH"],
  [3687, 5400, "NORTH_WEST"], [3687, 5400, "WEST"], [3687, 5415, "SOUTH"], [3687, 5415, "SOUTH_WEST"],
  [3687, 5415, "WEST"], [3688, 5401, "NORTH"], [3688, 5401, "NORTH_WEST"], [3688, 5401, "WEST"],
  [3688, 5414, "SOUTH"], [3688, 5414, "SOUTH_WEST"], [3688, 5414, "WEST"], [3689, 5402, "NORTH"],
  [3689, 5402, "NORTH_WEST"], [3689, 5402, "WEST"], [3689, 5413, "SOUTH"], [3689, 5413, "SOUTH_WEST"],
  [3689, 5413, "WEST"], [3690, 5403, "NORTH"], [3690, 5403, "NORTH_WEST"], [3690, 5403, "WEST"],
  [3690, 5412, "SOUTH"], [3690, 5412, "SOUTH_WEST"], [3690, 5412, "WEST"], [3691, 5404, "NORTH_WEST"],
  [3691, 5404, "WEST"], [3691, 5405, "NORTH_WEST"], [3691, 5405, "SOUTH_WEST"], [3691, 5405, "WEST"],
  [3691, 5406, "NORTH_WEST"], [3691, 5406, "SOUTH_WEST"], [3691, 5406, "WEST"],
  [3691, 5407, "NORTH_WEST"], [3691, 5407, "SOUTH_WEST"], [3691, 5407, "WEST"],
  [3691, 5408, "NORTH_WEST"], [3691, 5408, "SOUTH_WEST"], [3691, 5408, "WEST"],
  [3691, 5409, "NORTH_WEST"], [3691, 5409, "SOUTH_WEST"], [3691, 5409, "WEST"],
  [3691, 5410, "NORTH_WEST"], [3691, 5410, "SOUTH_WEST"], [3691, 5410, "WEST"],
  [3691, 5411, "SOUTH_WEST"], [3691, 5411, "WEST"],
];
// Per quadrant (NE, SE, SW, NW): [x, firstY, lastY] column runs.
const QUADRANT_COLUMNS = [
  [[3681, 5408, 5417], [3682, 5408, 5417], [3683, 5408, 5416], [3684, 5408, 5416], [3685, 5408, 5416], [3686, 5408, 5415], [3687, 5408, 5414], [3688, 5408, 5413], [3689, 5408, 5412], [3690, 5408, 5409]],
  [[3681, 5398, 5407], [3682, 5398, 5407], [3683, 5399, 5407], [3684, 5399, 5407], [3685, 5399, 5407], [3686, 5400, 5407], [3687, 5401, 5407], [3688, 5402, 5407], [3689, 5403, 5407], [3690, 5406, 5407]],
  [[3671, 5406, 5407], [3672, 5403, 5407], [3673, 5402, 5407], [3674, 5401, 5407], [3675, 5400, 5407], [3676, 5399, 5407], [3677, 5399, 5407], [3678, 5399, 5407], [3679, 5398, 5407], [3680, 5398, 5407]],
  [[3671, 5408, 5409], [3672, 5408, 5412], [3673, 5408, 5413], [3674, 5408, 5414], [3675, 5408, 5415], [3676, 5408, 5416], [3677, 5408, 5416], [3678, 5408, 5416], [3679, 5408, 5417], [3680, 5408, 5417]],
];

const Z = 1;
const SPAWN = { x: 3673, y: 5407, z: Z };
const MEMORY_TILES = [{ x: 3679, y: 5406 }, { x: 3680, y: 5406 }, { x: 3679, y: 5407 }, { x: 3680, y: 5407 }];
const QUADRANT_BASE = { x: 3681, y: 5408 };
const QUADRANT_ORIGINS = [{ x: 3681, y: 5408 }, { x: 3681, y: 5407 }, { x: 3680, y: 5407 }, { x: 3680, y: 5408 }];
const SHADOW_TILES = [{ x: 3685, y: 5412 }, { x: 3685, y: 5401 }, { x: 3674, y: 5401 }, { x: 3674, y: 5412 }];
const QUADRANT_LIGHTS = [
  [45871, 3682, 5409], [45869, 3682, 5406], [45870, 3679, 5406], [45868, 3679, 5409],
];
const QUADRANT_GRAPHICS = [2257, 2256, 2259, 2258];
const QUADRANT_SOUNDS = [5591, 3887, 173, 156];
const QUADRANT_NAMES = ["shadow", "lightning", "ice", "fire"];
const BLAST_REACH = 12;
const BLAST_DELAY = 30;
const BLAST_STEP = 3;

/** Per quadrant: the corner the hourglass stands on (and the helper NPC showing its bar) and its stages. */
const HOURGLASSES = [
  { x: 3689, y: 5416, half: 45982, gone: 46057, empty: 46061, full: 46065 },
  { x: 3689, y: 5398, half: 46017, gone: 46059, empty: 46063, full: 46067 },
  { x: 3671, y: 5398, half: 46016, gone: 46058, empty: 46062, full: 46066 },
  { x: 3671, y: 5416, half: 45981, gone: 46056, empty: 46060, full: 46064 },
];
const AKKHA_HEADBAR_NPC = 11805; // akkha_headbar_npc
const HOURGLASS_BAR = 36;
const HOURGLASS_BAR_PER_TICK = 2;

const ANIMATION = {
  MELEE: 9770, RANGED: 9772, MAGIC: 9774, VANISH: 9784, APPEAR: 9785, DETONATION: 9776, MEMORY: 9777,
  TRAIL: 9778, FINAL_STAND: 9779, SHADOW_SPAWN: 9790, SHADOW_BLAST: 9777, SHADOW_DEATH: 9792,
};
const PROJECTILE = { RANGED: 2255, MAGIC: 2253 };
const SOUND = { STYLE: 5585, SYMBOL: 5667, QUADRANT: 5727, TRAIL: 5722, FIRE: 4827, DARKNESS: 5675, RANGED_HIT: 5640, MAGIC_HIT: 5774 };
const GRAPHIC = { FIRE: 128, UNSTABLE_BURST: 2260 };
const TINT = {
  IMMUNE: { startCycle: 0, endCycle: 600, hue: 0, saturation: 0, lightness: 106, weight: 40 },
  NONE: { startCycle: 0, endCycle: 0, hue: -1, saturation: -1, lightness: -1, weight: 0 },
  TRAIL: { startCycle: 0, endCycle: 605, hue: 0, saturation: 0, lightness: 0, weight: 112 },
  DETONATE: { startCycle: 0, endCycle: 245, hue: 8, saturation: 1, lightness: 100, weight: 112 },
};
const IMMUNE_TINT_REFRESH = 15;

const MAX_HIT = { melee: 22, ranged: 18, magic: 18, UNSTABLE: 13, UNSTABLE_CAP: 25, BURN: 5, DARKNESS: 2 };
const ELEMENT_HIT = { min: 12, max: 16 };
const PRAYER_THROUGH = { melee: 0.25, ranged: 0.15, magic: 0.15 };
const UNSTABLE_PRAYER_THROUGH = 0.75;
const SHADOW_TIMER = 50;
const TRAIL_TICKS = 22;
const TRAIL_START = 20;
const DETONATION_TICKS = 10;
const TRAIL_ORB_LIFE = 7;
const UNSTABLE_INTERVAL = 3;
const UNSTABLE_BATCH = { min: 3, max: 6 };
const FINAL_SHARE = 0.2;
const AUTOS = 7;
const AUTOS_VIGILANT = 5;
const ATTACK_SPEED = 6;
const STYLE_TIMEOUT = 100; // Wiki: 60 seconds
const STAT_DRAIN = 3;
const BURNS = 5;
const BURN_INTERVAL = 3;
const DARKNESS_TICKS = 5;
const ICE_TICKS = 25;
const COLLAPSE_TICKS = 2;
const TASK = { PERFECT: "Perfect Akkha", ORBS: "Dropped the ball", EXPERT: "Akkhan't Do it" };
const EXPERT_PATH_LEVEL = 4;

class AkkhaRoom extends Raid.Room {
  build() {
    const { NpcIdentifiers } = Shared.core();
    this.forms = [NpcIdentifiers.AKKHA_2, NpcIdentifiers.AKKHA_3, NpcIdentifiers.AKKHA_4];
    this.styles = ["melee", "ranged", "magic"];
    this.formIndex = 0;
    const settings = this.settings;
    this.doubleTrouble = settings.isActive("DOUBLE_TROUBLE");
    this.keepBack = settings.isActive("KEEP_BACK");
    this.stayVigilant = settings.isActive("STAY_VIGILANT");
    this.feelingSpecial = settings.isActive("FEELING_SPECIAL");
    this.autosLeft = this.stayVigilant ? AUTOS_VIGILANT : AUTOS;
    this.specialIndex = Shared.random(0, 2);
    this.lastStyleChange = 0;
    this.memory = [];
    this.memoryDelay = 0;
    this.trailTicks = 0;
    this.detonationTicks = 0;
    this.shadows = [null, null, null, null];
    this.bars = [null, null, null, null];
    this.dispelled = new Set();
    this.lastDispelled = -1;
    this.shadowsUp = false;
    this.restoring = false;
    this.dying = false;
    this.fakes = [];
    this.realTile = -1;
    this.swapHits = 0;
    this.trailOrbs = new Map();
    this.trailFrom = new Map();
    this.unstableOrbs = new Set();
    this.unstableTicks = -1;
    this.effects = new Map();
    this.standing = false;
    this.lastHp = null;
    this.immune = false;
    this.immuneTint = 0;
    this.memoryIterations = 4 + Math.min(2, Math.floor(this.pathLevel() / 2));
    this.akkha = this.spawn(NpcIdentifiers.AKKHA, SPAWN, { points: 1 });
    // Wiki: "while it is a distance attack, he will always try to close the gap between him and
    // his target", so he can be led into the quadrant of a dispelled shadow.
    this.akkha?.setFlag("combat:close-in");
    if (this.akkha) this.akkha.__toaAkkha = true;
  }

  onStart() {
    this.raid.scale(this.akkha, this.pathLevel());
    this.akkha.setNpcTransformationId(this.forms[0]);
    this.lastHp = this.akkha.getHitpoints();
    this.lastStyleChange = Shared.cycle();
    this.openBossHud(this.akkha);
  }

  lootSource() {
    return this.akkha;
  }

  onComplete() {
    this.clearAdds();
    this.despawn(this.akkha);
    this.reportTasks();
  }

  onReset() {
    this.clearAdds();
    this.despawn(this.akkha);
    this.build();
  }

  clearAdds() {
    for (const shadow of this.shadows) if (shadow) this.despawn(shadow);
    this.shadows = [null, null, null, null];
    for (const bar of this.bars) if (bar) this.despawn(bar);
    this.bars = [null, null, null, null];
    for (const fake of this.fakes) if (fake) this.despawn(fake);
    this.fakes = [];
    for (const orb of this.trailOrbs.keys()) this.despawn(orb);
    this.trailOrbs.clear();
    for (const orb of this.unstableOrbs) this.despawn(orb);
    this.unstableOrbs.clear();
    this.unstableTicks = -1;
    this.resetObjects();
  }

  // -------------------------------------------------------------- tasks

  allInvocations() {
    return this.doubleTrouble && this.keepBack && this.stayVigilant && this.feelingSpecial;
  }

  /** Perfect Akkha is lost by anyone's mistake; the Wiki's other tasks are "without dying yourself". */
  failPerfect(reason) {
    this.raid.failTask(TASK.PERFECT, reason);
  }

  reportTasks() {
    const survivors = this.deathlessPlayers();
    if (survivors.length > 0) this.raid.completeTask(TASK.ORBS, survivors);
    if (!this.allInvocations()) return;
    if (this.teamSize >= 2) this.raid.completeTask(TASK.PERFECT);
    if (this.pathLevel() >= EXPERT_PATH_LEVEL && survivors.length > 0) this.raid.completeTask(TASK.EXPERT, survivors);
  }

  get style() {
    return this.styles[this.formIndex];
  }

  quadrantOf(location) {
    if (location.getX() >= QUADRANT_BASE.x) return location.getY() >= QUADRANT_BASE.y ? 0 : 1;
    return location.getY() >= QUADRANT_BASE.y ? 3 : 2;
  }

  shadowAlive(shadow) {
    return !!shadow && shadow.getHitpoints() > 0 && shadow.isRegistered?.() !== false;
  }

  /** He can't be hurt while standing in a quadrant whose shadow is alive. */
  onShadedQuadrant() {
    if (!this.shadowsUp) return false;
    const centre = this.akkha.getLocation().transform(1, 1);
    return this.shadowAlive(this.shadows[this.quadrantOf(centre)]);
  }

  /** From the hit that crosses a threshold until the shadows are back, and on a shaded quadrant. */
  isImmune() {
    return this.restoring || this.onShadedQuadrant();
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (!this.isStarted()) return;
    this.tickMemory();
    this.tickTimers();
    this.tickShadows();
    this.tickTrailOrbs();
    if (this.unstableTicks > 0 && --this.unstableTicks <= 0) {
      this.unstableTicks = UNSTABLE_INTERVAL;
      this.spawnUnstableOrbs();
    }
    this.moveUnstableOrbs();
    this.checkThresholds();
    this.tickImmunity();
    this.tickStyleTimeout();
    this.keepTarget();
  }

  /**
   * He's never idle: with no target he takes the player nearest his centre, as after a special.
   * Played over the MCP: his target dropped (generic NPC retreat, now off for the raid's NPCs), and
   * since only a special re-aimed him he stood still for good. No capture shows how live picks up.
   */
  keepTarget() {
    if (!this.akkha || this.standing || this.memory.length > 0) return;
    if (this.akkha.getCombat().getTarget?.()) return;
    this.aggroNearest();
  }

  /** Wiki: he changes style if he hasn't for 60 seconds, as when he can't reach anyone. */
  tickStyleTimeout() {
    if (this.standing || this.memory.length > 0) return;
    if (Shared.cycle() - this.lastStyleChange >= STYLE_TIMEOUT) this.changeStyle();
  }

  /** "Akkha is currently immune" once, as it begins, and his tint for as long as it lasts. */
  tickImmunity() {
    const akkha = this.akkha;
    if (!akkha || this.standing) return;
    const immune = this.isImmune();
    if (immune && !this.immune) this.sayImmune();
    if (immune && --this.immuneTint <= 0) {
      akkha.tint(TINT.IMMUNE);
      this.immuneTint = IMMUNE_TINT_REFRESH;
    } else if (!immune && this.immune) {
      akkha.tint(TINT.NONE);
      this.immuneTint = 0;
    }
    this.immune = immune;
  }

  sayImmune() {
    for (const player of this.challengePlayers()) {
      player.sendMessage("<col=ff289d>Akkha is currently immune to your attacks, but his shadows are still disrupted.</col>");
    }
  }

  /** At 80/60/40/20% of his health he is immune at once, and the shadows appear a tick later. */
  checkThresholds() {
    const akkha = this.akkha;
    if (!akkha || this.standing || this.lastHp === null) return;
    const now = akkha.getHitpoints();
    for (let share = 0.8; share > 0.1; share -= 0.2) {
      const threshold = Math.floor(akkha.getMaxHitpoints() * share);
      if (this.lastHp > threshold && now <= threshold && now > 0) {
        const first = !this.shadowsUp;
        this.restoring = true;
        this.later(1, () => this.spawnShadows(first));
        break;
      }
    }
    this.lastHp = now;
  }

  tickTimers() {
    if (this.detonationTicks > 0) {
      if (--this.detonationTicks === DETONATION_TICKS - 2) {
        for (const player of this.challengePlayers()) {
          player.sendMessage("<col=a53fff>You have been marked for detonation!</col>");
          player.tint(TINT.DETONATE);
        }
      } else if (this.detonationTicks <= 0) {
        this.detonate();
      }
    }
    if (this.trailTicks > 0) {
      if (--this.trailTicks === TRAIL_START) {
        for (const player of this.challengePlayers()) {
          player.sendMessage("<col=a53fff>Magical orbs begin to materialise behind you!</col>");
          player.tint(TINT.TRAIL);
        }
      } else if (this.trailTicks <= 0) {
        for (const player of this.challengePlayers()) player.sendMessage("<col=229628>The magical orbs stop materialising.</col>");
        this.trailFrom.clear();
      }
    }
  }

  trailing() {
    return this.trailTicks > 0 && this.trailTicks <= TRAIL_START;
  }

  // -------------------------------------------------------------- attacks

  /** One swing: an auto, or when they run out a special and the next style. */
  attack(target) {
    const { Animation } = Shared.core();
    const akkha = this.akkha;
    if (this.standing || this.memory.length > 0) return;
    if (this.style === "melee" && akkha.getLocation().getDistance(target.getLocation()) > 3) return;
    if (this.autosLeft <= 0) {
      this.autosLeft = this.stayVigilant ? AUTOS_VIGILANT : AUTOS;
      this.changeStyle();
      this.runSpecial();
      this.aggroNearest();
      return;
    }
    this.autosLeft--;
    if (this.style === "melee") {
      akkha.performAnimation(new Animation(ANIMATION.MELEE));
      this.cleave(target);
    } else {
      // Keep Back: the melee lands first, with no animation of its own.
      if (this.keepBack) this.cleave(null);
      this.volley(this.style === "magic");
    }
  }

  runSpecial() {
    const { Animation } = Shared.core();
    const players = this.challengePlayers().length;
    if (this.doubleTrouble) {
      this.specialIndex %= players < 2 ? 1 : 2;
      if (this.specialIndex === 0) this.memoryBlast();
      else this.startDetonation();
      this.trailTicks = TRAIL_TICKS;
    } else {
      this.specialIndex %= players < 2 ? 2 : 3;
      if (this.specialIndex === 0) this.memoryBlast();
      else if (this.specialIndex === 1) {
        this.akkha.performAnimation(new Animation(ANIMATION.TRAIL));
        this.trailTicks = TRAIL_TICKS;
      } else this.startDetonation();
    }
    this.specialIndex++;
  }

  /** Wiki: after a special he goes for the player closest to his centre tile. */
  aggroNearest() {
    const centre = this.akkha.getLocation().transform(1, 1);
    const players = this.challengePlayers();
    let nearest = null;
    for (const player of players) {
      if (!nearest || player.getLocation().getDistance(centre) < nearest.getLocation().getDistance(centre)) nearest = player;
    }
    if (nearest) this.akkha.getCombat().attack(nearest);
  }

  /** Melee hits his target and anyone beside them in reach. */
  cleave(target) {
    const akkha = this.akkha;
    for (const player of this.challengePlayers()) {
      if (target && player.getLocation().getDistance(target.getLocation()) > 1) continue;
      if (!withinReach(akkha, player)) continue;
      this.landStyled(player, "melee", 1);
    }
  }

  /** Ranged and magic hit everyone in the fight, the damage fixed as the projectile leaves. */
  volley(magic) {
    const { Animation } = Shared.core();
    const akkha = this.akkha;
    akkha.performAnimation(new Animation(magic ? ANIMATION.MAGIC : ANIMATION.RANGED));
    this.later(2, () => {
      if (!this.akkha || this.standing) return;
      const style = magic ? "magic" : "ranged";
      for (const player of this.challengePlayers()) {
        const ticks = Shared.tileProjectile(this.area, akkha, player, magic ? PROJECTILE.MAGIC : PROJECTILE.RANGED,
          { duration: 30, perTile: 0, startHeight: 101, endHeight: 34, angle: 12 });
        Shared.sound(player, magic ? SOUND.MAGIC_HIT : SOUND.RANGED_HIT);
        this.landStyled(player, style, ticks);
      }
    });
  }

  landStyled(player, style, delay) {
    if (!Shared.isProtected(player, style)) {
      this.failPerfect(`${Shared.displayName(player)} didn't pray against a ${style} attack.`);
    }
    this.strike(this.akkha, player, this.methodFor(style), style, MAX_HIT[style], delay, { prayerMultiplier: PRAYER_THROUGH[style] });
  }

  methodFor(style) {
    return Raid.styleMethod(style);
  }

  /** Wiki (14 Sep 2022): players stop attacking when he changes style. */
  changeStyle() {
    const akkha = this.akkha;
    this.lastStyleChange = Shared.cycle();
    for (const player of this.roomPlayers()) {
      Shared.sound(player, SOUND.STYLE);
      if (player.getCombat().getTarget?.() === akkha) player.getCombat().reset();
    }
    this.formIndex = (this.formIndex + 1) % this.forms.length;
    akkha.setNpcTransformationId(this.forms[this.formIndex]);
  }

  startDetonation() {
    const { Animation } = Shared.core();
    this.akkha.performAnimation(new Animation(ANIMATION.DETONATION));
    this.detonationTicks = DETONATION_TICKS;
  }

  /** Three tiles out from every player in a plus (or with Feeling Special, maybe an x). */
  detonate() {
    const cross = this.feelingSpecial && Shared.random(0, 1) === 0;
    const steps = cross ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const hit = new Set();
    const players = this.challengePlayers();
    for (const player of players) {
      const quadrant = this.quadrantOf(player.getLocation());
      for (const [dx, dy] of steps) {
        let tile = player.getLocation();
        for (let i = 0; i < 3; i++) {
          tile = tile.transform(dx, dy);
          const key = `${tile.getX()},${tile.getY()}`;
          if (hit.has(key) || !Shared.floorFree(this.area, tile)) continue;
          hit.add(key);
          this.graphic(QUADRANT_GRAPHICS[quadrant], tile, { height: quadrant === 3 ? 124 : 0 });
          for (const victim of players) {
            if (!victim.getLocation().equals(tile)) continue;
            this.elementHit(victim, quadrant, "a detonation");
          }
        }
      }
    }
  }

  /** Memory, shadow, orb and detonation damage, with the quadrant's element. */
  elementHit(player, quadrant, cause) {
    Shared.damage(player, Math.floor(Shared.random(ELEMENT_HIT.min, ELEMENT_HIT.max) * this.damageFactor()));
    this.failPerfect(`${Shared.displayName(player)} was hit by ${cause}.`);
    this.applyEffect(player, quadrant);
  }

  // -------------------------------------------------------------- memory

  /** He vanishes, lights the quadrants in an order, then blasts every quadrant but the lit one, in turn. */
  memoryBlast() {
    const { Animation } = Shared.core();
    const akkha = this.akkha;
    akkha.getCombat().reset();
    akkha.getMovementQueue().reset();
    akkha.getMovementQueue().setBlockMovement(true);
    akkha.performAnimation(new Animation(ANIMATION.MEMORY));
    const iterations = this.memoryIterations;
    // Wiki: each lit quadrant is next to the last, never across from it.
    const order = [Shared.random(0, 3)];
    for (let i = 1; i < iterations; i++) order.push((order[i - 1] + (Shared.random(0, 1) === 0 ? 3 : 1)) % 4);
    let shown = 0;
    const light = () => {
      const [id, x, y] = QUADRANT_LIGHTS[order[shown++]];
      this.setObject(id, { x, y, z: Z }, 10, 0);
      this.later(2, () => this.setObject(-1, { x, y, z: Z }, 10));
      for (const player of this.challengePlayers()) Shared.sound(player, SOUND.SYMBOL);
    };
    const steps = [];
    steps.push([1, () => {
      for (const player of this.challengePlayers()) player.sendMessage("<col=a53fff>Sections of the room start to glow...</col>");
    }]);
    steps.push([1, () => {
      akkha.setUntargetable(true);
      akkha.performAnimation(new Animation(ANIMATION.VANISH));
    }]);
    steps.push([2, () => {
      akkha.setVisible(false);
      akkha.moveTo(Shared.loc({ ...Shared.randomOf(MEMORY_TILES), z: Z }));
      light();
    }]);
    for (let i = 1; i < iterations; i++) {
      steps.push([this.feelingSpecial && i === iterations - 1 ? 0 : 2, light]);
    }
    for (let i = 0; i < iterations; i++) {
      const lit = order[i];
      steps.push([i === iterations - 1 ? 2 : this.feelingSpecial ? 2 : 4, () => {
        this.quadrantBlast(false, [0, 1, 2, 3].filter((quadrant) => quadrant !== lit));
      }]);
    }
    steps.push([0, () => {
      akkha.setVisible(true);
      akkha.performAnimation(new Animation(ANIMATION.APPEAR));
      akkha.setUntargetable(false);
      akkha.getMovementQueue().setBlockMovement(false);
      this.aggroNearest();
    }]);
    this.memory = steps;
    this.memoryDelay = 2;
  }

  tickMemory() {
    if (this.memory.length === 0) return;
    if (this.memoryDelay > 0 && --this.memoryDelay > 0) return;
    while (this.memory.length > 0 && this.memoryDelay <= 0) {
      const [delay, action] = this.memory.shift();
      action();
      this.memoryDelay = delay;
    }
  }

  /** Fire across whole quadrants, from the middle out (or, from a shadow, from the rim in). */
  quadrantBlast(fromShadow, quadrants) {
    for (const player of this.challengePlayers()) Shared.sound(player, SOUND.QUADRANT);
    const cause = fromShadow ? "a shadow's blast" : "a memory blast";
    for (const quadrant of quadrants) {
      const origin = QUADRANT_ORIGINS[quadrant];
      const tiles = quadrantTiles(quadrant);
      const stepsOut = (tile) => {
        const out = Math.abs(tile.x - origin.x) + Math.abs(tile.y - origin.y);
        return fromShadow ? BLAST_REACH - out : out;
      };
      for (const tile of tiles) {
        this.graphic(QUADRANT_GRAPHICS[quadrant], tile, { delay: BLAST_DELAY + stepsOut(tile) * BLAST_STEP, height: quadrant === 3 ? 124 : 0 });
      }
      // The near half lands a tick before the far half (Wiki: it can be outrun).
      for (const tick of [0, 1]) {
        this.later(tick, () => {
          for (const tile of tiles) {
            if ((stepsOut(tile) > BLAST_REACH / 2 ? 1 : 0) !== tick) continue;
            for (const player of this.challengePlayers()) {
              const location = player.getLocation();
              if (location.getX() !== tile.x || location.getY() !== tile.y) continue;
              this.elementHit(player, quadrant, cause);
            }
          }
        });
      }
    }
  }

  // -------------------------------------------------------------- shadows

  /**
   * Four new shadows at each threshold. Those dispelled before come back immune, so each
   * threshold needs a fresh quadrant; only the last dispelled plays its spawn.
   */
  spawnShadows(first) {
    if (this.standing) return;
    const { NpcIdentifiers, Animation } = Shared.core();
    this.shadowsUp = true;
    this.restoring = false;
    for (const player of this.challengePlayers()) {
      player.sendMessage(first ? "<col=ff289d>Shadows appear throughout the room!</col>" : "<col=ff289d>The shadows in the room are restored!</col>");
    }
    for (let i = 0; i < 4; i++) {
      if (this.shadows[i]) this.despawn(this.shadows[i]);
      const shadow = this.spawn(NpcIdentifiers.AKKHAS_SHADOW, { ...SHADOW_TILES[i], z: Z }, { points: 1 });
      this.shadows[i] = shadow;
      if (!shadow) continue;
      const immune = this.dispelled.has(i);
      shadow.__toaScripted = true;
      shadow.__toaShadow = { index: i, counter: 0, delay: 0, immune };
      shadow.getMovementQueue().setBlockMovement(true);
      if (immune) shadow.tint(TINT.IMMUNE);
      if (first || i === this.lastDispelled) shadow.performAnimation(new Animation(ANIMATION.SHADOW_SPAWN));
      this.setHourglass(i, "empty", 0);
    }
  }

  setHourglass(index, stage, fill) {
    const hourglass = HOURGLASSES[index];
    if (!this.bars[index]) {
      const bar = this.spawn(AKKHA_HEADBAR_NPC, { x: hourglass.x, y: hourglass.y, z: Z }, { scale: false, points: 0 });
      if (bar) {
        bar.__toaScripted = true;
        bar.setUntargetable(true);
        bar.getMovementQueue().setBlockMovement(true);
      }
      this.bars[index] = bar;
    }
    if (stage !== this.bars[index]?.__toaStage) {
      if (this.bars[index]) this.bars[index].__toaStage = stage;
      this.setObject(hourglass[stage], { x: hourglass.x, y: hourglass.y, z: Z }, 10, 0);
    }
    this.bars[index]?.showHeadbar?.(HOURGLASS_BAR, { fill });
  }

  /** Each shadow fills its hourglass and then blasts its own quadrant; the memory pauses them. */
  tickShadows() {
    const { Animation } = Shared.core();
    if (this.memory.length > 0) return;
    for (const shadow of this.shadows) {
      if (!this.shadowAlive(shadow)) continue;
      const state = shadow.__toaShadow;
      if (state.immune) shadow.tint(TINT.IMMUNE);
      if (state.delay <= 0) {
        state.counter++;
        const stage = state.counter >= SHADOW_TIMER ? "full" : state.counter >= SHADOW_TIMER / 2 ? "half" : "empty";
        this.setHourglass(state.index, stage, state.counter * HOURGLASS_BAR_PER_TICK);
        if (state.counter >= SHADOW_TIMER) {
          state.counter = 0;
          state.delay = 4;
        }
      } else if (--state.delay === 3) {
        shadow.performAnimation(new Animation(ANIMATION.SHADOW_BLAST));
      } else if (state.delay === 2) {
        this.quadrantBlast(true, [state.index]);
      } else if (state.delay === 0) {
        this.setHourglass(state.index, "empty", 0);
      }
    }
  }

  /** Killing a shadow shields the others until the next threshold. */
  shadowDied(index) {
    this.dispelled.add(index);
    this.lastDispelled = index;
    this.setHourglass(index, "gone", 0);
    this.bars[index]?.removeHeadbar?.(HOURGLASS_BAR);
    this.shadows.forEach((shadow, i) => {
      if (i !== index && this.shadowAlive(shadow)) {
        shadow.__toaShadow.immune = true;
        shadow.tint(TINT.IMMUNE);
      }
    });
  }

  // -------------------------------------------------------------- orbs

  /** An orb on the tile each moving player has just left, one a tick however far they ran. */
  tickPlayer(player) {
    if (!this.trailing() || !this.inChallenge(player) || player.getHitpoints() <= 0) return;
    const here = player.getLocation().clone();
    const from = this.trailFrom.get(player);
    this.trailFrom.set(player, here);
    if (!from || from.equals(here)) return;
    this.later(1, () => {
      this.spawnTrailOrb(from, player);
      if (this.feelingSpecial) {
        this.spawnTrailOrb(here.transform(Math.sign(here.getX() - from.getX()), Math.sign(here.getY() - from.getY())), player);
      }
    });
  }

  spawnTrailOrb(location, owner) {
    if (!Shared.floorFree(this.area, location)) return;
    for (const orb of this.trailOrbs.keys()) if (orb.getLocation().equals(location)) return;
    const { NpcIdentifiers } = Shared.core();
    const quadrant = this.quadrantOf(location);
    const ids = [NpcIdentifiers.COL_00FFFF_ORB_OF_DARKNESS_COL_2, NpcIdentifiers.COL_00FFFF_ORB_OF_LIGHTNING_COL,
      NpcIdentifiers.COL_00FFFF_FROZEN_ORB_COL, NpcIdentifiers.COL_00FFFF_BURNING_ORB_COL];
    const orb = this.spawn(ids[quadrant], { x: location.getX(), y: location.getY(), z: Z }, { scale: false, points: 0 });
    if (!orb) return;
    orb.__toaScripted = true;
    orb.setUntargetable(true);
    orb.getMovementQueue().setBlockMovement(true);
    this.trailOrbs.set(orb, { life: TRAIL_ORB_LIFE, quadrant, victim: null });
    Shared.sound(owner, SOUND.TRAIL);
    this.raid.failTask(TASK.ORBS, "You dropped an orb.", owner);
    this.raid.tally(owner, "orbsDropped");
  }

  /** Stepped on, an orb goes off a tick later (Wiki: "with a minor delay"). */
  tickTrailOrbs() {
    for (const [orb, state] of [...this.trailOrbs]) {
      if (state.victim) {
        const victim = state.victim;
        if (victim.getHitpoints() > 0) {
          Shared.sound(victim, QUADRANT_SOUNDS[state.quadrant]);
          victim.performGraphic(Shared.gfx(QUADRANT_GRAPHICS[state.quadrant], { height: state.quadrant === 3 ? 124 : 0 }));
          this.elementHit(victim, state.quadrant, "an orb");
        }
        this.trailOrbs.delete(orb);
        this.despawn(orb);
        continue;
      }
      state.victim = this.challengePlayers().find((player) => player.getLocation().equals(orb.getLocation())) ?? null;
      if (!state.victim && --state.life <= 0) {
        this.trailOrbs.delete(orb);
        this.despawn(orb);
      }
    }
  }

  spawnUnstableOrbs() {
    const { NpcIdentifiers } = Shared.core();
    const count = Shared.random(UNSTABLE_BATCH.min, UNSTABLE_BATCH.max);
    for (const [x, y, direction] of Shared.shuffle(UNSTABLE_ORB_PATHS).slice(0, count)) {
      const orb = this.spawn(NpcIdentifiers.COL_00FFFF_UNSTABLE_ORB_COL, { x, y, z: Z }, { scale: false, points: 0 });
      if (!orb) continue;
      orb.__toaScripted = true;
      orb.__toaDirection = direction;
      orb.setUntargetable(true);
      orb.canWalkThroughNPCs = () => true;
      this.unstableOrbs.add(orb);
    }
  }

  /** Wiki: scales with raid and path level; Protect from Magic comes off before the cap of 25; shared on a tile. */
  unstableDamage(victim, sharing) {
    let damage = this.maxHit(MAX_HIT.UNSTABLE);
    if (Shared.isProtected(victim, "magic")) damage = Math.floor(damage * UNSTABLE_PRAYER_THROUGH);
    return Math.floor(Math.min(MAX_HIT.UNSTABLE_CAP, damage) / sharing);
  }

  /** Unstable orbs roll in a straight line. */
  moveUnstableOrbs() {
    const directions = {
      NORTH: [0, 1], SOUTH: [0, -1], EAST: [1, 0], WEST: [-1, 0],
      NORTH_EAST: [1, 1], NORTH_WEST: [-1, 1], SOUTH_EAST: [1, -1], SOUTH_WEST: [-1, -1],
    };
    for (const orb of [...this.unstableOrbs]) {
      const location = orb.getLocation();
      const victims = this.challengePlayers().filter((player) => player.getLocation().equals(location));
      if (victims.length > 0) {
        for (const victim of victims) {
          Shared.damage(victim, this.unstableDamage(victim, victims.length));
          this.failPerfect(`${Shared.displayName(victim)} was hit by an unstable orb.`);
        }
        this.unstableOrbs.delete(orb);
        this.despawn(orb);
        continue;
      }
      const [dx, dy] = directions[orb.__toaDirection];
      const next = location.transform(dx, dy);
      if (!Shared.floorFree(this.area, next)) {
        orb.performGraphic(Shared.gfx(GRAPHIC.UNSTABLE_BURST, { delay: 10, height: 158 }));
        this.unstableOrbs.delete(orb);
        this.later(1, () => this.despawn(orb));
        continue;
      }
      Shared.walkStraight(orb, next);
    }
  }

  // -------------------------------------------------------------- effects

  /** Each quadrant's element: darkness, lightning, ice or fire. */
  applyEffect(player, quadrant) {
    const now = Shared.cycle();
    const last = this.effects.get(player) ?? {};
    const kind = QUADRANT_NAMES[quadrant];
    const cooldown = { shadow: 4, lightning: 6, ice: 25, fire: 30 }[kind];
    if (now <= (last[kind] ?? -Infinity) + cooldown) return;
    last[kind] = now;
    this.effects.set(player, last);
    if (kind === "shadow") this.applyDarkness(player);
    else if (kind === "lightning") {
      const { PrayerHandler } = Shared.core();
      player.sendMessage("<col=ff3045>You have been struck by lightning and can't use protection prayers!</col>");
      for (const prayer of PrayerHandler.PROTECTION_PRAYERS) PrayerHandler.deactivatePrayer(player, prayer);
      player.getCombat().getPrayerBlockTimer().start(5);
    } else if (kind === "ice") {
      player.sendMessage("<col=ff3045>Your attacks have been slowed by some ice!</col>");
      player.__toaIcedUntil = now + ICE_TICKS;
      this.later(ICE_TICKS, () => this.affected(player) && player.sendMessage("<col=229628>The ice around you melts away.</col>"));
    } else {
      player.forceChat?.("Argh! It burns!");
      player.sendMessage("<col=ff3045>You have been set alight!</col>");
      this.later(1, () => this.burn(player, 1));
    }
  }

  /** Wiki: low, rapid damage and every combat stat down by 3 (June 2025: combat stats only). */
  applyDarkness(player) {
    const { Skill } = Shared.core();
    player.sendMessage("<col=ff3045>You have been consumed by darkness!</col>");
    const skills = player.getSkillManager();
    for (const skill of [Skill.ATTACK, Skill.DEFENCE, Skill.STRENGTH, Skill.RANGED, Skill.MAGIC]) {
      skills.setCurrentLevel(skill, Math.max(0, skills.getCurrentLevel(skill) - STAT_DRAIN), true);
    }
    let ticks = 0;
    this.repeat(1, () => {
      if (!this.affected(player) || ticks++ >= DARKNESS_TICKS) return false;
      Shared.sound(player, SOUND.DARKNESS, 30);
      Shared.damage(player, this.maxHit(MAX_HIT.DARKNESS));
      return true;
    });
  }

  /** Flames, the burn a tick later and "goes out" a tick after the last (01757 30277-30292). */
  burn(player, count) {
    if (!this.affected(player)) return;
    Shared.sound(player, SOUND.FIRE, 30);
    player.performGraphic(Shared.gfx(GRAPHIC.FIRE, { height: 124 }));
    this.later(1, () => {
      if (!this.affected(player)) return;
      Shared.damage(player, MAX_HIT.BURN);
      for (const other of this.challengePlayers()) {
        if (other !== player && other.getLocation().getDistance(player.getLocation()) <= 1) this.applyEffect(other, 3);
      }
    });
    if (count < BURNS) this.later(BURN_INTERVAL, () => this.burn(player, count + 1));
    else this.later(2, () => this.affected(player) && player.sendMessage("<col=229628>The fire around you goes out.</col>"));
  }

  affected(player) {
    return this.isStarted() && player.getHitpoints() > 0 && this.inChallenge(player);
  }

  // -------------------------------------------------------------- final stand

  /** Out of health: he heals to a fifth and takes a stand on a shadow's tile, with fakes on the rest. */
  finalStand() {
    const { Animation, NpcIdentifiers } = Shared.core();
    const akkha = this.akkha;
    this.standing = true;
    this.immune = false;
    this.restoring = false;
    this.memory = [];
    akkha.setVisible(true);
    akkha.setHitpoints(1);
    akkha.setUntargetable(true);
    akkha.getCombat().reset();
    akkha.getMovementQueue().reset();
    akkha.getMovementQueue().setBlockMovement(true);
    akkha.tint(TINT.NONE);
    akkha.setNpcTransformationId(NpcIdentifiers.AKKHA_5);
    akkha.performAnimation(new Animation(ANIMATION.FINAL_STAND));
    for (const player of this.challengePlayers()) player.sendMessage("<col=ff289d>Akkha makes his final stand!</col>");
    for (const shadow of this.shadows) if (this.shadowAlive(shadow)) shadow.performAnimation(new Animation(ANIMATION.SHADOW_DEATH));
    this.trailTicks = 0;
    this.detonationTicks = 0;
    this.later(COLLAPSE_TICKS, () => {
      for (const shadow of this.shadows) if (shadow) this.despawn(shadow);
      this.shadows = [null, null, null, null];
      for (const bar of this.bars) if (bar) this.despawn(bar);
      this.bars = [null, null, null, null];
      for (let i = 0; i < HOURGLASSES.length; i++) {
        this.setObject(HOURGLASSES[i].gone, { x: HOURGLASSES[i].x, y: HOURGLASSES[i].y, z: Z }, 10, 0);
      }
      akkha.setNpcTransformationId(NpcIdentifiers.AKKHA_6);
      akkha.setHitpoints(Math.floor(akkha.getMaxHitpoints() * FINAL_SHARE));
    });
    this.later(4, () => akkha.performAnimation(new Animation(ANIMATION.VANISH)));
    this.later(5, () => {
      this.realTile = Shared.random(0, 3);
      akkha.moveTo(Shared.loc({ ...SHADOW_TILES[this.realTile], z: Z }));
      akkha.setNpcTransformationId(NpcIdentifiers.AKKHA_7);
      akkha.performAnimation(new Animation(ANIMATION.APPEAR));
      akkha.setUntargetable(false);
      this.fakes = SHADOW_TILES.map((tile, index) => {
        if (index === this.realTile) return null;
        const fake = this.spawn(NpcIdentifiers.AKKHAS_SHADOW_2, { ...tile, z: Z }, { scale: false, points: 0 });
        if (!fake) return null;
        fake.__toaScripted = true;
        fake.__toaFake = true;
        fake.getMovementQueue().setBlockMovement(true);
        fake.performAnimation(new Animation(ANIMATION.APPEAR));
        fake.tint(TINT.IMMUNE);
        return fake;
      });
      this.unstableTicks = UNSTABLE_INTERVAL - 1;
    });
  }

  /** Wiki: three successful hits from players (one more per extra player) and he moves. */
  finalHit(hits) {
    this.swapHits += hits;
    if (this.swapHits < 2 + this.teamSize) return;
    this.swapHits = 0;
    const { Animation } = Shared.core();
    const akkha = this.akkha;
    const next = Shared.randomOf(this.fakes.map((fake, index) => (fake ? index : -1)).filter((index) => index !== -1));
    if (next === undefined) return;
    akkha.performAnimation(new Animation(ANIMATION.VANISH));
    akkha.setUntargetable(true);
    this.later(1, () => {
      if (this.isCompleted()) return;
      const fake = this.fakes[next];
      fake?.moveTo(Shared.loc({ ...SHADOW_TILES[this.realTile], z: Z }));
      this.fakes[this.realTile] = fake;
      this.fakes[next] = null;
      this.realTile = next;
      akkha.moveTo(Shared.loc({ ...SHADOW_TILES[next], z: Z }));
      akkha.performAnimation(new Animation(ANIMATION.APPEAR));
      fake?.performAnimation(new Animation(ANIMATION.APPEAR));
      akkha.setUntargetable(false);
    });
  }

  /** All fall together, the orbs go a tick later, and the room is done a tick after that. */
  finalDeath() {
    if (this.dying) return;
    this.dying = true;
    const { Animation } = Shared.core();
    const akkha = this.akkha;
    this.unstableTicks = -1;
    akkha.setHitpoints(1);
    akkha.setUntargetable(true);
    akkha.performAnimation(new Animation(ANIMATION.SHADOW_DEATH));
    for (const fake of this.fakes) fake?.performAnimation(new Animation(ANIMATION.SHADOW_DEATH));
    this.later(1, () => {
      for (const orb of this.unstableOrbs) this.despawn(orb);
      this.unstableOrbs.clear();
    });
    this.later(COLLAPSE_TICKS, () => this.complete());
  }

  graphic(id, tile, options = {}) {
    const viewer = this.roomPlayers()[0];
    if (!viewer) return;
    const location = tile.getX ? tile : Shared.loc({ x: tile.x, y: tile.y, z: Z });
    Shared.graphicAt(viewer, id, location, options);
  }
}

function quadrantTiles(quadrant) {
  const tiles = [];
  for (const [x, first, last] of QUADRANT_COLUMNS[quadrant]) {
    for (let y = first; y <= last; y++) tiles.push({ x, y });
  }
  return tiles;
}

function withinReach(npc, player) {
  const size = npc.getSize?.() ?? 1;
  const location = npc.getLocation();
  const target = player.getLocation();
  const dx = target.getX() < location.getX() ? location.getX() - target.getX() : Math.max(0, target.getX() - (location.getX() + size - 1));
  const dy = target.getY() < location.getY() ? location.getY() - target.getY() : Math.max(0, target.getY() - (location.getY() + size - 1));
  return Math.max(dx, dy) <= 1 && !(dx === 1 && dy === 1);
}

function akkhaRoom(npc) {
  const room = npc?.__toaRoom;
  return room instanceof AkkhaRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ hooks

function blockHit(hit) {
  for (const part of hit.getHits()) part.setDamage(0);
  hit.updateTotalDamage();
}

/** Immunities: the style he prays against, a shaded quadrant, immune shadows, the final stand. */
function filterDamage(event) {
  const npc = event.npc;
  const room = akkhaRoom(npc);
  if (!room) return;
  const { CombatType } = Shared.core();
  const type = event.hit.getCombatType?.();
  const attacker = event.hit.getAttacker?.();
  const fromPlayer = attacker?.isPlayer?.() === true;
  if (npc.__toaAkkha) {
    if (room.standing) {
      // Wiki: Protect from Magic and Missiles at once: melee only, and thralls don't count.
      if (type !== CombatType.MELEE) blockHit(event.hit);
      else if (fromPlayer) {
        const landed = event.hit.getHits().filter((part) => part.getDamage() > 0).length;
        if (landed > 0) room.finalHit(landed);
      }
      return;
    }
    const prayed = { melee: CombatType.MELEE, ranged: CombatType.RANGED, magic: CombatType.MAGIC }[room.style];
    if (type === prayed && fromPlayer) {
      room.failPerfect(`${Shared.displayName(attacker)} hit Akkha with the wrong style.`);
      blockHit(event.hit);
    } else if (room.isImmune()) {
      blockHit(event.hit);
    }
  } else if (npc.__toaShadow) {
    if (npc.__toaShadow.immune) {
      attacker?.sendMessage?.("<col=ff289d>This shadow is currently immune to your attacks.</col>");
      blockHit(event.hit);
    }
  } else if (npc.__toaFake) {
    blockHit(event.hit);
  }
}

function akkhaDowned(event) {
  const npc = event.npc;
  const room = akkhaRoom(npc);
  if (!room) return;
  if (npc.__toaAkkha) {
    event.preventDeath = true;
    if (!room.standing) room.finalStand();
    else room.finalDeath();
  } else if (npc.__toaShadow) {
    room.shadowDied(npc.__toaShadow.index);
  }
}

/** Ice slows the frozen player's attacks by a tick. */
function iceSlows(event) {
  const player = event.player;
  if (player?.__toaIcedUntil && Shared.cycle() < player.__toaIcedUntil) {
    const combat = player.getCombat();
    combat.setAttackDelay?.((combat.getAttackDelay?.() ?? 0) + 1);
  }
}

module.exports = function registerAkkha(api) {
  Shared.bind(api);
  Raid.registerRoom("HET_BOSS", AkkhaRoom);
  api.onNpcHitModify(filterDamage);
  api.onNpcBeforeDeath(akkhaDowned);
  api.onPlayerDealtDamage(iceSlows);
  registerAkkhaCombat(api);
};

function registerAkkhaCombat(api) {
  const { CombatMethod, CombatType, NpcIdentifiers } = api.core;
  const TYPES = { melee: CombatType.MELEE, ranged: CombatType.RANGED, magic: CombatType.MAGIC };

  class AkkhaCombatMethod extends CombatMethod {
    type() {
      return TYPES.melee;
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    attackDistance(npc) {
      return akkhaRoom(npc)?.style === "melee" ? 1 : 10;
    }

    canAttack(npc) {
      const room = akkhaRoom(npc);
      return !!room && room.isStarted() && !room.standing && room.memory.length === 0;
    }

    start(npc, target) {
      akkhaRoom(npc)?.attack(target);
    }

    hits() {
      return [];
    }
  }

  api.registerNpcCombatMethodProvider([NpcIdentifiers.AKKHA, NpcIdentifiers.AKKHA_2, NpcIdentifiers.AKKHA_3, NpcIdentifiers.AKKHA_4,
    NpcIdentifiers.AKKHA_5, NpcIdentifiers.AKKHA_6, NpcIdentifiers.AKKHA_7], AkkhaCombatMethod, { singleton: false });
}
