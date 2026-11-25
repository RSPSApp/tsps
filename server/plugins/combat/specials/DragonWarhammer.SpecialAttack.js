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

  function smash(hit, config) {
    if (hit.isAccurate() && (!config.requireDamage || Math.floor(hit.getTotalDamage()) > 0)) {
      drainDefence(hit, config.percent / 100);
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
    const actual = skillManager ? skillManager.getCurrentLevel(Skill.DEFENCE) : target.getAsNpc().getDefenceLevel();
    hit.getAttacker().getAsPlayer().sendMessage(`You reduce your opponent's Defence by ${currentLevel - actual}, from ${currentLevel} to ${actual}.`);
  }

  class DragonWarhammerCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.playAreaSoundAt(character, Sound.DRAGON_WARHAMMER_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      const config = { enabled: true, percent: DEFENCE_DRAIN_FRACTION * 100, requireDamage: true, ...this.specialMechanics?.["defence-drain"] };
      if (config.enabled) smash(hit, config);
    }
  }

  return {
    id: ID,
    itemIds: [ItemIdentifiers.DRAGON_WARHAMMER, ItemIdentifiers.DRAGON_WARHAMMER_3, ItemIdentifiers.DRAGON_WARHAMMER_OR_, ItemIdentifiers.DRAGON_WARHAMMER_CR_],
    drainAmount: DRAIN,
    strengthMultiplier: 1.5,
    accuracyMultiplier: 1,
    metadata: { editorMechanics: { version: 1, groups: [{
      id: "defence-drain", name: "Defence reduction", phase: "At impact", hook: "handleAfterHitEffects", event: "resolved",
      trigger: "When the hit passes accuracy; some bosses also allow a reduction on a miss",
      description: "Remove {percent}% of the enemy's current Defence level. Choose whether the hit must deal damage. Bosses may limit how far their Defence can be reduced.",
      parameters: [
        { key: "enabled", label: "Enable Defence reduction", type: "boolean", value: true },
        { key: "percent", label: "Current Defence removed (%)", type: "number", value: DEFENCE_DRAIN_FRACTION * 100, min: 0, max: 100, step: .1 },
        { key: "requireDamage", label: "Require positive damage", type: "boolean", value: true },
      ],
    }] } },
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
