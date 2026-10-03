// TODO: ported from xrsps-typescript; untested.
module.exports = function registerBlueMoonSpearSpecialAttack(api) {
  const { Animation, CombatSpecial, Equipment, Graphic, ItemIdentifiers, MeleeCombatMethod, TimerKey } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(11055);
  const SPECIAL_VFX = new Graphic(2791);
  const CRUSH_BONUS_INDEX = 2;

  const BLUE_MOON_HELM_IDS = [
    ItemIdentifiers.BLUE_MOON_HELM,
    ItemIdentifiers.BLUE_MOON_HELM_4,
    ItemIdentifiers.BLUE_MOON_HELM_BROKEN_,
    ItemIdentifiers.BLUE_MOON_HELM_6,
  ];
  const BLUE_MOON_BODY_IDS = [
    ItemIdentifiers.BLUE_MOON_CHESTPLATE,
    ItemIdentifiers.BLUE_MOON_CHESTPLATE_4,
    ItemIdentifiers.BLUE_MOON_CHESTPLATE_BROKEN_,
    ItemIdentifiers.BLUE_MOON_CHESTPLATE_6,
  ];
  const BLUE_MOON_LEGS_IDS = [
    ItemIdentifiers.BLUE_MOON_TASSETS,
    ItemIdentifiers.BLUE_MOON_TASSETS_4,
    ItemIdentifiers.BLUE_MOON_TASSETS_BROKEN_,
    ItemIdentifiers.BLUE_MOON_TASSETS_6,
  ];

  function hasFullBlueMoonArmour(player) {
    const items = player.getEquipment().getItems();
    return BLUE_MOON_HELM_IDS.includes(items[Equipment.HEAD_SLOT].getId())
      && BLUE_MOON_BODY_IDS.includes(items[Equipment.BODY_SLOT].getId())
      && BLUE_MOON_LEGS_IDS.includes(items[Equipment.LEG_SLOT].getId());
  }

  class BlueMoonSpearCombatMethod extends MeleeCombatMethod {
    canAttack(character, target) {
      return character.isPlayer() && hasFullBlueMoonArmour(character.getAsPlayer());
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      // TODO: upstream scales accuracy/damage by the target's remaining bind
      // ticks and only consumes a legitimate active freeze; our freeze clock is
      // not exposed to plugins, so only the freeze clear and base crush roll are ported.
      hit.getTarget().getTimers().cancel(TimerKey.FREEZE);
    }
  }

  api.registerCombatSpecial({
    id: "blue_moon_spear",
    itemIds: [ItemIdentifiers.BLUE_MOON_SPEAR, ItemIdentifiers.BLUE_MOON_SPEAR_4],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    // TODO: upstream computes accuracyMultiplier/damageMultiplier from the
    // target's remaining bind ticks; those cannot be expressed as static traits.
    traits: { hitCount: 1, meleeAttackBonusIndex: CRUSH_BONUS_INDEX },
    combatMethod: new BlueMoonSpearCombatMethod(),
  });
};
