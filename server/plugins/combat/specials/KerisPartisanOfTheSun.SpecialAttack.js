// TODO: ported from xrsps-typescript; untested.
module.exports = function registerKerisPartisanOfTheSunSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic, ItemIdentifiers, Skill } = api.core;

  const DRAIN = 75;
  const SPECIAL_ANIMATION = new Animation(9544);
  const SPECIAL_VFX = new Graphic(2128);
  const PRAYER_COST = 50;
  const OVERHEAL_MULTIPLIER = 1.2;

  class KerisPartisanOfTheSunCombatMethod extends CombatMethod {
    hits() {
      return null;
    }

    type() {
      return CombatType.MELEE;
    }

    start(character, target) {
      if (!character.isPlayer()) {
        return;
      }
      const player = character.getAsPlayer();
      const skillManager = player.getSkillManager();
      const prayer = skillManager.getCurrentLevel(Skill.PRAYER);
      if (prayer < PRAYER_COST) {
        player.sendMessage("You do not have enough prayer points to use Tumeken's Light.");
        return;
      }

      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(SPECIAL_ANIMATION);
      player.performGraphic(SPECIAL_VFX);
      skillManager.setCurrentLevels(Skill.PRAYER, prayer - PRAYER_COST);
      this.restoreDrainedSkills(skillManager);
      player.setPoisonDamage(0);
      player.setVenomed(false);
      this.overhealHitpoints(player, skillManager);
      player.setRunEnergy(100);
      player.getPacketSender().sendRunEnergy();
    }

    restoreDrainedSkills(skillManager) {
      for (const skill of Skill.values()) {
        if (skill === Skill.PRAYER || skill === Skill.HITPOINTS) {
          continue;
        }
        if (skillManager.getCurrentLevel(skill) < skillManager.getMaxLevel(skill)) {
          skillManager.setCurrentLevels(skill, skillManager.getMaxLevel(skill));
        }
      }
    }

    overhealHitpoints(player, skillManager) {
      const cap = Math.floor(skillManager.getMaxLevel(Skill.HITPOINTS) * OVERHEAL_MULTIPLIER);
      if (skillManager.getCurrentLevel(Skill.HITPOINTS) < cap) {
        player.setHitpoints(cap);
      }
    }
  }

  api.registerCombatSpecial({
    id: "keris_partisan_of_the_sun",
    itemIds: [
      ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN,
      ItemIdentifiers.KERIS_PARTISAN_OF_THE_SUN_2,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new KerisPartisanOfTheSunCombatMethod(),
  });
};
