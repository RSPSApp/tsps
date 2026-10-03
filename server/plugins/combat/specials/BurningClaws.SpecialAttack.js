// TODO: ported from xrsps-typescript; untested.
module.exports = function registerBurningClawsSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 30;
  const SPECIAL_ANIMATION = new Animation(11140);
  const SPECIAL_VFX = new Graphic(2814);
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const ACCURACY_ROLLS = 3;

  class BurningClawsCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    // TODO: the burn proc needs the first-successful-accuracy-roll index and a
    // shared delayed-damage burn scheduler, neither of which is exposed to
    // plugins yet; the trait ranges are registered for when core consumes them.
  }

  api.registerCombatSpecial({
    id: "burning_claws",
    itemIds: [ItemIdentifiers.BURNING_CLAWS],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 3,
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
      accuracyRollCount: ACCURACY_ROLLS,
      firstSuccessfulAccuracyDamageRanges: [
        { minimumDamageMultiplier: 0.75, maximumDamageMultiplier: 1.75, hitDamageMultipliers: [0.25, 0.25, 0.5] },
        { minimumDamageMultiplier: 0.5, maximumDamageMultiplier: 1.5, hitDamageMultipliers: [0.5, 0.5, 0], hitDamageBonuses: [-1, -1, 2] },
        { minimumDamageMultiplier: 0.25, maximumDamageMultiplier: 1.25, hitDamageMultipliers: [0, 0, 1], hitDamageBonuses: [1, 1, -2] },
      ],
    },
    combatMethod: new BurningClawsCombatMethod(),
  });
};
