// TODO: base implementation — demon 10% drain needs an NPC demon-category flag; NPC stat drain not available in core. Ported from xrsps-typescript; untested.
module.exports = function registerArclightSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Skill } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(2890);
  const SPECIAL_VFX = new Graphic(483);
  const DRAIN_FRACTION = 0.05;
  const FLAT_DRAIN = 1;
  const DRAINED_SKILLS = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE];

  function weaken(target) {
    if (!target.isPlayer()) {
      // TODO: NPC combat-stat drain is not exposed by our core NPC state.
      return;
    }
    const skillManager = target.getAsPlayer().getSkillManager();
    for (const skill of DRAINED_SKILLS) {
      const baseLevel = skillManager.getMaxLevel(skill);
      const current = skillManager.getCurrentLevel(skill);
      const drainAmount = Math.floor(baseLevel * DRAIN_FRACTION) + FLAT_DRAIN;
      skillManager.setCurrentLevels(skill, Math.max(1, current - drainAmount));
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
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      weaken(hit.getTarget());
    }
  }

  api.registerCombatSpecial({
    id: "arclight",
    itemIds: [ItemIdentifiers.ARCLIGHT],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    combatMethod: new ArclightCombatMethod(),
  });
};
