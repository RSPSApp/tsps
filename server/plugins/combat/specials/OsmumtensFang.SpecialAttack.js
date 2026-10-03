// TODO: ported from xrsps-typescript; untested.
module.exports = function registerOsmumtensFangSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 25;
  const SPECIAL_ANIMATION = new Animation(11222);
  const SPECIAL_VFX = new Graphic(2833);
  const ACCURACY_MULTIPLIER = 1.5;
  const MINIMUM_DAMAGE_MULTIPLIER = 0.15;

  class OsmumtensFangCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }
  }

  api.registerCombatSpecial({
    id: "osmumtens_fang",
    itemIds: [
      ItemIdentifiers.OSMUMTENS_FANG,
      ItemIdentifiers.OSMUMTENS_FANG_OR_,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      damageMultiplier: 1,
      minimumDamageMultiplier: MINIMUM_DAMAGE_MULTIPLIER,
      maximumDamageMultiplier: 1,
    },
    combatMethod: new OsmumtensFangCombatMethod(),
  });
};
