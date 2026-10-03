// TODO: ported from xrsps-typescript (Sweep/forward-line targeting); untested.
module.exports = function registerDragonHalberdSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Sounds } = api.core;

  const DRAIN = 30;
  const ANIMATION = new Animation(1203);
  const GRAPHIC = new Graphic(282, GraphicHeight.HIGH);
  const SWEEP_TARGETING = {
    pattern: "forward_line",
    width: 3,
    maxTargets: 10,
    requiresMultiCombat: true,
    largeTargetExtraHit: { minimumSize: 2, accuracyMultiplier: 0.75 },
  };

  class DragonHalberdCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }
  }

  api.registerCombatSpecial({
    id: "dragon_halberd",
    itemIds: [ItemIdentifiers.DRAGON_HALBERD, ItemIdentifiers.CRYSTAL_HALBERD_FULL_I_],
    drainAmount: DRAIN,
    strengthMultiplier: 1.1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      damageMultiplier: 1.1,
      meleeAttackBonusIndex: 1,
      meleeDefenceBonusIndex: 1,
      targeting: SWEEP_TARGETING,
    },
    combatMethod: new DragonHalberdCombatMethod(),
  });
};
