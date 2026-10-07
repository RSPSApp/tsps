// TODO: ported from xrsps-typescript (Sweep/forward-line targeting); untested.
module.exports = function registerDragonHalberdSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Sounds } = api.core;

  const DRAIN = 30;
  const ANIMATION = new Animation(1203);
  const GRAPHIC = new Graphic(282, GraphicHeight.HIGH);
  // Every active crystal halberd stage shares Sweep; the inactive stages do not.
  const CRYSTAL_HALBERD_IDS = [
    ItemIdentifiers.CRYSTAL_HALBERD_FULL_I_, ItemIdentifiers.CRYSTAL_HALBERD_9_10_I_,
    ItemIdentifiers.CRYSTAL_HALBERD_8_10_I_, ItemIdentifiers.CRYSTAL_HALBERD_7_10_I_,
    ItemIdentifiers.CRYSTAL_HALBERD_6_10_I_, ItemIdentifiers.CRYSTAL_HALBERD_5_10_I_,
    ItemIdentifiers.CRYSTAL_HALBERD_4_10_I_, ItemIdentifiers.CRYSTAL_HALBERD_3_10_I_,
    ItemIdentifiers.CRYSTAL_HALBERD_2_10_I_, ItemIdentifiers.CRYSTAL_HALBERD_1_10_I_,
    ItemIdentifiers.CRYSTAL_HALBERD_FULL, ItemIdentifiers.CRYSTAL_HALBERD_9_10,
    ItemIdentifiers.CRYSTAL_HALBERD_8_10, ItemIdentifiers.CRYSTAL_HALBERD_7_10,
    ItemIdentifiers.CRYSTAL_HALBERD_6_10, ItemIdentifiers.CRYSTAL_HALBERD_5_10,
    ItemIdentifiers.CRYSTAL_HALBERD_4_10, ItemIdentifiers.CRYSTAL_HALBERD_3_10,
    ItemIdentifiers.CRYSTAL_HALBERD_2_10, ItemIdentifiers.CRYSTAL_HALBERD_1_10,
    ItemIdentifiers.CRYSTAL_HALBERD, ItemIdentifiers.CRYSTAL_HALBERD_3,
  ];
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
    itemIds: [ItemIdentifiers.DRAGON_HALBERD, ...CRYSTAL_HALBERD_IDS],
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
