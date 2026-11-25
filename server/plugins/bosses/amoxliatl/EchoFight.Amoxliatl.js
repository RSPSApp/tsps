"use strict";

/**
 * The Leagues VI Echo Amoxliatl's fight, as recorded (rsprox.net 1140, rev 237.1: 7 Echoes, 6
 * kills; docs/amoxliatl.md). The normal fight (Fight.Amoxliatl) still runs her rising, HUD, pools'
 * clearing and death; her turns are her own, on the fight's clock (data `echo`):
 * - Every 4 ticks from 4 after she rises: two magic shots that land 3 and 4 ticks later, and the
 *   next tick a black icicle at the tile the player stood on, landing 2 ticks after that. Its tile
 *   and the floor 2-4 steps out (not the 8 tiles around it) take 18-26, and an icy pool forms.
 * - The first turn at or below 520 hitpoints, and again at 250, is a phase cast: spikes on every
 *   floor tile within 2 steps of the player, prayers off the next tick, and 3 ticks later the hit
 *   and a pool on each tile. The turn after it comes 5 ticks later.
 * - From the second cast (the enrage): only the icicle, every 2 ticks.
 * - A pool hurts from its second tick, 7-15 a tick, and goes after 100 ticks.
 * Her hazards are her hits (Fight.hurtPlayer): on live, Thorns answers the icicle and the pools as
 * it does her shots.
 */
const Common = require("./Common.Amoxliatl");
const { Fight, begin: beginFight, onFloor, floorTiles, key, magicStyle } = require("./Fight.Amoxliatl");

const ECHO = () => Common.data.echo;

const ids = new Map();
/** A gameval name in the data, resolved in the cache (a missing one fails loudly). */
function id(kind, name) {
  const cacheKey = `${kind}:${name}`;
  if (!ids.has(cacheKey)) {
    const { CacheDefinitions } = Common.core;
    const resolved = { spotanim: CacheDefinitions.getSpotanimId, seq: CacheDefinitions.getSeqId, loc: CacheDefinitions.getLocId }[kind].call(CacheDefinitions, name);
    if (!Number.isInteger(resolved)) throw new Error(`Echo Amoxliatl: no ${kind} named ${name}`);
    ids.set(cacheKey, resolved);
  }
  return ids.get(cacheKey);
}

/** The recorded heights are the wire's; PacketSender.sendProjectile multiplies by 4. */
const engineHeight = (wire) => wire / 4;

const steps = ([ax, ay], [bx, by]) => Math.abs(ax - bx) + Math.abs(ay - by);
const near = ([ax, ay], [bx, by]) => Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= 1;

/** The icicle's spikes: its tile, then every floor tile 2-4 steps out but not next to it, with the step count. */
function spikeTiles(centre) {
  const { reach } = ECHO().spikes;
  const tiles = [{ tile: centre, steps: 0 }];
  for (const tile of floorTiles()) {
    const count = steps(tile, centre);
    if (count >= 2 && count <= reach && !near(tile, centre)) tiles.push({ tile, steps: count });
  }
  return tiles;
}

/** A phase cast's tiles: every floor tile within its reach of the player. */
function phaseTiles(centre) {
  const { reach } = ECHO().phase;
  return floorTiles().filter((tile) => steps(tile, centre) <= reach);
}

class EchoFight extends Fight {
  constructor(session, boss) {
    super(session, boss);
    /** 0 before the first phase cast, 1 after it, 2 in the enrage. */
    this.phase = 0;
    /** key(x, y) -> the tick its pool formed. */
    this.poolTicks = new Map();
  }

  start() {
    super.start();
    this.at(ECHO().turns.first, () => this.turn());
  }

  /** The combat engine's turn does nothing: hers run on the fight's clock. */
  attack() {
    return [];
  }

  turn() {
    if (this.stopped || this.over) return;
    const { turns, phases } = ECHO();
    const hitpoints = this.boss.getHitpoints();
    if (this.phase === 0 && hitpoints <= phases.first.hitpoints) {
      this.phase = 1;
      this.phaseCast(phases.first.say);
      this.at(turns.afterPhase, () => this.turn());
    } else if (this.phase === 1 && hitpoints <= phases.second.hitpoints) {
      this.phase = 2;
      this.phaseCast(phases.second.say);
      this.at(turns.afterPhase, () => this.turn());
    } else if (this.phase === 2) {
      this.enrageTurn();
      this.at(turns.enrageEvery, () => this.turn());
    } else {
      this.standardTurn();
      this.at(turns.every, () => this.turn());
    }
  }

  sound({ id: soundId, delay = 0 }) {
    this.player.getPacketSender().sendSoundEffect(soundId, 1, delay);
  }

  // ------------------------------------------------------------------ her turns

  standardTurn() {
    const { Animation } = this.core;
    const { standard, icicle } = ECHO();
    this.boss.performAnimation(new Animation(id("seq", standard.seq)));
    for (const sound of standard.sounds) this.sound(sound);
    const shot = standard.shot;
    shot.arcs.forEach((arc, index) => {
      this.projectile(shot.spotanim, this.core.Projectile.centreOf(this.boss), this.player.getLocation(), this.player, arc.delay, arc.end, shot);
      this.at(shot.landTicks[index], () => this.shotLands());
    });
    const tile = this.playerTile();
    this.at(icicle.sendTicks, () => this.sendIcicle(tile));
  }

  enrageTurn() {
    const { Animation } = this.core;
    const { enrage, icicle } = ECHO();
    this.boss.performAnimation(new Animation(id("seq", enrage.seq)));
    this.sound(enrage.sound);
    const tile = this.playerTile();
    this.at(icicle.sendTicks, () => this.sendIcicle(tile));
  }

  phaseCast(line) {
    const { Animation, PrayerHandler } = this.core;
    const { phase } = ECHO();
    this.boss.performAnimation(new Animation(id("seq", phase.seq)));
    this.say(line);
    this.sound({ id: phase.sound });
    const tiles = phaseTiles(this.playerTile());
    for (const tile of tiles) Common.tileGraphic(this.player, this.session.tile([...tile, 0]), id("spotanim", phase.spotanim));
    this.at(phase.disableTicks, () => {
      if (this.over) return;
      PrayerHandler.deactivatePrayers(this.player);
      this.player.sendMessage(phase.message);
    });
    this.at(phase.landTicks, () => {
      if (this.over) return;
      if (this.playerOn(tiles)) this.hurtPlayer(Common.randomInt(...ECHO().icicle.damage));
      for (const [x, y] of tiles) this.placePool(x, y, false);
      Common.areaSound(this.player, Common.data.pools.sound, this.session.tile(Common.data.arena.centre));
    });
  }

  /** A magic shot lands: rolled like any magic attack, so Protect from Magic blocks it. */
  shotLands() {
    if (this.over || this.player.getHitpoints() <= 0) return;
    const { CombatFactory, PendingHit, World } = this.core;
    const hit = new PendingHit(this.boss, this.player, magicStyle(), { delay: 0 });
    CombatFactory.applyStyleDamage(hit, ECHO().standard.shot.maxHit);
    this.player.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle());
  }

  // ------------------------------------------------------------------ the black icicle

  sendIcicle(tile) {
    if (this.over) return;
    const { icicle } = ECHO();
    const at = this.session.tile([...tile, 0]);
    const spec = icicle.projectile;
    this.projectile(spec.spotanim, this.core.Projectile.centreOf(this.boss), at, null, spec.delay, spec.end, spec);
    Common.tileGraphic(this.player, at, id("spotanim", icicle.impact.spotanim), icicle.impact.delay);
    Common.tileGraphic(this.player, at, id("spotanim", icicle.shadow));
    this.at(icicle.landTicks, () => this.icicleLands(tile));
  }

  icicleLands(centre) {
    if (this.over) return;
    const { icicle, spikes } = ECHO();
    const spiked = spikeTiles(centre);
    const spotanim = id("spotanim", spikes.spotanim);
    for (const { tile, steps: count } of spiked) {
      Common.tileGraphic(this.player, this.session.tile([...tile, 0]), spotanim, count * spikes.delayPerStep);
    }
    // The player's tile now is where they stood as the last tick ended (this runs before their step).
    if (this.playerOn(spiked.map(({ tile }) => tile))) this.hurtPlayer(Common.randomInt(...icicle.damage));
    else this.sound({ id: icicle.missSound });
    this.placePool(centre[0], centre[1], false);
    Common.areaSound(this.player, Common.data.pools.sound, this.session.tile(Common.data.arena.centre));
  }

  // ------------------------------------------------------------------ the pools

  placePool(x, y, playSound = true) {
    if (this.stopped || this.over || !onFloor(x, y) || this.pools.has(key(x, y))) return false;
    const { GameObject, ObjectManager } = this.core;
    const { pools } = ECHO();
    const tile = this.session.tile([x, y, 0]);
    if (this.core.RegionManager.blocked(tile, this.session.area)) return false;
    const pool = new GameObject(id("loc", pools.loc), tile, pools.shape, Common.randomInt(0, 3), this.session.area);
    ObjectManager.register(pool, true);
    this.pools.set(key(x, y), pool);
    this.poolTicks.set(key(x, y), this.tick);
    if (playSound) Common.areaSound(this.player, Common.data.pools.sound, this.session.tile(Common.data.arena.centre));
    this.at(pools.lifetimeTicks, () => this.removePool(x, y, pool));
    return true;
  }

  removePool(x, y, pool) {
    if (this.pools.get(key(x, y)) !== pool) return;
    this.pools.delete(key(x, y));
    this.poolTicks.delete(key(x, y));
    if (this.player.isRegistered()) Common.tileGraphic(this.player, pool.getLocation(), id("spotanim", ECHO().pools.clearSpotanim));
    this.core.ObjectManager.deregister(pool, true);
  }

  poolDamage() {
    const [x, y] = this.playerTile();
    const formed = this.poolTicks.get(key(x, y));
    if (formed === undefined || this.tick - formed < ECHO().pools.hurtFromTicks || this.player.getHitpoints() <= 0) return;
    this.hurtPlayer(Common.randomInt(...ECHO().pools.damage));
  }

  clearPools(puff = true) {
    const { ObjectManager } = this.core;
    for (const pool of this.pools.values()) {
      if (puff && this.player.isRegistered()) Common.tileGraphic(this.player, pool.getLocation(), id("spotanim", ECHO().pools.clearSpotanim));
      ObjectManager.deregister(pool, true);
    }
    this.pools.clear();
    this.poolTicks.clear();
  }

  // ------------------------------------------------------------------ helpers

  playerOn(tiles) {
    const [px, py] = this.playerTile();
    return tiles.some(([x, y]) => x === px && y === py);
  }

  projectile(name, from, to, lockon, delay, end, arc) {
    const { Projectile } = this.core;
    new Projectile(from, to, lockon, id("spotanim", name), delay, end, engineHeight(arc.startHeight), engineHeight(arc.endHeight), this.session.area)
      .withAngle(arc.angle)
      .withProgress(arc.progress)
      .sendProjectile();
  }
}

/** The Echo rises: her fight for the session. */
function begin(session, boss) {
  return beginFight(session, boss, EchoFight);
}

module.exports = { begin, EchoFight, spikeTiles, phaseTiles };
