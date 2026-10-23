// TODO: ported from xrsps-typescript; untested.
function buildSpecial(core) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Skill, Sounds } = core;

  const DRAIN = 50;
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const ANIMATION = new Animation(7642);
  const GRAPHIC = new Graphic(1212, Priority.HIGH);

  // OSRS drains one damage per level in this order; NPCs have no Prayer stat.
  const PLAYER_DRAIN_ORDER = [
    [Skill.DEFENCE, 1],
    [Skill.STRENGTH, 1],
    [Skill.PRAYER, 0],
    [Skill.ATTACK, 1],
    [Skill.MAGIC, 1],
    [Skill.RANGED, 1],
  ];

  function warstrike(target, damage) {
    let remainingDrain = Math.max(0, Math.floor(damage));
    if (remainingDrain <= 0) {
      return;
    }
    const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
    for (const [skill, minimumLevel] of PLAYER_DRAIN_ORDER) {
      if (remainingDrain <= 0) {
        break;
      }
      if (!target.isPlayer() && skill === Skill.PRAYER) continue;
      const currentLevel = Math.max(0, Math.floor(skillManager.getCurrentLevel(skill)));
      const amount = Math.min(remainingDrain, Math.max(0, currentLevel - (target.isPlayer() ? minimumLevel : 0)));
      if (amount <= 0) {
        continue;
      }
      skillManager.setCurrentLevels(skill, currentLevel - amount);
      remainingDrain -= amount;
    }
  }

  class BandosGodswordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit) {
      warstrike(hit.getTarget(), hit.getTotalDamage());
    }
  }

  return {
    id: "bandos_godsword",
    itemIds: [ItemIdentifiers.BANDOS_GODSWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1.21,
    accuracyMultiplier: 2,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 2,
      damageMultiplierStages: [1.1, 1.1],
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
    },
    combatMethod: new BandosGodswordCombatMethod(),
  };
}

module.exports = function registerBandosGodswordSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api.core));
};
