"use strict";

/**
 * The Third Age minions' attacks (see ../Mimic.plugin.js for behaviour and sources).
 *
 * The engine's generic NPC ranged/magic paths undersell them: NPC casts play no
 * cast or impact graphic, and NPC hit delays are flat (ranged 1 tick, magic 3)
 * while their projectiles fly distance-scaled shapes, so damage detaches from the
 * visuals. These methods keep the data-driven ids and only complete the
 * presentation, mirroring the player spell/arrow shapes:
 * - Ranger: the configured projectile (npc-combat-defs.json 8636 → 1574; NR-oracle
 *   value, triangulated as the lit fire arrow from bronze-tier strength and the
 *   orange streak, still awaiting a capture) on the canonical arrow shape (delay 41, 46 + 5/tile, heights
 *   43/31), hitsplat rounded to the visual landing. Max 12, speed 4, distance 6:
 *   all the dump's (monsters-complete.json), unchanged.
 * - Mage: Earth Wave whole (CombatSpells.EARTH_WAVE: cast 164, flight 165, impact
 *   166; the Wiki green, max 16 from the dump) on the canonical magic shape
 *   (delay 51, 46 + 10/tile, heights 43/31), hitsplat rounded to the landing, the
 *   impact only on accurate hits as player spells do. Speed 4, distance 10.
 * The warrior needs none of this (melee) and stays on the engine default.
 */

const Shared = require("./Shared.Mimic");

/** Earth Wave, as CombatSpells.EARTH_WAVE defines it (cast, flight, impact). */
const WAVE = { CAST: 164, PROJECTILE: 165, IMPACT: 166 };
/** Fallback arrow when no projectile is configured (the engine's NPC default). */
const DEFAULT_ARROW = 10;
/** Max hits from monsters-complete.json: ranger 12, mage 16. */
const MAX_HIT = { ranger: 12, mage: 16 };

/** Chebyshev tiles, as the engine measures projectile distance. */
function distance(attacker, target) {
  return attacker.getLocation().getDistance(target.getLocation());
}

/** Hit delay in ticks, rounded to the projectile's visual landing (30 cycles/tick). */
function landingDelay(endCycles) {
  return Math.max(1, Math.round(endCycles / 30));
}

function attackSpeedOf(character, fallback) {
  return character.getCurrentDefinition?.()?.getAttackSpeed?.() ?? fallback;
}

function playAttackAnim(character, target) {
  const { Animation } = Shared.core();
  const animation = character.getAttackAnim?.(target);
  if (animation != null && animation !== -1) {
    character.performAnimation(new Animation(animation));
  }
}

function rangerProjectileId(npc) {
  const configured = npc.getAsNpc?.()?.getCurrentDefinition?.()?.getProjectileId?.();
  return configured != null && configured >= 0 ? configured : DEFAULT_ARROW;
}

function methodClasses() {
  const { CombatMethod, CombatType, Projectile, Graphic, GraphicHeight, PendingHit, CombatFactory } = Shared.core();

  class RangerMethod extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    attackDistance() {
      return 6;
    }

    attackSpeed(character) {
      return attackSpeedOf(character, 4);
    }

    start(character, target) {
      playAttackAnim(character, target);
      const tiles = distance(character, target);
      Projectile.createProjectile(character, target, rangerProjectileId(character), 41, 46 + tiles * 5, 43, 31).sendProjectile();
    }

    hits(character, target) {
      const hit = new PendingHit(character, target, this, landingDelay(46 + distance(character, target) * 5));
      hit.setHandleAfterHitEffects(false);
      CombatFactory.applyStyleDamage(hit, MAX_HIT.ranger);
      return [hit];
    }
  }

  class MageMethod extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return 10;
    }

    attackSpeed(character) {
      return attackSpeedOf(character, 4);
    }

    start(character, target) {
      playAttackAnim(character, target);
      character.performGraphic?.(new Graphic(WAVE.CAST, GraphicHeight.HIGH));
      const tiles = distance(character, target);
      Projectile.createProjectile(character, target, WAVE.PROJECTILE, 51, 46 + tiles * 10, 43, 31).sendProjectile();
    }

    hits(character, target) {
      const hit = new PendingHit(character, target, this, landingDelay(46 + distance(character, target) * 10));
      hit.setHandleAfterHitEffects(true);
      CombatFactory.applyStyleDamage(hit, MAX_HIT.mage);
      return [hit];
    }

    handleAfterHitEffects(hit) {
      if (!hit?.isAccurate?.()) return;
      hit.getTarget?.()?.performGraphic?.(new Graphic(WAVE.IMPACT, GraphicHeight.HIGH));
    }
  }

  return { RangerMethod, MageMethod };
}

function attach(api) {
  const { RangerMethod, MageMethod } = methodClasses();
  const { RANGER, MAGE } = Shared.ids();
  api.registerNpcCombatMethodProvider([RANGER], RangerMethod);
  api.registerNpcCombatMethodProvider([MAGE], MageMethod);
}

module.exports = { attach, methodClasses, landingDelay, WAVE };
