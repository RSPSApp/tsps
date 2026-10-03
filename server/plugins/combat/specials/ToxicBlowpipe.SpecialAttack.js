module.exports = function registerToxicBlowpipeSpecialAttack(api) {
  const { ItemIdentifiers, RangedCombatMethod } = api.core;

  // The blowpipe's actual special combat method lives in the ToxicBlowpipe plugin,
  // which registers a combat method resolver for the loaded blowpipe. This spec entry
  // gives the weapon its special bar, drain and multipliers.

  api.registerCombatSpecial({
    id: "toxic_blowpipe",
    itemIds: [ItemIdentifiers.TOXIC_BLOWPIPE],
    drainAmount: 50,
    strengthMultiplier: 1.5,
    accuracyMultiplier: 2.0,
    combatMethod: new RangedCombatMethod(),
  });
};
