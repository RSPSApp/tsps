// TODO: ported from xrsps-typescript; untested.
// TODO: Rock Knocker special attack animation/graphic ids not found; skipped.
module.exports = function registerDragonPickaxeSpecialAttack(api) {
  const { CombatMethod, CombatSpecial, CombatType, ItemIdentifiers, Skill } = api.core;

  const DRAIN = 100;
  const MINING_BOOST = 3;

  // Rock Knocker is an instant utility special: +3 Mining, no attack roll.
  class DragonPickaxeCombatMethod extends CombatMethod {
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
      const base = skillManager.getMaxLevel(Skill.MINING);
      const current = skillManager.getCurrentLevel(Skill.MINING);
      skillManager.setCurrentLevels(Skill.MINING, Math.max(current, base + MINING_BOOST));
    }
  }

  api.registerCombatSpecial({
    id: "dragon_pickaxe",
    itemIds: [
      ItemIdentifiers.DRAGON_PICKAXE,
      ItemIdentifiers.INFERNAL_PICKAXE,
      ItemIdentifiers._3RD_AGE_PICKAXE,
      ItemIdentifiers.CRYSTAL_PICKAXE,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new DragonPickaxeCombatMethod(),
  });
};
