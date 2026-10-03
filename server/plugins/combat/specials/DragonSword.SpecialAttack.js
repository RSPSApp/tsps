// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonSwordSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 40;
  const SPECIAL_ANIMATION = new Animation(7515);
  const SPECIAL_VFX = new Graphic(1369);

  class DragonSwordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }
  }

  api.registerCombatSpecial({
    id: "dragon_sword",
    itemIds: [ItemIdentifiers.DRAGON_SWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1.25,
      damageMultiplier: 1.25,
      meleeDefenceBonusIndex: 0,
      ignoreProtectionPrayer: true,
    },
    combatMethod: new DragonSwordCombatMethod(),
  });
};
