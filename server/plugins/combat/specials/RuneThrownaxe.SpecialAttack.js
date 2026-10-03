// TODO: ported from xrsps-typescript; untested.
module.exports = function registerRuneThrownaxeSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, RangedCombatMethod } = api.core;

  const DRAIN = 10;
  const SPECIAL_ANIMATION = new Animation(1068);
  const SPECIAL_VFX = new Graphic(257, 0, GraphicHeight.HIGH);
  const IMPACT_GRAPHIC = new Graphic(258);

  // TODO: Chainhit should bounce to up to five extra targets within three tiles,
  // spending 10% energy per bounce and skipping prayer modifiers; no multi-target hook.
  class RuneThrownaxeCombatMethod extends RangedCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
    }
  }

  api.registerCombatSpecial({
    id: "rune_thrownaxe",
    itemIds: [ItemIdentifiers.RUNE_THROWNAXE, ItemIdentifiers.RUNE_THROWNAXE_2],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1 },
    combatMethod: new RuneThrownaxeCombatMethod(),
  });
};
