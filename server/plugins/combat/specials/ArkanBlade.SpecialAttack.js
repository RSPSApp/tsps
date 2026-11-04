// TODO: ported from xrsps-typescript; untested.
module.exports = function registerArkanBladeSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 30;
  const SPECIAL_ANIMATION = new Animation(12297);
  const SPECIAL_VFX = new Graphic(3336);
  const BURN_TOTAL_DAMAGE = 10;

  class ArkanBladeCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (!hit.isAccurate() || Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      api.emitCustomEvent("combat:burn", {
        attacker: hit.getAttacker(), target: hit.getTarget(), damage: BURN_TOTAL_DAMAGE, severity: "strong",
      });
    }
  }

  api.registerCombatSpecial({
    id: "arkan_blade",
    itemIds: [ItemIdentifiers.ARKAN_BLADE],
    drainAmount: DRAIN,
    strengthMultiplier: 1.5,
    accuracyMultiplier: 1.5,
    traits: { hitCount: 1, accuracyMultiplier: 1.5, damageMultiplier: 1.5 },
    combatMethod: new ArkanBladeCombatMethod(),
  });
};
