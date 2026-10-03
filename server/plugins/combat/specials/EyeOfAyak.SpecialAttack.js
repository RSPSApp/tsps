// TODO: ported from xrsps-typescript; untested.
module.exports = function registerEyeOfAyakSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic, ItemIdentifiers, PendingHit } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(12394);
  const SPECIAL_VFX = new Graphic(3364);
  const IMPACT_GRAPHIC = new Graphic(3365);

  // TODO: Soul Rend's Magic Defence bonus drain (equal to damage dealt) needs a
  // mutable target combat-attribute API, which our core does not expose.
  // TODO: core's magic hit path (getMagicMaxhit) ignores damageMultiplier, so
  // the 1.3x Soul Rend max-hit bonus is not yet applied.
  class EyeOfAyakCombatMethod extends CombatMethod {
    hits(character, target) {
      return [new PendingHit(character, target, this, 2)];
    }

    type() {
      return CombatType.MAGIC;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
    }

    attackSpeed(character) {
      return 5;
    }

    attackDistance(character) {
      return 10;
    }
  }

  api.registerCombatSpecial({
    id: "eye_of_ayak",
    itemIds: [ItemIdentifiers.EYE_OF_AYAK],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      rollAttackType: "magic",
      damageType: "magic",
      accuracyMultiplier: 2,
      damageMultiplier: 1.3,
    },
    combatMethod: new EyeOfAyakCombatMethod(),
  });
};
