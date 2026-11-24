const { mechanicSchema, mechanicSettings } = require("./Mechanics.SpecialAttack");
// TODO: ported from xrsps-typescript; untested.
function buildSpecial(core) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Skill, Sound, Sounds } = core;

  const DRAIN = 50;
  const DRAIN_FRACTION = 0.1;
  const ANIMATION = new Animation(5870);
  const GRAPHIC = new Graphic(1027, GraphicHeight.MIDDLE);
  const PLAYER_DRAIN_ORDER = [Skill.DEFENCE, Skill.ATTACK, Skill.RANGED, Skill.MAGIC];

  function sunder(target, damage, config) {
    let remainingDrain = Math.max(0, Math.floor(Math.floor(damage) * config.percent / 100));
    if (remainingDrain <= 0) {
      return;
    }
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    for (const name of config.order) {
      if (name === "prayer" && !target.isPlayer()) continue;
      const skill = Skill[name.toUpperCase()];
      if (remainingDrain <= 0) {
        break;
      }
      const currentLevel = Math.max(0, Math.floor(skillManager.getCurrentLevel(skill)));
      const drainAmount = Math.min(remainingDrain, Math.max(0, currentLevel - (target.isPlayer() ? config.playerFloor : 0)));
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
      Sounds.playAreaSoundAt(character, Sound.BARRELCHEST_ANCHOR_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      const config = mechanicSettings(this, "ordered-drain", { percent: DRAIN_FRACTION * 100, order: ["defence", "attack", "ranged", "magic"], playerFloor: 1 });
      if (!config.enabled) return;
      sunder(hit.getTarget(), hit.getTotalDamage(), config);
    }
  }

  return {
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
    metadata: { editorMechanics: mechanicSchema("ordered-drain", { percent: DRAIN_FRACTION * 100, order: ["defence", "attack", "ranged", "magic"], playerFloor: 1 }) },
    combatMethod: new BarrelchestAnchorCombatMethod(),
  };
}

module.exports = function registerBarrelchestAnchorSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
