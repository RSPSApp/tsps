/**
 * Smash (https://oldschool.runescape.wiki/w/Dragon_warhammer): 50% more damage, and 30% of the
 * target's current Defence on a successful hit, which for this special has to deal damage (Mod
 * Ash: "the DWH blog said this one wouldn't" trigger on a 0). A Smash that drains nothing asks
 * "combat-special:missed-drain" whether the target still loses some (Tekton: 5%).
 */
function buildSpecial(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Skill, Sound, Sounds } = api.core;

  const ID = "dragon_warhammer";
  const DRAIN = 50;
  const DEFENCE_DRAIN_FRACTION = 0.3;
  const ANIMATION = new Animation(1378);
  const GRAPHIC = new Graphic(1292, Priority.HIGH);

  function smash(hit) {
    if (hit.isAccurate() && Math.floor(hit.getTotalDamage()) > 0) {
      drainDefence(hit, DEFENCE_DRAIN_FRACTION);
      return;
    }
    const missed = { hit, specialId: ID, fraction: 0, levels: 0 };
    api.emitCustomEvent("combat-special:missed-drain", missed);
    if (missed.fraction > 0) drainDefence(hit, missed.fraction);
  }

  function drainDefence(hit, fraction) {
    const target = hit.getTarget();
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : null;
    const currentLevel = Math.max(0, Math.floor(skillManager
      ? skillManager.getCurrentLevel(Skill.DEFENCE) : target.getAsNpc().getDefenceLevel()));
    const drainAmount = Math.floor(currentLevel * fraction);
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
      Sounds.playAreaSoundAt(character, Sound.DRAGON_WARHAMMER_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      smash(hit);
    }
  }

  return {
    id: ID,
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
  api.registerCombatSpecial(buildSpecial(api));
};
