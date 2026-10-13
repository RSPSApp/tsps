"use strict";

/**
 * Wave 3: the Nylocas, then Nylocas Vasilias.
 *
 * Wiki ("Theatre of Blood/Strategies", The Nylocas; its Nylocas page; Nylocas Vasilias):
 * - 31 fixed waves (NylocasWaves.js) come out of the east, south and west lanes. Each nylocas
 *   takes damage only from its own style. Most go for the four supports; the aggressive ones
 *   (8348-8353) go for the team. Some flicker through other styles first, usually twice.
 * - Small ones: 11 hitpoints, max hit 17; big ones (2x2): 22 and 24, splitting into two small
 *   ones of any style when killed. They attack every 3 ticks.
 * - A nylocas blows up 30 seconds after appearing: up to 18 from a small one, 21 from a big one.
 * - Waves stall while 12 nylocas are alive (24 from wave 20).
 * - A support that falls drops rocks on the team for up to 50; all four falling kills the team.
 * - Then Vasilias (2500 hitpoints) drops into the middle in its melee form. Every 10 ticks it
 *   changes to one of the other two styles, and everyone's attack stops. It hits up to 70 every
 *   4 ticks; Protect from Melee blocks its melee, the other prayers leave 17 of 70. A hit in
 *   the wrong style is turned back on the attacker and heals it.
 * Cache: the supports (32862, breaking 32863, broken 32864), the nylocas ids (8342-8353), the
 * support NPC (8358) and Vasilias (8354-8357).
 * Captured: the nylocas' animations (7989/7999/8004 at players, 7990/8001/8004 on a support,
 * detonations 7992/8000/8006), Vasilias' arrival (8075) and attacks, the ranged (1559/1561)
 * and magic (1609/1610) projectiles' timing and arcs, detonations 1565-1567. The supports'
 * animations (8073/8074) are RuneLite's names; no capture has a support falling.
 * Estimates: the supports' tiles and the tiles nylocas attack them from, 500 hitpoints per
 * support, Vasilias' spawn tile; a wave every 4 ticks; where the lanes start (the tunnels are
 * solid in the map); which supports each lane goes for; flickering nylocas changing every 4
 * ticks; the explosions hitting anyone within a tile.
 */

const Shared = require("./TobShared");
const Raid = require("./TobRaid");
const { WAVES, parse } = require("./NylocasWaves");

const IDS = {
  small: { melee: 8342, ranged: 8343, magic: 8344 },
  big: { melee: 8345, ranged: 8346, magic: 8347 },
  smallAggressive: { melee: 8348, ranged: 8349, magic: 8350 },
  bigAggressive: { melee: 8351, ranged: 8352, magic: 8353 },
  vasilias: { spawning: 8354, melee: 8355, magic: 8356, ranged: 8357 },
  support: 8358,
};
const STYLE_OF = {};
for (const [kind, styles] of Object.entries(IDS)) {
  if (kind === "support") continue;
  for (const [style, id] of Object.entries(styles)) STYLE_OF[id] = style;
}

const OBJECT = { SUPPORT: 32862, BREAKING: 32863, BROKEN: 32864 };
/** As captured: a ranged or magic attack at a player, and the strikes on a support beside it. */
const ANIMATION = {
  attack: { magic: 7989, ranged: 7999, melee: 8004 },
  support: { magic: 7990, ranged: 8001, melee: 8004 },
  detonate: { magic: 7992, ranged: 8000, melee: 8006 },
  vasilias: { magic: 7989, ranged: 7999, melee: 8004 },
  VASILIAS_SPAWN: 8075, PRECOLLAPSE: 8073, COLLAPSE: 8074,
};
const GRAPHIC = { detonate: { melee: 1565, ranged: 1566, magic: 1567 } };
const PROJECTILE = { ranged: { small: 1559, big: 1561 }, magic: { small: 1609, big: 1610 } };
/** As captured, for every size. */
const FLIGHT = {
  ranged: { delay: 39, duration: 0, perTile: 10, startHeight: 8, endHeight: 16, angle: 16, progress: 48 },
  magic: { delay: 25, duration: 0, perTile: 10, startHeight: 12, endHeight: 16, angle: 24, progress: 24 },
};

/** Supports (south-west tiles) and the tiles nylocas attack them from (estimates). */
const SUPPORTS = {
  NW: { x: 3289, y: 4253, face: 1, spots: [{ x: 3290, y: 4252 }, { x: 3291, y: 4252 }, { x: 3292, y: 4254 }, { x: 3292, y: 4253 }] },
  SW: { x: 3289, y: 4242, face: 0, spots: [{ x: 3290, y: 4245 }, { x: 3291, y: 4245 }, { x: 3292, y: 4243 }, { x: 3292, y: 4244 }] },
  NE: { x: 3300, y: 4253, face: 2, spots: [{ x: 3301, y: 4252 }, { x: 3300, y: 4252 }, { x: 3299, y: 4254 }, { x: 3299, y: 4253 }] },
  SE: { x: 3300, y: 4242, face: 3, spots: [{ x: 3301, y: 4245 }, { x: 3300, y: 4245 }, { x: 3299, y: 4243 }, { x: 3299, y: 4244 }] },
};
/** Where each lane starts and enters the arena, and the supports it goes for (estimates). */
const LANES = {
  east: { start: { x: 3307, y: 4248 }, mouth: { x: 3301, y: 4248 }, supports: ["NE", "SE"] },
  south: { start: { x: 3295, y: 4237 }, mouth: { x: 3295, y: 4243 }, supports: ["SW", "SE"] },
  west: { start: { x: 3283, y: 4248 }, mouth: { x: 3290, y: 4248 }, supports: ["NW", "SW"] },
};
const VASILIAS_TILE = { x: 3294, y: 4247, z: 0 };

const WAVE_TICKS = 4;
const CAP = { early: 12, late: 24, lateFrom: 20 };
const NYLO = { small: { max: 17, explode: 18 }, big: { max: 24, explode: 21 }, attackTicks: 3, lifeTicks: 50, flickerTicks: 4 };
const SUPPORT_HITPOINTS = 500;
const COLLAPSE_MAX = 50;
const VASILIAS = { maxHit: 70, prayerMultiplier: 0.25, formTicks: 10, attackTicks: 4, arrival: 3 };

class NylocasRoom extends Raid.Room {
  onBuild() {
    this.supports = new Map();
    this.nylos = new Set();
    this.wave = 0;
    this.waveTicks = 0;
    this.vasilias = null;
  }

  onStart() {
    for (const [key, def] of Object.entries(SUPPORTS)) {
      const npc = this.spawn(IDS.support, { x: def.x, y: def.y, z: 0 }, { scale: false, scripted: true });
      if (!npc) continue;
      npc.setMaxHitpoints(SUPPORT_HITPOINTS);
      npc.setHitpoints(SUPPORT_HITPOINTS);
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
    return { current, maximum: SUPPORT_HITPOINTS * 4 };
  }

  tick() {
    if (!this.isStarted()) return;
    if (this.vasilias) {
      this.tickVasilias();
      return;
    }
    this.tickNylos();
    this.tickSupports();
    if (this.wave < WAVES.length) {
      if (++this.waveTicks >= WAVE_TICKS && this.nylos.size < (this.wave + 1 >= CAP.lateFrom ? CAP.late : CAP.early)) {
        this.waveTicks = 0;
        this.spawnWave(WAVES[this.wave++]);
      }
    } else if (this.nylos.size === 0) {
      this.summonVasilias();
    }
  }

  onComplete() {
    for (const nylo of [...this.nylos]) this.despawn(nylo);
    this.nylos.clear();
  }

  // -------------------------------------------------------------- the waves

  spawnWave(wave) {
    for (const [laneKey, entries] of Object.entries(wave)) {
      for (const entry of entries) this.spawnNylo(parse(entry), LANES[laneKey]);
    }
  }

  spawnNylo(def, lane, at = null) {
    const size = def.big ? "big" : "small";
    const style = def.flickers[0] ?? def.style;
    const table = def.aggressive ? (def.big ? IDS.bigAggressive : IDS.smallAggressive) : (def.big ? IDS.big : IDS.small);
    const tile = at ?? lane.start;
    const nylo = this.spawn(table[style], { ...tile, z: 0 }, { scripted: true });
    if (!nylo) return null;
    nylo.__nylo = {
      def, size, table, style, lane, age: 0, attackIn: NYLO.attackTicks,
      flickers: def.flickers.slice(1).concat(def.flickers.length ? [def.style] : []), entered: !!at, support: null, spot: null,
    };
    if (!at) Shared.walkStraight(nylo, { ...lane.mouth, z: 0 });
    this.nylos.add(nylo);
    return nylo;
  }

  setStyle(nylo, style) {
    const state = nylo.__nylo;
    state.style = style;
    nylo.setNpcTransformationId?.(state.table[style]);
  }

  tickNylos() {
    for (const nylo of [...this.nylos]) {
      const state = nylo.__nylo;
      if (nylo.getHitpoints() <= 0 || !nylo.isRegistered()) {
        this.nylos.delete(nylo);
        if (state.size === "big" && nylo.getHitpoints() <= 0) this.split(nylo);
        continue;
      }
      state.age++;
      if (state.age >= NYLO.lifeTicks) {
        this.detonate(nylo);
        continue;
      }
      if (state.flickers.length > 0 && state.age % NYLO.flickerTicks === 0) {
        this.setStyle(nylo, state.flickers.shift());
      }
      if (!state.entered) {
        const at = Shared.tileOf(nylo);
        if (at.x !== state.lane.mouth.x || at.y !== state.lane.mouth.y) continue;
        state.entered = true;
        nylo.setFlag("movement:ignore-clipping", false);
        this.engage(nylo);
      }
      if (state.def.aggressive) continue;
      this.tickPillarAttack(nylo);
    }
  }

  /** Into the arena: the aggressive ones go for the team, the rest for a support. */
  engage(nylo) {
    const state = nylo.__nylo;
    if (state.def.aggressive) {
      const target = Shared.randomOf(this.fighters());
      Shared.unscript(nylo);
      if (target) nylo.getCombat().attack(target);
      return;
    }
    const standing = state.lane.supports.filter((key) => this.supports.has(key));
    const key = Shared.randomOf(standing.length ? standing : [...this.supports.keys()]);
    if (!key) return;
    state.support = key;
    state.spot = Shared.randomOf(SUPPORTS[key].spots);
    Shared.core().PathFinder.calculateWalkRoute(nylo, state.spot.x, state.spot.y);
  }

  tickPillarAttack(nylo) {
    const state = nylo.__nylo;
    const support = this.supports.get(state.support);
    if (!support) {
      if (state.entered) this.engage(nylo);
      return;
    }
    const at = Shared.tileOf(nylo);
    if (Shared.distanceTo(support, at) > 1) {
      if (!nylo.getMovementQueue().hasRoute?.() && !Shared.frozen(nylo)) {
        Shared.core().PathFinder.calculateWalkRoute(nylo, state.spot.x, state.spot.y);
      }
      return;
    }
    if (Shared.frozen(nylo) || --state.attackIn > 0) return;
    state.attackIn = NYLO.attackTicks;
    const { Animation } = Shared.core();
    nylo.setPositionToFace?.(support.getLocation());
    nylo.performAnimation(new Animation(ANIMATION.support[state.style]));
    const damage = Shared.random(0, NYLO[state.size].max);
    support.setHitpoints(Math.max(0, support.getHitpoints() - damage));
  }

  /** A big one splits into two small ones of any style. */
  split(nylo) {
    const at = Shared.tileOf(nylo);
    for (let i = 0; i < 2; i++) {
      const style = Shared.randomOf(["melee", "ranged", "magic"]);
      const child = this.spawnNylo({ style, big: false, aggressive: false, flickers: [] }, nylo.__nylo.lane, { x: at.x + i, y: at.y });
      if (child) this.engage(child);
    }
  }

  /** Thirty seconds in, it blows up, hurting anyone within a tile. */
  detonate(nylo) {
    const { Animation } = Shared.core();
    const state = nylo.__nylo;
    nylo.performAnimation(new Animation(ANIMATION.detonate[state.style]));
    Shared.graphicAt(this.area, GRAPHIC.detonate[state.style], Shared.tileOf(nylo));
    for (const player of this.fighters()) {
      if (Shared.distanceTo(nylo, player.getLocation()) <= 1) Shared.damage(player, Shared.random(1, NYLO[state.size].explode));
    }
    this.nylos.delete(nylo);
    this.despawn(nylo);
  }

  // -------------------------------------------------------------- supports

  tickSupports() {
    for (const [key, support] of [...this.supports]) {
      if (support.getHitpoints() > 0) continue;
      this.supports.delete(key);
      this.collapse(key, support);
    }
  }

  /** A support falls on the team; with the last one, the roof comes down on everyone. */
  collapse(key, support) {
    const def = SUPPORTS[key];
    this.despawn(support);
    const broken = this.placeObject(OBJECT.BROKEN, { x: def.x, y: def.y, z: 0 }, 10, def.face);
    const { Animation } = Shared.core();
    for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendObjectAnimation?.(broken, new Animation(ANIMATION.COLLAPSE));
    const last = this.supports.size === 0;
    for (const player of this.fighters()) {
      Shared.damage(player, last ? player.getHitpoints() : Shared.random(1, COLLAPSE_MAX));
    }
  }

  // -------------------------------------------------------------- Vasilias

  summonVasilias() {
    const { Animation } = Shared.core();
    const npc = this.spawn(IDS.vasilias.spawning, VASILIAS_TILE, { scripted: true });
    if (!npc) return;
    this.vasilias = npc;
    npc.performAnimation(new Animation(ANIMATION.VASILIAS_SPAWN));
    this.formTicks = 0;
    this.arriving = VASILIAS.arrival;
  }

  tickVasilias() {
    const npc = this.vasilias;
    if (npc.getHitpoints() <= 0 || !npc.isRegistered()) {
      this.complete();
      return;
    }
    if (this.arriving > 0) {
      if (--this.arriving > 0) return;
      Shared.unscript(npc);
      this.changeForm("melee");
      const target = this.nearestFighter();
      if (target) npc.getCombat().attack(target);
      return;
    }
    if (++this.formTicks >= VASILIAS.formTicks) {
      this.formTicks = 0;
      this.changeForm(Shared.randomOf(["melee", "ranged", "magic"].filter((style) => style !== npc.__vasiliasStyle)));
      for (const player of this.fighters()) player.getCombat().reset?.();
    }
    const target = npc.getCombat().getTarget?.();
    if (!target || target.getHitpoints?.() <= 0) {
      const next = this.nearestFighter();
      if (next) npc.getCombat().attack(next);
    }
  }

  changeForm(style) {
    this.vasilias.__vasiliasStyle = style;
    this.vasilias.setNpcTransformationId?.(IDS.vasilias[style]);
  }

  nearestFighter() {
    let best = null;
    for (const player of this.fighters()) {
      if (!best || Shared.distanceTo(this.vasilias, player.getLocation()) < Shared.distanceTo(this.vasilias, best.getLocation())) best = player;
    }
    return best;
  }

  /** Each nylocas (and Vasilias) takes damage only from its own style. */
  modifyHit(npc, hit) {
    const style = npc === this.vasilias ? npc.__vasiliasStyle : npc.__nylo?.style;
    if (!style) return;
    const hitStyle = styleOfHit(hit);
    if (!hitStyle || hitStyle === style) return;
    const damage = hit.getTotalDamage?.() ?? 0;
    for (const part of hit.getHits?.() ?? []) part.setDamage(0);
    hit.updateTotalDamage?.();
    // Vasilias turns a wrong-style hit back on the attacker and heals from it.
    if (npc === this.vasilias && damage > 0) {
      const attacker = hit.getAttacker?.();
      if (attacker?.isPlayer?.()) Shared.damage(attacker, damage);
      Shared.heal(npc, damage);
    }
  }
}

function styleOfHit(hit) {
  const { CombatType } = Shared.core();
  const type = hit.getCombatType?.();
  if (type === CombatType.MELEE) return "melee";
  if (type === CombatType.RANGED) return "ranged";
  if (type === CombatType.MAGIC) return "magic";
  return null;
}

/** The nylocas' and Vasilias' combat methods, made once `api.core` gives CombatMethod to extend. */
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
      return [room.styledHit(npc, target, state.style, NYLO[state.size].max, delay)];
    }
  }

  class VasiliasMethod extends CombatMethod {
    type() {
      return CombatType[styleKey(this.npcStyle ?? "melee")];
    }

    attackSpeed() {
      return VASILIAS.attackTicks;
    }

    attackDistance(npc) {
      return npc.__vasiliasStyle === "melee" ? 1 : 10;
    }

    canAttack(npc) {
      this.npcStyle = npc.__vasiliasStyle;
      return !!npc.__vasiliasStyle;
    }

    hits(npc, target) {
      const room = npc.__tobRoom;
      const style = npc.__vasiliasStyle;
      if (!room || !style) return [];
      this.npcStyle = style;
      const { Animation } = Shared.core();
      npc.performAnimation(new Animation(ANIMATION.vasilias[style]));
      let delay = 0;
      if (style !== "melee") delay = Math.max(1, Shared.projectile(room.area, npc, target, PROJECTILE[style].big, FLIGHT[style]) - 1);
      return [room.styledHit(npc, target, style, VASILIAS.maxHit, delay, { prayerMultiplier: style === "melee" ? 0 : VASILIAS.prayerMultiplier })];
    }
  }

  return { NyloMethod, VasiliasMethod };
}

module.exports = function registerNylocas(api) {
  Shared.bind(api);
  Raid.registerRoom("NYLOCAS", NylocasRoom);
  const { NyloMethod, VasiliasMethod } = combatMethods(api.core);
  api.registerNpcCombatMethodProvider([...Object.values(IDS.smallAggressive), ...Object.values(IDS.bigAggressive)], NyloMethod, { singleton: false });
  api.registerNpcCombatMethodProvider(Object.values(IDS.vasilias), VasiliasMethod, { singleton: false });
};

function styleKey(style) {
  return style === "ranged" ? "RANGED" : style === "magic" ? "MAGIC" : "MELEE";
}

Object.assign(module.exports, { NylocasRoom, IDS, SUPPORTS, LANES, styleOfHit });
