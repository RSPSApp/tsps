"use strict";

/**
 * The Thermonuclear smoke devil's attack (see ../ThermonuclearSmokeDevil.plugin.js for
 * behaviour and sources).
 *
 * Wiki (Thermonuclear smoke devil): a single typeless magical-ranged style, max 8, speed
 * 2, range 8. Prayer bypass lives in Typeless.ThermonuclearSmokeDevil.js; the facemask
 * rule lives in Slayer's gear data. Captures (submission 1158): attack anim 3847
 * (lore_dust_devil_attack) every second tick, projectile 644 (smoke_devil_smoke_proj,
 * 32-56 cycles) and impact spotanim 643 on the player with defend anim 1156.
 */
const Common = require("./Common.ThermonuclearSmokeDevil");

let ThermonuclearMethod = null;

function methodClass() {
  if (ThermonuclearMethod) return ThermonuclearMethod;
  const { Animation, CombatMethod, CombatType, Graphic, GraphicHeight, MagicCombatMethod, PendingHit, Projectile } = Common.core;
  ThermonuclearMethod = class extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return Common.ATTACK_DISTANCE;
    }

    attackSpeed() {
      return Common.ATTACK_SPEED;
    }

    start(character, target) {
      character.performAnimation(new Animation(Common.ANIM_ATTACK));
      try {
        target.getPacketSender?.()?.sendSound?.(Common.ATTACK_SOUND, 1, 0);
      } catch {
        // Sound is best-effort; the attack still fires.
      }
      Projectile.createProjectile(character, target, Common.PROJECTILE_ID, 0, 20, 43, 31).sendProjectile();
    }

    hits(character, target) {
      return [new PendingHit(character, target, this, Common.HIT_DELAY_TICKS)];
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget?.();
      if (!target) return;
      if (hit.isAccurate()) {
        target.performGraphic(new Graphic(Common.IMPACT_ID, GraphicHeight.HIGH));
      } else {
        target.performGraphic(MagicCombatMethod.SPLASH_GRAPHIC);
      }
    }
  };
  return ThermonuclearMethod;
}

function attach(api) {
  api.registerNpcCombatMethodProvider([Common.BOSS_ID], methodClass());
}

module.exports = { attach, methodClass };
