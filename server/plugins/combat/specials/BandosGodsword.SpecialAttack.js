// TODO: ported from xrsps-typescript; untested.
module.exports = function registerBandosGodswordSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Skill, Sounds } = api.core;

  const DRAIN = 50;
  const ANIMATION = new Animation(7642);
  const GRAPHIC = new Graphic(1212, Priority.HIGH);

  // OSRS drains one damage per level in this order; Prayer can reach 0, the
  // other skills floor at 1.
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
    if (!target.isPlayer()) {
      // TODO: NPC combat-stat drain is not exposed by our core NPC state.
      return;
    }
    const skillManager = target.getAsPlayer().getSkillManager();
    for (const [skill, minimumLevel] of PLAYER_DRAIN_ORDER) {
      if (remainingDrain <= 0) {
        break;
      }
      const currentLevel = Math.max(0, Math.floor(skillManager.getCurrentLevel(skill)));
      const amount = Math.min(remainingDrain, Math.max(0, currentLevel - minimumLevel));
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

  api.registerCombatSpecial({
    id: "bandos_godsword",
    itemIds: [ItemIdentifiers.BANDOS_GODSWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1.21,
    accuracyMultiplier: 2,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 2,
      damageMultiplier: 1.21,
    },
    combatMethod: new BandosGodswordCombatMethod(),
  });
};
