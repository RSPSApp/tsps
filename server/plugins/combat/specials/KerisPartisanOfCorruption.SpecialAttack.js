// Wiki: Wrath of Amascut marks a target for ten ticks; marks refresh rather than stack.
const weakenedUntil = new WeakMap();
let core;

function canUseInTombs(api, player) {
  const query = { player, inside: false };
  api.emitCustomEvent("toa:in-tombs", query);
  if (!query.inside) player.sendMessage("This special attack can only be used within the Tombs of Amascut.");
  return query.inside;
}

function amplifyDamage({ target, hit }) {
  if ((weakenedUntil.get(target) ?? -1) > core.World.getProcessCycle()) {
    let remaining = target.getHitpoints();
    for (const damage of hit.getHits()) {
      const value = Math.min(remaining, Math.floor(damage.getDamage() * 5 / 4));
      damage.setDamage(value);
      remaining -= value;
    }
    hit.updateTotalDamage();
  }
}

function buildSpecial(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod } = api.core;

  const DRAIN = 75;
  const SPECIAL_ANIMATION = new Animation(9544);
  const SPECIAL_VFX = new Graphic(2128);
  const ACCURACY_MULTIPLIER = 2;
  const DAMAGE_MULTIPLIER = 1.25;

  class KerisPartisanOfCorruptionCombatMethod extends MeleeCombatMethod {
    canAttack(character, target) {
      return canUseInTombs(api, character) && super.canAttack(character, target);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) weakenedUntil.set(hit.getTarget(), api.core.World.getProcessCycle() + 10);
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }
  }

  return {
    id: "keris_partisan_of_corruption",
    itemIds: [
      ItemIdentifiers.KERIS_PARTISAN_OF_CORRUPTION,
      ItemIdentifiers.KERIS_PARTISAN_OF_CORRUPTION_2,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      attackSpeedTicks: 8,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      damageMultiplier: DAMAGE_MULTIPLIER,
    },
    combatMethod: new KerisPartisanOfCorruptionCombatMethod(),
  };
}

module.exports = function registerKerisPartisanOfCorruptionSpecialAttack(api) {
  core = api.core;
  api.registerCombatSpecial(buildSpecial(api));
  api.onPlayerDealtDamage(amplifyDamage);
};
