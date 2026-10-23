function buildSpecial(core) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Skill } = core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(11138);
  const SPECIAL_VFX = new Graphic(2810);
  const DRAIN_FRACTION = 0.05;
  const FLAT_DRAIN = 1;
  const DRAINED_SKILLS = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE];

  function weaken(hit) {
    if (!hit.isAccurate()) {
      return;
    }
    const target = hit.getTarget();
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    const demon = target.isNpc?.() && target.getAsNpc().getCurrentDefinition().hasAttribute("demon");
    const fraction = demon ? 0.15 : DRAIN_FRACTION;
    for (const skill of DRAINED_SKILLS) {
      const baseLevel = skillManager.getMaxLevel(skill);
      const current = skillManager.getCurrentLevel(skill);
      const drainAmount = Math.floor(baseLevel * fraction) + FLAT_DRAIN;
      skillManager.setCurrentLevels(skill, Math.max(target.isPlayer() ? 1 : 0, current - drainAmount));
    }
  }

  class EmberlightCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      weaken(hit);
    }
  }

  return {
    id: "emberlight",
    itemIds: [ItemIdentifiers.EMBERLIGHT],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1, meleeDefenceBonusIndex: 0 },
    combatMethod: new EmberlightCombatMethod(),
  };
}

module.exports = function registerEmberlightSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
