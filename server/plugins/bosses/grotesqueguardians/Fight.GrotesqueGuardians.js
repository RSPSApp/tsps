/**
 * One Grotesque Guardians fight (Wiki: Grotesque Guardians/Strategies, Dusk, Dawn):
 * - phase 1: only Dawn can be hurt; Dusk, defensive, takes nothing. At half health (225) Dawn
 *   flies up and off the roof;
 * - phase 2: Dusk alone, rocks falling from Dawn in the sky every 15 to 30 ticks (3x3, up to 22,
 *   a direct hit stuns for 10 ticks; 6 to 9 ticks to land); at half health Dusk turns defensive
 *   again and Dawn comes down;
 * - phase 3: lightning across the roof (5-10 a vortex, one always on the player), then Dawn sends
 *   three energy spheres that heal her 90 each unless the player walks into them;
 * - phase 4, once Dawn is finished with a hammer: Dusk takes in her essence and fights alone,
 *   imprisoning the player in a cell of fire now and then - one gap out, up to 65 on whoever is
 *   still inside after 5 ticks, healing Dusk (who can't be hurt during the first one);
 * - standing under Dusk while he fights alone (phases 2 and 4) gets the player trampled for 30-40;
 * - both are finished with a rock hammer at 9 hitpoints or below (Finishers.Slayer.js).
 * Combat.GrotesqueGuardians.js picks each attack; this runs the phases and the roof's hazards.
 */
const Common = require("./Common.GrotesqueGuardians");

class Fight {
  constructor(roof, dusk, dawn, random = Math.random) {
    this.roof = roof;
    this.dusk = dusk;
    this.dawn = dawn;
    this.random = random;
    this.phase = 1;
    this.tickCount = 0;
    this.rocks = [];
    /** Phase 2: the ticks Dawn took off and of the next rockfall. */
    this.dawnLeft = 0;
    this.nextRockfall = Infinity;
    this.vortices = [];
    this.spheres = [];
    this.prison = null;
    this.prisons = 0;
    this.lightningUntil = 0;
    this.stopped = false;
    this.attacks = { dusk: 0, dawn: 0 };
    this.lastTrample = -Infinity;
    dusk.__ggFight = this;
    dawn.__ggFight = this;
    this.lockHitpoints();
  }

  // --- Who can be hurt

  /** Whether a hit on this guardian lands at all (before the weapon rules). */
  vulnerable(npc) {
    if (npc === this.dawn) return this.phase === 1 || (this.phase === 3 && this.tickCount >= this.lightningUntil);
    if (npc === this.dusk) return this.phase === 2 || (this.phase === 4 && !(this.prisons === 1 && this.prison));
    return false;
  }

  /**
   * A Guardian that can't be hurt keeps its hitpoints whatever reaches it - recoil, vengeance and
   * thralls skip the hit hook (Roof.GrotesqueGuardians.js) that blocks ordinary hits.
   */
  lockHitpoints() {
    for (const npc of [this.dusk, this.dawn]) npc.setHitpointsLocked?.(!this.stopped && !this.vulnerable(npc));
  }

  // --- Phases

  /** Called after hits: Dawn flying off at half health, then Dusk turning defensive. */
  checkPhase() {
    const { ids, data } = Common;
    if (this.phase === 1 && this.dawn.getHitpoints() <= this.phaseThreshold(this.dawn)) {
      this.phase = 2;
      this.dawnLeft = this.tickCount;
      this.nextRockfall = this.tickCount + data.rockfall.firstAfter;
      this.dawn.getCombat?.().reset?.();
      this.dawn.setUntargetable?.(true);
      this.changeForm(this.dawn, "dawnFlying");
      this.changeForm(this.dusk, "duskPhase2");
      return true;
    }
    if (this.phase === 2 && this.dusk.getHitpoints() <= this.phaseThreshold(this.dusk)) {
      this.phase = 3;
      this.rocks = [];
      this.changeForm(this.dusk, "duskPhase3");
      this.changeForm(this.dawn, "dawnPhase3");
      this.landDawn();
      this.dawn.performAnimation(new Common.core.Animation(ids.seqs.dawnFlyDown));
      this.lightningUntil = this.tickCount + data.lightning.ticks;
      return true;
    }
    return false;
  }

  phaseThreshold(npc) { return this.roof.echo ? Math.floor(npc.getMaxHitpoints() / 2) :
    Common.data.phases[npc === this.dawn ? "dawnFliesBelow" : "dawnReturnsBelow"]; }
  changeForm(npc, ordinary) {
    if (this.roof.form) this.roof.form(npc, ordinary);
    else npc.setNpcTransformationId(Common.ids.npcs[ordinary]);
  }

  /** Phase 2: Dawn climbs into the sky and is gone from the roof until she comes back. */
  tickDawnFlight() {
    if (this.phase !== 2) return;
    const { upAfter, goneAfter } = Common.data.dawnFlight;
    const since = this.tickCount - this.dawnLeft;
    if (since === upAfter) this.dawn.performAnimation(new Common.core.Animation(Common.ids.seqs.dawnFlyUp));
    if (since === goneAfter) this.dawn.setVisible?.(false);
  }

  /** Back down on the spot she took off from, in view and open to attack again. */
  landDawn() {
    this.dawn.moveTo?.(Common.toLocation(Common.data.roof.dawnPerch));
    this.dawn.setVisible?.(true);
    this.dawn.setUntargetable?.(false);
  }

  /** Dawn finished: Dusk takes in her essence and fights alone, opening with a prison. */
  dawnDied() {
    if (this.phase >= 4) return;
    const { ids } = Common;
    this.phase = 4;
    this.vortices = [];
    this.spheres = [];
    this.changeForm(this.dusk, "duskPhase4Spawn");
    this.dusk.performAnimation(new Common.core.Animation(ids.seqs.duskEnrage));
    Common.later(3, () => {
      if (this.stopped) return;
      this.changeForm(this.dusk, "duskPhase4");
      const target = this.roof.players()[0];
      if (target) this.imprison(target);
    });
  }

  // --- A tick

  tick(players) {
    if (this.stopped) return;
    this.tickCount += 1;
    this.checkPhase();
    // Dawn finished, whoever is credited with her death (Kills.GrotesqueGuardians.js also calls it);
    // at 0 hitpoints she waits for the rock hammer first.
    if (this.phase === 3 && this.dawn.getHitpoints() <= 0 && (this.dawn.isDyingFunction?.() || this.dawn.isRegistered?.() === false)) this.dawnDied();
    this.tickDawnFlight();
    if (this.phase === 2 && this.tickCount >= this.nextRockfall && players[0]) {
      this.nextRockfall = this.tickCount + Common.randomInt(...Common.data.rockfall.every);
      this.dropRocks(players[0]);
    }
    if (this.phase === 3) this.tickLightning(players);
    this.tickRocks(players);
    this.tickTrample(players);
    this.tickVortices(players);
    this.tickSpheres(players);
    this.tickPrison(players);
    this.lockHitpoints();
  }

  // --- Phase 2: rockfall

  /** A few rocks near the player, the rest anywhere on the roof; none is aimed at their tile. */
  dropRocks(target) {
    const { rockfall, roof } = Common.data;
    const base = target.getLocation();
    const [minX, maxX, minY, maxY] = roof.floor;
    const tiles = new Map();
    const fill = (count, pick) => {
      for (let attempt = 0; tiles.size < count && attempt < 60; attempt++) {
        const tile = pick();
        if (this.roof.contains(tile)) tiles.set(`${tile.getX()},${tile.getY()}`, tile);
      }
    };
    const near = () => Common.randomInt(-rockfall.aimedRange, rockfall.aimedRange);
    fill(rockfall.aimed, () => base.transform(near(), near()));
    fill(Common.randomInt(...rockfall.rocks), () => base.transform(
      Common.randomInt(minX, maxX) - base.getX(), Common.randomInt(minY, maxY) - base.getY()));
    for (const tile of tiles.values()) this.throwRock(tile, rockfall.speeds[Common.randomInt(0, rockfall.speeds.length - 1)]);
  }

  /** The shadow and sound on the tile, and the rock falling onto it. */
  throwRock(tile, speed) {
    const { rockfall } = Common.data;
    const { ids } = Common;
    const { Projectile } = Common.core;
    const start = Common.randomInt(...rockfall.startCycles);
    const players = this.roof.players();
    Common.tileGraphic(players, tile, ids.spotanims[speed.shadow], start - rockfall.startCycles[0]);
    for (const player of players) {
      player.getPacketSender().sendAreaSound(rockfall.sound, tile.getX(), tile.getY(), tile.getZ(), 1, speed.soundDelay, rockfall.soundRadius);
    }
    // It comes in from the tile to the south-west, as recorded.
    new Projectile(tile.transform(-1, -1), tile, null, ids.spotanims.falling, start, speed.endCycles,
      rockfall.startHeight, rockfall.endHeight, this.roof.area ?? null).withAngle(0).withProgress(0).sendProjectile();
    this.rocks.push({ tile, lands: this.tickCount + speed.ticks });
  }

  tickRocks(players) {
    if (this.rocks.length === 0) return;
    const { rockfall } = Common.data;
    const landing = this.rocks.filter((rock) => rock.lands <= this.tickCount);
    for (const rock of landing) {
      for (const player of players) {
        const distance = Common.chebyshev(player.getLocation(), rock.tile);
        if (distance > 1) continue;
        Common.hurtPlayer(player, Common.randomInt(0, rockfall.max));
        if (distance === 0) knockOut(player);
      }
    }
    this.rocks = this.rocks.filter((rock) => rock.lands > this.tickCount);
  }

  // --- Dusk alone: the trample

  /** Under Dusk's body while he fights alone: trampled (Wiki), now and then while it lasts. */
  tickTrample(players) {
    if (this.phase !== 2 && this.phase !== 4) return;
    const { trample } = Common.data;
    if (this.tickCount - this.lastTrample < trample.every || this.dusk.getHitpoints() <= 0) return;
    const base = this.dusk.getLocation();
    const size = Math.max(1, this.dusk.getSize?.() ?? 1);
    for (const player of players) {
      const at = player.getLocation();
      const under = at.getX() >= base.getX() && at.getX() < base.getX() + size && at.getY() >= base.getY() && at.getY() < base.getY() + size;
      if (!under) continue;
      this.lastTrample = this.tickCount;
      Common.hurtPlayer(player, Common.randomInt(trample.min, trample.max));
      player.sendMessage(Common.message("trampled"));
    }
  }

  // --- Phase 3: lightning, then the spheres

  tickLightning(players) {
    const { lightning } = Common.data;
    if (this.tickCount < this.lightningUntil) {
      if (this.tickCount % 2 === 0 && players[0]) {
        const base = players[0].getLocation();
        const lands = this.tickCount + lightning.warnTicks;
        this.vortices.push({ tile: base, lands });
        for (let i = 1; i < lightning.vortices; i++) {
          const tile = base.transform(Common.randomInt(-6, 6), Common.randomInt(-6, 6));
          if (this.roof.contains(tile)) this.vortices.push({ tile, lands });
        }
      }
      return;
    }
    if (this.tickCount === this.lightningUntil) this.sendSpheres();
  }

  tickVortices(players) {
    if (this.vortices.length === 0) return;
    const { lightning } = Common.data;
    for (const vortex of this.vortices.filter((v) => v.lands <= this.tickCount)) {
      Common.tileGraphic(players, vortex.tile, Common.ids.spotanims.lightning);
      for (const player of players) {
        if (Common.chebyshev(player.getLocation(), vortex.tile) <= 1) Common.hurtPlayer(player, Common.randomInt(lightning.min, lightning.max));
      }
    }
    this.vortices = this.vortices.filter((v) => v.lands > this.tickCount);
  }

  sendSpheres() {
    const { spheres } = Common.data;
    const centre = this.dawn.getLocation().transform(2, 2);
    this.spheres = [];
    for (let i = 0; i < spheres.count; i++) {
      const tile = centre.transform(Common.randomInt(-6, 6), Common.randomInt(-6, 6));
      if (!this.roof.contains(tile)) { i--; continue; }
      this.spheres.push({ tile, arrives: this.tickCount + spheres.ticks });
    }
    for (const sphere of this.spheres) Common.tileGraphic(this.roof.players(), sphere.tile, Common.ids.spotanims.sphere);
  }

  /** Walking into a sphere takes it; one left alone reaches Dawn and heals her. */
  tickSpheres(players) {
    if (this.spheres.length === 0) return;
    const left = [];
    for (const sphere of this.spheres) {
      const taker = players.find((player) => Common.chebyshev(player.getLocation(), sphere.tile) === 0);
      if (taker) {
        Common.tileGraphic(players, sphere.tile, Common.ids.spotanims.sphereImpact);
        taker.sendMessage(Common.message("sphere"));
        continue;
      }
      if (this.tickCount >= sphere.arrives) {
        if (this.dawn.getHitpoints() > 0) {
          const max = this.dawn.getMaxHitpoints?.() ?? 450;
          this.dawn.setHitpoints(Math.min(max, this.dawn.getHitpoints() + Common.data.spheres.heal));
        }
        continue;
      }
      left.push(sphere);
    }
    this.spheres = left;
  }

  // --- Phase 4: the prison

  /** A 5x5 wall of fire round the 3x3 cell, with one tile open. */
  imprison(target) {
    const { prison } = Common.data;
    const centre = target.getLocation();
    const ring = [];
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) ring.push([dx, dy]);
    const gap = ring[Math.floor(this.random() * ring.length)];
    this.prisons += 1;
    this.prison = { centre, gap: centre.transform(gap[0], gap[1]), closes: this.tickCount + prison.escapeTicks, target };
    this.dusk.performAnimation(new Common.core.Animation(Common.ids.seqs.forcefield));
    for (const [dx, dy] of ring) if (dx !== gap[0] || dy !== gap[1]) Common.tileGraphic(this.roof.players(), centre.transform(dx, dy), Common.ids.spotanims.enragedLightning);
  }

  /** Still inside when it closes: the hit heals Dusk. The opening itself is safe, even by a wall. */
  tickPrison() {
    const prison = this.prison;
    if (!prison || this.tickCount < prison.closes) return;
    this.prison = null;
    const at = prison.target.getLocation();
    if (Common.chebyshev(at, prison.centre) > 2 || (at.getX() === prison.gap.getX() && at.getY() === prison.gap.getY())) return;
    const damage = Common.hurtPlayer(prison.target, Common.randomInt(0, Common.data.prison.max));
    // Down to the hammer, he takes nothing back.
    if (this.dusk.getHitpoints() <= 0) return;
    const max = this.dusk.getMaxHitpoints?.() ?? 450;
    this.dusk.setHitpoints(Math.min(max, this.dusk.getHitpoints() + damage));
  }

  stop() {
    this.stopped = true;
    this.rocks = [];
    this.vortices = [];
    this.spheres = [];
    this.prison = null;
    this.lockHitpoints();
    if (this.dusk.__ggFight === this) this.dusk.__ggFight = null;
    if (this.dawn.__ggFight === this) this.dawn.__ggFight = null;
  }
}

/** A direct rock: stunned, with the circling stars, the block animation and the sound. */
function knockOut(player) {
  const { Animation, Graphic } = Common.core;
  const { rockfall } = Common.data;
  bind(player, rockfall.stunTicks);
  player.performGraphic(Graphic.delayed(Common.ids.spotanims.stunned, 0, rockfall.stunHeight));
  const block = player.getBlockAnim();
  if (block >= 0) player.performAnimation(new Animation(block));
  player.getPacketSender().sendSound(rockfall.stunSound, 1, 0);
  player.sendMessage(Common.message("knockedOut"));
}

/**
 * A stun or freeze: the player can't move for `ticks`. One that ends later takes over the release;
 * one ending sooner leaves it to the longer one. Counted in game ticks, never wall time.
 */
function bind(player, ticks) {
  const queue = player.getMovementQueue?.();
  if (!queue) return;
  const until = Common.core.World.getProcessCycle() + ticks;
  queue.reset?.();
  queue.setBlockMovement?.(true);
  if ((player.__ggBound?.until ?? -1) >= until) return;
  const bound = { until };
  player.__ggBound = bound;
  Common.later(ticks, () => {
    if (player.__ggBound !== bound) return;
    player.__ggBound = null;
    if (player.getHitpoints?.() <= 0) return;
    queue.setBlockMovement?.(false);
  });
}

module.exports = { Fight, bind };
