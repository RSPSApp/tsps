// TODO: ported from xrsps-typescript; untested.
// TODO: Hammer Blow has a dedicated special-attack animation in OSRS (wiki: "special attack animation has been updated", 2017) and a guaranteed 5 damage on a miss; the animation id is not exposed by RuneLite AnimationID, upstream xrsps, or our cache tooling — needs a sequence dump from the OSRS cache.
module.exports = function registerGraniteHammerSpecialAttack(api) {
  const { CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 60;
  // TODO: Hammer Blow special animation id not found
  const SPECIAL_VFX = new Graphic(1450);
  const ACCURACY_MULTIPLIER = 1.5;
  const DAMAGE_BONUS = 5;

  class GraniteHammerCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performGraphic(SPECIAL_VFX);
    }
  }

  api.registerCombatSpecial({
    id: "granite_hammer",
    itemIds: [
      ItemIdentifiers.GRANITE_HAMMER,
      ItemIdentifiers.GRANITE_HAMMER_2,
      ItemIdentifiers.GRANITE_HAMMER_3,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      minimumDamageBonus: DAMAGE_BONUS,
      maximumDamageBonus: DAMAGE_BONUS,
    },
    combatMethod: new GraniteHammerCombatMethod(),
  });
};
