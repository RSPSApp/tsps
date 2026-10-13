// TODO: ported from xrsps-typescript; untested.
module.exports = function registerGraniteMaulSpecialAttack(api) {
  const { Animation, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Sounds } = api.core;

  const STANDARD_DRAIN = 60;
  const ORNATE_DRAIN = 50;
  const ANIMATION = new Animation(1667);
  const GRAPHIC = new Graphic(340, GraphicHeight.HIGH);

  // The granite maul drains and queues in CombatSpecial.activate, not here.
  class GraniteMaulCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }
  }

  // ItemIdentifiers names are positional; these are the cache gamevals granite_maul (4153),
  // granite_maul_pretty (12848, clamp applied), granite_maul_plus (24225, handle applied) and
  // granite_maul_pretty_plus (24227, both applied). Only the two with a handle cost 50%.
  api.registerCombatSpecial({
    id: "granite_maul",
    itemIds: [
      ItemIdentifiers.GRANITE_MAUL,
      ItemIdentifiers.GRANITE_MAUL_3,
      ItemIdentifiers.GRANITE_MAUL_5,
      ItemIdentifiers.GRANITE_MAUL_7,
    ],
    drainAmount: STANDARD_DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    // One-tick queued attack: core performs the instant attack and skips the
    // energy check while it is queued (see CombatSpecial.activate).
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      queuedAttack: true,
    },
    drainAmountByItemId: {
      [ItemIdentifiers.GRANITE_MAUL_5]: ORNATE_DRAIN,
      [ItemIdentifiers.GRANITE_MAUL_7]: ORNATE_DRAIN,
    },
    combatMethod: new GraniteMaulCombatMethod(),
  });
};
