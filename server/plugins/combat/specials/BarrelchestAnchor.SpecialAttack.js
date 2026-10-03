// TODO: ported from xrsps-typescript; untested.
module.exports = function registerBarrelchestAnchorSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Skill, Sounds } = api.core;

  const DRAIN = 50;
  const DRAIN_FRACTION = 0.1;
  const ANIMATION = new Animation(5870);
  const GRAPHIC = new Graphic(1027, GraphicHeight.MIDDLE);
  const PLAYER_DRAIN_ORDER = [Skill.DEFENCE, Skill.ATTACK, Skill.RANGED, Skill.MAGIC];

  function sunder(target, damage) {
    let remainingDrain = Math.max(0, Math.floor(Math.floor(damage) * DRAIN_FRACTION));
    if (remainingDrain <= 0) {
      return;
    }
    if (!target.isPlayer()) {
      // TODO: NPC combat-stat drain is not exposed by our core NPC state.
      return;
    }
    const skillManager = target.getAsPlayer().getSkillManager();
    for (const skill of PLAYER_DRAIN_ORDER) {
      if (remainingDrain <= 0) {
        break;
      }
      const currentLevel = Math.max(0, Math.floor(skillManager.getCurrentLevel(skill)));
      const drainAmount = Math.min(remainingDrain, Math.max(0, currentLevel - 1));
      if (drainAmount <= 0) {
        continue;
      }
      skillManager.setCurrentLevels(skill, currentLevel - drainAmount);
      remainingDrain -= drainAmount;
    }
  }

  class BarrelchestAnchorCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit) {
      sunder(hit.getTarget(), hit.getTotalDamage());
    }
  }

  api.registerCombatSpecial({
    id: "barrelchest_anchor",
    itemIds: [ItemIdentifiers.BARRELCHEST_ANCHOR],
    drainAmount: DRAIN,
    strengthMultiplier: 1.1,
    accuracyMultiplier: 2,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 2,
      damageMultiplier: 1.1,
    },
    combatMethod: new BarrelchestAnchorCombatMethod(),
  });
};
