// Plane 1 sea-floor map squares: Mogre Camp, Harmony Island and Fossil Island.
const MOGRE_CAMP = { minX: 2944, maxX: 3007, minY: 9472, maxY: 9535 };
const HARMONY_TUNNEL = { minX: 3776, maxX: 3839, minY: 9216, maxY: 9279 };
const FOSSIL_ISLAND = { minX: 3712, maxX: 3839, minY: 10240, maxY: 10367 };
const UNDERWATER_PLANE = 1;

function isUnderwater(location) {
  if (location.getZ() !== UNDERWATER_PLANE) return false;
  const x = location.getX();
  const y = location.getY();
  return [MOGRE_CAMP, HARMONY_TUNNEL, FOSSIL_ISLAND].some(bounds =>
    x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY);
}

function buildSpecial(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Skill, Sound, Sounds } = api.core;

  const DRAIN = 75;
  const SPECIAL_ANIMATION = new Animation(6118);
  const SPECIAL_VFX = new Graphic(1048);
  const BOOST_FRACTION = 0.25;
  const BASE_BOOST_CAP = 3;
  const LEVEL_CAP_FRACTION = 0.1;
  const BOOSTED_SKILLS = [Skill.STRENGTH, Skill.ATTACK, Skill.DEFENCE];

  class BrineSabreCombatMethod extends MeleeCombatMethod {
    canAttack(character, target) {
      if (!isUnderwater(character.getLocation())) {
        character.sendMessage("This special attack can only be used underwater.");
        character.setSpecialActivated(false);
        CombatSpecial.updateBar(character.getAsPlayer());
        return false;
      }
      return super.canAttack(character, target);
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
      Sounds.sendSound(character, Sound.BRINE_SABRE_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate()) {
        return;
      }
      const boostAmount = Math.floor(Math.floor(hit.getTotalDamage()) * BOOST_FRACTION);
      if (boostAmount <= 0) {
        return;
      }
      const attacker = hit.getAttacker();
      if (!attacker.isPlayer()) {
        return;
      }
      const skillManager = attacker.getAsPlayer().getSkillManager();
      for (const skill of BOOSTED_SKILLS) {
        const base = skillManager.getMaxLevel(skill);
        const current = skillManager.getCurrentLevel(skill);
        const cap = base + BASE_BOOST_CAP + Math.floor(base * LEVEL_CAP_FRACTION);
        skillManager.setCurrentLevels(skill, Math.max(current, Math.min(cap, current + boostAmount)));
      }
    }
  }

  return {
    id: "brine_sabre",
    itemIds: [ItemIdentifiers.BRINE_SABRE],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 2,
    traits: { hitCount: 1, accuracyMultiplier: 2 },
    combatMethod: new BrineSabreCombatMethod(),
  };
}

module.exports = function registerBrineSabreSpecialAttack(api) {
  api.registerCombatSpecial(buildSpecial(api));
};
