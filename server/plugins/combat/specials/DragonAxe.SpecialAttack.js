const { mechanicSchema, mechanicSettings } = require("./Mechanics.SpecialAttack");
module.exports = function registerDragonAxeSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Equipment, Graphic, GraphicHeight, ItemIdentifiers, Skill, Sound, Sounds } = api.core;

  const DRAIN = 100;
  const WOODCUTTING_BOOST = 3;
  const FORCED_CHAT = "Chop chop!";
  const ANIMATION = new Animation(2876);
  const SWOOSH = new Graphic(479, GraphicHeight.HIGH);
  const CRYSTAL_SWOOSH = new Graphic(1689, GraphicHeight.HIGH);
  const CRYSTAL_AXES = [ItemIdentifiers.CRYSTAL_AXE, ItemIdentifiers.CRYSTAL_FELLING_AXE];

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
      const weaponId = CombatSpecial.weaponIdFor(character.getAsPlayer());
      character.forceChat(FORCED_CHAT);
      character.performAnimation(ANIMATION);
      character.performGraphic(CRYSTAL_AXES.includes(weaponId) ? CRYSTAL_SWOOSH : SWOOSH);
      const location = character.getLocation();
      Sounds.playAreaSound({
        source: character,
        soundId: Sound.DRAGON_AXE_SPECIAL.getId(),
        x: location.getX(),
        y: location.getY(),
        level: location.getZ(),
        loops: 1,
        delay: 0,
        radius: 1,
      });
      this.applySpecialFeature(character);
    }

    applySpecialFeature(character) {
      if (!character.isPlayer()) return;
      const config = mechanicSettings(this, "skill-boost", { skill: "woodcutting", flat: WOODCUTTING_BOOST, percent: 0 });
      if (!config.enabled) return;
      const skill = Skill[config.skill.toUpperCase()], skillManager = character.getAsPlayer().getSkillManager();
      const base = skillManager.getMaxLevel(skill), current = skillManager.getCurrentLevel(skill);
      skillManager.setCurrentLevels(skill, Math.max(current, base + config.flat + Math.floor(base * config.percent / 100)));
    }
  }

  api.registerCombatSpecial({
    id: "dragon_axe",
    itemIds: [
      ItemIdentifiers.DRAGON_AXE,
      ItemIdentifiers.DRAGON_FELLING_AXE,
      ItemIdentifiers.DRAGON_AXE_OR_,
      ItemIdentifiers.DRAGON_AXE_OR__3,
      ItemIdentifiers.INFERNAL_AXE,
      ItemIdentifiers.INFERNAL_AXE_UNCHARGED_,
      ItemIdentifiers.INFERNAL_AXE_OR_,
      ItemIdentifiers.INFERNAL_AXE_UNCHARGED__2,
      ItemIdentifiers.INFERNAL_AXE_OR__3,
      ItemIdentifiers.INFERNAL_AXE_UNCHARGED__4,
      ItemIdentifiers._3RD_AGE_AXE,
      ItemIdentifiers.CRYSTAL_AXE,
      ItemIdentifiers.CRYSTAL_AXE_INACTIVE_,
      ItemIdentifiers.CRYSTAL_FELLING_AXE,
      ItemIdentifiers.CRYSTAL_FELLING_AXE_INACTIVE_,
      ItemIdentifiers._3RD_AGE_FELLING_AXE,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    metadata: { editorMechanics: mechanicSchema("skill-boost", { skill: "woodcutting", flat: WOODCUTTING_BOOST, percent: 0, _event: "launch", _hook: "applySpecialFeature" }) },
    combatMethod: new DragonAxeCombatMethod(),
  });
};
