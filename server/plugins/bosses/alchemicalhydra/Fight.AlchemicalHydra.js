/**
 * One Alchemical Hydra fight (Wiki: Alchemical Hydra, /Strategies):
 * - four phases, at 825, 550 and 275 hitpoints a head falls off and it changes form
 *   (serpentine -> electric -> flame -> enraged); each of the first three starts with 75% damage
 *   reduction, lost when the Hydra stands by its phase's chemical vent as the vents erupt (red for
 *   serpentine, green for electric, blue for flame); the wrong vent empowers it instead;
 * - its attacks are counted per phase: three auto-attacks, then the phase's special, then one
 *   every nine (the enraged phase repeats the poison);
 * - poison: blobs land in 3x3 splashes (up to 7, and poison 6 for the one aimed at the player,
 *   4 otherwise), leaving pools that hit for up to 12 a tick to whoever stands in them;
 * - lightning: four currents from the room's corners close in on the player; one reaching them
 *   hits for up to 22 and binds them; a phase change dissipates them;
 * - fire: walls of fire to the player's sides, then a tracking fire that follows them: up to 25,
 *   then a burn of 5 five times; the Hydra idles for seven ticks after;
 * - its death or the player leaving clears every pool, current and fire.
 * Combat.AlchemicalHydra.js picks each attack; this keeps the count and runs the rest.
 */
const Common = require("./Common.AlchemicalHydra");

const PHASES = () => Common.data.phases;

class Fight {
  constructor(lair, npc, random = Math.random) {
    this.lair = lair;
    this.npc = npc;
    this.random = random;
    this.phase = 0;
    this.attacks = 0;
    this.basics = 0;
    this.style = "ranged";
    this.shielded = true;
    this.empowered = false;
    this.transitionUntil = 0;
    this.tickCount = 0;
    this.pools = [];
    this.currents = [];
    this.walls = [];
    this.trackers = [];
    this.burns = [];
    this.stopped = false;
    npc.__hydraFight = this;
  }

  get enraged() {
    return this.phase === 3;
  }

  // --- The attack count

  /** The attack the count says comes next: "special" or a basic style. */
  nextAttack() {
    const { specialAfter, specialEvery, styleSwitchEvery } = Common.data.combat;
    const n = this.attacks + 1;
    if (n > specialAfter && (n - specialAfter - 1) % specialEvery === 0) return "special";
    const every = this.enraged ? 1 : styleSwitchEvery;
    if (this.basics > 0 && this.basics % every === 0) return this.style === "ranged" ? "magic" : "ranged";
    return this.style;
  }

  counted(kind) {
    this.attacks += 1;
    if (kind === "special") return;
    this.style = kind;
    this.basics += 1;
  }

  transitioning() {
    return this.tickCount < this.transitionUntil;
  }

  // --- Phases and vents

  /** Past this phase's threshold, a head falls and the next form comes (one a tick at most). */
  checkPhase() {
    if (this.enraged || this.stopped || this.transitioning()) return false;
    const below = PHASES()[this.phase].below;
    if (this.npc.getHitpoints() > below) return false;
    this.changePhase();
    return true;
  }

  changePhase() {
    const { ids } = Common;
    const transitions = [ids.npcs.toElectric, ids.npcs.toFlame, ids.npcs.toEnraged];
    const from = this.phase;
    this.npc.setNpcTransformationId(transitions[from]);
    this.npc.performAnimation(new Common.core.Animation(ids.seqs.phaseOut[from]));
    this.transitionUntil = this.tickCount + Common.data.combat.phaseChangeTicks;
    this.currents = [];
    this.phase = from + 1;
    this.attacks = 0;
    this.basics = 0;
    this.shielded = !this.enraged && this.phase < 3;
    this.empowered = false;
    if (this.enraged) this.style = this.style === "ranged" ? "magic" : "ranged";
    Common.later(Common.data.combat.phaseChangeTicks, () => {
      if (this.stopped) return;
      this.npc.setNpcTransformationId(Common.phaseForms()[this.phase]);
      this.npc.performAnimation(new Common.core.Animation(ids.seqs.phaseIn[from]));
    });
  }

  /** Every few ticks the vents erupt: by its own vent the Hydra loses its shield, by another it rages. */
  eruptVents(players) {
    const want = PHASES()[this.phase].vent;
    for (const [colour, tile] of Object.entries(Common.data.vents)) {
      const near = Common.distanceToFootprint(Common.toLocation(tile), this.npc) <= Common.data.combat.ventRange;
      if (!near) continue;
      if (colour === want && this.shielded) {
        this.shielded = false;
        this.empowered = false;
        this.npc.forceChat?.(Common.message("roar"));
        for (const player of players) player.sendMessage(Common.message("weakened"));
      } else if (colour !== want && want && this.shielded) {
        this.empowered = true;
        for (const player of players) player.sendMessage(Common.message("empowered"));
      }
    }
  }

  /**
   * The most a hit can take off the player: 35, 52 while an incorrect vent empowers it (up
   * to 50% more, the Wiki's infobox's 35 -> 52), 55 once enraged.
   */
  maxHit() {
    const { combat } = Common.data;
    if (this.enraged) return combat.enragedMaxHit;
    return this.empowered ? combat.empoweredMaxHit : combat.maxHit;
  }

  /** onNpcHitModify: 75% less damage while shielded (the enraged form keeps no shield). */
  reduce(damage) {
    if (!this.shielded || this.enraged) return damage;
    return Math.floor(damage * Common.data.combat.shieldedDamage);
  }

  // --- A tick

  tick(players) {
    if (this.stopped) return;
    this.tickCount += 1;
    if (this.npc.isDyingFunction?.() || this.npc.getHitpoints() <= 0) {
      this.clear();
      return;
    }
    this.checkPhase();
    if (this.tickCount % Common.data.combat.ventEvery === 0) this.eruptVents(players);
    this.tickPools(players);
    this.tickCurrents(players);
    this.tickFire(players);
  }

  // --- Poison

  spitPoison(target) {
    const { poison } = Common.data;
    const count = this.enraged ? poison.enragedBlobs : poison.blobs;
    const base = target.getLocation();
    const tiles = [base];
    for (let attempt = 0; tiles.length < count && attempt < 30; attempt++) {
      const tile = base.transform(Common.randomInt(-poison.spread, poison.spread), Common.randomInt(-poison.spread, poison.spread));
      if (!this.lair.contains(tile) || tiles.some((other) => sameTile(other, tile))) continue;
      tiles.push(tile);
    }
    const { Projectile } = Common.core;
    tiles.forEach((tile, index) => {
      new Projectile(Projectile.centreOf(this.npc), tile, null, Common.ids.spotanims.poisonFlight, 0, poison.landDelay * 30, 90, 0, this.npc.getPrivateArea?.() ?? null).sendProjectile();
      Common.later(poison.landDelay, () => this.landPoison(tile, index === 0 ? target : null));
    });
  }

  landPoison(centre, aimedAt) {
    if (this.stopped) return;
    const { poison } = Common.data;
    const players = this.lair.players();
    Common.tileGraphic(players, centre, Common.ids.spotanims.poisonSplash);
    for (const player of players) {
      if (chebyshev(player.getLocation(), centre) > 1) continue;
      Common.hurtPlayer(player, Common.randomInt(0, poison.splashMax), true);
      // Severity, hit x 5: the Wiki's hits are 6 on the target and 4 beside it (Alchemical Hydra/Strategies). No recording.
      Common.core.CombatFactory.poisonEntity(player, (player === aimedAt ? poison.poisonTargeted : poison.poisonNear) * 5);
    }
    const until = this.tickCount + poison.poolTicks;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tile = centre.transform(dx, dy);
        if (this.lair.contains(tile)) this.pools.push({ tile, until });
      }
    }
    Common.tileGraphic(players, centre, Common.ids.spotanims.poisonPool);
  }

  tickPools(players) {
    if (this.pools.length === 0) return;
    const { poolMax } = Common.data.poison;
    for (const player of players) {
      if (this.pools.some((pool) => sameTile(pool.tile, player.getLocation()))) {
        Common.hurtPlayer(player, Common.randomInt(1, poolMax), true);
      }
    }
    this.pools = this.pools.filter((pool) => this.tickCount < pool.until);
  }

  // --- Lightning

  castLightning() {
    const { lightning } = Common.data;
    const until = this.tickCount + lightning.lifetime;
    this.currents = Common.data.room.corners.slice(0, lightning.currents).map(([x, y]) => ({ x, y, until }));
    Common.tileGraphic(this.lair.players(), this.npc.getLocation(), Common.ids.spotanims.lightningCaster);
  }

  tickCurrents(players) {
    if (this.currents.length === 0) return;
    const target = players[0];
    if (!target) return;
    const { lightning } = Common.data;
    const at = target.getLocation();
    const left = [];
    for (const current of this.currents) {
      if (this.tickCount >= current.until) continue;
      current.x += Math.sign(at.getX() - current.x);
      current.y += Math.sign(at.getY() - current.y);
      const tile = new Common.core.Location(current.x, current.y, at.getZ());
      Common.tileGraphic(players, tile, Common.ids.spotanims.lightning);
      if (current.x === at.getX() && current.y === at.getY()) {
        Common.hurtPlayer(target, Common.randomInt(0, lightning.max));
        Common.tileGraphic(players, tile, Common.ids.spotanims.shock);
        bind(target, lightning.bindTicks);
        continue;
      }
      left.push(current);
    }
    this.currents = left;
  }

  // --- Fire

  breatheFire(target) {
    const { fire } = Common.data;
    const at = target.getLocation();
    const centre = this.npc.getLocation().transform(Math.floor(this.npc.getSize() / 2), Math.floor(this.npc.getSize() / 2));
    const horizontal = Math.abs(at.getX() - centre.getX()) >= Math.abs(at.getY() - centre.getY());
    const half = Math.floor(fire.wallLength / 2);
    const until = this.tickCount + fire.wallTicks;
    for (const side of [-2, 2]) {
      for (let k = -half; k <= half; k++) {
        const tile = horizontal ? at.transform(k, side) : at.transform(side, k);
        if (this.lair.contains(tile)) this.walls.push({ tile, until });
      }
    }
    for (const wall of this.walls) Common.tileGraphic(this.lair.players(), wall.tile, Common.ids.spotanims.fire);
    this.trackers.push({ x: centre.getX(), y: centre.getY(), until: this.tickCount + 1 + fire.trackTicks, target });
    this.npc.getCombat().setAttackDelay?.(fire.idleAfter);
  }

  tickFire(players) {
    const { fire } = Common.data;
    if (this.walls.length > 0) {
      for (const player of players) {
        if (this.walls.some((wall) => sameTile(wall.tile, player.getLocation()))) Common.hurtPlayer(player, fire.wallDamage);
      }
      this.walls = this.walls.filter((wall) => this.tickCount < wall.until);
    }
    const left = [];
    for (const tracker of this.trackers) {
      if (this.tickCount >= tracker.until || !tracker.target?.isRegistered?.()) continue;
      const at = tracker.target.getLocation();
      tracker.x += Math.sign(at.getX() - tracker.x);
      tracker.y += Math.sign(at.getY() - tracker.y);
      const tile = new Common.core.Location(tracker.x, tracker.y, at.getZ());
      Common.tileGraphic(players, tile, Common.ids.spotanims.fireTravel);
      if (tracker.x === at.getX() && tracker.y === at.getY()) {
        Common.hurtPlayer(tracker.target, Common.randomInt(0, fire.trackMax));
        this.burns.push({ player: tracker.target, left: fire.burnHits, next: this.tickCount + 2 });
        continue;
      }
      left.push(tracker);
    }
    this.trackers = left;
    this.burns = this.burns.filter((burn) => {
      if (this.tickCount < burn.next) return true;
      Common.hurtPlayer(burn.player, fire.burnDamage);
      burn.left -= 1;
      burn.next = this.tickCount + 2;
      return burn.left > 0;
    });
  }

  // --- The end

  clear() {
    this.pools = [];
    this.currents = [];
    this.walls = [];
    this.trackers = [];
    this.burns = [];
  }

  stop() {
    this.stopped = true;
    this.clear();
    if (this.npc.__hydraFight === this) this.npc.__hydraFight = null;
  }
}

function sameTile(a, b) {
  return a.getX() === b.getX() && a.getY() === b.getY();
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

/** A lightning hit holds the player in place for a few ticks; a later hit extends it. */
function bind(player, ticks) {
  const queue = player.getMovementQueue?.();
  if (!queue) return;
  const until = (player.__hydraBoundUntil ?? 0) > Date.now() ? player.__hydraBoundUntil : 0;
  player.__hydraBoundUntil = Math.max(until, Date.now() + ticks * 600);
  queue.reset?.();
  queue.setBlockMovement?.(true);
  Common.later(ticks, () => {
    if ((player.__hydraBoundUntil ?? 0) > Date.now() + 1) return;
    if (player.getHitpoints?.() <= 0 || player.isDyingFunction?.()) return;
    player.__hydraBoundUntil = 0;
    queue.setBlockMovement?.(false);
  });
}

module.exports = { Fight, chebyshev, bind };
