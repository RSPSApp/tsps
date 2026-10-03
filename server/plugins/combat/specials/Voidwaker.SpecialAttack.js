// TODO: ported from xrsps-typescript; untested.
module.exports = function registerVoidwakerSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(11240);
  const SPECIAL_VFX = new Graphic(2834);
  const IMPACT_GRAPHIC = new Graphic(2363);

  class VoidwakerCombatMethod extends MeleeCombatMethod {
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
    }
  }

  api.registerCombatSpecial({
    id: "voidwaker",
    itemIds: [ItemIdentifiers.VOIDWAKER],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      guaranteedHit: true,
      damageType: "magic",
      maximumHitSource: "physical_melee",
      minimumDamageMultiplier: 0.5,
      maximumDamageMultiplier: 1.5,
    },
    combatMethod: new VoidwakerCombatMethod(),
  });
};
