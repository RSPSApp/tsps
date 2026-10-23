"use strict";

/**
 * Ocellus, the last room: the hooded figure behind the inner vault, in three phases and a final
 * stand. The four censers round the room help the party once each in the third phase.
 *
 * From the spectator captures of three kills (docs/fractured-archive.md), the Wiki's Ocellus and
 * strategy pages and the guides:
 * - The room (level 1) centres on 4127,5673. The figure (16671; 16672 unmet, 16673 met) stands
 *   at 4126,5669. "Now... ascension..." starts it; the entrance closes behind the party.
 * - **First phase** (16674; 2,500/3,630/4,680/5,730/6,780 hitpoints for two to six, a second bar
 *   of 96 for his charge):
 *   - He walks corner to corner the other way round the clock (SE, NE, NW, SW, from a random
 *     first one) with Protect from Melee, a ranged fireball or a magic water ball at everyone
 *     every five ticks.
 *   - At a corner, seven tendrils two ticks apart: eight tiles running in from a far tile, each
 *     sending its energy into him five ticks after it is laid (the line lights up green).
 *     Anyone standing on the crack then intercepts it and is healed of their chip damage;
 *     nobody on it, and it charges him. Three ticks after the last, "Pointless..." / "You... fail..." /
 *     "Unworthy...", and three more, his explosion two tiles round him (up to 35).
 *   - At two thirds and a quarter he teleports to the middle for four sides clockwise, two
 *     tendrils a side (the second two ticks later), each side ending in the explosion; then his
 *     charge goes: "Death... awaits..." (17-18), or "Embrace... annihilation..." (80+) when the
 *     tendrils charged him enough.
 *   - At 1: "You... will disappear...", back to the middle if he isn't there, and the second phase.
 * - **Second phase** (16675, 123 ticks whatever the damage): portals on the four arms of the
 *   cross through the middle split the room. The Blade (16676) stands with him and takes the
 *   party's attacks; part of the damage reaches his bar. On the two arms beside the party's
 *   quadrant every portal turns purple and fires across it, all but one an arm, which stays
 *   orange: the 2x2 where the two orange lines cross is safe. Six volleys five ticks apart, then
 *   purple pools burst over the floor, every portal turns purple, and an orange portal opens on
 *   the floor for seven ticks: standing on it takes a player to the next quadrant clockwise
 *   before the whole quadrant is struck. "This... is enough..." ends it.
 * - **Third phase** (16677; one bar with the second, 5,250/7,610/9,820/12,020): the cross falls
 *   away, leaving four quadrants joined by three stepping stones on each arm ("Gap": Jump). He
 *   fights in one quadrant at a time, its barriers up, from the quadrant the party ended the
 *   portals in, clockwise:
 *   - two melee and a slash at the tank, twice, then a special in turn: the cog (prayers off
 *     while the circle forms, Protect from Melee when it strikes, once more each quadrant), the
 *     void ("Await... the void...": a void shot at everyone and a Void Vine rooting a player
 *     another must break), "Untether..." (eruptions while he floats, then the square under him:
 *     inside when the ground outside erupts, out when he slams) and, from the second quadrant,
 *     "Insolence..." (three slashes leaving void);
 *   - void bombs fall in the quadrants still standing, void flares (Siphons, Augmenters, then
 *     Rifts) must be killed before their time is up;
 *   - at 75, 50 and 25% "Obliteration..." or "Run... It matters not...": the barriers drop, and
 *     eleven ticks later the quadrant is destroyed with anyone still on it.
 * - **Final stand** (one quadrant left, "End..."): a 60-tick loop. He rises with Deflect Melee
 *   and the ground round him void, takes half of everyone's health into an orb they can win back,
 *   and void bursts under each player every two ticks six times (he takes half damage meanwhile);
 *   his charged attack (cog melee, black-hole magic, arrows ranged); then on the ground with
 *   Deflect Range and the floor void but next to him, the same again.
 * - At 0: phase3_death; the Blade (16683, "Travel") appears where he fell 14 ticks later.
 * - Music: Artifacts of Old (893), then Ascension (894).
 * Estimates: the damage figures, what charges him how much, the tendril's damage and heal, the
 * floor portal's destination (the same spot in the next quadrant), the Blade's share (43%), the
 * cog's prayer checks, the vine's and flares' hitpoints and timers, what an Augmenter does, the
 * Untether square's size, and the final stand's void and orb tiles.
 */

const Shared = require("./Shared.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");

const { named, anim, spot } = Shared;

const CENTRE = { x: 4127, y: 5673, z: 1 };
/** His 3x3 tile in the middle (the cross's centre). */
const MIDDLE = { x: 4126, y: 5672 };
const LAYOUT = {
  figure: { x: 4126, y: 5669, z: 1 },
  arena: { minX: 4115, maxX: 4139, minY: 5661, maxY: 5685 },
  entrance: { x: 4127, y: 5660, z: 1 },
  censers: [
    { loc: "tfa_ocellus_artifact_heal", inactive: "tfa_ocellus_artifact_heal_inactive", x: 4138, y: 5662, effect: "heal" },
    { loc: "tfa_ocellus_artifact_damage_ranged", inactive: "tfa_ocellus_artifact_damage_ranged_inactive", x: 4116, y: 5662, effect: "ranged" },
    { loc: "tfa_ocellus_artifact_spec", inactive: "tfa_ocellus_artifact_spec_inactive", x: 4116, y: 5684, effect: "spec" },
    { loc: "tfa_ocellus_artifact_damage_melee", inactive: "tfa_ocellus_artifact_damage_melee_inactive", x: 4138, y: 5684, effect: "melee" },
  ],
};
const P1_HP = { 2: 2500, 3: 3630, 4: 4680, 5: 5730, 6: 6780 };
const P3_HP = { 2: 5250, 3: 7610, 4: 9820, 5: 12020 };
const P1_COLOURS = [132, 623, 853];
/**
 * His headbars (captured): the first phase's blue one (10) with cyan hitsplats (18 yours, 19
 * others'), from the third the plain one (19), both 100 wide; heals show as hitsplat 6.
 */
const HEADBAR = { P1: { id: 10, width: 100 }, P3: { id: 19, width: 100 } };
const SPLAT = { P1: [18, 19], HEAL: { mine: 6, others: 6 } };
const EXTRA_COLOURS = [5280, 21088, 28480];
const EXTRA_MAX = 96;

const TIME = {
  BASIC: 5,
  WALK_LIMIT: 16,
  CRACK_GAP: 2,
  CRACKS_PER_CORNER: 7,
  CRACK_FLOWS: 5,
  LINE_AFTER_LAST: 3,
  EXPLODE_AFTER_LAST: 6,
  WALK_AFTER_LAST: 9,
  TELEPORT: 4,
  MIDDLE_FIRST: 8,
  MIDDLE_SIDE: 8,
  MIDDLE_FIRST_FLOWS: 4,
  MIDDLE_SECOND_FLOWS: 6,
  EXPEND_AFTER_LINE: 2,
  WALK_AFTER_EXPEND: 7,
  TRANSFORM: 10,
  PHASE_TWO: 123,
  WALLS_AFTER_TRANSFORM: 2,
  SPEECH_AFTER_TRANSFORM: 7,
  QUADRANT: 42,
  VOLLEYS: 6,
  VOLLEY: 5,
  VOLLEY_FIRES: 4,
  POOLS: 28,
  ALL_PURPLE: 31,
  FLOOR_PORTAL: 33,
  STRIKE_ALL: 40,
  POOL_BURSTS: 4,
  ROTATION: [0, 3, 6, 10, 13, 16],
  SPECIAL_AFTER: 20,
  DEGEN: 24,
  INSOLENCE_DEGEN: 15,
  VINE: 15,
  FLARE: 28,
  FLARES_EVERY: 48,
  BARRIERS_DOWN_TO_END: 11,
  END_TO_NEXT: 6,
  FINAL_LOOP: 60,
  BLADE_AFTER_DEATH: 14,
};
const DAMAGE = {
  BASIC: 25, EXPLODE: 35, DEATH_AWAITS: [17, 18], ANNIHILATION: [80, 90],
  PORTAL: [20, 25], POOL: 25,
  MELEE: 40, SLASH: 35, VOID_SHOT: 25, DEBRIS: 30, COG: 40, VINE: 50, ERUPT: 40, SLAM: 45, DEGEN: [6, 7],
  COLLAPSE_FALL: 99, FLARE: 30, HYBRID: 45, HYBRID_PRAYED: [6, 7], BURST: [15, 16], BLADE_SHARE: 0.43,
};
const CHARGE_PER_TENDRIL = 2;
/** His charge from which "Embrace... annihilation..." comes instead of "Death... awaits..." (estimate). */
const CHARGED = 12;
const MIDDLE_AT = [2 / 3, 0.25];
const COLLAPSE_AT = [0.75, 0.5, 0.25];

/** The first phase's corners, the other way round the clock (captured: SE, NE, NW, SW). */
const CORNERS = [{ x: 4132, y: 5666 }, { x: 4132, y: 5678 }, { x: 4120, y: 5678 }, { x: 4120, y: 5666 }];
/** The middle's four sides clockwise: each side's first and second tendril (near tile, way). */
const MIDDLE_SIDES = [
  [[{ x: 4126, y: 5675 }, [-1, 1]], [{ x: 4128, y: 5675 }, [1, 1]]],
  [[{ x: 4129, y: 5674 }, [1, 1]], [{ x: 4129, y: 5672 }, [1, -1]]],
  [[{ x: 4128, y: 5671 }, [1, -1]], [{ x: 4126, y: 5671 }, [-1, -1]]],
  [[{ x: 4125, y: 5672 }, [-1, -1]], [{ x: 4125, y: 5674 }, [-1, 1]]],
];

/**
 * The portal that stays orange on each arm (the N/S arm's, then the E/W arm's, counted out from
 * the middle), volley by volley: the same in every captured kill. Their strips cross inside the
 * floor, a few tiles from the last.
 */
const ORANGE = {
  NW: [[2, 2], [2, 3], [1, 4], [2, 2], [2, 4], [3, 3]],
  NE: [[1, 0], [1, 3], [1, 5], [3, 3], [2, 2], [3, 0]],
  SE: [[1, 1], [3, 1], [1, 3], [1, 1], [2, 2], [4, 1]],
  SW: [[2, 2], [2, 3], [1, 4], [2, 2], [2, 4], [3, 3]],
};

/** Quadrants clockwise, as the portals and the third phase go round. */
const CLOCKWISE = ["NW", "NE", "SE", "SW"];
const QUADRANT = {
  SE: { sx: 1, sy: -1, corner: { x: 4132, y: 5666 }, suffix: "_270",
    barriers: [["tfa_ocellus_quadrant_barrier_01", 4128, 5665, 2], ["tfa_ocellus_quadrant_barrier_02", 4134, 5672, 3]],
    collapse: [["tfa_wallkit_archive03_slice_collapse_se_01", 4135, 5663], ["tfa_wallkit_archive03_slice_collapse_se_02", 4129, 5660], ["tfa_wallkit_archive03_slice_collapse_se_03", 4128, 5665]],
    floor: [[4129, 5663], [4129, 5660], [4136, 5664]] },
  SW: { sx: -1, sy: -1, corner: { x: 4120, y: 5666 }, suffix: "",
    barriers: [["tfa_ocellus_quadrant_barrier_02", 4126, 5666, 0], ["tfa_ocellus_quadrant_barrier_01", 4119, 5672, 3]],
    collapse: [["tfa_wallkit_archive03_slice_collapse_sw_01", 4117, 5660], ["tfa_wallkit_archive03_slice_collapse_sw_02", 4114, 5664], ["tfa_wallkit_archive03_slice_collapse_sw_03", 4119, 5665]],
    floor: [[4118, 5664], [4117, 5660], [4114, 5663]] },
  NW: { sx: -1, sy: 1, corner: { x: 4120, y: 5678 }, suffix: "_90",
    barriers: [["tfa_ocellus_quadrant_barrier_02", 4120, 5674, 1], ["tfa_ocellus_quadrant_barrier_01", 4126, 5681, 0]],
    collapse: [["tfa_wallkit_archive03_slice_collapse_nw_01", 4114, 5675], ["tfa_wallkit_archive03_slice_collapse_nw_02", 4118, 5681], ["tfa_wallkit_archive03_slice_collapse_nw_03", 4119, 5674]],
    floor: [[4114, 5675], [4117, 5675], [4118, 5682]] },
  // The last quadrant never fell in the captures: its slices' places are unknown.
  NE: { sx: 1, sy: 1, corner: { x: 4132, y: 5678 }, suffix: "_180",
    barriers: [["tfa_ocellus_quadrant_barrier_01", 4135, 5674, 1], ["tfa_ocellus_quadrant_barrier_02", 4128, 5680, 2]],
    collapse: [], floor: [] },
};

/**
 * The third phase's stepping stones: each arm's path from one quadrant's edge over its three
 * stones to the next's (captured: the stones, and the gaps in the invisible walls beside them).
 */
const CROSSINGS = [
  { from: "SE", to: "SW", crumble: [3, 1, 2], path: [{ x: 4129, y: 5663 }, { x: 4127, y: 5663 }, { x: 4127, y: 5666 }, { x: 4127, y: 5669 }, { x: 4125, y: 5669 }],
    stones: ["tfa_ocellus_platform_jump_outer_east", "tfa_ocellus_platform_jump_middle", "tfa_ocellus_platform_jump_outer_west"] },
  { from: "SW", to: "NW", crumble: [3, 1, 2], path: [{ x: 4117, y: 5671 }, { x: 4117, y: 5673 }, { x: 4120, y: 5673 }, { x: 4123, y: 5673 }, { x: 4123, y: 5675 }],
    stones: ["tfa_ocellus_platform_jump_outer_south", "tfa_ocellus_platform_jump_middle", "tfa_ocellus_platform_jump_outer_north"] },
  { from: "NW", to: "NE", crumble: [1, 2, 3], path: [{ x: 4125, y: 5683 }, { x: 4127, y: 5683 }, { x: 4127, y: 5680 }, { x: 4127, y: 5677 }, { x: 4129, y: 5677 }],
    stones: ["tfa_ocellus_platform_jump_outer_west", "tfa_ocellus_platform_jump_middle", "tfa_ocellus_platform_jump_outer_east"] },
  { from: "NE", to: "SE", crumble: [1, 2, 3], path: [{ x: 4137, y: 5675 }, { x: 4137, y: 5673 }, { x: 4134, y: 5673 }, { x: 4131, y: 5673 }, { x: 4131, y: 5671 }],
    stones: ["tfa_ocellus_platform_jump_outer_north", "tfa_ocellus_platform_jump_middle", "tfa_ocellus_platform_jump_outer_south"] },
];
/** The cross's collapsed arms (solid) and the gaps beside its stones, as captured. */
const ARMS = [
  ["tfa_wallkit_archive03_straight_collapse_01", 4126, 5660], ["tfa_wallkit_archive03_straight_collapse_02", 4114, 5672],
  ["tfa_wallkit_archive03_straight_collapse_03", 4126, 5676], ["tfa_wallkit_archive03_straight_collapse_04", 4130, 5672],
];
const STONE_GAPS = [[4117, 5672], [4123, 5674], [4126, 5669], [4126, 5683], [4128, 5663], [4128, 5677], [4131, 5672], [4137, 5674]];
const STONE_JUMP = 30;
/** The void flares of each quadrant (captured: Siphons, then Augmenters, then Rifts). */
const FLARES = ["tfa_ocellus_p3_bombportal_heal", "tfa_ocellus_p3_bombportal_buff", "tfa_ocellus_p3_bombportal_basic"];
const FLARE_KIND = { tfa_ocellus_p3_bombportal_heal: "heal", tfa_ocellus_p3_bombportal_buff: "buff", tfa_ocellus_p3_bombportal_basic: "default" };
const STONES = new Set();

class OcellusRoom extends Raid.Room {
  onBuild() {
    /** Censer charges waiting for their hit, by player: the room's, so they end with it. */
    this.censerCharges = new Map();
    this.figure = this.spawn(named("npc", "tfa_ocellus_intro"), LAYOUT.figure, { scripted: true, face: Shared.core().Direction.NORTH.getId() });
    this.censers = LAYOUT.censers.map((censer) => ({ ...censer, object: this.placeObject(named("loc", censer.loc), { x: censer.x, y: censer.y, z: 1 }), used: false }));
    this.phase = 0;
    this.gen = 0;
    this.degen = new Map();
    this.adds = new Set();
    this.vines = new Map();
    this.repeat(3, () => {
      if (this.phase >= 3) return false;
      Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_sword_repair_particles_01"), CENTRE);
      return true;
    });
  }

  /** "Proceed" (or Talk-to) on the figure starts it (estimate: the spectator saw no dialogue). */
  proceed(player) {
    if (this.stage !== Raid.STAGE.IDLE) return;
    Shared.options(player, "Begin the challenge?", "Yes.", () => this.start(), "No.", () => {});
  }

  /** Runs `action` in `ticks` unless the phase moved on (or he fell) meanwhile. */
  at(ticks, action) {
    const gen = this.gen;
    this.later(ticks, () => {
      if (this.gen === gen && !this.dead) action();
    });
  }

  onStart() {
    for (const player of this.roomPlayers()) meet(player);
    this.figure.forceChat("Now... ascension...");
    this.placeObject(named("loc", "tfa_wallkit_archive03_entrance02_closing"), LAYOUT.entrance, 22, 0);
    this.later(3, () => this.placeObject(named("loc", "tfa_wallkit_archive03_entrance02_closed"), LAYOUT.entrance, 22, 0));
    this.boss = this.figure;
    this.boss.setNpcTransformationId(named("npc", "tfa_ocellus_p1"));
    this.boss.setHealthBar(HEADBAR.P1);
    this.setHitpoints(this.boss, this.scaled(P1_HP));
    this.phase = 1;
    this.charge = 0;
    this.corner = Shared.random(0, CORNERS.length - 1);
    this.middles = [];
    this.showBar(named("npc", "tfa_ocellus_p1"), this.boss.getMaxHitpoints(), P1_COLOURS);
    this.extraBar(0, EXTRA_MAX, EXTRA_COLOURS);
    this.walkToCorner();
  }

  tick() {
    if (!this.isStarted() || !this.boss) return;
    this.burnDegen();
    if (this.phase === 1) {
      this.barTo(this.boss.getHitpoints());
      this.trackChip();
    }
    if (this.phase >= 2) this.barTo(this.pool);
    if (this.phase >= 3) this.showPool();
    if (this.phase === 2) this.checkFloorPortal();
    if (this.phase === 3) this.checkCollapse();
    if (this.phase === 4) this.checkOrbs();
  }

  /** From the third phase his headbar shows the shared pool, not his own hitpoints (kept full). */
  showPool() {
    this.boss.setDisplayedHealth({ current: this.pool, max: this.poolMax, bar: HEADBAR.P3 });
  }

  // ---------------------------------------------------------------- phase one

  share() {
    return this.boss.getHitpoints() / Math.max(1, this.boss.getMaxHitpoints());
  }

  /** The next threshold for the middle, if his health has passed one not yet done. */
  middleDue() {
    return MIDDLE_AT.find((at) => this.share() <= at && !this.middles.includes(at));
  }

  /** He walks to the next corner with Protect from Melee, attacking every five ticks. */
  walkToCorner() {
    if (this.phase !== 1) return;
    const due = this.middleDue();
    if (due !== undefined) {
      this.middles.push(due);
      this.middlePhase();
      return;
    }
    const corner = CORNERS[this.corner++ % CORNERS.length];
    this.protectMelee(true);
    this.boss.getMovementQueue().reset().addSteps(Shared.loc({ ...corner, z: 1 }));
    const gen = this.gen;
    let walked = 0;
    this.repeat(1, () => {
      if (this.gen !== gen || this.dead) return false;
      if (walked++ % TIME.BASIC === 0) this.basic();
      // His health passing two thirds or a quarter on the way takes him to the middle (captured).
      const due = this.middleDue();
      if (due !== undefined) {
        this.middles.push(due);
        this.protectMelee(false);
        this.middlePhase();
        return false;
      }
      const at = this.boss.getLocation();
      const arrived = at.getX() === corner.x && at.getY() === corner.y;
      if (!arrived && walked < TIME.WALK_LIMIT) return true;
      if (!arrived) this.boss.moveTo(Shared.loc({ ...corner, z: 1 }));
      this.protectMelee(false);
      this.boss.getMovementQueue().reset();
      this.boss.setPositionToFace(Shared.loc(CENTRE));
      this.at(1, () => this.cornerSet(corner));
      return false;
    });
  }

  /** Seven tendrils two ticks apart, the line, the explosion, and on to the next corner. */
  cornerSet(corner) {
    const ways = inward(corner);
    for (let i = 0; i < TIME.CRACKS_PER_CORNER; i++) {
      this.at(i * TIME.CRACK_GAP, () => {
        this.boss.performAnimation(anim("npc_ocellus_phase1_charge"));
        Shared.areaSound(this.area, this.boss, 12512);
        this.tendril(this.cornerTendril(corner, ways), 60, TIME.CRACK_FLOWS);
      });
    }
    const last = (TIME.CRACKS_PER_CORNER - 1) * TIME.CRACK_GAP;
    this.at(last + TIME.LINE_AFTER_LAST, () => this.boss.forceChat(Shared.randomOf(["Pointless...", "You... fail...", "Unworthy..."])));
    this.at(last + TIME.EXPLODE_AFTER_LAST, () => this.explode());
    this.at(last + TIME.WALK_AFTER_LAST, () => this.walkToCorner());
  }

  /**
   * One corner tendril: eight tiles from a far tile in to his footprint, at random from seven
   * spots (captured, not aimed at anyone): straight along either of the two rows (or columns)
   * of his side nearer the middle, or diagonal from his inner corner, its tile or either beside it.
   */
  cornerTendril(corner, [[sx], [, sy]]) {
    const inner = { x: sx < 0 ? corner.x : corner.x + 2, y: sy < 0 ? corner.y : corner.y + 2 };
    const across = sx < 0 ? corner.x - 1 : corner.x + 3;
    const along = sy < 0 ? corner.y - 1 : corner.y + 3;
    const rows = sy > 0 ? [corner.y + 1, corner.y + 2] : [corner.y, corner.y + 1];
    const cols = sx > 0 ? [corner.x + 1, corner.x + 2] : [corner.x, corner.x + 1];
    const spots = [
      ...rows.map((y) => ({ near: { x: across, y }, way: [sx, 0] })),
      ...cols.map((x) => ({ near: { x, y: along }, way: [0, sy] })),
      ...[[sx, 0], [sx, sy], [0, sy]].map(([ox, oy]) => ({ near: { x: inner.x + ox, y: inner.y + oy }, way: [sx, sy] })),
    ];
    return { ...Shared.randomOf(spots), length: 8 };
  }

  /**
   * A tendril's crack, drawn from its far end in (captured: a cycle a tile from `delay`), its
   * energy flowing back `flows` ticks after it is laid: the line lights up green (the "_end"
   * graphics, on every line in the captures). Anyone standing on the crack as the green passes
   * intercepts it (no timing needed: they can wait on it) and is healed of their chip damage;
   * nobody on it, and it charges him.
   */
  tendril({ near, way, length }, delay, flows) {
    const [dx, dy] = way;
    const diagonal = dx !== 0 && dy !== 0;
    const tiles = [];
    for (let i = length - 1; i >= 0; i--) tiles.push({ x: near.x + dx * i, y: near.y + dy * i, z: 1 });
    const kind = diagonal ? "02" : "01";
    const turn = crackTurn(dx, dy);
    tiles.forEach((tile, i) => Shared.graphicAt(this.area, named("spotanim", `vfx_ocellus_p1_floor_crack_${kind}${i === 0 ? "_start" : ""}${turn}`), tile, { delay: delay + i }));
    this.at(flows, () => {
      this.boss.performGraphic(spot("vfx_ocellus_p1_charge"));
      tiles.forEach((tile, i) => Shared.graphicAt(this.area, named("spotanim", `vfx_ocellus_p1_floor_crack_${kind}_end${turn}`), tile, { delay: i }));
      Shared.areaSound(this.area, this.boss, 12513);
      const standers = this.fighters().filter((player) => {
        const p = Shared.standingOn(player);
        return tiles.some((tile) => tile.x === p.x && tile.y === p.y);
      });
      if (standers.length === 0) {
        this.charge = Math.min(EXTRA_MAX, this.charge + CHARGE_PER_TENDRIL);
        this.extraBar(this.charge, EXTRA_MAX, EXTRA_COLOURS);
        return;
      }
      for (const player of standers) this.healChip(player);
    });
  }

  /**
   * Chip damage: what a player lost since they last intercepted (from the most health they had
   * since), given back when they intercept a tendril (guides).
   */
  trackChip() {
    this.chip = this.chip ?? new Map();
    for (const player of this.fighters()) this.chip.set(player, Math.max(this.chip.get(player) ?? 0, player.getHitpoints()));
  }

  healChip(player) {
    const top = this.chip?.get(player) ?? player.getHitpoints();
    const healed = heal(player, top - player.getHitpoints());
    if (healed > 0) player.showHitsplat(healed, SPLAT.HEAL);
    this.chip?.set(player, player.getHitpoints());
  }

  /** His fireball (ranged) or water ball (magic) at everyone (captured: 50/50 per volley). */
  basic() {
    const fire = Math.random() < 0.5;
    this.boss.performAnimation(anim(fire ? "npc_ocellus_phase1_basic_projectile_start" : "npc_ocellus_phase1_basic_projectile_end"));
    this.boss.performGraphic(spot(fire ? "vfx_ocellus_fire_attack01_spotanim" : "vfx_ocellus_water_attack01_spotanim"));
    const projectile = named("spotanim", fire ? "vfx_ocellus_fire_attack01_projanim" : "vfx_ocellus_water_attack01_projanim");
    for (const player of this.fighters()) {
      const end = Shared.distanceTo(this.boss, player.getLocation()) <= 5 ? 95 : 125;
      const ticks = Shared.projectile(this.area, this.boss, player, projectile, { delay: 30, end, angle: 40, startHeight: 578, endHeight: 124 });
      this.strike(this.boss, player, fire ? "ranged" : "magic", DAMAGE.BASIC, ticks, { prayerMultiplier: 0 });
    }
  }

  /**
   * His explosion: the two rings round his footprint (captured: the inner one at once, the outer
   * a moment later), up to 35 on them.
   */
  explode() {
    this.boss.performAnimation(anim("npc_ocellus_phase1_explode"));
    this.boss.performGraphic(spot("vfx_ocellus_p1_explode_npc"));
    const at = Shared.tileOf(this.boss);
    const tiles = [];
    for (let x = at.x - 2; x <= at.x + 4; x++) {
      for (let y = at.y - 2; y <= at.y + 4; y++) {
        const ring = Math.max(Math.max(at.x - x, x - at.x - 2, 0), Math.max(at.y - y, y - at.y - 2, 0));
        if (ring === 0 || !inArena({ x, y })) continue;
        tiles.push({ x, y, z: 1, ring });
      }
    }
    this.at(1, () => {
      const floor = ["vfx_ocellus_p1_explode_floor", "vfx_ocellus_p1_explode_floor_90", "vfx_ocellus_p1_explode_floor_180", "vfx_ocellus_p1_explode_floor_270"];
      for (const tile of tiles) Shared.graphicAt(this.area, named("spotanim", Shared.randomOf(floor)), tile, { delay: tile.ring === 2 ? 2 : 0 });
      this.hitOn(tiles, DAMAGE.EXPLODE);
    });
  }

  /** To the middle: four sides clockwise from a random one, then his charge goes. */
  middlePhase() {
    this.boss.getMovementQueue().reset();
    this.teleportToMiddle(() => {
      this.placeObject(named("loc", "tfa_wallkit_archive03_center01_blockwalk"), MIDDLE_TILE());
      const first = Shared.random(0, MIDDLE_SIDES.length - 1);
      for (let i = 0; i < MIDDLE_SIDES.length; i++) {
        const [one, two] = MIDDLE_SIDES[(first + i) % MIDDLE_SIDES.length];
        this.at(TIME.MIDDLE_FIRST - TIME.TELEPORT + i * TIME.MIDDLE_SIDE, () => {
          this.boss.performAnimation(anim("npc_ocellus_phase1_charge"));
          Shared.areaSound(this.area, this.boss, 12512);
          this.tendril({ near: one[0], way: one[1], length: 6 }, 0, TIME.MIDDLE_FIRST_FLOWS);
          this.tendril({ near: two[0], way: two[1], length: 6 }, 60, TIME.MIDDLE_SECOND_FLOWS);
          this.at(TIME.MIDDLE_SECOND_FLOWS, () => this.explode());
        });
      }
      const line = TIME.MIDDLE_FIRST - TIME.TELEPORT + MIDDLE_SIDES.length * TIME.MIDDLE_SIDE;
      this.at(line, () => this.expendLine());
      this.at(line + TIME.EXPEND_AFTER_LINE, () => this.expend());
      this.at(line + TIME.EXPEND_AFTER_LINE + TIME.WALK_AFTER_EXPEND, () => this.walkToCorner());
    });
  }

  /** Out where he stands, in on the middle four ticks later (captured), then `next`. */
  teleportToMiddle(next) {
    const at = this.boss.getLocation();
    if (at.getX() === MIDDLE.x && at.getY() === MIDDLE.y) {
      next();
      return;
    }
    this.boss.performAnimation(anim("npc_ocellus_phase1_teleport_out"));
    this.boss.performGraphicInSlot(2, spot("vfx_ocellus_p1_teleport_out"));
    // He fades out with it, and back in at the middle (captured: cycles 30-45, then 0-20).
    this.boss.fade(255, { from: 0, startCycles: 30, endCycles: 45 });
    this.at(TIME.TELEPORT, () => {
      this.boss.moveTo(Shared.loc(MIDDLE_TILE()));
      this.boss.fade(0, { from: 255, endCycles: 20 });
      this.boss.performAnimation(anim("npc_ocellus_phase1_teleport_in"));
      this.boss.performGraphicInSlot(2, spot("vfx_ocellus_p1_teleport_in"));
      next();
    });
  }

  /** "Embrace... annihilation..." when the tendrils charged him enough, "Death... awaits..." otherwise. */
  expendLine() {
    this.charged = this.charge >= CHARGED;
    this.boss.forceChat(this.charged ? "Embrace... annihilation..." : "Death... awaits...");
    this.placeObject(named("loc", "tfa_wallkit_archive03_center01"), MIDDLE_TILE());
  }

  /** His charge goes into everyone (Wiki: 80+ charged, 17-18 not), and empties. */
  expend() {
    this.boss.performAnimation(anim("npc_ocellus_phase1_expend"));
    const [min, max] = this.charged ? DAMAGE.ANNIHILATION : DAMAGE.DEATH_AWAITS;
    this.at(1, () => {
      for (const player of this.fighters()) Shared.damageNow(player, Shared.random(min, max));
    });
    this.charge = 0;
    this.extraBar(0, EXTRA_MAX, EXTRA_COLOURS);
  }

  /** His Protect from Melee while he walks (captured head icon 440:0; Wiki). */
  protectMelee(on) {
    this.protectingMelee = on;
    this.boss.setHeadIcon(on ? 0 : -1);
  }

  // ---------------------------------------------------------------- phase two

  /** At 1 health: "You... will disappear...", to the middle, and he becomes the second phase. */
  phaseTwo() {
    this.phase = 1.5;
    this.gen++;
    this.boss.setHitpoints(1);
    this.protectMelee(false);
    this.boss.getMovementQueue().reset();
    this.boss.forceChat("You... will disappear...");
    // A tick on, so the hit that brought him to 1 doesn't take the teleport's animation.
    this.at(1, () => this.teleportToMiddle(() => {
      this.at(3, () => this.boss.performAnimation(anim("npc_ocellus_phase1_transformation")));
      this.at(TIME.TRANSFORM, () => this.transform());
    }));
  }

  transform() {
    this.boss.performAnimation(anim("npc_ocellus_phase2_transformation"));
    this.boss.performGraphicInSlot(2, spot("vfx_ocellus_p1_to_p2_transformation"));
    this.boss.setNpcTransformationId(named("npc", "tfa_ocellus_p2"));
    this.phase = 2;
    this.gen++;
    this.pool = this.scaled(P3_HP);
    this.poolMax = this.pool;
    for (const player of this.fighters()) Shared.api().emitCustomEvent("boss-hud:extra", { player, hidden: true });
    this.showBar(named("npc", "tfa_ocellus_p2"), this.pool);
    for (const player of this.roomPlayers()) {
      Shared.api().emitCustomEvent("music:unlock-track", { player, trackId: 894 });
      player.getPacketSender().sendSong(894);
    }
    this.at(TIME.WALLS_AFTER_TRANSFORM, () => {
      this.walls = this.placeWalls();
      this.placeObject(named("loc", "tfa_wallkit_archive03_center01_blockwalk"), MIDDLE_TILE());
    });
    this.at(TIME.SPEECH_AFTER_TRANSFORM, () => {
      this.boss.forceChat("Your time... comes...");
      this.sword = this.spawn(named("npc", "tfa_ocellus_p2_sword_hitbox"), MIDDLE_TILE(), { scripted: true });
      if (this.sword) this.setHitpoints(this.sword, 100000);
      this.blade = this.placeObject(named("loc", "tfa_the_blade1_idle0"), CENTRE);
      for (const wall of this.allWalls()) this.wallAnim(wall, "vfx_ocellus_p2_portal_idle");
      const counts = new Map();
      for (const player of this.fighters()) {
        const q = portalQuadrant(Shared.tileOf(player));
        if (q) counts.set(q, (counts.get(q) ?? 0) + 1);
      }
      const first = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "SW";
      this.portalQuadrant(CLOCKWISE.indexOf(first), 4);
    });
    this.at(TIME.PHASE_TWO, () => this.phaseThree());
  }

  /** Six portals on each arm of the cross, every two tiles (captured: 2x1, facing out). */
  placeWalls() {
    const walls = { E: [], S: [], W: [], N: [] };
    const id = named("loc", "tfa_ocellus_quadrant_wall_inactive");
    for (let i = 0; i < 6; i++) {
      walls.E.push({ x: 4128 + 2 * i, y: CENTRE.y, face: 0 });
      walls.S.push({ x: CENTRE.x, y: 5671 - 2 * i, face: 1 });
      walls.W.push({ x: 4125 - 2 * i, y: CENTRE.y, face: 2 });
      walls.N.push({ x: CENTRE.x, y: 5674 + 2 * i, face: 3 });
    }
    for (const wall of Object.values(walls).flat()) {
      wall.object = this.placeObject(id, { x: wall.x, y: wall.y, z: 1 }, 10, wall.face);
      this.wallAnim(wall, "vfx_ocellus_p2_portal_spawn");
    }
    return walls;
  }

  allWalls() {
    return this.walls ? Object.values(this.walls).flat() : [];
  }

  wallAnim(wall, name) {
    for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendObjectAnimation(wall.object, anim(name));
  }

  /** A portal purple (firing) or orange. */
  setWall(wall, purple) {
    if (wall.purple === purple) return;
    wall.purple = purple;
    wall.object = this.replaceObject(wall.object, named("loc", purple ? "tfa_ocellus_quadrant_wall_active" : "tfa_ocellus_quadrant_wall_inactive"));
    this.wallAnim(wall, "vfx_ocellus_p2_portal_idle");
  }

  /**
   * One quadrant's 42 ticks (captured): six volleys five ticks apart, the purple pools at 28,
   * every portal purple at 31, the floor portal at 33, and the whole quadrant struck at 40.
   */
  portalQuadrant(index, delay) {
    const key = CLOCKWISE[index % CLOCKWISE.length];
    const q = QUADRANT[key];
    const arms = [q.sy > 0 ? "N" : "S", q.sx > 0 ? "E" : "W"];
    this.at(delay, () => {
      this.quadrant = key;
      for (let v = 0; v < TIME.VOLLEYS; v++) this.at(v * TIME.VOLLEY, () => this.volley(q, arms, ORANGE[key][v]));
      this.at(TIME.POOLS, () => this.pools(key));
      this.at(TIME.ALL_PURPLE, () => this.volley(q, arms, true));
      this.at(TIME.FLOOR_PORTAL, () => this.openFloorPortal(key, index));
      this.portalQuadrant(index + 1, TIME.QUADRANT);
    });
  }

  /**
   * The two arms beside the quadrant turn purple, but one portal an arm (none with `all`), and
   * fire across it four ticks later (captured: from a 2x2 at each portal, every 2-tile strip).
   */
  volley(q, arms, orange) {
    const all = orange === true;
    const firing = [];
    for (const [a, arm] of arms.entries()) {
      const silent = all ? -1 : orange[a];
      this.walls[arm].forEach((wall, i) => {
        this.setWall(wall, i !== silent);
        if (i !== silent) firing.push({ wall, arm, i });
      });
    }
    // Every portal purple fires with the whole quadrant's strike (captured: nine ticks later).
    this.at(all ? TIME.STRIKE_ALL - TIME.ALL_PURPLE : TIME.VOLLEY_FIRES, () => {
      for (const { wall } of firing) this.setWall(wall, false);
      const strike = all ? null : [];
      for (const shot of firing) this.fire(q, shot, strike);
      if (!all) this.strikeStrips(q, strike);
    });
  }

  /** One portal's shot across the quadrant (captured: 6 cycles a tile, shorter at the corners). */
  fire(q, { wall, arm, i }, strips) {
    const length = [14, 14, 14, 14, 12, 10][i];
    const along = arm === "N" || arm === "S";
    const source = this.spawn(named("npc", "tfa_invisible_npc_2x2"), { x: wall.x, y: wall.y, z: 1 }, { scripted: true });
    const to = along ? { x: CENTRE.x + q.sx * length, y: wall.y, z: 1 } : { x: wall.x, y: CENTRE.y + q.sy * length, z: 1 };
    if (source) {
      Shared.projectile(this.area, source, to, named("spotanim", "vfx_ocellus_portal_projectile"), { end: 6 * length, angle: 127, progress: along ? 250 : 100, startHeight: 400, endHeight: 400 });
      this.later(3, () => this.despawn(source));
    }
    strips?.push(along ? { rows: [wall.y, wall.y + 1] } : { cols: [wall.x, wall.x + 1] });
  }

  /** Players in a firing strip of the quadrant are hit as the shot reaches them. */
  strikeStrips(q, strips) {
    for (const player of this.fighters()) {
      const p = Shared.standingOn(player);
      if (portalQuadrant(p) !== quadrantKey(q)) continue;
      const strip = strips.find((s) => (s.rows ? s.rows.includes(p.y) : s.cols.includes(p.x)));
      if (!strip) continue;
      const distance = strip.rows ? Math.abs(p.x - CENTRE.x) : Math.abs(p.y - CENTRE.y);
      this.at(Math.max(0, Math.ceil((6 * distance) / 30) - 1), () => {
        const now = Shared.standingOn(player);
        if (strip.rows ? strip.rows.includes(now.y) : strip.cols.includes(now.x)) Shared.damageNow(player, Shared.random(...DAMAGE.PORTAL));
      });
    }
  }

  /** Purple pools burst over the quadrant (captured: 12-14 tiles), each player's tile among them. */
  pools(key) {
    if (this.blade) this.blade = this.replaceObject(this.blade, named("loc", "tfa_the_blade1_idle2"));
    const tiles = this.randomTiles((tile) => portalQuadrant(tile) === key, Shared.random(10, 12));
    for (const player of this.fighters()) if (portalQuadrant(Shared.tileOf(player)) === key) tiles.push(Shared.tileOf(player));
    this.erupt(tiles, DAMAGE.POOL);
    this.poolTiles = tiles;
  }

  /** The orange portal on the floor for seven ticks; then the quadrant is struck (captured). */
  openFloorPortal(key, index) {
    const taken = new Set((this.poolTiles ?? []).map((tile) => `${tile.x},${tile.y}`));
    const [tile] = this.randomTiles((t) => portalQuadrant(t) === key && !taken.has(`${t.x},${t.y}`) && Math.abs(t.x - CENTRE.x) >= 2 && Math.abs(t.y - CENTRE.y) >= 2, 1);
    if (!tile) return;
    this.floorPortal = { tile, to: CLOCKWISE[(index + 1) % CLOCKWISE.length], from: key };
    Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_p2_safe_portal_spawn"), tile);
    this.at(1, () => {
      this.sword?.performGraphic(spot("vfx_ocellus_p2_sword_discharge"));
      Shared.areaSound(this.area, CENTRE, 4428);
      Shared.areaSound(this.area, CENTRE, 444, 30);
    });
    for (let t = 1; t < TIME.STRIKE_ALL - TIME.FLOOR_PORTAL; t++) this.at(t, () => this.floorPortal && Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_p2_safe_portal_idle"), tile));
    this.at(TIME.STRIKE_ALL - TIME.FLOOR_PORTAL, () => {
      Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_p2_safe_portal_despawn"), tile);
      this.floorPortal = null;
      // The whole quadrant is struck: nobody left in it lives (Wiki: the portal avoids it).
      for (const player of this.fighters()) if (portalQuadrant(Shared.standingOn(player)) === key) Shared.damageNow(player, player.getHitpoints());
    });
  }

  /** Stepping on the floor portal: to the same spot in the next quadrant (estimate). */
  checkFloorPortal() {
    const portal = this.floorPortal;
    if (!portal) return;
    for (const player of this.fighters()) {
      const p = Shared.tileOf(player);
      if (p.x !== portal.tile.x || p.y !== portal.tile.y) continue;
      const to = mirrorInto(p, portal.from, portal.to);
      player.getMovementQueue().reset();
      player.moveTo(Shared.loc({ ...to, z: 1 }));
      player.performGraphic(spot("vfx_ocellus_p2_safe_portal_despawn"));
    }
  }

  // ---------------------------------------------------------------- phase three

  /**
   * "This... is enough...": the Blade goes, the cross collapses into four arms of stepping stones
   * (captured: the arms solid, invisible walls beside them but at the stones), and he takes the
   * quadrant the party ended the portals in.
   */
  phaseThree() {
    if (this.phase !== 2) return;
    this.phase = 2.5;
    this.gen++;
    this.floorPortal = null;
    this.boss.forceChat("This... is enough...");
    this.boss.performAnimation(anim("npc_ocellus_p2_to_p3_part1"));
    this.boss.performGraphic(spot("vfx_ocellus_p2_to_p3_arm_glow01"));
    this.boss.performGraphicInSlot(5, spot("vfx_ocellus_sword_root_fire"));
    this.boss.performGraphicInSlot(2, spot("vfx_ocellus_p2_to_p3_arm01"));
    Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_sword_drop"), CENTRE);
    Shared.areaSound(this.area, CENTRE, 4428);
    this.later(1, () => Shared.graphicAt(this.area, named("spotanim", "tfa_arena_sword_drop_explosion"), CENTRE));
    this.later(2, () => {
      for (const wall of this.allWalls()) this.wallAnim(wall, "vfx_ocellus_p2_portal_despawn");
    });
    if (this.sword) this.despawn(this.sword);
    this.sword = null;
    if (this.blade) this.removeObject(this.blade);
    const first = this.quadrant ?? "SE";
    // The arms crack (4), fall in with explosions running out from the middle (9), and leave
    // the hole (12) (captured).
    let arms = [];
    this.later(4, () => {
      arms = ARMS.map(([name, x, y]) => ({ name, object: this.placeObject(named("loc", name), { x, y, z: 1 }) }));
      // The stairs up to the room go with the floor (captured: invisible locs in their places).
      this.placeObject(named("loc", "invisible_type8_blocking"), { x: 4126, y: 5658, z: 1 });
      this.placeObject(named("loc", "invisible_type0_nonblocking"), LAYOUT.entrance, 22, 0);
    });
    this.later(9, () => {
      arms.forEach(({ object }, i) => {
        for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendObjectAnimation(object, anim(`dungeonkit_guthixian03_cracking_collapsing_0${i + 1}`));
      });
      Shared.graphicAt(this.area, named("spotanim", "tfa_arena_collapsing_explosion01"), CENTRE);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        for (let k = 1; k <= 4; k++) {
          const tile = { x: CENTRE.x + dx * 3 * k, y: CENTRE.y + dy * 3 * k, z: 1 };
          Shared.graphicAt(this.area, named("spotanim", `tfa_arena_collapsing_explosion0${k === 4 ? 1 : k + 1}`), tile, { delay: 15 * (k - 1) });
        }
      }
    });
    this.later(12, () => {
      for (const { name, object } of arms) this.replaceObject(object, named("loc", `${name}_empty`));
    });
    this.later(8, () => {
      this.boss.performAnimation(anim("npc_ocellus_p2_to_p3_part2"));
      this.boss.setNpcTransformationId(named("npc", "tfa_ocellus_p3"));
      this.boss.setHealthBar(HEADBAR.P3);
      this.showBar(named("npc", "tfa_ocellus_p3"), this.poolMax);
      this.barTo(this.pool, { force: true });
    });
    this.later(9, () => {
      for (const wall of this.allWalls()) this.removeObject(wall.object);
      this.walls = null;
      this.placeObject(named("loc", "invisible_type8_blocking_size5"), { x: 4125, y: 5671, z: 1 });
      // In the middle platform's place: the hole shows (captured).
      this.placeObject(named("loc", "invisible_type8_blocking_size3"), MIDDLE_TILE());
      this.stones = new Map();
      for (const crossing of CROSSINGS) {
        this.stones.set(crossing, crossing.stones.map((name, i) => this.placeObject(named("loc", name), { ...crossing.path[i + 1], z: 1 }, 22, 0)));
      }
      this.placeCrossWalls();
      for (const player of this.fighters()) this.offTheArms(player, first);
    });
    // He fades out (12) and takes his first quadrant faded back in (14) (captured).
    this.later(12, () => this.boss.fade(255, { from: 0, endCycles: 28 }));
    this.later(14, () => {
      this.phase = 3;
      this.collapsed = [];
      this.quadrantIndex = 0;
      // The quadrant the portals ended in comes first: the order then goes clockwise from it.
      this.p3Order = [first, ...CLOCKWISE.filter((k) => k !== first).sort((a, b) => clockwiseAfter(first, a) - clockwiseAfter(first, b))];
      this.enterQuadrant();
    });
  }

  /** The invisible walls along both sides of each arm, open where the stones are (captured). */
  placeCrossWalls() {
    const wall = named("loc", "inviswall_blockrange");
    const gap = named("loc", "invisable_nonblocking_wall");
    const open = new Set(STONE_GAPS.map(([x, y]) => `${x},${y}`));
    const put = (x, y, face) => this.placeObject(open.has(`${x},${y}`) ? gap : wall, { x, y, z: 1 }, 0, open.has(`${x},${y}`) ? 0 : face);
    for (let y = 5661; y <= 5685; y++) {
      if (y >= 5672 && y <= 5674) continue;
      put(4126, y, 0);
      put(4128, y, 2);
    }
    for (let x = 4115; x <= 4139; x++) {
      if (x >= 4126 && x <= 4128) continue;
      put(x, 5672, 3);
      put(x, 5674, 1);
    }
  }

  /** Anyone left on a fallen arm goes to the nearest tile of the quadrant (estimate). */
  offTheArms(player, key) {
    const p = Shared.tileOf(player);
    if (p3Quadrant(p)) return;
    const q = QUADRANT[key];
    player.moveTo(Shared.loc({ x: q.sx > 0 ? Math.max(p.x, 4129) : Math.min(p.x, 4125), y: q.sy > 0 ? Math.max(p.y, 5675) : Math.min(p.y, 5671), z: 1 }));
  }

  /** He takes the next quadrant: its barriers go up, void bombs fall, and his rotation starts. */
  enterQuadrant() {
    const key = this.p3Order[this.quadrantIndex];
    const q = QUADRANT[key];
    this.gen++;
    this.current = key;
    this.barriersDown = false;
    this.boss.getMovementQueue().reset();
    this.boss.moveTo(Shared.loc({ ...q.corner, z: 1 }));
    this.boss.fade(0, { from: 255, endCycles: 28 });
    this.barriers = q.barriers.map(([name, x, y, face]) => {
      const object = this.placeObject(named("loc", `${name}_spawn`), { x, y, z: 1 }, 10, face);
      return { name, x, y, face, object };
    });
    this.later(1, () => {
      for (const barrier of this.barriers ?? []) barrier.object = this.replaceObject(barrier.object, named("loc", barrier.name));
    });
    if (this.quadrantIndex === 3) {
      this.boss.forceChat("End...");
      this.phase = 4;
      this.at(3, () => this.finalLoop(0));
      return;
    }
    this.at(3, () => this.voidBombs());
    // Void flares every 48 ticks from the second quadrant on; the first's come after Untether (captured).
    if (this.quadrantIndex > 0) for (let t = 2; t < 400; t += TIME.FLARES_EVERY) this.at(t, () => this.flares(FLARES[this.quadrantIndex], 2));
    this.specials = this.quadrantIndex === 0 ? [] : ["insolence"];
    this.at(3, () => this.rotation());
  }

  /** Two void bombs on each quadrant still standing, leaving void until it falls (captured). */
  voidBombs() {
    for (const key of CLOCKWISE) {
      if (this.collapsed.includes(key)) continue;
      for (const tile of this.randomTiles((t) => p3Quadrant(t) === key, 2)) {
        Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_quadrant_bomb_idle_01"), tile, { height: 255 });
        Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_quadrant_bomb_idle_01"), tile, { delay: 30, height: 255 });
        this.later(2, () => {
          Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_quadrant_bomb_drop_01"), tile, { height: 255 });
          Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_quadrant_bomb_impact_01"), tile);
          this.addDegen(tile, -1, "tfa_ocellus_void_degen_bomb", key);
        });
      }
    }
  }

  /** Two melee and a slash at the tank, twice, then his next special (captured spacing). */
  rotation() {
    const steps = ["melee", "melee", "slash", "melee", "melee", "slash"];
    steps.forEach((step, i) => this.at(TIME.ROTATION[i], () => this[step]()));
    this.at(TIME.SPECIAL_AFTER, () => {
      if (this.specials.length === 0) this.specials.push("cog", "void", "untether");
      const special = this.specials.shift();
      const length = this[special]();
      this.at(length, () => this.rotation());
    });
  }

  /** The first to hit him in this phase, while they stay in his quadrant; else the nearest there. */
  tankOf() {
    const here = this.fighters().filter((player) => p3Quadrant(Shared.standingOn(player)) === this.current);
    if (this.tank && here.includes(this.tank)) return this.tank;
    let best = null;
    for (const player of here) if (!best || Shared.distanceTo(this.boss, player.getLocation()) < Shared.distanceTo(this.boss, best.getLocation())) best = player;
    return best;
  }

  /** At the tank if he can reach them; a void shot at everyone if not (Wiki). */
  melee() {
    const target = this.tankOf();
    if (!target) {
      this.voidShot();
      return;
    }
    this.boss.setMobileInteraction(target);
    if (Shared.distanceTo(this.boss, target.getLocation()) > 1) {
      this.boss.getMovementQueue().reset().addSteps(target.getLocation());
      return;
    }
    this.boss.getMovementQueue().reset();
    this.boss.performAnimation(anim("npc_ocellus_phase3_melee_basic"));
    this.strike(this.boss, target, "melee", DAMAGE.MELEE, 1, { prayerMultiplier: 0 });
  }

  /**
   * The wave three tiles deep in front of him, his width, towards the tank (captured: the rows
   * two cycles apart, the tick after his swing): to be stepped out of.
   */
  slash() {
    const target = this.tankOf();
    if (!target) return;
    this.boss.setMobileInteraction(target);
    this.boss.performAnimation(anim("npc_ocellus_phase3_melee_slash"));
    const at = Shared.tileOf(this.boss);
    const [dx, dy] = cardinalTowards(this.bossCentre(), Shared.tileOf(target));
    const tiles = [];
    for (let k = 1; k <= 3; k++) {
      for (let w = 0; w < 3; w++) {
        const tile = dx !== 0
          ? { x: dx > 0 ? at.x + 2 + k : at.x - k, y: at.y + w, z: 1, k }
          : { x: at.x + w, y: dy > 0 ? at.y + 2 + k : at.y - k, z: 1, k };
        if (inArena(tile) && p3Quadrant(tile) === this.current) tiles.push(tile);
      }
    }
    this.at(1, () => tiles.forEach((tile) => Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_p3_shadow_slash_spotanim01"), tile, { delay: 2 * tile.k })));
    this.at(2, () => this.hitOn(tiles, DAMAGE.SLASH));
  }

  /**
   * An Insolence wave: three wide from him out to a player, eight steps, two cycles a step
   * (captured), leaving void in three bands that last 15 ticks.
   */
  superiorSlash(target) {
    if (!target) return;
    this.boss.setMobileInteraction(target);
    this.boss.performAnimation(anim("npc_ocellus_phase3_melee_superior_slash"));
    const from = this.bossCentre();
    const to = Shared.tileOf(target);
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const [vx, vy] = [(to.x - from.x) / length, (to.y - from.y) / length];
    const [px, py] = [-vy, vx];
    const tiles = new Map();
    for (let step = 1; step <= 8; step++) {
      for (const side of [-1, 0, 1]) {
        const tile = { x: Math.round(from.x + vx * (1 + step) + px * side), y: Math.round(from.y + vy * (1 + step) + py * side), z: 1, step };
        const key = `${tile.x},${tile.y}`;
        if (tiles.has(key) || !inArena(tile) || p3Quadrant(tile) !== this.current || Shared.distanceTo(this.boss, tile) === 0) continue;
        tiles.set(key, tile);
      }
    }
    const wave = [...tiles.values()];
    this.at(3, () => {
      for (const tile of wave) {
        Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_p3_shadow_slash_superior_spotanim01"), tile, { delay: 2 + 2 * tile.step });
        this.addDegen(tile, TIME.INSOLENCE_DEGEN, `tfa_ocellus_void_degen_aoe_insolence_${tile.step <= 3 ? 1 : tile.step <= 6 ? 4 : 7}`, undefined, "fx_ocellus_shadow_slash_degen_despawn");
      }
    });
    this.at(4, () => this.hitOn(wave, DAMAGE.SLASH));
  }

  voidShot() {
    this.boss.performAnimation(anim("npc_ocellus_phase3_basic_projectile_all"));
    this.boss.performGraphicInSlot(4, spot("vfx_ocellus_magic_spotanim01"));
    for (const player of this.fighters()) {
      const ticks = Shared.projectile(this.area, this.boss, player, named("spotanim", "vfx_ocellus_magic_projanim01"), { delay: 45, end: 60, angle: 100, progress: 100, startHeight: 435, endHeight: 124 });
      this.strike(this.boss, player, "magic", DAMAGE.VOID_SHOT, ticks, { prayerMultiplier: 0 });
    }
  }

  /**
   * The cog (the charged blade), once a quadrant more each time: while the circle forms under him
   * prayers must be off, and Protect from Melee on when the cog strikes (Wiki, guides). Debris
   * falls where everyone stood, leaving void (captured).
   */
  cog() {
    const loops = this.quadrantIndex + 1;
    this.boss.performAnimation(anim("npc_ocellus_phase3_prayer_in"));
    this.boss.performGraphicInSlot(4, spot("vfx_ocellus_phase3_melee_prayer_in"));
    const debris = this.fighters().map((player) => Shared.tileOf(player));
    // Each strike three ticks after the last; the circle forms in between (captured: the cog's
    // graphic per strike, "prayer_out" on the last; the loop animation between them).
    for (let k = 1; k <= loops; k++) {
      const disrupted = new Set();
      this.at(3 * k - 2, () => {
        for (const player of this.fighters()) if (overhead(player)) disrupted.add(player);
      });
      this.at(3 * k, () => {
        this.boss.performGraphicInSlot(2, spot(k === loops ? "vfx_ocellus_phase3_melee_prayer_out" : "vfx_ocellus_phase3_melee_prayer"));
        for (const player of this.fighters()) {
          const blocked = !disrupted.has(player) && Shared.isProtected(player, "melee");
          if (!blocked) Shared.damageNow(player, Shared.random(DAMAGE.COG / 2, DAMAGE.COG));
          if (disrupted.has(player)) player.sendMessage("The cog cuts through your prayers.");
        }
      });
      if (k < loops) this.at(3 * k + 2, () => this.boss.performAnimation(anim("npc_ocellus_phase3_prayer_loop")));
    }
    const fall = 3 * Math.max(1, loops - 1);
    this.at(fall, () => {
      for (const tile of debris) {
        Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_falling_debris"), tile);
        Shared.areaSound(this.area, tile, 12619);
      }
    });
    this.at(3 * loops + 2, () => this.boss.performAnimation(anim("npc_ocellus_phase3_prayer_out")));
    this.at(fall + 5, () => {
      this.hitOn(debris, DAMAGE.DEBRIS);
      for (const tile of debris) this.addDegen(tile, TIME.DEGEN, "tfa_ocellus_void_degen_aoe");
    });
    return 9 + 3 * (loops - 1);
  }

  /** "Await... the void...": a void shot at everyone and a vine rooting one, for another to break. */
  void() {
    this.boss.forceChat(Shared.randomOf(["Await... the void...", "Your panic... is futile...", "The void... will take you..."]));
    this.at(3, () => {
      this.voidShot();
      const tank = this.tankOf();
      const others = this.fighters().filter((player) => player !== tank);
      const target = Shared.randomOf(others.length > 0 ? others : this.fighters());
      if (!target) return;
      const vine = this.spawn(named("npc", "tfa_ocellus_p3_void_vine"), Shared.tileOf(target), { scripted: true });
      if (!vine) return;
      this.setHitpoints(vine, 45);
      this.adds.add(vine);
      this.vines.set(vine, target);
      target.getMovementQueue().reset().setBlockMovement(true);
      // The vine itself has no model: the entangle shows on the player (start, then its idle
      // again each tick so it keeps going, the end when freed).
      target.performGraphicInSlot(3, spot("vfx_ocellus_spell_entangle01_start"));
      this.repeat(1, () => {
        if (!this.vines.has(vine)) return false;
        target.performGraphicInSlot(3, spot("vfx_ocellus_spell_entangle01_idle"));
        return true;
      });
      this.later(TIME.VINE, () => {
        if (!this.vines.has(vine)) return;
        if (this.fighters().includes(target)) Shared.damageNow(target, DAMAGE.VINE);
        this.releaseVine(vine);
      });
    });
    return 9;
  }

  releaseVine(vine) {
    const target = this.vines.get(vine);
    this.vines.delete(vine);
    target?.getMovementQueue().setBlockMovement(false);
    target?.performGraphicInSlot(3, spot("vfx_ocellus_spell_entangle01_end"));
    this.adds.delete(vine);
    this.despawn(vine);
  }

  /**
   * "Untether...": he rises where he stands and floats to his corner while the quadrant erupts
   * four times; then the square shows under him, and four ticks later he comes down on everything
   * outside it (Wiki; under him is safe).
   */
  untether() {
    const q = QUADRANT[this.current];
    this.boss.forceChat("Untether...");
    this.boss.performAnimation(anim("npc_ocellus_phase3_unleash_in"));
    this.boss.getMovementQueue().reset();
    // He rises where he is and floats to his corner over three ticks (captured exact move).
    const at = this.boss.getLocation();
    if (at.getX() !== q.corner.x || at.getY() !== q.corner.y) this.boss.exactMove(Shared.loc({ ...q.corner, z: 1 }), { endCycles: 90 });
    this.untethered = true;
    // Afloat until he slams: his stance is the loop (captured bas), not the cache's idle.
    this.at(2, () => this.stance("npc_ocellus_phase3_unleash_loop"));
    for (let i = 0; i < 4; i++) {
      this.at(6 + 4 * i, () => {
        const tiles = this.randomTiles((t) => p3Quadrant(t) === this.current, Shared.random(9, 11));
        for (const player of this.fighters()) tiles.push(Shared.tileOf(player));
        this.erupt(tiles, DAMAGE.ERUPT);
      });
    }
    this.at(18, () => this.boss.performGraphic(spot("vfx_ocellus_p3_unleash_spotanim", { delay: 360 })));
    const centre = { x: q.corner.x + 1, y: q.corner.y + 1, z: 1 };
    this.at(25, () => Shared.graphicAt(this.area, named("spotanim", `vfx_ocellus_unleash_arena${q.suffix}`), centre));
    // He comes down on the quadrant: only the square under him is safe.
    this.at(29, () => {
      this.stance(null);
      this.boss.performAnimation(anim("npc_ocellus_phase3_unleash_out"));
      this.untethered = false;
      for (const player of this.fighters()) if (p3Quadrant(Shared.standingOn(player)) === this.current && !this.underHim(player)) Shared.damageNow(player, DAMAGE.SLAM);
    });
    if (this.quadrantIndex === 0) this.at(32, () => this.flares(FLARES[0], 2));
    return 37;
  }

  /** In the square under him: his footprint and a tile round it (estimate). */
  underHim(player) {
    return Shared.distanceTo(this.boss, Shared.standingOn(player)) <= 1;
  }

  /** "Insolence...": three superior slashes five ticks apart at whoever he looks at, leaving void. */
  insolence() {
    this.boss.forceChat("Insolence...");
    for (let i = 0; i < 3; i++) this.at(2 + 5 * i, () => this.superiorSlash(Shared.randomOf(this.fighters())));
    return 20;
  }

  /**
   * Void flares (Siphons, Augmenters, Rifts): 44 hitpoints and a charging bar under the health
   * (captured: headbar 75 filling over 28 ticks). Not killed when it is full, a flare detonates
   * on everyone. A Siphon heals him every four ticks while it lives (captured); an Augmenter
   * that detonates also strengthens him (estimate).
   */
  flares(name, count) {
    if (this.phase < 3 || this.dead) return;
    const kind = FLARE_KIND[name];
    const area = (t) => p3Quadrant(t) === this.current && Shared.distanceTo(this.boss, t) > 1;
    for (const tile of this.randomTiles(area, count)) {
      const flare = this.spawn(named("npc", name), tile, { scripted: true });
      if (!flare) continue;
      this.setHitpoints(flare, 44);
      this.adds.add(flare);
      flare.__tfaFlare = kind;
      flare.performAnimation(anim(`vfx_ocellus_voidflare_${kind}_spawn`));
      flare.showHeadbar(75, { fill: 0, endFill: 30, duration: 30 * TIME.FLARE });
      if (kind === "heal") {
        this.repeat(4, () => {
          if (!this.adds.has(flare) || this.dead) return false;
          Shared.projectile(this.area, flare, this.boss, named("spotanim", "vfx_ocellus_voidflare_healing_projanim"), { end: 30 });
          Shared.areaSound(this.area, flare, 12543);
          this.pool = Math.min(this.poolMax, this.pool + Math.round(this.poolMax * 0.01));
          return true;
        });
      }
      this.later(TIME.FLARE, () => {
        if (!this.adds.has(flare) || this.dead) return;
        flare.performAnimation(anim(`vfx_ocellus_voidflare_${kind}_detonate`));
        for (const player of this.fighters()) Shared.damageNow(player, Shared.random(DAMAGE.FLARE / 2, DAMAGE.FLARE));
        if (kind === "buff") this.empoweredUntil = Shared.cycle() + 30;
        this.adds.delete(flare);
        this.later(1, () => this.despawn(flare));
      });
    }
  }

  /** At 75, 50 and 25% he destroys the quadrant: barriers down, eleven ticks to jump (captured). */
  checkCollapse() {
    const next = this.collapsed.length;
    if (this.destroying || next >= COLLAPSE_AT.length || this.pool / Math.max(1, this.poolMax) > COLLAPSE_AT[next]) return;
    this.destroying = true;
    this.gen++;
    const key = this.current;
    this.boss.forceChat(Shared.randomOf(["Obliteration...", "Run... It matters not..."]));
    this.boss.performAnimation(anim("npc_ocellus_quadrant_destroy_in"));
    this.boss.performGraphicInSlot(2, spot("vfx_ocellus_phase3_arena_collapse_in"));
    this.boss.getMovementQueue().reset();
    for (const barrier of this.barriers ?? []) {
      const despawn = this.replaceObject(barrier.object, named("loc", `${barrier.name}_despawn`));
      this.later(2, () => this.removeObject(despawn));
    }
    this.barriers = [];
    this.barriersDown = true;
    this.later(2, () => {
      this.stance("npc_ocellus_quadrant_destroy_loop");
      this.boss.performGraphicInSlot(2, spot("vfx_ocellus_phase3_arena_collapse_loop"));
    });
    this.later(TIME.BARRIERS_DOWN_TO_END, () => {
      this.boss.forceChat(Shared.randomOf(["This end... comes...", "Everything... ends...", "You can't... escape... the end..."]));
      this.stance(null);
      this.boss.performAnimation(anim("npc_ocellus_phase3_unleash_out_90f"));
      this.boss.performGraphicInSlot(2, spot("vfx_ocellus_phase3_arena_collapse_out_01"));
      this.boss.performGraphicInSlot(4, spot("vfx_ocellus_phase3_arena_collapse_out_02"));
    });
    // A tick on he fades out, to fade back in on the next quadrant (captured).
    this.later(TIME.BARRIERS_DOWN_TO_END + 1, () => this.boss.fade(255, { from: 0, endCycles: 30 }));
    this.later(TIME.BARRIERS_DOWN_TO_END + 2, () => this.destroyQuadrant(key));
    this.later(TIME.BARRIERS_DOWN_TO_END + TIME.END_TO_NEXT, () => {
      if (this.dead) return;
      this.crumbleStones(key);
      this.destroying = false;
      this.quadrantIndex++;
      this.enterQuadrant();
    });
  }

  /** The stones on the arms beside a fallen quadrant crumble as he moves on (captured). */
  crumbleStones(key) {
    for (const crossing of CROSSINGS) {
      if (crossing.from !== key && crossing.to !== key) continue;
      const stones = this.stones?.get(crossing);
      if (!stones) continue;
      this.stones.delete(crossing);
      stones.forEach((stone, i) => {
        for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendObjectAnimation(stone, anim(`dungeonkit_guthixian03_steppingstone_despawn_0${crossing.crumble[i]}`));
        this.later(2, () => this.removeObject(stone));
      });
    }
  }

  /** The quadrant falls: its slices, its floor blocked, and anyone still on it lost (captured). */
  destroyQuadrant(key) {
    this.collapsed.push(key);
    for (const [tile, entry] of [...this.degen]) {
      if (entry.quadrant !== key) continue;
      this.removeObject(entry.object);
      this.degen.delete(tile);
    }
    // The quadrant's floor is map locs: their pieces go first (captured: invisible locs over each
    // piece and its ground decoration), then the slices fall in their place.
    for (const [x, y] of QUADRANT[key].floor) {
      this.placeObject(named("loc", "invisible_type8_nonblocking"), { x, y, z: 1 });
      this.placeObject(named("loc", "invisible_type0_nonblocking"), { x, y, z: 1 }, 22, 0);
    }
    for (const [name, x, y] of QUADRANT[key].collapse) {
      const slice = this.placeObject(named("loc", name), { x, y, z: 1 });
      for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendObjectAnimation(slice, anim("dungeonkit_guthixian03_collapse_01"));
    }
    const block = named("loc", "invisible_type0_blocking");
    for (let x = LAYOUT.arena.minX; x <= LAYOUT.arena.maxX; x++) {
      for (let y = LAYOUT.arena.minY; y <= LAYOUT.arena.maxY; y++) if (inArena({ x, y }) && p3Quadrant({ x, y }) === key) this.placeObject(block, { x, y, z: 1 }, 22, 0);
    }
    for (const player of this.fighters()) {
      if (p3Quadrant(Shared.standingOn(player)) !== key) continue;
      player.performAnimation(anim("tfa_ocellus_void_player_death"));
      Shared.damageNow(player, player.getHitpoints());
    }
  }

  // ---------------------------------------------------------------- the final stand

  /**
   * The last quadrant's 60-tick loop (captured, from his rise):
   * - 0: he rises (deflect_in, his stance the deflect loop): Deflect Melee (head icon 15), the
   *   "range" arena graphic, the tiles next to him void; 2: the deflect loop; 3: he takes half of
   *   everyone's health into orbs, and void bursts follow them (soul_fragment_start, his
   *   levitating fragment graphic kept going); 21: he lands (deflect_out), the arena ends.
   * - 24: his charged attack; a tick later Soul Split (11).
   * - 31: on the ground: Deflect Range (16), the "melee" arena graphic, the floor void but next
   *   to him; 34: the orbs and bursts again; 50: soul_fragment_end, the arena ends.
   * - 52: his charged attack, Soul Split a tick later; 59: Rifts; 60: round again.
   * The grounded half has no deflect animations: only the risen half's deflect_in and deflect_out.
   */
  finalLoop(round) {
    this.risenHalf();
    this.at(24, () => this.hybrid());
    this.at(31, () => this.groundedHalf());
    this.at(52, () => this.hybrid());
    this.at(59, () => this.flares("tfa_ocellus_p3_bombportal_basic", Math.min(5, 2 + Math.max(0, round - 1))));
    this.at(TIME.FINAL_LOOP, () => this.finalLoop(round + 1));
  }

  risenHalf() {
    this.boss.performAnimation(anim("npc_ocellus_phase3_deflect_in"));
    this.stance("npc_ocellus_phase3_deflect_loop");
    this.deflect = "melee";
    this.boss.setHeadIcon?.(15);
    const until = 21;
    this.arena("range", until);
    this.at(1, () => { this.voidFloor = "near"; });
    this.at(2, () => this.boss.performAnimation(anim("npc_ocellus_phase3_deflect_loop")));
    this.at(3, () => this.soulFragments(true, until - 3));
    this.at(until, () => {
      this.voidFloor = null;
      this.stance(null);
      this.boss.performAnimation(anim("npc_ocellus_phase3_deflect_out"));
    });
  }

  groundedHalf() {
    this.deflect = "ranged";
    this.boss.setHeadIcon?.(16);
    const until = 19;
    this.arena("melee", until);
    this.at(1, () => { this.voidFloor = "far"; });
    this.at(3, () => this.soulFragments(false, until - 3));
    this.at(until, () => {
      this.voidFloor = null;
      this.boss.performAnimation(anim("npc_ocellus_phase3_soul_fragment_end"));
    });
  }

  /**
   * The arena graphic round him for `ticks`: its start, its loop again every three ticks, its end
   * (captured; "range" while he is risen, "melee" on the ground), on an invisible NPC at his centre.
   */
  arena(kind, ticks) {
    const graphic = `vfx_ocellus_deflect_arena_${kind}`;
    const suffix = QUADRANT[this.current].suffix;
    this.arenaMarker = this.arenaMarker ?? this.spawn(named("npc", "tfa_invisible_npc"), this.bossCentre(), { scripted: true });
    this.arenaMarker?.performGraphic(spot(`${graphic}_start${suffix}`));
    for (let t = 1; t < ticks; t += 3) this.at(t, () => this.arenaMarker?.performGraphic(spot(`${graphic}_loop${suffix}`)));
    this.at(ticks, () => this.arenaMarker?.performGraphic(spot(`${graphic}_end${suffix}`)));
  }

  /** His standing and walking pose while afloat (null: the cache's again). */
  stance(name) {
    const seq = name ? named("seq", name) : null;
    this.boss.setBaseAnimations(seq === null ? null : { idle: seq, walk: seq, turnLeft: seq, turnRight: seq });
  }

  bossCentre() {
    const at = Shared.tileOf(this.boss);
    return { x: at.x + 1, y: at.y + 1, z: 1 };
  }

  /**
   * He takes half of everyone's health into an orb near them, theirs back if they reach it once it
   * has grown (twelve ticks), and void bursts under each player every two ticks, six times; he
   * takes half damage meanwhile (Wiki). His soul fragment shows on him (slot 2, again every two
   * ticks as live loops it) for `ticks`, then the orbs are gone.
   */
  soulFragments(risen, ticks) {
    this.boss.performAnimation(anim("npc_ocellus_phase3_soul_fragment_start"));
    const fragment = spot(risen ? "vfx_ocellus_soul_fragment_ocellus_levitating_idle" : "vfx_ocellus_soul_fragment_ocellus_idle");
    for (let t = 1; t < ticks; t += 2) this.at(t, () => this.boss.performGraphicInSlot(2, fragment));
    this.at(ticks, () => this.boss.performGraphicInSlot(2, Shared.gfx(-1)));
    this.orbs = new Map();
    for (const player of this.fighters()) {
      const stolen = Math.floor(player.getHitpoints() / 2);
      Shared.damageNow(player, stolen);
      player.performGraphic(spot("vfx_ocellus_soul_fragment_player_idle"));
      const [tile] = this.randomTiles((t) => p3Quadrant(t) === this.current && this.safeFromVoid(t) && Shared.distanceTo(player, t) >= 3, 1);
      if (!tile) continue;
      this.orbs.set(player, { tile, amount: stolen, readyAt: Shared.cycle() + 12 });
      player.getPacketSender().sendGraphic(Shared.gfx(named("spotanim", "vfx_ocellus_soul_fragment_spawn_12_ticks")), Shared.loc(tile));
      this.later(12, () => this.orbs?.get(player)?.tile === tile && player.getPacketSender().sendGraphic(Shared.gfx(named("spotanim", "vfx_ocellus_soul_fragment_idle")), Shared.loc(tile)));
    }
    this.halfDamage = true;
    for (let i = 0; i < 6; i++) {
      this.at(2 * i, () => {
        for (const player of this.fighters()) {
          const tile = Shared.standingOn(player);
          Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_p2_aoe_dodge"), tile);
          this.at(2, () => {
            const now = Shared.standingOn(player);
            if (now.x === tile.x && now.y === tile.y) Shared.damageNow(player, Shared.random(...DAMAGE.BURST));
          });
        }
      });
    }
    this.at(14, () => { this.halfDamage = false; });
    this.at(ticks, () => {
      for (const [player, orb] of this.orbs ?? []) player.getPacketSender().sendGraphic(Shared.gfx(named("spotanim", "vfx_ocellus_soul_fragment_despawn")), Shared.loc(orb.tile));
      this.orbs = null;
    });
  }

  /** A grown orb walked onto gives its player's health back. */
  checkOrbs() {
    for (const [player, orb] of this.orbs ?? []) {
      if (Shared.cycle() < orb.readyAt) continue;
      const p = Shared.tileOf(player);
      if (p.x !== orb.tile.x || p.y !== orb.tile.y) continue;
      heal(player, orb.amount);
      player.performGraphic(spot("vfx_ocellus_soul_fragment_player_regain"));
      player.getPacketSender().sendGraphic(Shared.gfx(named("spotanim", "vfx_ocellus_soul_fragment_despawn")), Shared.loc(orb.tile));
      this.orbs.delete(player);
    }
  }

  safeFromVoid(tile) {
    const d = Shared.distanceTo(this.boss, tile);
    return this.voidFloor === "far" ? d <= 1 : d > 1;
  }

  /** His charged attack, a style at random: Protect from it for 6-7, else 40+ (Wiki, guides). */
  hybrid() {
    const style = Shared.randomOf(["melee", "magic", "ranged"]);
    this.boss.performAnimation(anim("npc_ocellus_phase3_melee_hybrid"));
    this.boss.performGraphicInSlot(2, spot(style === "melee" ? "vfx_ocellus_phase3_melee_hybrid" : `vfx_ocellus_phase3_melee_hybrid_${style}`));
    // A tick on he prays Soul Split (captured head icon 11, kept until his next deflect): the
    // blast heals him a fifth of what it deals (estimate).
    this.at(1, () => {
      this.boss.setHeadIcon?.(11);
      this.deflect = null;
    });
    this.at(3, () => {
      let dealt = 0;
      for (const player of this.fighters()) {
        const before = player.getHitpoints();
        Shared.damageNow(player, Shared.isProtected(player, style) ? Shared.random(...DAMAGE.HYBRID_PRAYED) : Shared.random(DAMAGE.HYBRID - 5, DAMAGE.HYBRID + 5));
        dealt += before - player.getHitpoints();
      }
      const healed = Math.min(this.poolMax - this.pool, Math.floor(dealt / 5));
      this.pool += healed;
      if (healed > 0) this.boss.showHitsplat(healed, SPLAT.HEAL);
      this.showPool();
    });
  }

  // ---------------------------------------------------------------- stones

  /** The crossing and step a stone click is for, from where the player stands. */
  stoneStep(player, object) {
    const at = object.getLocation();
    const p = Shared.tileOf(player);
    for (const crossing of CROSSINGS) {
      const index = crossing.path.findIndex((tile) => tile.x === at.getX() && tile.y === at.getY());
      if (index <= 0 || index >= crossing.path.length - 1) continue;
      const from = crossing.path.findIndex((tile) => tile.x === p.x && tile.y === p.y);
      return { crossing, index, from };
    }
    return null;
  }

  /** Where the player walks to before jumping onto a stone: the edge for an outer one. */
  routeToStone(event) {
    if (this.phase < 3) return;
    const step = this.stoneStep(event.player, event.object);
    if (!step) return;
    if (step.from >= 0) {
      event.destination = { ...Shared.tileOf(event.player) };
      return;
    }
    const edge = step.index === 1 ? step.crossing.path[0] : step.index === 3 ? step.crossing.path[4] : null;
    if (edge) event.destination = { ...edge, z: 1 };
  }

  /** Jump onto a stone next on the path (captured: no jumping while the barriers stand). */
  jump(player, object) {
    const step = this.stoneStep(player, object);
    if (!step) return false;
    if (this.phase < 3 || !this.stones?.has(step.crossing)) return true;
    if (!this.barriersDown && step.from >= 0 && (step.from === 0 || step.from === 4)) {
      player.sendMessage("The barrier stops you from jumping.");
      return true;
    }
    // Out of his quadrant only over the arm to the one he takes next (clockwise): the other arm
    // leads back the way the fight came.
    if (step.from === 0 || step.from === 4) {
      const leaving = step.from === 0 ? step.crossing.from : step.crossing.to;
      const arriving = step.from === 0 ? step.crossing.to : step.crossing.from;
      const next = this.p3Order?.[this.quadrantIndex + 1];
      if (leaving === this.current && arriving !== next) {
        player.sendMessage("The way back is closed.");
        return true;
      }
    }
    if (step.from < 0 || Math.abs(step.from - step.index) !== 1) {
      player.sendMessage("You can't jump there from here.");
      return true;
    }
    this.hop(player, step.crossing.path[step.index]);
    return true;
  }

  hop(player, tile) {
    player.getMovementQueue().reset();
    player.getCombat().reset?.();
    Shared.forceMove(player, tile, STONE_JUMP, named("seq", "human_steppingstonejump"));
  }

  /** A walk click mid hop, from the raid's area: the next hop at once. */
  forcedWalk(player, destination) {
    return this.routeFromStone(player, destination);
  }

  /** A walk click from a stone hops to the next tile of its path towards it. */
  routeFromStone(player, destination) {
    if (this.phase < 3) return false;
    const p = Shared.standingOn(player);
    for (const crossing of CROSSINGS) {
      const index = crossing.path.findIndex((tile) => tile.x === p.x && tile.y === p.y);
      if (index <= 0 || index >= crossing.path.length - 1) continue;
      const toEnd = dist(destination, crossing.path[4]) < dist(destination, crossing.path[0]);
      const next = crossing.path[index + (toEnd ? 1 : -1)];
      this.hop(player, next);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- floors and damage

  /** Purple eruptions on tiles, bursting four ticks after they show (estimate). */
  erupt(tiles, damage) {
    for (const tile of tiles) Shared.graphicAt(this.area, named("spotanim", "vfx_ocellus_p2_aoe_dodge"), tile);
    this.at(TIME.POOL_BURSTS, () => this.hitOn(tiles, damage));
  }

  /** `count` random distinct tiles of the arena passing `test`. */
  randomTiles(test, count) {
    const tiles = [];
    const { arena } = LAYOUT;
    for (let x = arena.minX; x <= arena.maxX; x++) {
      for (let y = arena.minY; y <= arena.maxY; y++) if (inArena({ x, y }) && test({ x, y })) tiles.push({ x, y, z: 1 });
    }
    return Shared.shuffle(tiles).slice(0, count);
  }

  /** Void on a tile (a ground loc, turned at random as live does), gone after `ticks` (-1: stays). */
  addDegen(tile, ticks, locName, quadrant = p3Quadrant(tile), despawn = null) {
    const key = `${tile.x},${tile.y}`;
    const old = this.degen.get(key);
    if (old) this.removeObject(old.object);
    const object = this.placeObject(named("loc", locName), { x: tile.x, y: tile.y, z: 1 }, 22, Shared.random(0, 3));
    this.degen.set(key, { object, quadrant });
    if (ticks < 0) return;
    const clear = () => {
      if (this.degen.get(key)?.object !== object) return;
      this.degen.delete(key);
      this.removeObject(object);
    };
    if (!despawn) {
      this.later(ticks, clear);
      return;
    }
    this.later(ticks - 1, () => {
      if (this.degen.get(key)?.object !== object) return;
      for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendObjectAnimation(object, anim(despawn));
    });
    this.later(ticks, clear);
  }

  /** Void on the floor: 6-7 a tick (guides). */
  burnDegen() {
    for (const player of this.fighters()) {
      const at = Shared.standingOn(player);
      const inVoid = this.degen.has(`${at.x},${at.y}`)
        || (this.voidFloor && p3Quadrant(at) === this.current && !this.safeFromVoid(at));
      if (inVoid) Shared.damageNow(player, Shared.random(...DAMAGE.DEGEN));
    }
  }

  hitOn(tiles, damage) {
    for (const player of this.fighters()) {
      const at = Shared.standingOn(player);
      if (tiles.some((tile) => tile.x === at.x && tile.y === at.y)) Shared.damageNow(player, Shared.random(Math.floor(damage / 2), damage));
    }
  }

  /**
   * Melee does nothing while he walks with Protect from Melee; in the second phase the Blade takes
   * the hits and part reaches his bar; after, the hits come off the pool shared with it. In the
   * final stand his deflect turns that style's hits back on the attacker, and he takes half while
   * the void bursts go off.
   */
  modifyHit(npc, hit) {
    const { CombatType } = Shared.core();
    const zero = () => {
      for (const part of hit.getHits?.() ?? []) part.setDamage(0);
      hit.updateTotalDamage?.();
    };
    if (npc === this.boss && this.phase === 1 && this.protectingMelee && hit.getCombatType?.() === CombatType.MELEE) {
      zero();
      return;
    }
    if (npc === this.boss && this.phase === 1) {
      for (const part of hit.getHits?.() ?? []) if (part.getDamage() > 0) part.setSplatTypes?.(...SPLAT.P1);
      return;
    }
    if (npc === this.sword && this.phase === 2) {
      this.pool = Math.max(1, this.pool - Math.floor((hit.getTotalDamage?.() ?? 0) * DAMAGE.BLADE_SHARE));
      return;
    }
    if (npc !== this.boss || this.phase < 3) return;
    if (!this.tank) this.tank = hit.getAttacker?.()?.isPlayer?.() ? hit.getAttacker() : null;
    const style = hit.getCombatType?.();
    const deflected = (this.deflect === "ranged" && style === CombatType.RANGED) || (this.deflect === "melee" && style === CombatType.MELEE);
    if (deflected) {
      const attacker = hit.getAttacker?.();
      const dealt = hit.getTotalDamage?.() ?? 0;
      zero();
      if (attacker?.isPlayer?.() && dealt > 0) Shared.damageNow(attacker, dealt);
      return;
    }
    if (this.halfDamage) {
      for (const part of hit.getHits?.() ?? []) part.setDamage(Math.floor(part.getDamage() / 2));
      hit.updateTotalDamage?.();
    }
    this.pool = Math.max(0, this.pool - (hit.getTotalDamage?.() ?? 0));
    this.boss.setHitpoints(Math.max(1, this.boss.getMaxHitpoints()));
    this.showPool();
    if (this.pool <= 0) this.fall();
  }

  holdsOn(npc) {
    if (npc === this.boss) {
      if (this.phase === 1) this.phaseTwo();
      else if (this.phase >= 3 && this.pool <= 0) this.fall();
      else npc.setHitpoints(1);
      return true;
    }
    if (npc === this.sword) return true;
    if (this.vines.has(npc)) {
      this.releaseVine(npc);
      return true;
    }
    if (this.adds.has(npc)) {
      this.adds.delete(npc);
      if (npc.__tfaFlare) npc.performAnimation(anim(`vfx_ocellus_voidflare_${npc.__tfaFlare}_despawn`));
      this.later(npc.__tfaFlare ? 1 : 0, () => this.despawn(npc));
      return true;
    }
    return false;
  }

  canAttack(attacker, target) {
    if (!attacker?.isPlayer?.()) return null;
    if (this.vines.get(target) === attacker) return false;
    if (target !== this.boss) return null;
    if (this.dead || !this.isStarted() || this.phase === 1.5 || this.phase === 2 || this.phase === 2.5) return false;
    return null;
  }

  fall() {
    if (this.dead) return;
    this.dead = true;
    this.gen++;
    this.phase = 5;
    this.deflect = null;
    this.voidFloor = null;
    this.stance(null);
    this.boss.setHitpoints(1);
    this.boss.setHeadIcon?.(-1);
    this.boss.performAnimation(anim("npc_ocellus_phase3_death"));
    this.boss.performGraphic(spot("vfx_ocellus_death"));
    this.boss.performGraphicInSlot(1, spot("vfx_ocellus_death_skirt_spotanim01"));
    this.boss.performGraphicInSlot(2, spot("vfx_ocellus_death_crack_spotanim01"));
    for (const vine of [...this.vines.keys()]) this.releaseVine(vine);
    for (const add of [...this.adds]) this.despawn(add);
    this.adds.clear();
    if (this.arenaMarker) this.despawn(this.arenaMarker);
    this.hideBars();
    const at = Shared.tileOf(this.boss);
    this.complete();
    this.raid.finish();
    // The raid's kill count (CA monster key 26, "Fractured Archive, The").
    for (const player of this.raid.players) Shared.api().emitCustomEvent("combat-achievements:kill", { player, monster: "Fractured Archive, The" });
    this.later(TIME.BLADE_AFTER_DEATH, () => {
      this.despawn(this.boss);
      this.spawn(named("npc", "tfa_blade_npc_vault_entry"), at, { scripted: true });
    });
  }

  // ---------------------------------------------------------------- the censers

  /**
   * Each censer once, in the third phase, for the whole party (Wiki): Saradomin 50 hitpoints and
   * 50 prayer, Zarosian 50% special attack, Armadylean the next ranged hit and Bandosian the next
   * melee hit at their maximum.
   */
  useCenser(player, object) {
    const censer = this.censers.find((candidate) => candidate.object === object);
    if (!censer) return false;
    if (censer.used || this.phase < 3 || this.dead) {
      player.sendMessage("Nothing interesting happens.");
      return true;
    }
    censer.used = true;
    for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendObjectAnimation(object, anim("ornament_censer_activate"));
    censer.object = this.replaceObject(object, named("loc", censer.inactive));
    const { Skill } = Shared.core();
    for (const member of this.fighters()) {
      const skills = member.getSkillManager();
      if (censer.effect === "heal") {
        heal(member, 50);
        skills.setCurrentLevel(Skill.PRAYER, Math.min(skills.getMaxLevel(Skill.PRAYER), skills.getCurrentLevel(Skill.PRAYER) + 50), true);
      } else if (censer.effect === "spec") {
        member.setSpecialPercentage?.(Math.min(100, (member.getSpecialPercentage?.() ?? 0) + 50));
        Shared.core().CombatSpecial?.updateBar?.(member);
      } else {
        this.censerCharges.set(member, censer.effect);
      }
    }
    return true;
  }

  onComplete() {
    for (const entry of this.degen.values()) this.removeObject(entry.object);
    this.degen.clear();
  }
}

function MIDDLE_TILE() {
  return { ...MIDDLE, z: 1 };
}

/** The three ways from a corner into the room (captured: across, along, diagonal). */
function inward(corner) {
  const sx = corner.x > MIDDLE.x ? -1 : 1;
  const sy = corner.y > MIDDLE.y ? -1 : 1;
  return [[sx, 0], [0, sy], [sx, sy]];
}

function dot([dx, dy], p, from) {
  const vx = p.x - from.x;
  const vy = p.y - from.y;
  return (dx * vx + dy * vy) / Math.hypot(dx, dy);
}

/** The way along one axis from his centre to a tile (the larger difference). */
function cardinalTowards(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy)];
}

function dist(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * The crack graphics' turn for a direction (captured: from the west "_90", from the north
 * "_180"; the diagonal from the north-west "_90"); the others follow round.
 */
function crackTurn(dx, dy) {
  const turns = { "-1,0": "_90", "0,1": "_180", "1,0": "_270", "0,-1": "", "-1,1": "_90", "1,1": "_180", "1,-1": "_270", "-1,-1": "" };
  return turns[`${dx},${dy}`] ?? "";
}

/** The arena's floor: a square with its corners cut (captured: the third phase's fallen tiles). */
function inArena({ x, y }) {
  const { arena } = LAYOUT;
  if (x < arena.minX || x > arena.maxX || y < arena.minY || y > arena.maxY) return false;
  const corner = Math.min(x - arena.minX, arena.maxX - x) + Math.min(y - arena.minY, arena.maxY - y);
  return corner >= 8;
}

/** The second phase's quadrants either side of the portals' cross (null on it). */
function portalQuadrant({ x, y }) {
  if (x === CENTRE.x || y === CENTRE.y) return null;
  return `${y > CENTRE.y ? "N" : "S"}${x > CENTRE.x ? "E" : "W"}`;
}

/** The third phase's quadrants either side of the fallen arms (null on them or the middle). */
function p3Quadrant({ x, y }) {
  if (x >= 4126 && x <= 4128) return null;
  if (y >= 5672 && y <= 5674) return null;
  return `${y > CENTRE.y ? "N" : "S"}${x > CENTRE.x ? "E" : "W"}`;
}

function quadrantKey(q) {
  return Object.keys(QUADRANT).find((key) => QUADRANT[key] === q);
}

/** Steps clockwise from one quadrant to another. */
function clockwiseAfter(from, to) {
  return (CLOCKWISE.indexOf(to) - CLOCKWISE.indexOf(from) + 4) % 4;
}

/** A tile's mirror over the arm between two neighbouring quadrants. */
function mirrorInto(tile, from, to) {
  const out = { x: tile.x, y: tile.y };
  if (from[1] !== to[1]) out.x = 2 * CENTRE.x - tile.x;
  if (from[0] !== to[0]) out.y = 2 * CENTRE.y - tile.y;
  return out;
}

/** Any overhead prayer on (the cog cuts through them). */
function overhead(player) {
  const { PrayerHandler } = Shared.core();
  return ["PROTECT_FROM_MELEE", "PROTECT_FROM_MISSILES", "PROTECT_FROM_MAGIC", "RETRIBUTION", "REDEMPTION", "SMITE"]
    .some((name) => PrayerHandler[name] !== undefined && PrayerHandler.isActivated(player, PrayerHandler[name]));
}

/** Heals a player up to their maximum; what it healed. */
function heal(player, amount) {
  const { Skill } = Shared.core();
  const max = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
  const healed = Math.max(0, Math.min(amount, max - player.getHitpoints()));
  if (healed > 0) player.setHitpoints?.(player.getHitpoints() + healed);
  return healed;
}

/** Saved: Ocellus met (tfa_ocellus_met), which turns the hooded figure into Ocellus for good. */
const ATTR_MET = "fractured-archive:ocellus-met";

function meet(player) {
  player.setAttribute(ATTR_MET, true);
  sendMet({ player });
}

function sendMet({ player }) {
  player.getPacketSender().sendVarbit(named("varbit", "tfa_ocellus_met"), player.getAttribute(ATTR_MET) === true ? 1 : 0);
}

function roomOf(player) {
  const room = Raid.raidOf(player)?.room;
  return room instanceof OcellusRoom ? room : null;
}

function proceed(event) {
  const room = roomOf(event.player);
  if (!room || event.npc !== room.figure) return false;
  room.proceed(event.player);
  return true;
}

function interactCenser(event) {
  const room = roomOf(event.player);
  if (!room) return false;
  return room.useCenser(event.player, event.object);
}

function jumpStone(event) {
  const room = roomOf(event.player);
  if (!room) return false;
  return room.jump(event.player, event.object);
}

function routeStone(event) {
  if (STONES.size === 0) for (const crossing of CROSSINGS) for (const name of crossing.stones) STONES.add(named("loc", name));
  if (!STONES.has(event.objectId)) return;
  roomOf(event.player)?.routeToStone(event);
}

function walkRoute(event) {
  const room = roomOf(event.player);
  if (!room || !room.routeFromStone(event.player, event.destination)) return false;
  event.handled = true;
  return true;
}

/** A censer's charge makes the next hit of its style on Ocellus land at its maximum. */
function censerHit(event) {
  const player = event.attacker;
  if (!player?.isPlayer?.()) return;
  const room = roomOf(player);
  const style = room?.censerCharges.get(player);
  if (!style || event.target !== room.boss) return;
  const { CombatType } = Shared.core();
  if (event.combatType !== (style === "melee" ? CombatType.MELEE : CombatType.RANGED)) return;
  room.censerCharges.delete(player);
  event.forceAccurate = true;
  event.forceMaxHit = true;
}

/** The Blade where Ocellus fell: "Travel" to the vault (Vault.*). */
function travel(event) {
  const raid = Raid.raidOf(event.player);
  if (!(raid?.room instanceof OcellusRoom) || !raid.room.isCompleted()) return false;
  raid.moveTo(event.player, "VAULT");
  return true;
}

module.exports = function registerOcellus(api) {
  Shared.bind(api);
  Raid.registerRoom("OCELLUS", OcellusRoom);
  api.persistAttribute(ATTR_MET, false);
  api.onPlayerLogin(sendMet);
  api.onNpcsInteraction(["Hooded Figure", "Ocellus"], { "Talk-to": proceed, Proceed: proceed });
  for (const name of ["Saradomin Censer", "Armadylean Censer", "Zarosian Censer", "Bandosian Censer"]) api.onObjectInteraction(name, { Interact: interactCenser });
  api.onObjectInteraction("Gap", { Jump: jumpStone });
  api.onObjectRoute(routeStone);
  api.onWalkRoute(walkRoute);
  api.onCombatHitRoll(censerHit);
  api.onNpcInteraction("<col=00ffff>The Blade</col>", { Travel: travel, Commune: travel });
};

Object.assign(module.exports, { OcellusRoom, LAYOUT, P1_HP, P3_HP, TIME, DAMAGE, inArena, p3Quadrant, portalQuadrant, mirrorInto });
