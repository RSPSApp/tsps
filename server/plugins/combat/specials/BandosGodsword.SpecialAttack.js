// TODO: ported from xrsps-typescript; untested.
// A Warstrike that drains nothing asks "combat-special:missed-drain" whether the target still
// loses some levels (Tekton: 10, https://oldschool.runescape.wiki/w/Bandos_godsword).
function buildSpecial(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Skill, Sound, Sounds } = api.core;

  const ID = "bandos_godsword";
  const DRAIN = 50;
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const ANIMATION = new Animation(7642);
  const GRAPHIC = new Graphic(1212, Priority.HIGH);

  // OSRS drains one damage per level in this order; NPCs have no Prayer stat. Wiki (Bandos godsword): "the current stat
  // that is being drained must hit 0" before the rest moves on ("20 Defence … would lose 20 Defence levels").
  const PLAYER_DRAIN_ORDER = [
    [Skill.DEFENCE, 0],
    [Skill.STRENGTH, 0],
    [Skill.PRAYER, 0],
    [Skill.ATTACK, 0],
    [Skill.MAGIC, 0],
    [Skill.RANGED, 0],
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
      // Spill only after the current stat actually reaches zero (an encounter may have a floor).
      if (!target.isPlayer() && remainingDrain > 0 && skillManager.getCurrentLevel(skill) > 0) break;
    }
  }

  class BandosGodswordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.playAreaSoundAt(character, Sound.GODSWORD_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      const damage = hit.isAccurate() ? Math.floor(hit.getTotalDamage()) : 0;
      if (damage > 0) {
        warstrike(hit.getTarget(), damage);
        return;
      }
      const missed = { hit, specialId: ID, fraction: 0, levels: 0 };
      api.emitCustomEvent("combat-special:missed-drain", missed);
      warstrike(hit.getTarget(), missed.levels);
    }
  }

  return {
    id: ID,
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
  api.registerCombatSpecial(buildSpecial(api));
};
