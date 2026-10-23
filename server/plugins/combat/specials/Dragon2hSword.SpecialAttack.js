function dragon2hSwordSpecial({ Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod }) {

  const DRAIN = 60;
  const SPECIAL_ANIMATION = new Animation(3157);
  const SPECIAL_VFX = new Graphic(559);
  const POWERSTAB_TARGETING = { pattern: "surrounding", width: 1, maxTargets: 14, maxPlayerTargets: 3, requiresMultiCombat: true };

  // Powerstab also hits everything within one tile of the player in multi-combat: up to 14
  // targets, and no more than three players (wiki: Dragon 2h sword).
  class Dragon2hSwordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }
  }

  return {
    id: "dragon_2h_sword",
    itemIds: [ItemIdentifiers.DRAGON_2H_SWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1, targeting: POWERSTAB_TARGETING },
    combatMethod: new Dragon2hSwordCombatMethod(),
  };
}

module.exports = function registerDragon2hSwordSpecialAttack(api) {
  api.registerCombatSpecial(dragon2hSwordSpecial(api.core));
};
