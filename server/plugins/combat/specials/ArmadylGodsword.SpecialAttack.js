module.exports = function registerArmadylGodswordSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Sounds } = api.core;

  const DRAIN = 50;
  const ANIMATION = new Animation(7644);
  const GRAPHIC = new Graphic(1211, Priority.HIGH);

  class ArmadylGodswordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }
  }

  api.registerCombatSpecial({
    id: "armadyl_godsword",
    itemIds: [ItemIdentifiers.ARMADYL_GODSWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1.375,
    accuracyMultiplier: 2,
    combatMethod: new ArmadylGodswordCombatMethod(),
  });
};
