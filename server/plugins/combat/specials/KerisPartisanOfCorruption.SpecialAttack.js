// TODO: ported from xrsps-typescript; untested.
module.exports = function registerKerisPartisanOfCorruptionSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 75;
  const SPECIAL_ANIMATION = new Animation(9544);
  const SPECIAL_VFX = new Graphic(2128);
  const ACCURACY_MULTIPLIER = 2;
  const DAMAGE_MULTIPLIER = 1.25;

  // TODO: restrict activation to the Tombs of Amascut (`isInTombsOfAmascut`); no zone helper exposed.
  // TODO: on a damaging hit mark the target to take 25% more damage for 10 ticks; no target damage-taken modifier API.
  class KerisPartisanOfCorruptionCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }
  }

  api.registerCombatSpecial({
    id: "keris_partisan_of_corruption",
    itemIds: [
      ItemIdentifiers.KERIS_PARTISAN_OF_CORRUPTION,
      ItemIdentifiers.KERIS_PARTISAN_OF_CORRUPTION_2,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      damageMultiplier: DAMAGE_MULTIPLIER,
    },
    combatMethod: new KerisPartisanOfCorruptionCombatMethod(),
  });
};
