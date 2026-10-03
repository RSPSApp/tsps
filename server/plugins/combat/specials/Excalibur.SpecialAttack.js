// TODO: ported from xrsps-typescript; untested.
module.exports = function registerExcaliburSpecialAttack(api) {
  const { CombatMethod, CombatSpecial, CombatType, ItemIdentifiers, Skill } = api.core;

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
      const current = skillManager.getCurrentLevel(Skill.DEFENCE);
      skillManager.setCurrentLevels(Skill.DEFENCE, Math.floor(current + DEFENCE_BOOST));
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
