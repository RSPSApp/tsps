module.exports = function registerDragonHarpoonSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Equipment, Graphic, ItemIdentifiers, Skill, Sound, Sounds } = api.core;

  const DRAIN = 100;
  const FISHING_BOOST = 3;
  const FORCED_CHAT = "Here fishy fishies!";
  const GLOW = new Graphic(246);
  const CRYSTAL_GLOW = new Graphic(1688);
  const DRAGON_STAB = new Animation(7393);
  const INFERNAL_STAB = new Animation(7394);
  const CRYSTAL_STAB = new Animation(8333);
  const TRAILBLAZER_STAB = new Animation(11823);
  const RELOADED_STAB = new Animation(11824);
  const CRYSTAL_HARPOONS = [ItemIdentifiers.CRYSTAL_HARPOON, ItemIdentifiers.CRYSTAL_HARPOON_INACTIVE_];
  // The cache's Fishstabber sequences carry the held tool model. Keep every
  // wieldable variant here so an ornament or depleted charge cannot lose the special.
  const HARPOON_ANIMATIONS = new Map([
    [ItemIdentifiers.DRAGON_HARPOON, DRAGON_STAB],
    [ItemIdentifiers.INFERNAL_HARPOON, INFERNAL_STAB],
    [ItemIdentifiers.INFERNAL_HARPOON_UNCHARGED_, INFERNAL_STAB],
    [ItemIdentifiers.CRYSTAL_HARPOON, CRYSTAL_STAB],
    [ItemIdentifiers.CRYSTAL_HARPOON_INACTIVE_, CRYSTAL_STAB],
    [ItemIdentifiers.DRAGON_HARPOON_OR_, TRAILBLAZER_STAB],
    [ItemIdentifiers.INFERNAL_HARPOON_OR_, TRAILBLAZER_STAB],
    [ItemIdentifiers.INFERNAL_HARPOON_UNCHARGED__2, TRAILBLAZER_STAB],
    [ItemIdentifiers.DRAGON_HARPOON_OR__3, RELOADED_STAB],
    [ItemIdentifiers.INFERNAL_HARPOON_OR__3, RELOADED_STAB],
    [ItemIdentifiers.INFERNAL_HARPOON_UNCHARGED__4, RELOADED_STAB],
  ]);

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
      const crystal = CRYSTAL_HARPOONS.includes(weaponId);
      character.forceChat(FORCED_CHAT);
      character.performAnimation(HARPOON_ANIMATIONS.get(weaponId));
      character.performGraphic(crystal ? CRYSTAL_GLOW : GLOW);
      // rsprox_transcripts/227/00075.txt:77210 (and every recorded Fishstabber): synth sound 2538, the dragon
      // battleaxe special's.
      Sounds.sendSound(character, Sound.DRAGON_BATTLEAXE_SPECIAL);
      const skillManager = character.getAsPlayer().getSkillManager();
      const base = skillManager.getMaxLevel(Skill.FISHING);
      const current = skillManager.getCurrentLevel(Skill.FISHING);
      skillManager.setCurrentLevels(Skill.FISHING, Math.max(current, base + FISHING_BOOST));
    }
  }

  api.registerCombatSpecial({
    id: "dragon_harpoon",
    itemIds: [...HARPOON_ANIMATIONS.keys()],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new DragonHarpoonCombatMethod(),
  });
};
