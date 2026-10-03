// TODO: ported from xrsps-typescript; untested.
module.exports = function registerBoneDaggerSpecialAttack(api) {
  const { CombatSpecial, ItemIdentifiers, MeleeCombatMethod, Skill } = api.core;

  const DRAIN = 75;

  class BoneDaggerCombatMethod extends MeleeCombatMethod {
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
      if (!target.isPlayer()) {
        // TODO: NPC combat-stat drain is not exposed by our core NPC state.
        return;
      }
      const skillManager = target.getAsPlayer().getSkillManager();
      const current = skillManager.getCurrentLevel(Skill.DEFENCE);
      skillManager.setCurrentLevels(Skill.DEFENCE, Math.max(1, current - damage));
    }
  }

  api.registerCombatSpecial({
    id: "bone_dagger",
    itemIds: [
      ItemIdentifiers.BONE_DAGGER,
      ItemIdentifiers.BONE_DAGGER_P_,
      ItemIdentifiers.BONE_DAGGER_P_PLUS_,
      ItemIdentifiers.BONE_DAGGER_P_PLUS_PLUS_,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    // TODO: OSRS guarantees accuracy only when the wielder was not the target's
    // most recent attacker; that combat-relationship check is not exposed here.
    traits: { hitCount: 1 },
    combatMethod: new BoneDaggerCombatMethod(),
  });
};
