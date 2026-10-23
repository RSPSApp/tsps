// Smash drains 30% of current Defence after a successful accuracy roll.
function buildSpecial(core) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Skill, Sounds } = core;

  const DRAIN = 50;
  const DEFENCE_DRAIN_FRACTION = 0.3;
  const ANIMATION = new Animation(1378);
  const GRAPHIC = new Graphic(1292, Priority.HIGH);

  function smash(hit) {
    if (!hit.isAccurate()) {
      return;
    }
    const target = hit.getTarget();
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : null;
    const currentLevel = Math.max(0, Math.floor(skillManager
      ? skillManager.getCurrentLevel(Skill.DEFENCE) : target.getAsNpc().getDefenceLevel()));
    const drainAmount = Math.floor(currentLevel * DEFENCE_DRAIN_FRACTION);
    if (drainAmount <= 0) return;
    const level = currentLevel - drainAmount;
    if (skillManager) skillManager.setCurrentLevels(Skill.DEFENCE, level);
    else target.getAsNpc().setDefenceLevel(level);
    hit.getAttacker().getAsPlayer().sendMessage(`You reduce your opponent's Defence by ${drainAmount}, from ${currentLevel} to ${level}.`);
  }

  class DragonWarhammerCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit) {
      smash(hit);
    }
  }

  return {
    id: "dragon_warhammer",
    itemIds: [ItemIdentifiers.DRAGON_WARHAMMER, ItemIdentifiers.DRAGON_WARHAMMER_3, ItemIdentifiers.DRAGON_WARHAMMER_OR_, ItemIdentifiers.DRAGON_WARHAMMER_CR_],
    drainAmount: DRAIN,
    strengthMultiplier: 1.5,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1.5,
    },
    combatMethod: new DragonWarhammerCombatMethod(),
  };
}

module.exports = function registerDragonWarhammerSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
