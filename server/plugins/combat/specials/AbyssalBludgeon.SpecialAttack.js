// TODO: ported from xrsps-typescript; untested.
const { mechanicSchema, mechanicSettings } = require("./Mechanics.SpecialAttack");
module.exports = function registerAbyssalBludgeonSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Skill, Sound, Sounds } = api.core;

  const DRAIN = 50;
  const DAMAGE_PER_MISSING_PRAYER_POINT = 0.005;
  const ANIMATION = new Animation(3299);
  const GRAPHIC = new Graphic(1284, Priority.HIGH);

  // Keep player-dependent bonuses separate from the shared static hit pattern.
  const TRAITS = { hitCount: 1, damageMultiplier: 1 };

  class AbyssalBludgeonCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);

      character.performAnimation(ANIMATION);
      Sounds.playAreaSoundAt(character, Sound.GRANITE_MAUL_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      hit.getTarget().performGraphic(GRAPHIC);
    }

    getSpecialFeatureTraits(character) {
      const config = mechanicSettings(this, "missing-resource-bonus", { skill: "prayer", damagePerPoint: DAMAGE_PER_MISSING_PRAYER_POINT * 100, accuracyPerPoint: 0, capEnabled: false, damageCap: 100 });
      if (!config.enabled || !character.isPlayer()) return {};
      const manager = character.getAsPlayer().getSkillManager(), skill = Skill[config.skill.toUpperCase()];
      const missing = Math.max(0, Math.floor(manager.getMaxLevel(skill)) - Math.floor(manager.getCurrentLevel(skill)));
      const damage = missing * config.damagePerPoint / 100;
      return { damageMultiplier: 1 + (config.capEnabled ? Math.min(damage, config.damageCap / 100) : damage), accuracyMultiplier: 1 + missing * config.accuracyPerPoint / 100 };
    }
  }

  const method = new AbyssalBludgeonCombatMethod();

  api.registerCombatSpecial({
    id: "abyssal_bludgeon",
    itemIds: [ItemIdentifiers.ABYSSAL_BLUDGEON],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: TRAITS,
    traitsFor: player => ({ ...TRAITS, ...method.getSpecialFeatureTraits(player) }),
    metadata: { editorMechanics: mechanicSchema("missing-resource-bonus", { skill: "prayer", damagePerPoint: DAMAGE_PER_MISSING_PRAYER_POINT * 100, accuracyPerPoint: 0, capEnabled: false, damageCap: 100, _event: "traits", _hook: "getSpecialFeatureTraits" }) },
    combatMethod: method,
  });
};
