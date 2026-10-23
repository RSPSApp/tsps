"use strict";

/**
 * Dagannoth Supreme's fight (see ../DagannothKings.plugin.js for behaviour and sources).
 *
 * Wiki (Dagannoth Supreme): the ranged king, max 30, speed 4, weak to melee. His attack
 * sounds like the Water Wave spell, splashes like magic on a miss, and hits every
 * player in the 6x6 area around his target (radius 3 here; the facing nuance is a
 * follow-up). Captured (submission 89): attack anim 2855, projectile 475
 * (dagannoth_spine_spotanim_travel), impact sound 227 at the target with the
 * projectile's delay. ReasonPS agrees on the shape (2855/475, speed 4).
 */
const Common = require("./Common.DagannothKings");
const Hud = require("./Hud.DagannothKings");

let SupremeMethod = null;

function methodClass() {
  if (SupremeMethod) return SupremeMethod;
  const { Animation, CombatMethod, CombatType, PendingHit, Projectile } = Common.core;
  SupremeMethod = class extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    attackDistance() {
      return Common.SUPREME_DISTANCE;
    }

    attackSpeed() {
      return Common.ATTACK_SPEED;
    }

    start(character, target) {
      character.performAnimation(new Animation(Common.ANIM.supremeRange));
      if (target?.isPlayer?.()) Hud.engaged(character, target);
      Projectile.createProjectile(character, target, Common.PROJECTILE.supreme, 0, 20, 43, 31).sendProjectile();
    }

    hits(character, target) {
      const victims = [target];
      const at = target.getLocation();
      for (const player of Common.playersAround(character, at, Common.SUPREME_SPLASH_RADIUS, Common.SUPREME_DISTANCE + Common.SUPREME_SPLASH_RADIUS)) {
        if (player !== target) victims.push(player);
      }
      return victims.map((victim) => new PendingHit(character, victim, this, Common.HIT_DELAY.supreme));
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget?.();
      if (!target || !hit.isAccurate()) return;
      // Captured as an area sound at the target with the projectile's delay.
      try {
        target.getPacketSender()?.sendSound?.(Common.SUPREME_IMPACT_SOUND, 1, 0);
      } catch {
        // Sound is best-effort.
      }
    }
  };
  return SupremeMethod;
}

function attach(api) {
  api.registerNpcCombatMethodProvider([Common.SUPREME_ID], methodClass());
}

module.exports = { attach, methodClass };
