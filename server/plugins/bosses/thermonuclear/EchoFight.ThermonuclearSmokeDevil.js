"use strict";

/**
 * The Leagues VI Echo Thermonuclear smoke devil's fight, as rsprox.net 1161 records it (rev 237.1,
 * 31 Echo kills; figures in data/thermonuclear-smoke-devil.json `echo`, facts and their sources in
 * docs/thermonuclear-smoke-devil.md). It runs on its own tick task, not the combat engine's attack
 * turn (Fight.ThermonuclearSmokeDevil.js gives the Echo no attack of its own):
 *
 * - Twelve smoke pools ring the Echo. A pool under the player when a shot lands is used up: with
 *   the right protection prayer the shot does nothing ("The power resonating here protects you
 *   from the blast."), with the wrong one half. Off a pool the right prayer halves it; the wrong
 *   one takes it whole.
 * - Shots come in sets of three, one every 2 ticks, a set every 12: ranged, magic, ranged, magic.
 *   Once enraged every set alternates (RMR or MRM, from the style the set would have had).
 * - After four sets, the special: an 8-tick charge (the pools go), then a typeless blast whose
 *   damage is fixed at launch by distance (13 a tile, 9 at least, 130 at most). As it lands the
 *   Echo prays against the style of the last of the player's hits to land on it; that style then
 *   does a quarter of its damage. The pools come back 14 ticks after the charge began.
 */
const Common = require("./Common.ThermonuclearSmokeDevil");

const ECHO = Common.DATA.echo;
const RANGED = "ranged";
const MAGIC = "magic";

let styles = null;

/** Hit styles for the PendingHits the fight builds (no attack of their own). */
function styleMethod(style) {
  if (!styles) {
    const { CombatMethod, CombatType } = Common.core;
    const make = (type) => new (class extends CombatMethod {
      type() { return type; }
      hits() { return []; }
    })();
    styles = { [RANGED]: make(CombatType.RANGED), [MAGIC]: make(CombatType.MAGIC) };
  }
  return styles[style];
}

const ids = {};
/** Cache ids for the data's gameval names, resolved once. */
function id(kind, name) {
  const key = `${kind}:${name}`;
  if (!(key in ids)) {
    const { CacheDefinitions } = Common.core;
    ids[key] = kind === "seq" ? CacheDefinitions.getSeqId(name) : CacheDefinitions.getSpotanimId(name);
  }
  return ids[key];
}

const tileKey = (x, y) => `${x},${y}`;

/** Chebyshev distance from a tile to the nearest tile of an NPC's footprint. */
function distanceToFootprint(npc, at) {
  const origin = npc.getLocation();
  const size = npc.getSize?.() ?? 1;
  const dx = Math.max(origin.getX() - at.getX(), 0, at.getX() - (origin.getX() + size - 1));
  const dy = Math.max(origin.getY() - at.getY(), 0, at.getY() - (origin.getY() + size - 1));
  return Math.max(dx, dy);
}

/**
 * The special's damage at `tiles` from the Echo: recorded from 4 tiles out (13 a tile from 11, 9 at
 * least); nearer, where nothing is recorded, the Wiki's (130 underneath, 117 adjacent, 13 less a tile).
 */
function specialDamage(tiles) {
  const near = ECHO.special.nearDamage[String(tiles)];
  if (near !== undefined) return near;
  const { perTile, fromTiles, max, min } = ECHO.special.damage;
  return Math.min(max, Math.max(min, perTile * (fromTiles - tiles)));
}

/** The special's flight, in client cycles: 10 a tile, 60 at least (as recorded). */
function specialFlightCycles(tiles) {
  const arc = ECHO.special.projectileArc;
  return Math.max(arc.minEnd, arc.baseEnd + arc.endPerTile * tiles);
}

/**
 * What a shot of `style` does to a player standing `onPool` and praying `prayer` (the style their
 * protection prayer is against, or null), as a fraction of its rolled damage.
 */
function shotMultiplier(style, prayer, onPool) {
  const right = prayer === style;
  if (onPool) return right ? 0 : 0.5;
  return right ? 0.5 : 1;
}

/** The styles of the set at `index` in its cycle (0-3): RRR MMM RRR MMM, or alternating once enraged. */
function setStyles(index, enraged) {
  const first = index % 2 === 0 ? RANGED : MAGIC;
  const other = first === RANGED ? MAGIC : RANGED;
  return enraged ? [first, other, first] : [first, first, first];
}

class EchoFight {
  constructor(session, boss) {
    this.session = session;
    this.player = session.player;
    this.boss = boss;
    this.core = Common.core;
    this.tick = 0;
    this.events = [];
    this.stopped = false;
    /** Live pools by tile key, and whether they are drawn (idle) yet. */
    this.pools = new Map();
    this.enraged = false;
    this.setIndex = 0;
    /** The style of the last of the player's hits to land on the Echo, and what it prays against. */
    this.lastStyle = null;
    this.protecting = null;
    this.random = Math.random;
  }

  /** Runs `action` `ticks` from now. */
  at(ticks, action) {
    this.events.push({ tick: this.tick + ticks, action });
  }

  start() {
    this.sound(ECHO.spawnSound);
    this.boss.getCombat().attack(this.player);
    this.at(ECHO.pools.firstSpawnTicks, () => this.spawnPools());
    this.scheduleSet(ECHO.orbs.firstSetTicks);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.events = [];
    this.pools.clear();
  }

  /** Every tick: due events, then the live pools drawn. */
  process() {
    if (this.stopped) return;
    this.tick++;
    if (this.boss.getHitpoints() <= 0 || !this.boss.isRegistered?.()) {
      this.stop();
      return;
    }
    // Its shots aren't combat-engine attacks: keep it counted as fighting.
    this.boss.getCombat().getLastAttack?.().reset?.();
    // An event can add one for this same tick (a set's first shot): run until none is due.
    for (;;) {
      const due = this.events.filter((event) => event.tick <= this.tick);
      if (due.length === 0) break;
      this.events = this.events.filter((event) => event.tick > this.tick);
      for (const event of due) if (!this.stopped) event.action();
      if (this.stopped) return;
    }
    this.drawPools();
  }

  // ------------------------------------------------------------------ the pools

  spawnPools() {
    for (const [x, y] of ECHO.pools.tiles) {
      this.pools.set(tileKey(x, y), { x, y, drawn: false });
      this.mapGraphic(id("spotanim", ECHO.pools.spawn), x, y);
      this.sound(ECHO.pools.spawnSound);
    }
  }

  /** Live's idle loop is sent for every pool every tick, from the tick after it appears. */
  drawPools() {
    const idle = id("spotanim", ECHO.pools.idle);
    for (const pool of this.pools.values()) {
      if (!pool.drawn) {
        pool.drawn = true;
        continue;
      }
      this.mapGraphic(idle, pool.x, pool.y);
    }
  }

  /** Takes the pool off the player's tile, if one is there. */
  usePool(at) {
    const key = tileKey(at.getX(), at.getY());
    const pool = this.pools.get(key);
    if (!pool || at.getZ() !== 0) return false;
    this.pools.delete(key);
    this.mapGraphic(id("spotanim", ECHO.pools.despawn), pool.x, pool.y);
    return true;
  }

  clearPools() {
    const despawn = id("spotanim", ECHO.pools.despawn);
    for (const pool of this.pools.values()) this.mapGraphic(despawn, pool.x, pool.y);
    this.pools.clear();
  }

  // ------------------------------------------------------------------ the shots

  scheduleSet(ticks) {
    const { decideTicksBefore } = ECHO.enrage;
    this.at(Math.max(0, ticks - decideTicksBefore), () => this.decideEnrage());
    this.at(ticks, () => this.startSet());
  }

  /** The enrage is decided 8 ticks before a set, on the HP then (recorded; see the data's note). */
  decideEnrage() {
    if (!this.enraged && this.boss.getHitpoints() < ECHO.enrage.hitpoints) this.enraged = true;
  }

  startSet() {
    const { orbTicks, setTicks, setsPerCycle } = ECHO.orbs;
    const shots = setStyles(this.setIndex, this.enraged);
    shots.forEach((style, i) => this.at(i * orbTicks, () => this.launchShot(style)));
    this.setIndex++;
    if (this.setIndex < setsPerCycle) {
      this.scheduleSet(setTicks);
    } else {
      this.setIndex = 0;
      this.at(setTicks, () => this.startSpecial());
    }
  }

  launchShot(style) {
    const { Animation, Projectile } = this.core;
    const orbs = ECHO.orbs;
    if (!this.playerPresent()) return;
    this.boss.performAnimation(new Animation(id("seq", orbs.attackSeq)));
    const arc = orbs.projectile;
    Projectile.createProjectile(this.boss, this.player, id("spotanim", orbs[style].projectile), arc.delay, arc.end, arc.startHeight, arc.endHeight)
      .withAngle(arc.angle)
      .withProgress(arc.progress)
      .sendProjectile();
    this.sound(orbs.launchSound);
    if (orbs[style].launchSound) this.sound(orbs[style].launchSound, orbs[style].launchSoundDelay ?? 0);
    this.at(orbs.landTicks, () => this.shotLands(style));
  }

  /** Lands on the player wherever they are: a pool and the right prayer decide what it does. */
  shotLands(style) {
    const { CombatFactory, Graphic, PendingHit, World } = this.core;
    if (!this.playerPresent()) return;
    const at = this.player.getLocation();
    const onPool = this.usePool(at);
    const multiplier = shotMultiplier(style, this.prayerStyle(), onPool);
    if (multiplier === 0) {
      this.player.performGraphic(new Graphic(id("spotanim", ECHO.pools.shield)));
      this.player.getPacketSender().sendTypedMessage(this.core.ChatType.SPAM, ECHO.pools.protectMessage);
      this.sound(ECHO.pools.protectSound);
      return;
    }
    this.player.performGraphic(Graphic.atHeight(id("spotanim", ECHO.orbs[style].impact), ECHO.orbs.impactHeight));
    const impact = ECHO.orbs.impactSound;
    this.player.getPacketSender().sendAreaSound(impact.id, at.getX(), at.getY(), at.getZ(), 1, 0, impact.range);
    // Recorded: either style misses about one shot in seven, whatever the Echo's levels; a hit is 48-62.
    const hit = new PendingHit(this.boss, this.player, styleMethod(style), { delay: 0, rollAccuracy: false });
    // Wiki: only the special triggers Vengeance.
    hit.setTriggersVengeance?.(false);
    if (this.random() < ECHO.orbs.missChance) {
      hit.markProtectionBypassed();
      for (const part of hit.getHits()) {
        part.setDamage(0);
        part.setHitmask?.(this.core.HitMask.BLUE);
      }
      hit.updateTotalDamage();
    } else {
      CombatFactory.applyStyleDamage(hit, ECHO.orbs.damage.max, { minHit: ECHO.orbs.damage.min, bypassProtectionPrayer: true });
      if (multiplier !== 1) {
        for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * multiplier));
        hit.updateTotalDamage();
      }
    }
    this.player.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle());
  }

  // ------------------------------------------------------------------ the special

  startSpecial() {
    const { Animation } = this.core;
    const special = ECHO.special;
    this.clearPools();
    const bar = special.chargeBar;
    this.boss.showHeadbar?.(bar.id, { fill: bar.fill, endFill: bar.endFill, duration: bar.cycles });
    for (let t = 0; t < special.chargeTicks; t += special.chargeSeqEvery) {
      this.at(t, () => this.boss.performAnimation(new Animation(id("seq", special.chargeSeq))));
    }
    this.at(special.chargeTicks, () => this.launchSpecial());
    this.at(special.poolsBackTicks, () => this.spawnPools());
    this.scheduleSet(special.nextSetTicks);
  }

  launchSpecial() {
    const { Animation, Projectile } = this.core;
    const special = ECHO.special;
    this.boss.performAnimation(new Animation(id("seq", special.launchSeq)));
    const from = this.boss.getLocation();
    this.player.getPacketSender().sendAreaSound(special.launchAreaSound.id, from.getX(), from.getY(), from.getZ(), 1, 0, special.launchAreaSound.range);
    if (!this.playerPresent()) return;
    // Damage and flight are fixed now, by where the player stands as it is cast (as recorded).
    const tiles = distanceToFootprint(this.boss, this.player.getLocation());
    const damage = specialDamage(tiles);
    const cycles = specialFlightCycles(tiles);
    const arc = special.projectileArc;
    Projectile.createProjectile(this.boss, this.player, id("spotanim", special.projectile), arc.delay, cycles, arc.startHeight, arc.endHeight)
      .withAngle(arc.angle)
      .withProgress(arc.progress)
      .sendProjectile();
    this.sound(special.landSound, cycles);
    this.at(Math.round(cycles / 30), () => this.specialLands(damage));
  }

  specialLands(damage) {
    const { Graphic, PendingHit, World } = this.core;
    this.prayAgainstLastStyle();
    if (!this.playerPresent()) return;
    this.player.performGraphic(Graphic.atHeight(id("spotanim", ECHO.special.impact), ECHO.special.impactHeight));
    const hit = new PendingHit(this.boss, this.player, styleMethod(MAGIC), { delay: 0, rollAccuracy: false });
    hit.markProtectionBypassed();
    hit.setTotalDamage(damage);
    this.player.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle());
  }

  // ------------------------------------------------------------------ its prayer

  /** The player's hit about to land: the style it prays against does a quarter of its damage. */
  onHit(hit) {
    const style = this.styleOf(hit.getCombatType?.());
    if (!style) return;
    this.lastStyle = style;
    if (style !== this.protecting) return;
    for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * ECHO.overhead.protectedDamage));
    hit.updateTotalDamage();
  }

  prayAgainstLastStyle() {
    if (!this.lastStyle) return;
    this.protecting = this.lastStyle;
    this.boss.setHeadIcon(ECHO.overhead.icons[this.lastStyle]);
  }

  styleOf(type) {
    const { CombatType } = this.core;
    if (type === CombatType.MELEE) return "melee";
    if (type === CombatType.RANGED) return RANGED;
    if (type === CombatType.MAGIC) return MAGIC;
    return null;
  }

  // ------------------------------------------------------------------ helpers

  /** The style the player's protection prayer is against: ranged, magic, or null. */
  prayerStyle() {
    const { PrayerHandler } = this.core;
    if (PrayerHandler.isActivated(this.player, PrayerHandler.PROTECT_FROM_MAGIC)) return MAGIC;
    if (PrayerHandler.isActivated(this.player, PrayerHandler.PROTECT_FROM_MISSILES)) return RANGED;
    return null;
  }

  playerPresent() {
    const player = this.player;
    return player.isRegistered?.() !== false && player.getHitpoints() > 0
      && player.getPrivateArea?.() === this.session.area && Common.inLair(player.getLocation());
  }

  mapGraphic(graphicId, x, y) {
    const { Graphic, Location } = this.core;
    if (!Number.isInteger(graphicId) || graphicId < 0) return;
    this.player.getPacketSender().sendGraphic(new Graphic(graphicId), new Location(x, y, 0));
  }

  sound(soundId, delay = 0) {
    this.player.getPacketSender().sendSoundEffect(soundId, 1, delay, 255);
  }
}

/** The Echo appears: its fight, run on its own tick task for the session. */
function begin(session, boss) {
  const fight = new EchoFight(session, boss);
  session.fight = fight;
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      if (fight.stopped || session.ended) {
        fight.stop();
        this.stop();
        return;
      }
      fight.process();
    }
  })());
  fight.start();
  return fight;
}

module.exports = { begin, EchoFight, specialDamage, specialFlightCycles, shotMultiplier, setStyles, distanceToFootprint };
