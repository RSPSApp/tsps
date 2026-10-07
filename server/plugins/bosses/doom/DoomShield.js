"use strict";

/**
 * The demonic shield, from delve 3 (Wiki):
 * - At delves 3 and 4 the Doom raises it once it is at 75% or less and has made two attacks;
 *   from delve 5 it raises it two attacks after each shockwave as well.
 * - It becomes "Doom of Mokhaiotl (Shielded)" (14708) with 500 shield points and charges its
 *   Special Beam the whole time. Only demonbane harms the shield (always hitting) and resets the
 *   charge; anything else is "The demonic shield resists your attack!" (purple).
 * - A larva bursting on it takes 100 points. Larvae come all the while from one side (north,
 *   north-west, west or south-west), coloured from delve 4, melee larvae included.
 * - Larvae killed during it store about 3 damage each, up to 50, dealt to the Doom when the
 *   shield goes.
 * - It ends when the shield breaks, or when the charge completes and the beam fires. From delve 5
 *   the Doom then burrows (DoomBurrow).
 * Capture (delves 3-5): 2 ticks after its charge animation (12408) it becomes 14708, the HUD
 * shows 500/500 (varp 1683 = 14708; the bar turns blue, 132/623/853, which this server can't
 * send) and headbar 81 runs for 510 cycles (17 ticks) at every delve. Each demonbane hit restarts
 * it (12410). A larva comes every 7-9 ticks from the north-west, 8-12 tiles from the centre,
 * the first 5 ticks in; a larva bursting on it takes 100 (hitsplat 17). Broken at delves 3-4, it
 * becomes the Doom again with a rock throw; at delve 5 it burrows at once.
 * Between hits it loops the charge (12409, graphic 3412 in slot 2) each tick, as the melee charge.
 * Guess: the beam firing when the charge completes ends the shield (Wiki).
 */

const Shared = require("./DoomShared");
const { ANIM } = require("./DoomBoss");
const { isDemonbane } = require("./DoomHazards");

const SHIELD = {
  points: 500,
  charge: 17,
  /** Capture: its charge bar runs 510 cycles; hits show the shield's points on headbar 11. */
  chargeCycles: 510,
  bar: { id: 11, width: 120 },
  firstLarva: 5,
  larvaEvery: [7, 9],
  larvaBurst: 100,
  storedPerLarva: 3,
  storedCap: 50,
  sides: [[-1, 1]],
  message: "<col=a53fff>The demonic shield resists your attack!</col>",
};

function chargeTicks() {
  return SHIELD.charge;
}

class ShieldPhase {
  constructor(run) {
    this.run = run;
    this.points = 0;
    this.stored = 0;
    this.firesAt = Infinity;
    this.side = null;
    this.nextLarvaAt = Infinity;
  }

  /** Up once raised: the 2 ticks of its charge animation before come first. */
  get up() {
    return this.run.attacks.phase === "shield" && this.raised;
  }

  start() {
    const run = this.run;
    const boss = run.boss;
    run.attacks.phase = "shield";
    run.attacks.endCharge();
    this.raised = true;
    this.points = SHIELD.points;
    this.stored = 0;
    this.side = Shared.randomOf(SHIELD.sides);
    this.nextLarvaAt = run.ticks + SHIELD.firstLarva;
    boss.setNpcTransformationId(Shared.NPC.DOOM_SHIELDED);
    boss.setHitpointsLocked(true);
    this.restartCharge();
    run.updateHud(true);
    run.hudColours(true);
  }

  restartCharge(cancelled = false) {
    const { Animation } = Shared.core();
    const run = this.run;
    this.firesAt = run.ticks + chargeTicks(run.level);
    if (cancelled) {
      run.boss.performAnimation(new Animation(ANIM.BEAM_CANCEL));
      // Capture: no charge graphic on a tick a demonbane hit cancels it.
      Shared.withdrawChargeGraphic(run.boss);
      this.cancelledAt = run.ticks;
    }
    Shared.chargeBar(run.boss, SHIELD.chargeCycles);
  }

  /** What the Doom's bar shows with a hit on the shield: its points, on the shield's bar. */
  shieldHealth(points = this.points) {
    return { current: Math.max(0, points), max: SHIELD.points, bar: SHIELD.bar };
  }

  tick() {
    const run = this.run;
    if (this.up && run.ticks >= this.firesAt) {
      Shared.fireBeam(run, run.delve.beam);
      this.end();
      return;
    }
    if (!this.up) return;
    // Capture: the charge loops each tick, except a tick a demonbane hit cancels it (12410).
    if (this.cancelledAt !== run.ticks) Shared.chargeLoop(run.boss);
    if (run.ticks >= this.nextLarvaAt) {
      this.nextLarvaAt = run.ticks + Shared.random(...SHIELD.larvaEvery);
      run.hazards.spawnLarva({ from: this.side, shield: true });
    }
  }

  /** A hit on the shield: demonbane only, always landing, and it resets the charge. */
  hit(hit) {
    const attacker = hit.getAttacker?.();
    if (!this.up) {
      for (const part of hit.getHits()) part.setDamage(0);
      hit.updateTotalDamage();
      return;
    }
    if (!attacker?.isPlayer?.() || !isDemonbane(attacker)) {
      for (const part of hit.getHits()) part.setDamage(0);
      hit.updateTotalDamage();
      attacker?.sendMessage?.(SHIELD.message);
      return;
    }
    for (const part of hit.getHits()) part.setDamage(Math.max(1, part.getDamage()));
    hit.updateTotalDamage();
    this.run.boss.setDisplayedHealth?.(this.shieldHealth(this.points - hit.getTotalDamage()));
    this.damage(hit.getTotalDamage());
    if (this.up) this.restartCharge(true);
  }

  damage(amount) {
    if (!this.up) return;
    this.points -= amount;
    this.run.updateHud(true);
    if (this.points <= 0) this.end();
  }

  /** Capture: a larva bursting on the shield shows as a bonus hitsplat (17) of up to 100. */
  larvaBurst() {
    if (!this.up) return;
    const amount = Math.min(SHIELD.larvaBurst, this.points);
    this.run.boss.showHitsplat?.(amount, { mine: Shared.SPLAT.BONUS, others: Shared.SPLAT.BONUS }, this.shieldHealth(this.points - amount));
    this.damage(amount);
  }

  larvaKilled() {
    if (this.up) this.stored = Math.min(SHIELD.storedCap, this.stored + SHIELD.storedPerLarva);
  }

  end() {
    const run = this.run;
    const boss = run.boss;
    if (!this.up || !boss) return;
    this.raised = false;
    this.firesAt = Infinity;
    this.nextLarvaAt = Infinity;
    Shared.emptyChargeBar(boss);
    run.hudColours(false);
    // Capture: at delve 5 it keeps the shielded form until it turns into the burrowed one.
    if (!run.delve.burrow) boss.setNpcTransformationId(-1);
    boss.setHitpointsLocked(false);
    run.attacks.phase = "attacks";
    if (this.stored > 0 && boss.getHitpoints() > 0) Shared.damage(boss, this.stored);
    this.stored = 0;
    run.updateHud(true);
    if (run.delve.burrow) run.burrow.start();
    else run.attacks.resume();
  }

  hudPoints() {
    return Math.max(0, this.points);
  }

  stop() {
    this.raised = false;
    this.firesAt = Infinity;
    this.nextLarvaAt = Infinity;
  }
}

module.exports = { ShieldPhase, SHIELD, chargeTicks };
