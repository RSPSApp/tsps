// TODO: ported from xrsps-typescript; untested.
module.exports = function registerAbyssalDaggerSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Sounds } = api.core;

  const DRAIN = 25;
  const ACCURACY_MULTIPLIER = 1.25;
  const DAMAGE_MULTIPLIER = 0.85;
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const ANIMATION = new Animation(3300);
  const GRAPHIC = new Graphic(1283, Priority.HIGH);

  class AbyssalDaggerCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }
  }

  api.registerCombatSpecial({
    id: "abyssal_dagger",
    itemIds: [ItemIdentifiers.ABYSSAL_DAGGER_P_PLUS_PLUS_],
    drainAmount: DRAIN,
    strengthMultiplier: DAMAGE_MULTIPLIER,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 2,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      damageMultiplier: DAMAGE_MULTIPLIER,
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
      sharedAccuracyRollAcrossHits: true,
    },
    combatMethod: new AbyssalDaggerCombatMethod(),
  });
};
