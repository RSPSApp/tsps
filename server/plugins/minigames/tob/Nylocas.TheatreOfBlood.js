"use strict";

/**
 * Wave 3: the Nylocas, then Nylocas Vasilias.
 *
 * Wiki ("Theatre of Blood/Strategies", The Nylocas; Hard and Entry Mode pages; Nylocas Vasilias, Prinkipas):
 * - 31 fixed waves (NylocasWaves.TheatreOfBlood.js) come out of the east, south and west lanes. Each nylocas
 *   takes damage only from its own style, and a player who hits one in the wrong style can't damage it again;
 *   in Hard Mode the hit also bounces back at them, capped to the nylocas' health.
 * - Small ones hit up to 17, big ones (2x2) 24 (Entry 5 and 10), every 3 ticks; big ones split into two
 *   small ones of any style. A nylocas blows up after 30 seconds: up to 18 or 21 (Entry about 8).
 * - Waves stall while 12 nylocas are alive (24 from wave 20).
 * - A support that falls drops rocks on the team for up to 50; all four falling kills the team.
 * - Hard Mode: a Nylocas Prinkipas (max 38) at waves 10, 20 and 30, fighting as Vasilias does in Normal.
 * - Then Vasilias drops into the middle in its melee form and every 10 ticks (Entry: 15, captured) changes
 *   to one of the other two styles, and attacks on it stop. It hits up to 70 (Entry 24, Hard 105) every 4
 *   ticks; Protect from Melee blocks its melee, the other prayers leave 17 of 70. A hit in the wrong style
 *   is turned back on the attacker and heals it.
 * - Hard Mode's Vasilias: its ranged attack hits everyone within 2 squares of its target; its magic attack
 *   bounces to everyone else, unblockable, for half within 2 tiles of the target (the Wiki says more beyond
 *   that but not how much), and acts as usual if the whole team is on one tile.
 * Cache: the supports (32862, breaking 32863, broken 32864) and their tiles and faces, and every mode's ids.
 * Captured, 16 rooms over Entry (101, 554), Normal (554, 1764, 1833, 1837, 3299) and Hard (1837, 1852):
 * - The lanes' tiles, and where each nylocas takes its aggressive id: on reaching the arena.
 * - A strike takes exactly 1 hitpoint from a support. Supports' hitpoints by team size, exact over 16 rooms.
 * - Nylocas' life (52 ticks), flickers at 5, 7 and 26 ticks, the tiles they strike supports from.
 * - A killed big one's two (5 ticks later, on two corners of its tile), an expired one's (3 ticks later).
 * - The animations, projectiles and sounds named below; a falling support from start to end (1852 tick 1563).
 * - Vasilias' arrival 16-18 ticks after the last nylocas, its forms' timing, Prinkipas the same.
 * - Hitpoints (the damage dealt each kill): Hard Mode's are 1.5x the Wiki's infobox, though the Wiki's Hard Mode
 *   page says only that enemies "have more health"; Normal matches it exactly. Entry's differ from the
 *   usual team scale for one and two players.
 * Estimates: Entry's hitpoints for three or more; explosions reaching a tile round the nylocas (the
 * Entry Mode page: "avoided by being at least two tiles away"); how rocks spread. From few samples: a
 * big magic nylocas' projectile; Vasilias' forms' timing in Entry (2 rooms).
 */

const Shared = require("./Shared.TheatreOfBlood");
const Raid = require("./RaidState.TheatreOfBlood");
const { WAVES, GAPS, parse } = require("./NylocasWaves.TheatreOfBlood");

const STYLES = ["melee", "ranged", "magic"];
const triple = (melee) => ({ melee, ranged: melee + 1, magic: melee + 2 });
const forms = (spawning) => ({ spawning, melee: spawning + 1, magic: spawning + 2, ranged: spawning + 3 });
/** Cache, and captured for what each id does: nylocas appear plain and take the aggressive id in the arena. */
const IDS_BY_MODE = {
  entry: { small: triple(10774), big: triple(10777), smallAggressive: triple(10780), bigAggressive: triple(10783), vasilias: forms(10786), support: 10790 },
  normal: { small: triple(8342), big: triple(8345), smallAggressive: triple(8348), bigAggressive: triple(8351), vasilias: forms(8354), support: 8358 },
  hard: { small: triple(10791), big: triple(10794), smallAggressive: triple(10797), bigAggressive: triple(10800), vasilias: forms(10807), prinkipas: forms(10803), support: 10811 },
};
const IDS = IDS_BY_MODE.normal;
const STYLE_OF = {};
for (const table of Object.values(IDS_BY_MODE)) {
  for (const [kind, styles] of Object.entries(table)) {
    if (kind === "support") continue;
    for (const [style, id] of Object.entries(styles)) STYLE_OF[id] = style;
  }
}
/** The names the captured "hit a Nylocas Hagios with the wrong style" uses. */
const NAME_OF_STYLE = { melee: "Nylocas Ischyros", ranged: "Nylocas Toxobolos", magic: "Nylocas Hagios" };

const OBJECT = { SUPPORT: 32862, BREAKING: 32863, BROKEN: 32864 };
/** As captured: a ranged or magic attack at a player, the strikes on a support beside it, a big one running out of time. */
const ANIMATION = {
  attack: { magic: 7989, ranged: 7999, melee: 8004 },
  support: { magic: 7990, ranged: 8001, melee: 8004 },
  detonate: { magic: 7992, ranged: 8000, melee: 8006 },
  ARRIVAL: 8075, COLLAPSE: 8074, RESET: -1,
};
/** Client cycles a strike on a support starts into its tick, as captured (5-10, at random). */
const STRIKE_DELAY = { min: 5, max: 10 };
const GRAPHIC = {
  /** A small one running out of time, and a small one dying. */
  detonate: { melee: 1565, ranged: 1566, magic: 1567 },
  death: { melee: 1562, ranged: 1563, magic: 1564 },
  ROCK: 305,
};
/** A boss (Vasilias, Prinkipas) throws a bigger one; a big magic nylocas uses the small one (few samples). */
const PROJECTILE = { ranged: { small: 1559, big: 1560, boss: 1561 }, magic: { small: 1609, big: 1609, boss: 1610 }, ROCK: 645 };
/** As captured, for every size. */
const FLIGHT = {
  ranged: { delay: 39, duration: 0, perTile: 10, startHeight: 8, endHeight: 16, angle: 16, progress: 48 },
  magic: { delay: 25, duration: 0, perTile: 10, startHeight: 12, endHeight: 16, angle: 24, progress: 24 },
  /** Falling from 225 up; they land 25-30 cycles in (rsprox 1852, 1563-1565). */
  rock: { delay: 5, duration: 22, perTile: 0, startHeight: 225, endHeight: 6, angle: 0, progress: 0 },
};
const SOUND = { DEATH: 3980, SUPPORT_BREAKS: 1790, SUPPORT_FALLS: 977, ROCK: 360 };
const SHAKE = { slot: 0, random: 5, sine: 15, frequency: 10, ticks: 3 };
const MESSAGE = {
  SUPPORT: "<col=ff0000>A support was destroyed!</col>",
  BOUNCED: "Your attack is absorbed by the nylocas and bounced right off!",
};

/**
 * Supports: the south-west tile and face are the cache's. `spots` and `bigSpots` are the tiles
 * nylocas strike from, as captured (a big one's south-west tile).
 */
const SUPPORTS = {
  NW: { x: 3289, y: 4253, face: 1, spots: [{ x: 3290, y: 4252 }, { x: 3291, y: 4252 }, { x: 3292, y: 4254 }, { x: 3292, y: 4253 }], bigSpots: [{ x: 3290, y: 4251 }, { x: 3292, y: 4253 }] },
  SW: { x: 3289, y: 4242, face: 0, spots: [{ x: 3290, y: 4245 }, { x: 3291, y: 4245 }, { x: 3292, y: 4243 }, { x: 3292, y: 4244 }], bigSpots: [{ x: 3290, y: 4245 }, { x: 3291, y: 4245 }, { x: 3292, y: 4243 }, { x: 3292, y: 4244 }] },
  NE: { x: 3300, y: 4253, face: 2, spots: [{ x: 3301, y: 4252 }, { x: 3300, y: 4252 }, { x: 3299, y: 4254 }, { x: 3299, y: 4253 }], bigSpots: [{ x: 3300, y: 4251 }, { x: 3298, y: 4253 }] },
  SE: { x: 3300, y: 4242, face: 3, spots: [{ x: 3301, y: 4245 }, { x: 3300, y: 4245 }, { x: 3299, y: 4243 }, { x: 3299, y: 4244 }], bigSpots: [{ x: 3300, y: 4245 }, { x: 3299, y: 4245 }, { x: 3298, y: 4243 }] },
};
/**
 * As captured: each lane's two tiles (a wave entry's "^" picks the upper), where a big one starts, the
 * line they reach the arena on, and the supports a nylocas with none of its own may go for.
 */
const LANES = {
  east: { lower: { x: 3310, y: 4248 }, upper: { x: 3310, y: 4249 }, big: { x: 3309, y: 4248 }, mouth: { x: 3300 }, face: "WEST", supports: ["NE", "SE"] },
  south: { lower: { x: 3295, y: 4233 }, upper: { x: 3296, y: 4233 }, big: { x: 3295, y: 4233 }, mouth: { y: 4244 }, face: "NORTH", supports: ["SW", "SE"] },
  west: { lower: { x: 3281, y: 4248 }, upper: { x: 3281, y: 4249 }, big: { x: 3281, y: 4248 }, mouth: { x: 3291 }, face: "EAST", supports: ["NW", "SW"] },
};
/** Captured: where Vasilias and every Prinkipas drop in. */
const VASILIAS_TILE = { x: 3294, y: 4247, z: 0 };

const FIRST_WAVE_TICKS = 5;
const WAVE_CHECK_TICKS = 4;
const CAP = { early: 12, late: 24, lateFrom: 20 };
/** Wiki's hits and explosions. Entry's are the infobox's, and its explosions "about 8". */
const NYLO_HITS = {
  entry: { small: { max: 5, explode: 8 }, big: { max: 10, explode: 8 } },
  normal: { small: { max: 17, explode: 18 }, big: { max: 24, explode: 21 } },
};
const NYLO = {
  attackTicks: 3, lifeTicks: 52, explodeReach: 1,
  flickers: [5, 7], lateFlickerTicks: 26,
  /** Captured: a killed small one goes 2 ticks after the killing blow; a big one takes 5, or 3 if it ran out of time. */
  deathTicks: { small: 2, big: 5, expired: 3 },
};
/** Wiki: Vasilias' melee is blocked by prayer, the others leave 17 of 70. */
const BOSS = {
  prayerMultiplier: 0.25, attackTicks: 4, arrivalTicks: 2, deathTicks: 5,
  vasiliasMax: { entry: 24, normal: 70, hard: 105 },
  prinkipasMax: 38,
  /** Captured: forms last 10 ticks (Entry 15), the first a tick less. */
  formTicks: { entry: 15, normal: 10, hard: 10 },
};
const PRINKIPAS_WAVES = [10, 20, 30];
const VASILIAS_DELAY_TICKS = 16;
const RANGED_SPLASH = 2;
const MAGIC_BOUNCE = { nearby: 2, nearbyMultiplier: 0.5 };
const COLLAPSE = { max: 50, breakTicks: 7, rocksPerTick: 2, rockTicks: 3, rockSpread: 8 };
const ICE_BARRAGE_SPELL = 12891;
const ROCKS_NEEDED = 4;

/** Supports' hitpoints: the cache's for five players, more for each one fewer (captured, exact). */
const SUPPORT_HITPOINTS = { entry: { five: 155, perMissing: 59.5 }, normal: { five: 130, perMissing: 50 }, hard: { five: 150, perMissing: 63 } };
/**
 * Hitpoints, as the damage dealt in each kill shows them: a table by team size, or a number the team
 * scale applies to. Hard: small and big as captured for 3-5 players (the Wiki gives none). Its bosses follow
 * the Wiki (Vasilias 2500, Prinkipas 400, the team scale's 300/350/400 every wave alike), though the captures
 * show about 1.5x: Prinkipas 450/525/539+ for 3/4/5. All Hard captures are Leagues worlds. Entry: captured
 * for one and two players, the rest the team scale's (estimates).
 */
const HITPOINTS = {
  entry: { small: { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 }, big: { 1: 3, 2: 5, 3: 8, 4: 9, 5: 10 }, vasilias: { 1: 360, 2: 780, 3: 1080, 4: 1260, 5: 1440 } },
  normal: { small: 11, big: 22, vasilias: 2500 },
  hard: { small: { 1: 12, 2: 12, 3: 12, 4: 13, 5: 16 }, big: { 1: 24, 2: 24, 3: 24, 4: 28, 5: 33 }, vasilias: 2500, prinkipas: 400 },
};

class NylocasRoom extends Raid.Room {
  onBuild() {
    this.ids = IDS_BY_MODE[this.raid.mode] ?? IDS;
    this.supports = new Map();
    this.nylos = new Set();
    this.princes = new Set();
    this.wave = 0;
    this.waveTicks = 0;
    this.nextGap = FIRST_WAVE_TICKS;
    /** Big ones between dying and splitting: they count as alive. */
    this.pendingSplits = 0;
    this.clearedTicks = 0;
    this.vasilias = null;
    this.dyingTicks = 0;
    /** On the Rocks: player to { cycle, count }. */
    this.barrages = new Map();
  }

  onStart() {
    const { five, perMissing } = SUPPORT_HITPOINTS[this.raid.mode] ?? SUPPORT_HITPOINTS.normal;
    this.supportMax = Math.round(five + perMissing * Math.max(0, 5 - this.raid.size));
    for (const [key, def] of Object.entries(SUPPORTS)) {
      const npc = this.spawn(this.ids.support, { x: def.x, y: def.y, z: 0 }, { scale: false, scripted: true });
      if (!npc) continue;
      npc.setMaxHitpoints(this.supportMax);
      npc.setHitpoints(this.supportMax);
      this.supports.set(key, npc);
    }
  }

  /** A support with no hitpoints left collapses here, not through the usual death. */
  holdsOn(npc) {
    return [...this.supports.values()].includes(npc);
  }

  healthBar() {
    if (this.vasilias) {
      return { current: Math.max(0, this.vasilias.getHitpoints()), maximum: this.vasilias.getMaxHitpoints() };
    }
    let current = 0;
    for (const support of this.supports.values()) current += Math.max(0, support.getHitpoints());
    return { current, maximum: (this.supportMax ?? 1) * 4 };
  }

  /** Gives a spawned NPC this raid's hitpoints for its kind (see HITPOINTS). */
  applyHitpoints(npc, kind) {
    const value = (HITPOINTS[this.raid.mode] ?? HITPOINTS.normal)[kind];
    const hitpoints = typeof value === "object"
      ? value[Math.max(1, Math.min(5, this.raid.size))]
      : Math.max(1, Math.floor(value * Shared.MODES[this.raid.mode].hitpoints(this.raid.size)));
    npc.setMaxHitpoints?.(hitpoints);
    npc.setHitpoints(hitpoints);
  }

  tick() {
    if (!this.isStarted()) return;
    if (this.vasilias) {
      this.tickVasilias();
      return;
    }
    this.tickNylos();
    this.tickPrinces();
    this.tickSupports();
    if (this.wave < WAVES.length) {
      this.tickWaves();
    } else if (this.nylos.size === 0 && this.pendingSplits === 0 && this.princes.size === 0) {
      if (++this.clearedTicks >= VASILIAS_DELAY_TICKS) this.summonVasilias();
    }
  }

  onComplete() {
    for (const nylo of [...this.nylos, ...this.princes]) this.despawn(nylo);
    this.nylos.clear();
    this.princes.clear();
    if (this.raid.taskLive("Perfect Nylocas")) this.raid.completeTask("Perfect Nylocas");
    if (this.raid.taskLive("Royal Affairs")) this.raid.completeTask("Royal Affairs");
  }

  // -------------------------------------------------------------- the waves

  /** Captured: a wave's gap is fixed by wave; one stalled by the cap tries again 4 ticks later. */
  tickWaves() {
    if (++this.waveTicks < this.nextGap) return;
    const cap = this.wave + 1 >= CAP.lateFrom ? CAP.late : CAP.early;
    if (this.nylos.size + this.pendingSplits >= cap) {
      this.waveTicks = this.nextGap - WAVE_CHECK_TICKS;
      return;
    }
    const gaps = GAPS[this.raid.mode] ?? GAPS.normal;
    this.waveTicks = 0;
    this.nextGap = gaps[this.wave] ?? WAVE_CHECK_TICKS;
    this.spawnWave(WAVES[this.wave++]);
    if (this.raid.isHard && PRINKIPAS_WAVES.includes(this.wave)) this.summonPrinkipas();
  }

  spawnWave(wave) {
    for (const [laneKey, entries] of Object.entries(wave)) {
      for (const entry of entries) this.spawnNylo(parse(entry), LANES[laneKey]);
    }
  }

  spawnNylo(def, lane, at = null) {
    const size = def.big ? "big" : "small";
    const style = def.flickers[0] ?? def.style;
    const table = def.big ? this.ids.big : this.ids.small;
    const tile = at ?? (def.big ? lane.big : def.upper ? lane.upper : lane.lower);
    const nylo = this.spawn(table[style], { ...tile, z: 0 }, { scale: false, scripted: true, face: at ? undefined : Shared.facing(lane.face) });
    if (!nylo) return null;
    this.applyHitpoints(nylo, size);
    nylo.__nylo = {
      def, size, table, style, lane, age: 0, attackIn: NYLO.attackTicks, previous: null, changedAt: 0,
      entered: !!at, support: null, spot: null, immune: new Set(), expiring: false,
      shows: def.flickers.length ? [def.flickers[1], def.style] : [],
    };
    if (!at) Shared.walkStraight(nylo, { ...tile, ...lane.mouth, z: 0 });
    this.nylos.add(nylo);
    return nylo;
  }

  setStyle(nylo, style) {
    const state = nylo.__nylo;
    if (style === state.style) return;
    state.previous = state.style;
    state.changedAt = Shared.cycle();
    state.style = style;
    nylo.setNpcTransformationId?.(state.table[style]);
  }

  tickNylos() {
    for (const nylo of [...this.nylos]) {
      const state = nylo.__nylo;
      if (state.expiring) continue;
      if (nylo.getHitpoints() <= 0 || !nylo.isRegistered()) {
        this.nylos.delete(nylo);
        if (nylo.getHitpoints() <= 0) this.onNyloKilled(nylo);
        continue;
      }
      state.age++;
      if (state.age >= NYLO.lifeTicks) {
        this.detonate(nylo);
        continue;
      }
      const flicker = NYLO.flickers.indexOf(state.age);
      if (flicker >= 0 && state.shows[flicker]) this.setStyle(nylo, state.shows[flicker]);
      if (state.age === NYLO.lateFlickerTicks && state.def.late) this.setStyle(nylo, state.def.late);
      if (!state.entered) {
        const at = Shared.tileOf(nylo);
        const mouth = state.lane.mouth;
        if ((mouth.x !== undefined && at.x !== mouth.x) || (mouth.y !== undefined && at.y !== mouth.y)) continue;
        state.entered = true;
        nylo.setFlag("movement:ignore-clipping", false);
        this.engage(nylo);
      }
      if (state.def.aggressive) {
        const target = nylo.getCombat().getTarget?.();
        if (!target || target.getHitpoints?.() <= 0) {
          const next = Shared.randomOf(this.fighters());
          if (next) nylo.getCombat().attack(next);
        }
        continue;
      }
      this.tickPillarAttack(nylo);
    }
  }

  /** Into the arena: the aggressive ones take their id and go for the team, the rest for a support. */
  engage(nylo) {
    const state = nylo.__nylo;
    if (state.def.aggressive) {
      state.table = state.size === "big" ? this.ids.bigAggressive : this.ids.smallAggressive;
      nylo.setNpcTransformationId?.(state.table[state.style]);
      Shared.unscript(nylo);
      const target = Shared.randomOf(this.fighters());
      if (target) nylo.getCombat().attack(target);
      return;
    }
    const own = state.def.support;
    const choices = own && this.supports.has(own) ? [own] : state.lane.supports.filter((key) => this.supports.has(key));
    const key = Shared.randomOf(choices.length ? choices : [...this.supports.keys()]);
    if (!key) return;
    state.support = key;
    state.spot = Shared.randomOf(state.size === "big" ? SUPPORTS[key].bigSpots : SUPPORTS[key].spots);
    Shared.core().PathFinder.calculateWalkRoute(nylo, state.spot.x, state.spot.y);
  }

  tickPillarAttack(nylo) {
    const state = nylo.__nylo;
    const support = this.supports.get(state.support);
    if (!support) {
      if (state.entered) this.engage(nylo);
      return;
    }
    if (!besideSupport(nylo, support)) {
      if (!nylo.getMovementQueue().hasRoute?.() && !Shared.frozen(nylo)) {
        Shared.core().PathFinder.calculateWalkRoute(nylo, state.spot.x, state.spot.y);
      }
      return;
    }
    if (Shared.frozen(nylo) || --state.attackIn > 0) return;
    state.attackIn = NYLO.attackTicks;
    const { Animation } = Shared.core();
    nylo.setPositionToFace?.(support.getLocation());
    nylo.performAnimation(new Animation(ANIMATION.support[state.style], Shared.random(STRIKE_DELAY.min, STRIKE_DELAY.max)));
    support.setHitpoints(Math.max(0, support.getHitpoints() - 1));
  }

  onNyloKilled(nylo) {
    const state = nylo.__nylo;
    const at = Shared.tileOf(nylo);
    if (state.size === "big") {
      this.pendingSplits++;
      this.later(NYLO.deathTicks.big, () => this.split(nylo, at));
      return;
    }
    this.later(NYLO.deathTicks.small, () => {
      Shared.graphicAt(this.area, GRAPHIC.death[state.style], at);
      Shared.areaSound(this.area, at, SOUND.DEATH);
    });
  }

  /** A big one splits into two small ones of any style, on two corners of its tile, each to any support. */
  split(nylo, at) {
    this.pendingSplits--;
    const lane = { ...nylo.__nylo.lane, supports: [] };
    for (let i = 0; i < 2; i++) {
      const style = Shared.randomOf(STYLES);
      const child = this.spawnNylo({ style, big: false, aggressive: false, flickers: [], late: null, upper: false, support: null }, lane, { x: at.x + i, y: at.y + i });
      if (child) this.engage(child);
    }
  }

  /** Out of time, it blows up, hurting anyone within a tile. A small one goes at once; a big one animates, then splits. */
  detonate(nylo) {
    const { Animation } = Shared.core();
    const state = nylo.__nylo;
    const at = Shared.tileOf(nylo);
    const hits = (NYLO_HITS[this.raid.mode] ?? NYLO_HITS.normal)[state.size];
    for (const player of this.fighters()) {
      if (Shared.distanceTo(nylo, player.getLocation()) <= NYLO.explodeReach) Shared.damage(player, Shared.random(1, hits.explode));
    }
    if (state.size === "small") {
      Shared.graphicAt(this.area, GRAPHIC.detonate[state.style], at);
      Shared.areaSound(this.area, at, SOUND.DEATH);
      this.nylos.delete(nylo);
      this.despawn(nylo);
      return;
    }
    state.expiring = true;
    nylo.performAnimation(new Animation(ANIMATION.detonate[state.style]));
    this.later(NYLO.deathTicks.expired, () => {
      this.nylos.delete(nylo);
      this.despawn(nylo);
      this.pendingSplits++;
      this.split(nylo, at);
    });
  }

  // -------------------------------------------------------------- supports

  tickSupports() {
    for (const [key, support] of [...this.supports]) {
      if (support.getHitpoints() > 0) continue;
      this.supports.delete(key);
      this.collapse(key, support);
    }
  }

  /**
   * As captured (rsprox 1852, tick 1563): the support breaks with a message and the camera shaking, falls next
   * tick, rocks rain for 3 ticks and each player gets one, and the broken support shows 7 ticks in.
   * With the last one, the roof comes down on everyone.
   */
  collapse(key, support) {
    const { Animation } = Shared.core();
    const def = SUPPORTS[key];
    const tile = { x: def.x, y: def.y, z: 0 };
    const centre = { x: def.x + 1, y: def.y + 1, z: 0 };
    const last = this.supports.size === 0;
    this.raid.failTask("Perfect Nylocas", "A support was destroyed.");
    const breaking = this.placeObject(OBJECT.BREAKING, tile, 10, def.face);
    Shared.areaSound(this.area, centre, SOUND.SUPPORT_BREAKS);
    for (const viewer of this.area.getPlayers()) {
      viewer.sendMessage(MESSAGE.SUPPORT);
      viewer.getPacketSender().sendCameraShake?.(SHAKE.slot, SHAKE.random, SHAKE.sine, SHAKE.frequency);
    }
    this.later(1, () => {
      for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendObjectAnimation?.(breaking, new Animation(ANIMATION.COLLAPSE));
      Shared.areaSound(this.area, centre, SOUND.SUPPORT_FALLS, 10);
    });
    this.later(SHAKE.ticks, () => {
      for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendCameraReset?.();
    });
    this.later(COLLAPSE.breakTicks, () => {
      this.despawn(support);
      this.placeObject(OBJECT.BROKEN, tile, 10, def.face);
    });
    for (let tick = 0; tick < COLLAPSE.rockTicks; tick++) this.later(tick, () => this.rainRocks());
    this.fighters().forEach((player, index) => this.later(Math.min(index, COLLAPSE.rockTicks - 1), () => this.rockOn(player, last)));
  }

  /** Rocks falling on open floor, to no effect (how many and where: estimates). */
  rainRocks() {
    for (let i = 0; i < COLLAPSE.rocksPerTick; i++) {
      const to = { x: VASILIAS_TILE.x + Shared.random(-COLLAPSE.rockSpread, COLLAPSE.rockSpread), y: VASILIAS_TILE.y + Shared.random(-COLLAPSE.rockSpread, COLLAPSE.rockSpread), z: 0 };
      const ticks = Shared.projectile(this.area, { ...to, y: to.y + 1 }, to, PROJECTILE.ROCK, FLIGHT.rock);
      this.later(ticks, () => Shared.graphicAt(this.area, GRAPHIC.ROCK, to));
    }
  }

  rockOn(player, last) {
    if (!this.fighters().includes(player)) return;
    const at = Shared.tileOf(player);
    const ticks = Shared.projectile(this.area, { x: at.x + 1, y: at.y + 1, z: at.z }, player, PROJECTILE.ROCK, FLIGHT.rock);
    player.performGraphic(Shared.gfx(GRAPHIC.ROCK, { delay: FLIGHT.rock.delay + FLIGHT.rock.duration }));
    Shared.areaSound(this.area, player, SOUND.ROCK, FLIGHT.rock.delay + FLIGHT.rock.duration);
    this.later(ticks, () => Shared.damage(player, last ? player.getHitpoints() : Shared.random(1, COLLAPSE.max)));
  }

  // -------------------------------------------------------------- Vasilias and the Prinkipas

  /** Hard Mode, with waves 10, 20 and 30: dropped in as Vasilias is, and it fights on through the waves. */
  summonPrinkipas() {
    const npc = this.spawnBoss(this.ids.prinkipas, "prinkipas", BOSS.prinkipasMax, BOSS.formTicks.hard);
    if (!npc) return;
    npc.__boss.prinkipas = true;
    this.princes.add(npc);
  }

  summonVasilias() {
    const npc = this.spawnBoss(this.ids.vasilias, "vasilias", BOSS.vasiliasMax[this.raid.mode] ?? BOSS.vasiliasMax.normal, BOSS.formTicks[this.raid.mode] ?? BOSS.formTicks.normal);
    if (npc) this.vasilias = npc;
  }

  spawnBoss(ids, kind, max, formLength) {
    const { Animation } = Shared.core();
    const npc = this.spawn(ids.spawning, VASILIAS_TILE, { scale: false, scripted: true });
    if (!npc) return null;
    this.applyHitpoints(npc, kind);
    npc.performAnimation(new Animation(ANIMATION.ARRIVAL));
    npc.__boss = { forms: ids, max, form: null, previous: null, changedAt: 0, arriving: BOSS.arrivalTicks, formTicks: 1, formLength, prinkipas: false };
    return npc;
  }

  tickPrinces() {
    for (const npc of [...this.princes]) {
      if (npc.getHitpoints() <= 0 || !npc.isRegistered()) {
        this.princes.delete(npc);
        continue;
      }
      this.tickBoss(npc);
    }
  }

  tickVasilias() {
    const npc = this.vasilias;
    if (!npc.isRegistered()) {
      this.complete();
      return;
    }
    if (npc.getHitpoints() <= 0) {
      // Captured: the wave is over as it disappears, 5 ticks after its death animation starts.
      if (++this.dyingTicks >= BOSS.deathTicks) this.complete();
      return;
    }
    this.tickBoss(npc);
  }

  /** Vasilias' and Prinkipas' forms: each change stops attacks on it. */
  tickBoss(npc) {
    const boss = npc.__boss;
    if (boss.arriving > 0) {
      if (--boss.arriving > 0) return;
      Shared.unscript(npc);
      this.changeForm(npc, "melee");
      const target = this.nearestFighter(npc);
      if (target) npc.getCombat().attack(target);
      return;
    }
    if (++boss.formTicks >= boss.formLength) {
      boss.formTicks = 0;
      this.changeForm(npc, Shared.randomOf(STYLES.filter((style) => style !== boss.form)));
      if (boss.prinkipas) this.raid.failTask("Royal Affairs", "A Nylocas Prinkipas changed styles.");
      for (const player of this.fighters()) {
        if (player.getCombat().getTarget?.() === npc) player.getCombat().reset?.();
      }
    }
    const target = npc.getCombat().getTarget?.();
    if (!target || target.getHitpoints?.() <= 0) {
      const next = this.nearestFighter(npc);
      if (next) npc.getCombat().attack(next);
    }
  }

  changeForm(npc, style) {
    const { Animation } = Shared.core();
    const boss = npc.__boss;
    boss.previous = boss.form;
    boss.changedAt = Shared.cycle();
    boss.form = style;
    npc.setNpcTransformationId?.(boss.forms[style]);
    npc.performAnimation(new Animation(ANIMATION.RESET));
  }

  nearestFighter(npc) {
    let best = null;
    for (const player of this.fighters()) {
      if (!best || Shared.distanceTo(npc, player.getLocation()) < Shared.distanceTo(npc, best.getLocation())) best = player;
    }
    return best;
  }

  /** Perfect Nylocas: Vasilias landing a hit on someone without the right prayer up. */
  noteOffPrayer(player, style, hit) {
    if ((hit?.getTotalDamage?.() ?? 0) <= 0 || Shared.isProtected(player, style)) return;
    this.raid.failTask("Perfect Nylocas", `${Shared.displayName(player)} got hit by Nylocas Vasilias' ${style} attack and didn't pray against it.`);
  }

  /** Hard Mode: on from player to player, one at a time (captured); half to anyone within 2 tiles of the first. */
  bounceMagic(primary, from, rest, damage) {
    if (rest.length === 0) return;
    const [next, ...others] = rest;
    if (!this.fighters().includes(next)) {
      this.bounceMagic(primary, from, others, damage);
      return;
    }
    const ticks = Shared.projectile(this.area, from, next, PROJECTILE.magic.boss, FLIGHT.magic);
    this.later(ticks, () => {
      const near = Shared.distanceTo(primary, next.getLocation()) <= MAGIC_BOUNCE.nearby;
      Shared.damage(next, near ? Math.floor(damage * MAGIC_BOUNCE.nearbyMultiplier) : damage);
      this.bounceMagic(primary, next, others, damage);
    });
  }

  /**
   * Each nylocas (and boss) takes damage only from its own style. Wiki: a hit thrown just before it
   * changed still counts. A nylocas then ignores whoever got it wrong, and in Hard Mode bounces the hit
   * back, up to its health. A boss always bounces it and heals from it. As captured, bounces say so.
   */
  modifyHit(npc, hit) {
    const state = npc.__nylo ?? npc.__boss;
    if (!state) return;
    const attacker = hit.getAttacker?.();
    const player = attacker?.isPlayer?.() ? attacker : null;
    if (npc.__nylo) {
      this.countBarrage(npc, hit, player);
      if (player && state.immune.has(player)) {
        clearHit(hit);
        return;
      }
    }
    const hitStyle = styleOfHit(hit);
    if (!hitStyle || hitStyle === (state.style ?? state.form)) return;
    if (hitStyle === state.previous && launchedAt(hit) < state.changedAt) return;
    const damage = hit.getTotalDamage?.() ?? 0;
    clearHit(hit);
    if (!player) return;
    const name = npc.__nylo ? NAME_OF_STYLE[state.style] : "Nylocas Vasilias";
    if (!state.prinkipas) this.raid.failTask("Perfect Nylocas", `${Shared.displayName(player)} hit a ${name} with the wrong style.`);
    if (npc.__nylo) {
      state.immune.add(player);
      if (!this.raid.isHard) return;
      player.sendMessage(MESSAGE.BOUNCED);
      Shared.damage(player, Math.min(damage, Math.max(0, npc.getHitpoints())));
      return;
    }
    player.sendMessage(MESSAGE.BOUNCED);
    if (damage > 0) {
      Shared.damage(player, damage);
      Shared.heal(npc, damage);
    }
  }

  /** On the Rocks: four nylocas frozen by one Ice Barrage. */
  countBarrage(npc, hit, player) {
    if (!player || hit.getSpell?.()?.spellId?.() !== ICE_BARRAGE_SPELL || !hit.isAccurate?.() || Shared.frozen(npc)) return;
    const cycle = Shared.cycle();
    const last = this.barrages.get(player);
    const count = last?.cycle === cycle ? last.count + 1 : 1;
    this.barrages.set(player, { cycle, count });
    if (count >= ROCKS_NEEDED) this.raid.completeTask("Nylocas, On the Rocks", [player]);
  }
}

function clearHit(hit) {
  for (const part of hit.getHits?.() ?? []) part.setDamage(0);
  hit.updateTotalDamage?.();
}

/** Whether a nylocas' footprint shares an edge with a support's (not only a corner): where it strikes from. */
function besideSupport(nylo, support) {
  const at = nylo.getLocation();
  const to = support.getLocation();
  const size = nylo.getSize?.() ?? 1;
  const supportSize = support.getSize?.() ?? 3;
  const dx = Math.max(to.getX() - (at.getX() + size - 1), at.getX() - (to.getX() + supportSize - 1), 0);
  const dy = Math.max(to.getY() - (at.getY() + size - 1), at.getY() - (to.getY() + supportSize - 1), 0);
  return dx + dy === 1;
}

/**
 * The cycle a hit was thrown: CombatFactory.addPendingHit lands an NPC's hit at the launch cycle plus
 * its delay plus one processing tick (`hitProcessingDelay`).
 */
function launchedAt(hit) {
  const { CombatFactory } = Shared.core();
  return Shared.cycle() - hit.getDelay() - (CombatFactory.hitProcessingDelay?.(hit) ?? 1);
}

function styleOfHit(hit) {
  const { CombatType } = Shared.core();
  const type = hit.getCombatType?.();
  if (type === CombatType.MELEE) return "melee";
  if (type === CombatType.RANGED) return "ranged";
  if (type === CombatType.MAGIC) return "magic";
  return null;
}

/** The nylocas' and bosses' combat methods, made once `api.core` gives CombatMethod to extend. */
function combatMethods({ CombatMethod, CombatType }) {
  /** The aggressive nylocas: their style's attack every 3 ticks. */
  class NyloMethod extends CombatMethod {
    type() {
      return CombatType[styleKey(this.npcStyle)];
    }

    /** Called before the engine reads type(), so the style is set for range checks. */
    canAttack(npc) {
      this.npcStyle = npc.__nylo?.style ?? STYLE_OF[npc.getId()];
      return true;
    }

    attackSpeed() {
      return NYLO.attackTicks;
    }

    attackDistance(npc) {
      return (npc.__nylo?.style ?? STYLE_OF[npc.getId()]) === "melee" ? 1 : 7;
    }

    hits(npc, target) {
      const room = npc.__tobRoom;
      const state = npc.__nylo;
      if (!room || !state) return [];
      this.npcStyle = state.style;
      const { Animation } = Shared.core();
      npc.performAnimation(new Animation(ANIMATION.attack[state.style]));
      let delay = 0;
      if (state.style !== "melee") delay = Math.max(1, Shared.projectile(room.area, npc, target, PROJECTILE[state.style][state.size], FLIGHT[state.style]) - 1);
      const max = (NYLO_HITS[room.raid.mode] ?? NYLO_HITS.normal)[state.size].max;
      return [room.styledHit(npc, target, state.style, max, delay)];
    }
  }

  /** Vasilias and the Prinkipas. Hard Mode's Vasilias has its own ranged and magic attacks. */
  class BossMethod extends CombatMethod {
    type() {
      return CombatType[styleKey(this.npcStyle ?? "melee")];
    }

    attackSpeed() {
      return BOSS.attackTicks;
    }

    attackDistance(npc) {
      return npc.__boss?.form === "melee" ? 1 : 10;
    }

    canAttack(npc) {
      this.npcStyle = npc.__boss?.form;
      return !!npc.__boss?.form;
    }

    hits(npc, target) {
      const room = npc.__tobRoom;
      const boss = npc.__boss;
      const style = boss?.form;
      if (!room || !style) return [];
      this.npcStyle = style;
      const { Animation } = Shared.core();
      npc.performAnimation(new Animation(ANIMATION.attack[style]));
      const options = { prayerMultiplier: style === "melee" ? 0 : BOSS.prayerMultiplier };
      const hardVasilias = room.raid.isHard && !boss.prinkipas;
      const launch = (player) => (style === "melee" ? 0 : Math.max(1, Shared.projectile(room.area, npc, player, PROJECTILE[style].boss, FLIGHT[style]) - 1));
      // Everyone within 2 squares of the target takes a shot of their own (captured: one projectile each).
      if (hardVasilias && style === "ranged") {
        for (const other of room.fighters()) {
          if (other === target || Shared.distanceTo(target, other.getLocation()) > RANGED_SPLASH) continue;
          room.noteOffPrayer(other, style, room.strike(npc, other, style, boss.max, launch(other), options));
        }
      }
      const delay = launch(target);
      // Unless the whole team stands together, it always hits and bounces on.
      if (hardVasilias && style === "magic") {
        const here = Shared.tileOf(target);
        const others = room.fighters().filter((other) => {
          const at = Shared.tileOf(other);
          return other !== target && (at.x !== here.x || at.y !== here.y);
        });
        if (others.length > 0) {
          const hit = room.styledHit(npc, target, style, boss.max, delay, { accurate: true, prayable: false });
          room.later(delay, () => room.bounceMagic(target, target, Shared.shuffle(others), hit.getTotalDamage()));
          room.noteOffPrayer(target, style, hit);
          return [hit];
        }
      }
      const hit = room.styledHit(npc, target, style, boss.max, delay, options);
      if (!boss.prinkipas) room.noteOffPrayer(target, style, hit);
      return [hit];
    }
  }

  return { NyloMethod, BossMethod };
}

const allIds = (key) => Object.values(IDS_BY_MODE).flatMap((table) => Object.values(table[key] ?? {}));

module.exports = function registerNylocas(api) {
  Shared.bind(api);
  Raid.registerRoom("NYLOCAS", NylocasRoom);
  const { NyloMethod, BossMethod } = combatMethods(api.core);
  api.registerNpcCombatMethodProvider([...allIds("smallAggressive"), ...allIds("bigAggressive")], NyloMethod, { singleton: false });
  api.registerNpcCombatMethodProvider([...allIds("vasilias"), ...allIds("prinkipas")], BossMethod, { singleton: false });
};

function styleKey(style) {
  return style === "ranged" ? "RANGED" : style === "magic" ? "MAGIC" : "MELEE";
}

Object.assign(module.exports, { launchedAt, NylocasRoom, IDS, IDS_BY_MODE, SUPPORTS, LANES, styleOfHit });
