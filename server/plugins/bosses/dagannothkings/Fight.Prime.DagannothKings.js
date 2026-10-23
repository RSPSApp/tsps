"use strict";

/**
 * Dagannoth Prime's fight (see ../DagannothKings.plugin.js for behaviour and sources).
 *
 * Wiki (Dagannoth Prime): the magic king, max 50, speed 4, weak to ranged, 3x3 AoE
 * around his target. Captured (submission 89): attack anim 2854, projectile 162
 * (waterwave_travel) with the usual magic flight, cast sound 213 at his tile, the
 * 2852 defend and 2856 death shared with the other kings. ReasonPS agrees on the
 * shape (2854/162, speed 4, range 6); the Wiki and the captures put his range at
 * 11+ tiles, so he keeps 12 here.
 */
const Common = require("./Common.DagannothKings");
const Hud = require("./Hud.DagannothKings");

let PrimeMethod = null;

function methodClass() {
  if (PrimeMethod) return PrimeMethod;
  const { Animation, CombatMethod, CombatType, Graphic, GraphicHeight, MagicCombatMethod, PendingHit, Projectile } = Common.core;
  PrimeMethod = class extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return Common.PRIME_DISTANCE;
    }

    attackSpeed() {
      return Common.ATTACK_SPEED;
    }

    start(character, target) {
      character.performAnimation(new Animation(Common.ANIM.primeMagic));
      if (target?.isPlayer?.()) Hud.engaged(character, target);
      Projectile.createProjectile(character, target, Common.PROJECTILE.prime, 0, 20, 43, 31).sendProjectile();
      // Captured as an area sound (range 10) at his tile on every cast.
      for (const player of Common.playersAround(character, character.getLocation(), 10)) {
        try {
          player.getPacketSender()?.sendSound?.(Common.PRIME_CAST_SOUND, 1, 0);
        } catch {
          // Sound is best-effort; the attack still fires.
        }
      }
    }

    hits(character, target) {
      const victims = [target];
      const at = target.getLocation();
      for (const player of Common.playersAround(character, at, Common.PRIME_SPLASH_RADIUS, Common.PRIME_DISTANCE + Common.PRIME_SPLASH_RADIUS)) {
        if (player !== target) victims.push(player);
      }
      return victims.map((victim) => new PendingHit(character, victim, this, Common.HIT_DELAY.prime));
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget?.();
      if (!target) return;
      if (hit.isAccurate()) {
        target.performGraphic(new Graphic(Common.PROJECTILE.primeImpact, GraphicHeight.HIGH));
      } else {
        target.performGraphic(MagicCombatMethod.SPLASH_GRAPHIC);
      }
    }
  };
  return PrimeMethod;
}

function attach(api) {
  api.registerNpcCombatMethodProvider([Common.PRIME_ID], methodClass());
}

module.exports = { attach, methodClass };
