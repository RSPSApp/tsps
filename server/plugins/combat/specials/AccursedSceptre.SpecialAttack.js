// TODO: ported from xrsps-typescript; untested.
function buildSpecial(core) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, ItemIdentifiers, PendingHit, Skill } = core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(9961);
  const DRAIN_FRACTION = 0.15;
  const DRAINED_SKILLS = [Skill.DEFENCE, Skill.MAGIC];

  function condemn(target) {
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    for (const skill of DRAINED_SKILLS) {
      const baseLevel = skillManager.getMaxLevel(skill);
      const current = skillManager.getCurrentLevel(skill);
      const drainAmount = Math.floor(baseLevel * DRAIN_FRACTION);
      const cap = baseLevel - drainAmount;
      skillManager.setCurrentLevels(skill, Math.min(current, Math.max(cap, current - drainAmount)));
    }
  }

  class AccursedSceptreCombatMethod extends CombatMethod {
    hits(character, target) {
      return [new PendingHit(character, target, this)];
    }

    type() {
      return CombatType.MAGIC;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(SPECIAL_ANIMATION);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate()) {
        return;
      }
      condemn(hit.getTarget());
    }
  }

  return {
    id: "accursed_sceptre",
    itemIds: [ItemIdentifiers.ACCURSED_SCEPTRE],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1.5,
    traits: { hitCount: 1, accuracyMultiplier: 1.5, damageMultiplier: 1.5 },
    combatMethod: new AccursedSceptreCombatMethod(),
  };
}

module.exports = function registerAccursedSceptreSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
