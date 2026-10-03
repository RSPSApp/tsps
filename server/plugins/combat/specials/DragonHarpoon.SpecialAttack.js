// TODO: ported from xrsps-typescript; untested.
// TODO: Fishstabber special attack animation/graphic ids not found; skipped.
module.exports = function registerDragonHarpoonSpecialAttack(api) {
  const { CombatMethod, CombatSpecial, CombatType, ItemIdentifiers, Skill } = api.core;

  const DRAIN = 100;
  const FISHING_BOOST = 3;

  // Fishstabber is an instant utility special: +3 Fishing, no attack roll.
  class DragonHarpoonCombatMethod extends CombatMethod {
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
      const base = skillManager.getMaxLevel(Skill.FISHING);
      const current = skillManager.getCurrentLevel(Skill.FISHING);
      skillManager.setCurrentLevels(Skill.FISHING, Math.max(current, base + FISHING_BOOST));
    }
  }

  api.registerCombatSpecial({
    id: "dragon_harpoon",
    itemIds: [
      ItemIdentifiers.DRAGON_HARPOON,
      ItemIdentifiers.INFERNAL_HARPOON,
      ItemIdentifiers.CRYSTAL_HARPOON,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new DragonHarpoonCombatMethod(),
  });
};
