// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonAxeSpecialAttack(api) {
  const { CombatMethod, CombatSpecial, CombatType, ItemIdentifiers, Skill } = api.core;

  const DRAIN = 100;
  const WOODCUTTING_BOOST = 3;

  // Lumber Up is an instant utility special: +3 Woodcutting, no attack roll.
  class DragonAxeCombatMethod extends CombatMethod {
    hits() {
      return null;
    }

    type() {
      return CombatType.MELEE;
    }

    start(character) {
      CombatSpecial.drain(character, DRAIN);
      if (!character.isPlayer()) {
        return;
      }
      const skillManager = character.getAsPlayer().getSkillManager();
      const base = skillManager.getMaxLevel(Skill.WOODCUTTING);
      const current = skillManager.getCurrentLevel(Skill.WOODCUTTING);
      skillManager.setCurrentLevels(Skill.WOODCUTTING, Math.max(current, base + WOODCUTTING_BOOST));
    }
  }

  api.registerCombatSpecial({
    id: "dragon_axe",
    itemIds: [
      ItemIdentifiers.DRAGON_AXE,
      ItemIdentifiers.INFERNAL_AXE,
      ItemIdentifiers._3RD_AGE_AXE,
      ItemIdentifiers.CRYSTAL_AXE,
      ItemIdentifiers.CRYSTAL_FELLING_AXE,
      ItemIdentifiers._3RD_AGE_FELLING_AXE,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new DragonAxeCombatMethod(),
  });
};
