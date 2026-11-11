// TODO: ported from xrsps-typescript; untested.
// TODO: Scatter Ashes special attack animation/graphic ids not found; skipped.
module.exports = function registerPurgingStaffSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, ItemIdentifiers, PendingHit } = api.core;

  const DRAIN = 25;
  // rsprox_transcripts/235/03315.txt:39781 and :40372 (against a skeleton, the purging staff worn): the special is
  // disarmed with this line and no energy is spent.
  const REFUSAL = "You can't use this special attack against non-demon enemies.";

  function isDemon(target) {
    return target?.isNpc?.() === true && target.getAsNpc().getCurrentDefinition().hasAttribute("demon");
  }

  // TODO: Scatter Ashes should use the strongest available Demonbane spell and refund
  // runes on a kill; spell choice and Demonbane scaling are not exposed to plugins.
  class PurgingStaffCombatMethod extends CombatMethod {
    hits(character, target) {
      return [new PendingHit(character, target, this, 3)];
    }

    type() {
      return CombatType.MAGIC;
    }

    canAttack(character, target) {
      if (!isDemon(target)) {
        character.sendMessage(REFUSAL);
        character.setSpecialActivated(false);
        if (character.isPlayer()) CombatSpecial.updateBar(character.getAsPlayer());
        return false;
      }
      return super.canAttack(character, target);
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      if (character.getAttackAnim() !== -1) {
        character.performAnimation(new Animation(character.getAttackAnim()));
      }
    }
  }

  api.registerCombatSpecial({
    id: "purging_staff",
    itemIds: [ItemIdentifiers.PURGING_STAFF, ItemIdentifiers.PURGING_STAFF_2],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      rollAttackType: "magic",
      damageType: "magic",
    },
    combatMethod: new PurgingStaffCombatMethod(),
  });
};
