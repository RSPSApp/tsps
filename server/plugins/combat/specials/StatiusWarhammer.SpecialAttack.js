const { mechanicSchema, mechanicSettings } = require("./Mechanics.SpecialAttack");
// TODO: ported from xrsps-typescript; untested.
function buildSpecial(core) {
  const { Animation, CombatSpecial, ItemIdentifiers, MeleeCombatMethod, Skill, Sound, Sounds } = core;

  const DRAIN = 35;
  const DEFENCE_DRAIN_FRACTION = 0.75;
  const ANIMATION = new Animation(1378);

  function smash(hit, config) {
    if (!hit.isAccurate() || config.requireDamage && Math.floor(hit.getTotalDamage()) <= 0 || config.playersOnly && !hit.getTarget().isPlayer()) {
      return;
    }
    const target = hit.getTarget();
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : null;
    const currentLevel = Math.max(0, Math.floor(skillManager
      ? skillManager.getCurrentLevel(Skill.DEFENCE) : target.getAsNpc().getDefenceLevel()));
    const level = currentLevel - Math.floor(currentLevel * config.percent / 100);
    if (skillManager) skillManager.setCurrentLevels(Skill.DEFENCE, level);
    else target.getAsNpc().setDefenceLevel(level);
  }

  class StatiusWarhammerCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      Sounds.playAreaSoundAt(character, Sound.DRAGON_WARHAMMER_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      const config = mechanicSettings(this, "defence-drain", { percent: DEFENCE_DRAIN_FRACTION * 100, requireDamage: false, playersOnly: false });
      if (!config.enabled) return;
      smash(hit, config);
    }
  }

  return {
    id: "statius_warhammer",
    itemIds: [ItemIdentifiers.STATIUSS_WARHAMMER],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      minimumDamageMultiplier: 0.25,
      maximumDamageMultiplier: 1.25,
    },
    metadata: { editorMechanics: mechanicSchema("defence-drain", { percent: DEFENCE_DRAIN_FRACTION * 100, requireDamage: false, playersOnly: false }) },
    combatMethod: new StatiusWarhammerCombatMethod(),
  };
}

module.exports = function registerStatiusWarhammerSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
