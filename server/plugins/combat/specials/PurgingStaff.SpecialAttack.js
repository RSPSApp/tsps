// TODO: ported from xrsps-typescript; untested.
// TODO: Scatter Ashes special attack animation/graphic ids not found; skipped.
module.exports = function registerPurgingStaffSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, ItemIdentifiers, PendingHit } = api.core;

  const DRAIN = 25;

  // TODO: Scatter Ashes should use the strongest available Demonbane spell and refund
  // runes on a kill; spell choice and Demonbane scaling are not exposed to plugins.
  class PurgingStaffCombatMethod extends CombatMethod {
    hits(character, target) {
      return [new PendingHit(character, target, this, 3)];
    }

    type() {
      return CombatType.MAGIC;
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
