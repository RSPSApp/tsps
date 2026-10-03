module.exports = function registerVolatileNightmareStaffSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, DamageFormulas, ItemIdentifiers, Misc, PendingHit } = api.core;

  const DRAIN = 55;
  const CAST_ANIMATION = new Animation(8532);

  class VolatileNightmareStaffCombatMethod extends CombatMethod {
    hits(character, target) {
      const hit = new PendingHit(character, target, this, 2);
      if (hit.isAccurate() && character.isPlayer()) {
        const player = character.getAsPlayer();
        const maxHit = DamageFormulas.getVolatileNightmareStaffBaseMaxHit(player);
        const hitRoll = Misc.randomInclusive(1, maxHit);
        hit.setTotalDamage(DamageFormulas.applyMagicDamageBonus(character, hitRoll));
      }
      return [hit];
    }

    canAttack(character, target) {
      if (!character.isPlayer()) {
        return false;
      }
      return character.getAsPlayer().getEquipment().getWeapon().getId() === ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF;
    }

    type() {
      return CombatType.MAGIC;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(CAST_ANIMATION);
    }

    attackSpeed(character) {
      return 5;
    }

    attackDistance(character) {
      return 10;
    }

    finished(character, target) {
      character.getCombat().reset();
      // reset() clears the interaction; a resolved cast still faces its target.
      character.setMobileInteraction(target);
      character.getMovementQueue().reset();
    }
  }

  api.registerCombatSpecial({
    id: "volatile_nightmare_staff",
    itemIds: [ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1.5,
    combatMethod: new VolatileNightmareStaffCombatMethod(),
  });
};
