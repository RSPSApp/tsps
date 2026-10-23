module.exports = function registerDragonHarpoonSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Equipment, Graphic, ItemIdentifiers, Skill } = api.core;

  const DRAIN = 100;
  const FISHING_BOOST = 3;
  const FORCED_CHAT = "Here fishy fishies!";
  const GLOW = new Graphic(246);
  const CRYSTAL_GLOW = new Graphic(1688);
  const DRAGON_STAB = new Animation(7393);
  const INFERNAL_STAB = new Animation(7394);
  const CRYSTAL_STAB = new Animation(8333);

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
      const weaponId = character.getAsPlayer().getEquipment().get(Equipment.WEAPON_SLOT).getId();
      const crystal = weaponId === ItemIdentifiers.CRYSTAL_HARPOON;
      character.forceChat(FORCED_CHAT);
      character.performAnimation(crystal ? CRYSTAL_STAB
        : weaponId === ItemIdentifiers.INFERNAL_HARPOON ? INFERNAL_STAB : DRAGON_STAB);
      character.performGraphic(crystal ? CRYSTAL_GLOW : GLOW);
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
