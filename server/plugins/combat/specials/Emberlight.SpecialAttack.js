// TODO: ported from xrsps-typescript; untested.
module.exports = function registerEmberlightSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Skill } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(11138);
  const SPECIAL_VFX = new Graphic(2810);
  const DRAIN_FRACTION = 0.05;
  const FLAT_DRAIN = 1;
  const DRAINED_SKILLS = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE];

  // TODO: Emberlight's 15% demon drain multiplier needs an NPC demon-category flag.
  function weaken(hit) {
    if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
      return;
    }
    const target = hit.getTarget();
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

  api.registerCombatSpecial({
    id: "emberlight",
    itemIds: [ItemIdentifiers.EMBERLIGHT],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1 },
    combatMethod: new EmberlightCombatMethod(),
  });
};
