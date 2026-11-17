/**
 * One Grotesque Guardians fight (Wiki: Grotesque Guardians/Strategies, Dusk, Dawn):
 * - phase 1: only Dawn can be hurt; Dusk, defensive, takes nothing. At half health (225) Dawn
 *   flies up;
 * - phase 2: Dusk alone, rocks falling from Dawn in the sky (3x3, up to 22, a direct hit stuns
 *   for 10 ticks); at half health Dusk turns defensive again and Dawn comes down;
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
      this.dawn.getCombat?.().reset?.();
      this.dawn.performAnimation(new Common.core.Animation(ids.seqs.dawnFlyUp));
      this.changeForm(this.dawn, "dawnFlying");
      this.changeForm(this.dusk, "duskPhase2");
      return true;
    }
    if (this.phase === 2 && this.dusk.getHitpoints() <= this.phaseThreshold(this.dusk)) {
      this.phase = 3;
      this.rocks = [];
      this.changeForm(this.dusk, "duskPhase3");
      this.changeForm(this.dawn, "dawnPhase3");
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
    if (this.phase === 2 && this.tickCount % Common.data.rockfall.every === 0 && players[0]) this.dropRocks(players[0]);
    if (this.phase === 3) this.tickLightning(players);
    this.tickRocks(players);
    this.tickTrample(players);
    this.tickVortices(players);
    this.tickSpheres(players);
    this.tickPrison(players);
    this.lockHitpoints();
  }

  // --- Phase 2: rockfall

  dropRocks(target) {
    const { rockfall } = Common.data;
    const base = target.getLocation();
    const lands = this.tickCount + rockfall.warnTicks;
    const tiles = [base];
    for (let attempt = 0; tiles.length < rockfall.rocks && attempt < 40; attempt++) {
      const tile = base.transform(Common.randomInt(-5, 5), Common.randomInt(-5, 5));
      if (this.roof.contains(tile)) tiles.push(tile);
    }
    for (const tile of tiles) {
      Common.tileGraphic(this.roof.players(), tile, Common.ids.spotanims.debris);
      this.rocks.push({ tile, lands });
    }
  }

  tickRocks(players) {
    if (this.rocks.length === 0) return;
    const { rockfall } = Common.data;
    const landing = this.rocks.filter((rock) => rock.lands <= this.tickCount);
    for (const rock of landing) {
      Common.tileGraphic(players, rock.tile, Common.ids.spotanims.falling);
      for (const player of players) {
        const distance = Common.chebyshev(player.getLocation(), rock.tile);
        if (distance > 1) continue;
        Common.hurtPlayer(player, Common.randomInt(0, rockfall.max));
        if (distance === 0) {
          bind(player, rockfall.stunTicks);
          player.sendMessage(Common.message("knockedOut"));
        }
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
