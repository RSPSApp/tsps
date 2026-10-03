// TODO: ported from xrsps-typescript; untested.
// TODO: Favour special attack animation/graphic ids not found; skipped.
module.exports = function registerAncientMaceSpecialAttack(api) {
  const { CombatSpecial, ItemIdentifiers, MeleeCombatMethod, Skill } = api.core;

  const DRAIN = 100;

  class AncientMaceCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate()) {
        return;
      }
      const damage = Math.max(0, Math.floor(hit.getTotalDamage()));
      if (damage <= 0) {
        return;
      }

      const target = hit.getTarget();
      if (target.isPlayer()) {
        const targetSkills = target.getAsPlayer().getSkillManager();
        const currentPrayer = targetSkills.getCurrentLevel(Skill.PRAYER);
        targetSkills.setCurrentLevels(Skill.PRAYER, Math.max(0, currentPrayer - damage));
      }

      const attacker = hit.getAttacker();
      if (attacker.isPlayer()) {
        const skills = attacker.getAsPlayer().getSkillManager();
        const currentPrayer = skills.getCurrentLevel(Skill.PRAYER);
        const prayerCap = skills.getMaxLevel(Skill.PRAYER) + damage;
        skills.setCurrentLevels(Skill.PRAYER, Math.min(prayerCap, currentPrayer + damage));
      }
    }
  }

  api.registerCombatSpecial({
    id: "ancient_mace",
    itemIds: [ItemIdentifiers.ANCIENT_MACE],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1 },
    combatMethod: new AncientMaceCombatMethod(),
  });
};
