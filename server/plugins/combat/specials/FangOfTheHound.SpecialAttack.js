/**
 * Fang of the hound's Ferocity (https://oldschool.runescape.wiki/w/Fang_of_the_hound, a Leagues VI
 * echo weapon): 50% energy, an instant-hit attack modelled on the granite maul's
 * special, with a guaranteed Flames of Cerberus if it hits (the cast is FangOfTheHound.plugin.js's,
 * which reads the armed special as the hit is rolled). Only one special a tick.
 *
 * Ours: as Quick Smash, the swing comes on the press even mid-cooldown and leaves a one-tick
 * cooldown; it plays the weapon's own attack animation (the Wiki names no other). Outside Leagues VI
 * it is the same instant hit without the Flames (FangOfTheHound.plugin.js gates them).
 */
let core;
/** Player -> the process cycle of their last Ferocity: one a tick. */
const lastFerocity = new WeakMap();

const DRAIN = 50;

function weaponIds() {
  const { ItemIdentifiers: ids } = core;
  return [ids.FANG_OF_THE_HOUND, ids.FANG_OF_THE_HOUND_2];
}

function buildSpecial() {
  const { CombatSpecial, MeleeCombatMethod, World } = core;

  class FangOfTheHoundCombatMethod extends MeleeCombatMethod {
    canAttack(character, target) {
      if (lastFerocity.get(character) === World.getProcessCycle()) return false;
      return super.canAttack(character, target);
    }

    start(character, target) {
      lastFerocity.set(character, World.getProcessCycle());
      CombatSpecial.drain(character, DRAIN);
      super.start(character, target);
    }
  }

  return {
    id: "fang_of_the_hound",
    itemIds: weaponIds(),
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      queuedAttack: true,
      bypassAttackDelay: true,
      attackSpeedTicks: 1,
    },
    combatMethod: new FangOfTheHoundCombatMethod(),
  };
}

module.exports = function registerFangOfTheHoundSpecialAttack(api) {
  core = api.core;
  api.registerCombatSpecial(buildSpecial());
};
