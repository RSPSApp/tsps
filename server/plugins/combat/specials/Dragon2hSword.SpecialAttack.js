// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragon2hSwordSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 60;
  const SPECIAL_ANIMATION = new Animation(3157);
  const SPECIAL_VFX = new Graphic(559);

  // Powerstab is a single-target special here; the upstream sweep against up to
  // fourteen nearby targets needs an engagement-level nearby-entity query.
  // TODO: area targeting for the surrounding Powerstab sweep.
  class Dragon2hSwordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }
  }

  api.registerCombatSpecial({
    id: "dragon_2h_sword",
    itemIds: [ItemIdentifiers.DRAGON_2H_SWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1 },
    combatMethod: new Dragon2hSwordCombatMethod(),
  });
};
