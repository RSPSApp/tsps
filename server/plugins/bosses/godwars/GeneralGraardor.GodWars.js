"use strict";

// Wiki: 60 melee, 35 ranged (15-35 on the slam), attack speed 6 from the definition.
const MELEE_MAX_HIT = 60;
const RANGED_MAX_HIT = 35;
const RANGED_MIN_HIT = 15;
// "Slams the ground to emit shockwaves to all players inside his chamber."
// ponytail: no chamber rectangle is modelled, radius is the room size.
const CHAMBER_RADIUS = 10;

// Cache: GODWARS_BANDOS_ATTACK, GODWARS_BANDOS_RANGED, GODWARS_BANDOS_PROJ/_SPOT.
const MELEE_ANIMATION = 7018;
const RANGED_ANIMATION = 7021;
const SHOCKWAVE_PROJECTILE = 1202;
const SHOCKWAVE_GRAPHIC = 1203;

module.exports = function registerGeneralGraardor(api) {
  const {
    Animation,
    CombatFactory,
    CombatMethod,
    CombatType,
    Graphic,
    Misc,
    NpcIdentifiers,
    PendingHit,
    Projectile,
  } = api.core;

  const NPC_IDS = [
    NpcIdentifiers.GENERAL_GRAARDOR,
    NpcIdentifiers.GENERAL_GRAARDOR_2,
  ];

  class GeneralGraardorCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.MELEE;
    }

    type() {
      return this.stance;
    }

    // Both attacks are only used in melee range, the "ranged" slam included.
    attackDistance() {
      return 1;
    }

    start(character, target) {
      // 2/3 melee, 1/3 slam.
      this.stance = Misc.randomInclusive(0, 2) === 0 ? CombatType.RANGED : CombatType.MELEE;
      if (this.stance === CombatType.RANGED) {
        character.performAnimation(new Animation(RANGED_ANIMATION));
        Projectile.createProjectile(
          character,
          target,
          SHOCKWAVE_PROJECTILE,
          40,
          Projectile.arrivalCycles(character, target),
          43,
          31
        ).sendProjectile();
      } else {
        character.performAnimation(new Animation(MELEE_ANIMATION));
      }
    }

    hits(character, target) {
      const ranged = this.stance === CombatType.RANGED;
      const delay = ranged ? Projectile.arrivalTicks(character, target) : 1;
      const hits = [new PendingHit(character, target, this, delay)];
      CombatFactory.applyStyleDamage(hits[0], ranged ? RANGED_MAX_HIT : MELEE_MAX_HIT, {
        minHit: ranged ? RANGED_MIN_HIT : 0,
      });
      if (!ranged) {
        return hits;
      }
      for (const player of character.getAsNpc().getPlayersWithinDistance(CHAMBER_RADIUS)) {
        if (player === target || player.getHitpoints() <= 0) {
          continue;
        }
        const hit = new PendingHit(character, player, this, delay);
        CombatFactory.applyStyleDamage(hit, RANGED_MAX_HIT, { minHit: RANGED_MIN_HIT });
        hits.push(hit);
      }
      return hits;
    }

    handleAfterHitEffects(hit) {
      if (this.stance === CombatType.RANGED && hit.getTarget().isPlayer()) {
        hit.getTarget().performGraphic(new Graphic(SHOCKWAVE_GRAPHIC));
      }
    }
  }

  api.registerNpcCombatMethodProvider(NPC_IDS, GeneralGraardorCombatMethod, { singleton: false });
};
