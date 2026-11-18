module.exports = function registerDragonPickaxeSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Equipment, ItemIdentifiers, Skill, Sounds } = api.core;

  const DRAIN = 100;
  const MINING_BOOST = 3;
  const FORCED_CHAT = "Smashing!";
  // rsprox recording 553: area sound on the same tick as Rock Knocker.
  const ROCK_KNOCKER_SOUND = 2655;
  // Cache sequences embed the held tool model. Notes, placeholders and Gauntlet
  // tools are deliberately absent; depleted infernal/crystal tools keep the special.
  const DRAGON_KNOCK = new Animation(7138);
  const UPGRADED_KNOCK = new Animation(334);
  const ZALCANO_KNOCK = new Animation(8330);
  const INFERNAL_KNOCK = new Animation(3410);
  const THIRD_AGE_KNOCK = new Animation(7267);
  const CRYSTAL_KNOCK = new Animation(8329);
  const TRAILBLAZER_KNOCK = new Animation(11821);
  const RELOADED_KNOCK = new Animation(11822);
  const PICKAXE_ANIMATIONS = new Map([
    [ItemIdentifiers.DRAGON_PICKAXE, DRAGON_KNOCK], // rockknocker
    [ItemIdentifiers.DRAGON_PICKAXE_3, UPGRADED_KNOCK], // rockknocker_pretty
    [ItemIdentifiers.DRAGON_PICKAXE_OR_, ZALCANO_KNOCK], // rockknocker_zalcano
    [ItemIdentifiers.INFERNAL_PICKAXE, INFERNAL_KNOCK], // rockknocker_infernal
    [ItemIdentifiers.INFERNAL_PICKAXE_UNCHARGED_, INFERNAL_KNOCK],
    [ItemIdentifiers._3RD_AGE_PICKAXE, THIRD_AGE_KNOCK], // rockknocker_3a
    [ItemIdentifiers.CRYSTAL_PICKAXE, CRYSTAL_KNOCK], // rockknocker_crystal
    [ItemIdentifiers.CRYSTAL_PICKAXE_INACTIVE_, CRYSTAL_KNOCK],
    [ItemIdentifiers.DRAGON_PICKAXE_OR__3, TRAILBLAZER_KNOCK], // rockknocker_trailblazer
    [ItemIdentifiers.INFERNAL_PICKAXE_OR_, TRAILBLAZER_KNOCK],
    [ItemIdentifiers.INFERNAL_PICKAXE_UNCHARGED__2, TRAILBLAZER_KNOCK],
    [ItemIdentifiers.DRAGON_PICKAXE_OR__5, RELOADED_KNOCK], // rockknocker_trailblazer_reloaded
    [ItemIdentifiers.INFERNAL_PICKAXE_OR__3, RELOADED_KNOCK],
    [ItemIdentifiers.INFERNAL_PICKAXE_UNCHARGED__4, RELOADED_KNOCK],
  ]);

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
      const player = character.getAsPlayer();
      const weaponId = player.getEquipment().get(Equipment.WEAPON_SLOT).getId();
      character.forceChat(FORCED_CHAT);
      character.performAnimation(PICKAXE_ANIMATIONS.get(weaponId));
      const location = character.getLocation();
      Sounds.playAreaSound({
        source: character,
        soundId: ROCK_KNOCKER_SOUND,
        x: location.getX(),
        y: location.getY(),
        level: location.getZ(),
        loops: 1,
        delay: 0,
        radius: 1,
      });
      const skillManager = character.getAsPlayer().getSkillManager();
      const base = skillManager.getMaxLevel(Skill.MINING);
      const current = skillManager.getCurrentLevel(Skill.MINING);
      skillManager.setCurrentLevels(Skill.MINING, Math.max(current, base + MINING_BOOST));
    }
  }

  api.registerCombatSpecial({
    id: "dragon_pickaxe",
    itemIds: [...PICKAXE_ANIMATIONS.keys()],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new DragonPickaxeCombatMethod(),
  });
};
