function buildSpecial(core) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Skill } = core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(2890);
  const SPECIAL_VFX = new Graphic(483);
  const DRAIN_FRACTION = 0.05;
  const FLAT_DRAIN = 1;
  const DRAINED_SKILLS = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE];

  function weaken(target) {
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    const demon = target.isNpc?.() && target.getAsNpc().getCurrentDefinition().hasAttribute("demon");
    const fraction = demon ? 0.10 : DRAIN_FRACTION;
    for (const skill of DRAINED_SKILLS) {
      const baseLevel = skillManager.getMaxLevel(skill);
      const current = skillManager.getCurrentLevel(skill);
      const drainAmount = Math.floor(baseLevel * fraction) + FLAT_DRAIN;
      skillManager.setCurrentLevels(skill, Math.max(target.isPlayer() ? 1 : 0, current - drainAmount));
    }
  }

  class ArclightCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate()) {
        return;
      }
      weaken(hit.getTarget());
    }
  }

  return {
    id: "arclight",
    itemIds: [ItemIdentifiers.ARCLIGHT],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1, meleeDefenceBonusIndex: 0 },
    combatMethod: new ArclightCombatMethod(),
  };
}

module.exports = function registerArclightSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
