// TODO: ported from xrsps-typescript; untested.
module.exports = function registerWebweaverBowSpecialAttack(api) {
  const { Animation, CombatFactory, CombatPosition, CombatSpecial, Graphic, ItemIdentifiers, Misc, PendingHit, RangedCombatMethod } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(9964);
  const SPECIAL_VFX = new Graphic(2354);
  const IMPACT_GRAPHIC = new Graphic(2355);
  const POISON_POTENCY = 4;

  class WebweaverBowCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const hitDelay = RangedCombatMethod.playerHitDelays(character, target, CombatPosition.projectileDistance(character, target))[0];
      // Swarm resolves in two close hitsplat groups of two independent rolls.
      return [
        new PendingHit(character, target, this, hitDelay),
        new PendingHit(character, target, this, hitDelay),
        new PendingHit(character, target, this, hitDelay + 1),
        new PendingHit(character, target, this, hitDelay + 1),
      ];
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
      const target = hit.getTarget();
      for (const splat of hit.getHits()) {
        if (splat.getDamage() <= 0) {
          continue;
        }
        if (Misc.getRandom(3) !== 0) {
          continue;
        }
        CombatFactory.poisonEntity(target, POISON_POTENCY);
      }
    }
  }

  api.registerCombatSpecial({
    id: "webweaver_bow",
    itemIds: [ItemIdentifiers.WEBWEAVER_BOW],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    // The target-dependent Wilderness passive is supplied by WebweaverBow.plugin.js.
    traits: {
      hitCount: 1,
      accuracyMultiplier: 2,
      accuracyMultiplierStages: [2],
      damageMultiplier: 0.4,
      damageMultiplierStages: [0.4],
      damageMultiplierStageRounding: ["ceil"],
      rollAttackType: "ranged",
      damageType: "ranged",
      hitDelayTicks: [0, 0, 1, 1],
    },
    combatMethod: new WebweaverBowCombatMethod(),
  });
};
