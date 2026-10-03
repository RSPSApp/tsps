// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonDaggerSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Sound, Sounds } = api.core;

  const DRAIN = 25;
  const ACCURACY_MULTIPLIER = 1.15;
  const DAMAGE_MULTIPLIER = 1.15;
  const ANIMATION = new Animation(1062);
  const GRAPHIC = new Graphic(252, GraphicHeight.HIGH);

  class DragonDaggerCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, Sound.DRAGON_DAGGER_SPECIAL);
    }
  }

  api.registerCombatSpecial({
    id: "dragon_dagger",
    itemIds: [
      ItemIdentifiers.DRAGON_DAGGER,
      ItemIdentifiers.DRAGON_DAGGER_P_,
      ItemIdentifiers.DRAGON_DAGGER_P_PLUS_,
      ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: DAMAGE_MULTIPLIER,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 2,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      damageMultiplier: DAMAGE_MULTIPLIER,
    },
    combatMethod: new DragonDaggerCombatMethod(),
    metadata: { finisherDamageMultiplier: 2 },
  });
};
