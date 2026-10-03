// TODO: ported from xrsps-typescript; untested.
module.exports = function registerAccursedSceptreSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, ItemIdentifiers, PendingHit, Skill } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(9961);
  const DRAIN_FRACTION = 0.15;
  const DRAINED_SKILLS = [Skill.DEFENCE, Skill.MAGIC];

  function condemn(target) {
    if (!target.isPlayer()) {
      // TODO: NPC Defence/Magic combat-stat drain is not exposed by our core NPC state.
      return;
    }
    const skillManager = target.getAsPlayer().getSkillManager();
    for (const skill of DRAINED_SKILLS) {
      const baseLevel = skillManager.getMaxLevel(skill);
      const current = skillManager.getCurrentLevel(skill);
      const drainAmount = Math.floor(baseLevel * DRAIN_FRACTION);
      const cap = baseLevel - drainAmount;
      skillManager.setCurrentLevels(skill, Math.max(cap, current - drainAmount));
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
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      condemn(hit.getTarget());
    }
  }

  api.registerCombatSpecial({
    id: "accursed_sceptre",
    itemIds: [ItemIdentifiers.ACCURSED_SCEPTRE],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1.5,
    traits: { hitCount: 1, accuracyMultiplier: 1.5, damageMultiplier: 1.5 },
    combatMethod: new AccursedSceptreCombatMethod(),
  });
};
