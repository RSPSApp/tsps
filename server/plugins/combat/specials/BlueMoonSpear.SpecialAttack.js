// Break Shackles (https://oldschool.runescape.wiki/w/Blue_moon_spear): 50% special energy, full Blue Moon
// armour. The swing removes every binding effect on the target (the Wiki does not tie it to the hit). Each tick of binding it
// removes adds 1.5% accuracy and 1.5% damage; the damage bonus stops at 112.5%, the accuracy bonus has no cap.
module.exports = function registerBlueMoonSpearSpecialAttack(api) {
  const { Animation, CombatSpecial, Equipment, Graphic, ItemIdentifiers, MeleeCombatMethod, TimerKey } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(11055);
  const SPECIAL_VFX = new Graphic(2791);
  const CRUSH_BONUS_INDEX = 2;
  const BONUS_PER_TICK = 0.015;
  const MAX_DAMAGE_BONUS = 1.125;
  /** Ticks of binding each wielder's current swing removed: the freeze is already gone when the hit rolls. */
  const removed = new WeakMap();

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

  function traitsFor(player) {
    const ticks = removed.get(player) ?? 0;
    return {
      hitCount: 1,
      meleeAttackBonusIndex: CRUSH_BONUS_INDEX,
      accuracyMultiplier: 1 + ticks * BONUS_PER_TICK,
      damageMultiplier: 1 + Math.min(ticks * BONUS_PER_TICK, MAX_DAMAGE_BONUS),
    };
  }

  class BlueMoonSpearCombatMethod extends MeleeCombatMethod {
    canAttack(character, target) {
      return character.isPlayer() && hasFullBlueMoonArmour(character.getAsPlayer());
    }

    start(character, target) {
      // Only a binding the target really has counts; the swing clears it, hit or miss.
      const timers = target.getTimers();
      removed.set(character, timers.left(TimerKey.FREEZE));
      timers.cancel(TimerKey.FREEZE);
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      removed.delete(hit.getAttacker());
    }
  }

  api.registerCombatSpecial({
    id: "blue_moon_spear",
    itemIds: [ItemIdentifiers.BLUE_MOON_SPEAR, ItemIdentifiers.BLUE_MOON_SPEAR_4],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traitsFor,
    combatMethod: new BlueMoonSpearCombatMethod(),
  });
};
