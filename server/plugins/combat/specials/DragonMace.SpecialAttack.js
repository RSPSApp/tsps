module.exports = function registerDragonMaceSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Sound, Sounds } = api.core;

  const DRAIN = 25;
  const ANIMATION = new Animation(1060);
  const GRAPHIC = new Graphic(251, GraphicHeight.HIGH);

  class DragonMaceCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, Sound.DRAGON_MACE_SPECIAL);
    }
  }

  api.registerCombatSpecial({
    id: "dragon_mace",
    itemIds: [ItemIdentifiers.DRAGON_MACE],
    drainAmount: DRAIN,
    strengthMultiplier: 1.5,
    accuracyMultiplier: 1.25,
    combatMethod: new DragonMaceCombatMethod(),
  });
};
