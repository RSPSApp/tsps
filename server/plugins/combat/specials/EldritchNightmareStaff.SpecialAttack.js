// TODO: ported from xrsps-typescript; untested.
module.exports = function registerEldritchNightmareStaffSpecialAttack(api) {
  const { CombatMethod, CombatSpecial, CombatType, ItemIdentifiers, PendingHit, Skill } = api.core;

  const DRAIN = 55;
  const BASE_MAX_HIT = 44;
  const PRAYER_RESTORE_FRACTION = 0.5;
  const MAXIMUM_PRAYER_LEVEL = 120;

  // TODO: core's magic hit path (getMagicMaxhit) ignores maximumHitSource /
  // visibleMagicMaximumHit and damageMultiplier, so the Invocate max hit is not
  // yet scaled by the traits recorded below.
  class EldritchNightmareStaffCombatMethod extends CombatMethod {
    hits(character, target) {
      return [new PendingHit(character, target, this, 2)];
    }

    type() {
      return CombatType.MAGIC;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      const attacker = hit.getAttacker();
      if (!attacker.isPlayer()) {
        return;
      }
      const skillManager = attacker.getAsPlayer().getSkillManager();
      const current = skillManager.getCurrentLevel(Skill.PRAYER);
      const restored = Math.floor(Math.floor(hit.getTotalDamage()) * PRAYER_RESTORE_FRACTION);
      skillManager.setCurrentLevels(Skill.PRAYER, Math.min(MAXIMUM_PRAYER_LEVEL, current + restored));
    }

    attackSpeed(character) {
      return 5;
    }

    attackDistance(character) {
      return 10;
    }
  }

  api.registerCombatSpecial({
    id: "eldritch_nightmare_staff",
    itemIds: [ItemIdentifiers.ELDRITCH_NIGHTMARE_STAFF],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1,
      rollAttackType: "magic",
      damageType: "magic",
      maximumHitSource: "visible_magic",
      visibleMagicMaximumHit: BASE_MAX_HIT,
    },
    combatMethod: new EldritchNightmareStaffCombatMethod(),
  });
};
