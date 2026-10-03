// TODO: ported from xrsps-typescript; untested.
module.exports = function registerAbyssalBludgeonSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Skill, Sounds } = api.core;

  const DRAIN = 50;
  const DAMAGE_PER_MISSING_PRAYER_POINT = 0.005;
  const ANIMATION = new Animation(3299);
  const GRAPHIC = new Graphic(1284, Priority.HIGH);

  // Penance is a per-attack max-hit multiplier, which the static trait registry
  // cannot compute. start() runs before hits(), so the value is stamped here.
  // ponytail: shared mutable trait object; per-attack stamp is safe single-threaded.
  const TRAITS = { hitCount: 1, damageMultiplier: 1 };

  class AbyssalBludgeonCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);

      let damageMultiplier = 1;
      if (character.isPlayer()) {
        const skillManager = character.getAsPlayer().getSkillManager();
        const basePrayer = Math.max(0, Math.floor(skillManager.getMaxLevel(Skill.PRAYER)));
        const currentPrayer = Math.max(0, Math.floor(skillManager.getCurrentLevel(Skill.PRAYER)));
        const missingPrayer = Math.max(0, basePrayer - currentPrayer);
        damageMultiplier += missingPrayer * DAMAGE_PER_MISSING_PRAYER_POINT;
      }
      TRAITS.damageMultiplier = damageMultiplier;

      character.performAnimation(ANIMATION);
      Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit) {
      hit.getTarget().performGraphic(GRAPHIC);
    }
  }

  api.registerCombatSpecial({
    id: "abyssal_bludgeon",
    itemIds: [ItemIdentifiers.ABYSSAL_BLUDGEON],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: TRAITS,
    combatMethod: new AbyssalBludgeonCombatMethod(),
  });
};
