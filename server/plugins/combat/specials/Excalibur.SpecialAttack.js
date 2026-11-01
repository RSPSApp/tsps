module.exports = function registerExcaliburSpecialAttack(api) {
  const { CombatMethod, CombatSpecial, CombatType, ItemIdentifiers, Skill, Sound, Sounds } = api.core;

  const DRAIN = 100;
  const DEFENCE_BOOST = 8;

  // Sanctuary is an instant utility special: +8 Defence, no attack roll.
  class ExcaliburCombatMethod extends CombatMethod {
    hits() {
      return null;
    }

    type() {
      return CombatType.MELEE;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      if (!character.isPlayer()) {
        return;
      }
      const skillManager = character.getAsPlayer().getSkillManager();
      // Sanctuary's own sound (Wiki: Sanctuary.wav; rsprox gameval `sanctuary`).
      Sounds.sendSound(character, Sound.EXCALIBUR_SPECIAL);
      const current = skillManager.getCurrentLevel(Skill.DEFENCE);
      const cap = skillManager.getMaxLevel(Skill.DEFENCE) + DEFENCE_BOOST;
      // Visible boosts do not stack; a stronger existing boost is preserved.
      skillManager.setCurrentLevels(Skill.DEFENCE, Math.max(current, Math.min(current + DEFENCE_BOOST, cap)));
    }
  }

  api.registerCombatSpecial({
    id: "excalibur",
    itemIds: [ItemIdentifiers.EXCALIBUR],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new ExcaliburCombatMethod(),
  });
};
