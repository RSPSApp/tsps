"use strict";

/**
 * The Doom's attacks: when it acts and what it does.
 *
 * Captures (delves 1-5; attack speed 6 at delves 1-2, 5 at 3-5):
 * - First attack 6 ticks after surfacing.
 * - Tongue (anim 12416) when the player stands next to it: the hit lands the next tick, and it
 *   acts again 4 ticks later.
 * - Orb (anim 12406): projectile 3380 (Ranged), 3379 (Magic) or, from delve 2, 3378 (Melee)
 *   from its centre, cycles 55 to 205 at delves 1-2, 175 at 3-4, 145 at 5, heights 387 to 100;
 *   it lands with graphic 2490 or 2492 (height 100).
 * - Rock throw (anim 12407): projectile 3384/3385 from its centre to the tile beside it towards
 *   the player, cycles 60 to 210, heights 340 to 500. Seven ticks later it bursts
 *   (DoomHazards.burstRock), and it acts again after twice its attack speed.
 * - Between rock throws, one to three orbs (or a throw at once).
 * - The melee charge: see CHARGE. About one throw in three charges.
 * - Larvae drop with about one attack in three at delve 1, one in six deeper.
 * - Shockwave: volatile earth appear 79-96 ticks into the fight (the timer stands still while
 *   the shield is up). The Doom keeps attacking until 15 ticks later: anim 12412, 12413 at 17, a
 *   slam (12414 with graphic 3370) at 19 and every 2 ticks after for each further shockwave, each
 *   landing 2 ticks after its slam with graphics over the whole floor; 12415 follows the last,
 *   and it acts again the tick after. Hits of 26-33 were seen.
 * - The rotation: from delve 3 the shield (DoomShield) at 75% (seen at 68%) once it has attacked
 *   twice; at delves 3-4 it breaks into a rock throw. At delve 5 it burrows instead (DoomBurrow),
 *   surfaces into volatile earth and the shockwave, then rock throws (one charged).
 * Wiki: orbs are rolled on impact, so prayer can be switched after the launch; the tongue hits
 * up to 40, halved by Protect from Melee; shockwaves hit 30-42 unless the player stands in the
 * earthen shield, one to five of them; no melee charge with the throws before a shockwave; only
 * a melee hit stops it, for a fifth of the Strength bonus; from delve 5 the shield comes two
 * attacks after each shockwave.
 * Guesses: shockwaves every 100 ticks after the first at delves 1-4; the red orb's impact
 * graphic (none); orbs landing at cycle 115 from delve 6.
 */

const Shared = require("./DoomShared");
const Delves = require("./DoomDelves");

const ANIM = {
  ORB: 12406, ROCK_THROW: 12407,
  BEAM_CHARGE: 12408, BEAM_LOOP: 12409, BEAM_CANCEL: 12410, BEAM_FIRE: 12411,
  AREA_CHARGE: 12412, AREA_LOOP: 12413, AREA_SLAM: 12414, AREA_RETURN: 12415,
  TONGUE: 12416,
};
const GFX = { AREA_SLAM: 3370, FLOOR_SLAM: [3405, 3406, 3407] };
const ORB = {
  ranged: { projectile: 3380, impact: 2490 },
  magic: { projectile: 3379, impact: 2492 },
  melee: { projectile: 3378, impact: -1 },
};
/** Capture: orbs land at cycle 205 at delves 1-2, 175 at 3-4, 145 at 5 (guess: 115 from 6). */
const ORB_END = [205, 205, 175, 175, 145, 115];
function orbFlight(level) {
  return { delay: 55, end: ORB_END[Math.min(level, ORB_END.length) - 1], startHeight: 387, endHeight: 100 };
}
const ROCK_LAUNCH = { ranged: 3384, magic: 3385 };
const ROCK_FLIGHT = { delay: 60, end: 210, startHeight: 340, endHeight: 500 };
const ROCK_BURST_TICKS = 7;
const SECOND_ROCK_TICKS = 3;

const FIRST_ATTACK_TICKS = 6;
const TONGUE_TICKS = 4;
const SHOCKWAVE = {
  first: [79, 96], every: 100,
  charge: 15, loop: 17, slam: 19, lands: 21, resume: 22, clear: 24,
  between: 2, damage: [26, 42],
};
/**
 * Capture: the melee charge starts 2 ticks after its rock throw (headbar 81 over 390 cycles,
 * headicon 6, anim 12408, then 12409 with graphic 3412 each tick) and fires 13 ticks later
 * (12411, hitting the next tick). A melee hit cancels it (12410), and the Doom acts again 7
 * ticks later at delves 1-2, 6 at 3-5. About one throw in three charges.
 */
const CHARGE = { chance: 1 / 3, delay: 2, ticks: 13, headIcon: 6, barCycles: 390 };
/** Capture: larvae drop with about one attack in three at delve 1, one in six deeper. */
const LARVA_CHANCE = { first: 0.3, deeper: 0.15 };
/** Capture: the shield comes up 2 ticks after its charge animation. */
const SHIELD_LEAD = 2;

let StyleMethod = null;

/** A combat method only so a PendingHit knows its style; the Doom's attacks are scripted here. */
function styleMethod(style) {
  if (!StyleMethod) {
    const { CombatMethod, CombatType } = Shared.core();
    StyleMethod = class extends CombatMethod {
      constructor(type) {
        super();
        this.stance = CombatType[type];
      }

      type() {
        return this.stance;
      }

      hits() {
        return [];
      }
    };
    StyleMethod.ranged = new StyleMethod("RANGED");
    StyleMethod.magic = new StyleMethod("MAGIC");
    StyleMethod.melee = new StyleMethod("MELEE");
  }
  return StyleMethod[style];
}

/** The Doom's own combat: nothing. Its attacks are the run's, never the engine's. */
function idleMethod() {
  const { CombatMethod, CombatType } = Shared.core();
  return class extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    canAttack() {
      return false;
    }

    attackDistance() {
      return 30;
    }

    hits() {
      return [];
    }
  };
}

/** Whether `tile` touches the side of the Doom's footprint (corners don't count). */
function besideBoss(boss, tile) {
  const at = boss.getLocation();
  const size = boss.getSize();
  const x = tile.getX();
  const y = tile.getY();
  const inX = x >= at.getX() && x < at.getX() + size;
  const inY = y >= at.getY() && y < at.getY() + size;
  return (inX && (y === at.getY() - 1 || y === at.getY() + size)) || (inY && (x === at.getX() - 1 || x === at.getX() + size));
}

/**
 * Where a thrown rock bursts: just outside the Doom, on the line from its centre to the
 * player. The capture's four throws all burst beside it towards the player; this line puts
 * them within a tile of where they did.
 */
function burstTile(boss, player) {
  const { Projectile } = Shared.core();
  const centre = Projectile.centreOf(boss);
  const p = player.getLocation();
  const dx = p.getX() - centre.getX();
  const dy = p.getY() - centre.getY();
  const reach = (boss.getSize() >> 1) + 1;
  const far = Math.max(Math.abs(dx), Math.abs(dy));
  if (far === 0) return { x: centre.getX(), y: centre.getY() - reach, z: 0 };
  const scale = reach / far;
  return { x: centre.getX() + Math.round(dx * scale), y: centre.getY() + Math.round(dy * scale), z: 0 };
}

class AttackCycle {
  constructor(run) {
    this.run = run;
    this.reset();
  }

  reset() {
    this.active = false;
    this.phase = "attacks";
    this.nextAt = Infinity;
    this.sinceRock = 0;
    this.rocksUp = 0;
    this.rockOrbsLandAt = 0;
    this.shockwave = null;
    this.nextShockwaveAt = Infinity;
    this.charge = null;
    this.attacksMade = 0;
    this.shielded = false;
    this.shieldFrom = 0;
    /** From delve 5: attacks left before the shield comes back (after each shockwave). */
    this.untilShield = null;
    this.tasks = new Set();
  }

  begin() {
    const ticks = this.run.ticks;
    this.active = true;
    this.nextAt = ticks + FIRST_ATTACK_TICKS;
    this.nextShockwaveAt = ticks + Shared.random(...SHOCKWAVE.first);
    this.sinceRock = 1;
  }

  stop() {
    this.active = false;
    for (const task of this.tasks) task.stop?.();
    this.tasks.clear();
    this.shockwave = null;
    this.charge = null;
    this.rocksUp = 0;
    this.rockOrbsLandAt = 0;
  }

  /** Runs `action` after `ticks`, unless the delve ends first. */
  after(ticks, action) {
    if (ticks <= 0) {
      if (this.active && this.run.stage === "fight") action();
      return;
    }
    const task = Shared.later(this.run, ticks, () => {
      this.tasks.delete(task);
      if (this.active && this.run.stage === "fight") action();
    });
    this.tasks.add(task);
  }

  get boss() {
    return this.run.boss;
  }

  get player() {
    return this.run.player;
  }

  tick() {
    if (!this.active) return;
    if (this.phase === "shield") {
      this.run.shield.tick();
      return;
    }
    if (this.phase === "burrow") {
      this.run.burrow.tick();
      return;
    }
    const ticks = this.run.ticks;
    if (!this.shockwave && ticks >= this.nextShockwaveAt) this.startShockwave();
    if (this.charge) this.chargeTick();
    if (ticks < this.nextAt || this.charge) return;
    if (this.shockwave && ticks >= this.shockwave.at + SHOCKWAVE.charge && ticks < this.shockwave.at + SHOCKWAVE.resume) return;
    if (this.shieldDue()) {
      this.raiseShield();
      return;
    }
    const hold = this.orbHold();
    if (hold > 0) {
      this.nextAt = ticks + hold;
      return;
    }
    this.attacksMade++;
    if (this.untilShield > 0) this.untilShield--;
    this.nextAt = ticks + this.attack();
    this.maybeLarvae();
  }

  maybeLarvae() {
    const chance = this.run.level === 1 ? LARVA_CHANCE.first : LARVA_CHANCE.deeper;
    if (this.run.random() >= chance) return;
    this.run.hazards.spawnLarva();
    // Wiki and capture: two at a time at delves 5-7.
    if (this.run.delve.pairs) this.run.hazards.spawnLarva({ beside: true });
  }

  /**
   * Wiki: from delve 3, at 75% or less after two attacks (once a delve at delves 3-4); from
   * delve 5 also two attacks after each shockwave. Never mid-shockwave or mid-charge.
   */
  shieldDue() {
    const delve = this.run.delve;
    const boss = this.boss;
    if (!delve.shield || this.shockwave || this.attacksMade < 2) return false;
    if (this.untilShield === 0) return true;
    return !this.shielded && boss.getHitpoints() <= boss.getMaxHitpoints() * 0.75;
  }

  raiseShield() {
    const { Animation } = Shared.core();
    this.shielded = true;
    this.untilShield = null;
    this.shieldFrom = this.run.ticks;
    // From delve 5 the shockwave comes from the rotation after each burrow, not a timer.
    if (this.run.delve.burrow) this.nextShockwaveAt = Infinity;
    this.phase = "shield";
    this.boss.performAnimation(new Animation(ANIM.BEAM_CHARGE));
    this.after(SHIELD_LEAD, () => this.run.shield.start());
  }

  /** Capture (delves 3-4): the shield breaks into a rock throw, and the Doom acts again after it. */
  resume() {
    this.phase = "attacks";
    // The shockwave's timer stands still while the shield is up.
    if (Number.isFinite(this.nextShockwaveAt)) this.nextShockwaveAt += this.run.ticks - this.shieldFrom;
    this.sinceRock = 0;
    this.rockThrow();
    this.nextAt = this.run.ticks + this.run.delve.speed * 2;
  }

  /** Surfaced after burrowing: volatile earth at once, the shockwave, then two attacks to the shield. */
  afterBurrow() {
    this.phase = "attacks";
    this.nextAt = this.run.ticks + this.run.delve.speed;
    this.startShockwave({ afterBurrow: true });
  }

  /** Picks and performs the next attack; returns the ticks until the one after. */
  attack() {
    const boss = this.boss;
    const player = this.player;
    if (besideBoss(boss, player.getLocation())) return this.tongue();
    const delve = this.run.delve;
    const wave = this.shockwave;
    // Capture: one to three orbs between rock throws (a throw at once now and then).
    const rock = this.sinceRock >= 3 || (this.sinceRock >= 1 && this.run.random() < 0.5);
    if (!rock) {
      this.sinceRock++;
      this.orb(this.pickOrbStyle());
      return delve.speed;
    }
    this.sinceRock = 0;
    this.rockThrow();
    // Wiki: never with the throws before a shockwave.
    if (!wave && this.run.random() < CHARGE.chance) this.after(CHARGE.delay, () => this.startCharge());
    return delve.speed * 2;
  }

  /**
   * Capture (delve 5): after a rock throw the next orb came 12 ticks on, not 10, landing after
   * the rock's last orb; the Wiki's changelog keeps them apart after a melee punish too. So an
   * attack waits while a rock is in the air, and until its orb would land after the rock's last.
   */
  orbHold() {
    if (besideBoss(this.boss, this.player.getLocation())) return 0;
    if (this.rocksUp > 0) return 1;
    const lands = this.run.ticks + Math.ceil(orbFlight(this.run.level).end / 30);
    return Math.max(0, this.rockOrbsLandAt + 1 - lands);
  }

  pickOrbStyle() {
    const styles = this.run.level >= 2 ? ["ranged", "magic", "melee"] : ["ranged", "magic"];
    return styles[Math.floor(this.run.random() * styles.length)];
  }

  // ---------------------------------------------------------------- the tongue and orbs

  /**
   * One blow from the Doom, rolled now against the player's defence. Protection prayers block
   * it, unless `halvedByPrayer` (the tongue), where Protect from Melee halves it.
   */
  strike(style, maxHit, delay, { halvedByPrayer = false } = {}) {
    const { CombatFactory, PendingHit } = Shared.core();
    const player = this.player;
    const hit = new PendingHit(this.boss, player, styleMethod(style), { delay, rollAccuracy: false });
    CombatFactory.applyStyleDamage(hit, maxHit, { bypassProtectionPrayer: halvedByPrayer });
    if (halvedByPrayer && Shared.isProtected(player, style)) {
      for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() / 2));
      hit.updateTotalDamage();
    }
    CombatFactory.addPendingHit(hit);
  }

  tongue() {
    const { Animation } = Shared.core();
    this.boss.performAnimation(new Animation(ANIM.TONGUE));
    this.strike("melee", Delves.MELEE_MAX_HIT, 1, { halvedByPrayer: true });
    return TONGUE_TICKS;
  }

  orb(style) {
    const { Animation } = Shared.core();
    const boss = this.boss;
    boss.performAnimation(new Animation(ANIM.ORB));
    const lands = Shared.projectile(this.run.area, boss, this.player, ORB[style].projectile, orbFlight(this.run.level));
    this.after(lands, () => this.orbLands(style));
  }

  /** Any orb that reaches the player: rolled now, so prayer switched in flight counts (Wiki). */
  orbLands(style) {
    const player = this.player;
    if (player.getHitpoints() <= 0) return;
    if (ORB[style].impact >= 0) player.performGraphic(Shared.gfx(ORB[style].impact, { height: 100 }));
    this.strike(style, this.run.delve.maxHit, 0);
  }

  /** A rock's orbs fly from one of its debris tiles, one tick apart (DoomHazards). */
  rockOrb(from, style, flight) {
    const lands = Shared.projectile(this.run.area, Shared.loc(from), this.player, ORB[style].projectile, flight);
    this.rockOrbsLandAt = Math.max(this.rockOrbsLandAt, this.run.ticks + lands);
    this.after(lands, () => this.orbLands(style));
  }

  // ---------------------------------------------------------------- rock throw

  /** A thrown rock came down and its orbs are on their way (DoomHazards). */
  rockLanded() {
    this.rocksUp = Math.max(0, this.rocksUp - 1);
  }

  /**
   * Wiki: from delve 8 two identical rocks, whose debris never overlap; the first rock's orbs
   * wait for the second to burst. Guess: the second is thrown 3 ticks after the first.
   */
  rockThrow() {
    const delve = this.run.delve;
    const style = this.run.random() < 0.5 ? "ranged" : "magic";
    if (delve.rockThrows < 2) {
      this.throwRock(style, { orbs: delve.rockOrbs });
      return;
    }
    let first = [];
    this.throwRock(style, { orbs: 0, landed: (tiles) => { first = tiles; } });
    this.after(SECOND_ROCK_TICKS, () => this.throwRock(style, { orbs: delve.rockOrbs * 2, exclude: () => first }));
  }

  throwRock(style, { orbs, exclude = () => [], landed = () => {} }) {
    const { Animation } = Shared.core();
    const boss = this.boss;
    const at = burstTile(boss, this.player);
    boss.performAnimation(new Animation(ANIM.ROCK_THROW));
    this.rocksUp++;
    Shared.projectile(this.run.area, boss, Shared.loc(at), ROCK_LAUNCH[style], ROCK_FLIGHT);
    this.after(ROCK_BURST_TICKS, () => landed(this.run.hazards.burstRock(at, style, { orbs, exclude: exclude() })));
  }

  // ---------------------------------------------------------------- the melee charge

  startCharge() {
    const { Animation } = Shared.core();
    if (this.phase !== "attacks" || this.charge) return;
    this.charge = { firesAt: this.run.ticks + CHARGE.ticks };
    this.boss.performAnimation(new Animation(ANIM.BEAM_CHARGE));
    this.boss.setHeadIcon?.(CHARGE.headIcon);
    Shared.chargeBar(this.boss, CHARGE.barCycles);
  }

  chargeTick() {
    if (this.run.ticks >= this.charge.firesAt) {
      this.fireBeam();
      return;
    }
    Shared.chargeLoop(this.boss);
  }

  get charging() {
    return !!this.charge;
  }

  endCharge() {
    if (this.charge) Shared.emptyChargeBar(this.boss);
    this.charge = null;
    this.boss?.setHeadIcon?.(-1);
  }

  /** A melee hit during the charge: it's stopped, for bonus damage, and holds its next attack. */
  punish(player) {
    const { Animation } = Shared.core();
    if (!this.charge) return 0;
    this.endCharge();
    this.run.punishedAt = this.run.ticks;
    this.boss.performAnimation(new Animation(ANIM.BEAM_CANCEL));
    // Capture: the next attack comes punishDelay - 1 ticks after the hit lands.
    this.nextAt = this.run.ticks + this.run.delve.punishDelay - 1;
    const strength = player.getBonusManager?.().getOtherBonus?.()[0] ?? 0;
    return Math.max(0, Math.floor(strength / 5));
  }

  /** Capture: the beam fires and hits the next tick. */
  fireBeam() {
    const { Animation } = Shared.core();
    this.endCharge();
    this.boss.performAnimation(new Animation(ANIM.BEAM_FIRE));
    this.after(1, () => this.run.hurt(this.run.delve.beam));
    this.nextAt = this.run.ticks + this.run.delve.speed;
  }

  // ---------------------------------------------------------------- shockwaves

  startShockwave({ afterBurrow = false } = {}) {
    const at = this.run.ticks;
    this.shockwave = { at, rocked: false, afterBurrow };
    this.run.hazards.spawnVolatileEarth();
    const { Animation } = Shared.core();
    const anim = (id) => () => this.boss?.performAnimation(new Animation(id));
    this.after(SHOCKWAVE.charge, anim(ANIM.AREA_CHARGE));
    this.after(SHOCKWAVE.loop, anim(ANIM.AREA_LOOP));
    this.after(SHOCKWAVE.slam, () => {
      this.boss?.performAnimation(new Animation(ANIM.AREA_SLAM));
      this.boss?.performGraphic(Shared.gfx(GFX.AREA_SLAM));
    });
    const count = this.run.delve.shockwaves;
    for (let index = 0; index < count; index++) {
      this.after(SHOCKWAVE.lands + index * SHOCKWAVE.between, () => this.shockwaveLands());
    }
    const last = SHOCKWAVE.lands + (count - 1) * SHOCKWAVE.between;
    this.after(last, anim(ANIM.AREA_RETURN));
    this.after(last + (SHOCKWAVE.clear - SHOCKWAVE.lands), () => this.run.hazards.clearVolatileEarth());
    this.after(last + (SHOCKWAVE.resume - SHOCKWAVE.lands), () => {
      this.shockwave = null;
      if (afterBurrow) this.untilShield = 2;
      else if (!(this.run.delve.burrow && this.shielded)) this.nextShockwaveAt = this.run.ticks + SHOCKWAVE.every;
      this.nextAt = Math.max(this.nextAt, this.run.ticks);
    });
  }

  shockwaveLands() {
    const run = this.run;
    const player = this.player;
    const tiles = [];
    for (let x = Shared.FLOOR.minX; x <= Shared.FLOOR.maxX; x++) {
      for (let y = Shared.FLOOR.minY; y <= Shared.FLOOR.maxY; y++) {
        const tile = run.tile({ x, y, z: 0 });
        if (Shared.floorFree(run.area, tile)) tiles.push(tile);
      }
    }
    for (const tile of tiles) Shared.graphicAt(player, Shared.randomOf(GFX.FLOOR_SLAM), tile);
    if (run.hazards.sheltered(player)) return;
    run.hurt(Shared.random(...SHOCKWAVE.damage));
  }
}

module.exports = { AttackCycle, idleMethod, styleMethod, besideBoss, burstTile, orbFlight, ANIM, ORB, SHOCKWAVE, CHARGE };
