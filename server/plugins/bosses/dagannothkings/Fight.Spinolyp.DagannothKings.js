"use strict";

/**
 * Spinolyp attacks (see ../DagannothKings.plugin.js for behaviour and sources).
 *
 * Wiki (Spinolyp) + Mod Ash: two styles, both rolling ranged accuracy against the
 * target's Ranged defence - one deals ranged damage and can poison, the other deals
 * magic damage and drains 1 prayer point (halved by the spectral spirit shield).
 * Captured spinolyp-shaped magic in the dungeon; ReasonPS uses 476/124 here.
 * Poison itself is the engine's (severity 30 starts at 6 damage, as live).
 */
const Common = require("./Common.DagannothKings");
const Dive = require("./Dive.Spinolyp.DagannothKings");

let SpinolypMethod = null;

function methodClass() {
  if (SpinolypMethod) return SpinolypMethod;
  const { Animation, CombatMethod, CombatType, PendingHit, Projectile } = Common.core;
  SpinolypMethod = class extends CombatMethod {
    constructor() {
      super();
      this.style = CombatType.RANGED;
    }

    type() {
      return this.style;
    }

    /** Mod Ash: the magic also rolls against Ranged defence. */
    accuracyDefenceType() {
      return CombatType.RANGED;
    }

    attackDistance() {
      return 10;
    }

    attackSpeed() {
      return Common.ATTACK_SPEED;
    }

    start(character, target) {
      this.style = Common.core.Misc.randomInclusive(0, 9) < 6 ? CombatType.RANGED : CombatType.MAGIC;
      character.performAnimation(new Animation(Common.ANIM.spinolypAttack));
      const projectile = this.style === CombatType.RANGED ? Common.PROJECTILE.spinolypRanged : Common.PROJECTILE.spinolypMagic;
      Projectile.createProjectile(character, target, projectile, 0, 20, 43, 31).sendProjectile();
    }

    hits(character, target) {
      // Two ticks, like the kings' captured flights at this range.
      return [new PendingHit(character, target, this, 2)];
    }

    handleAfterHitEffects(hit) {
      Dive.afterOwnAttack(hit.getAttacker?.());
      const target = hit.getTarget?.();
      if (!target?.isPlayer?.() || !hit.isAccurate() || hit.getTotalDamage() <= 0) return;
      if (this.style !== CombatType.MAGIC) return;
      // Mod Ash: the magic drains 1 prayer; the spectral shield halves it (coin flip).
      const apply = Common.core.applyPrayerDrainModifiers;
      const drain = typeof apply === "function"
        ? apply(target, Common.SPINOLYP_PRAYER_DRAIN, { attacker: hit.getAttacker?.() })
        : Common.SPINOLYP_PRAYER_DRAIN;
      if (drain > 0) target.getSkillManager().decreaseCurrentLevel(Common.core.Skill.PRAYER, drain, 0);
    }
  };
  return SpinolypMethod;
}

// One method instance per spinolyp: the style lives on `this` between start() and
// the landing hit, and several spinolyps share the room and attack on the same tick.
function attach(api) {
  api.registerNpcCombatMethodProvider([...Common.SPINOLYP_IDS], methodClass(), { singleton: false });
}

module.exports = { attach, methodClass };
