"use strict";

/**
 * Sulphur Nagua (Wiki: Sulphur Nagua): "their attacks are unique in that they hit twice per
 * attack, rolling damage normally and splitting it in two hitsplats" - 11 maximum, 6+5.
 * The ordinary melee swing, but with two splats on the same tick that share the maximum
 * (the same PendingHit split the twin weapons use, see MultiHitWeapons).
 */
const SULPHUR_NAGUA = 13033;

module.exports = {
  name: "SulphurNagua",
  description: "Sulphur Nagua melee: each attack lands as two hitsplats on the same tick that share one damage roll.",
  members: true,
  register(api) {
    const { MeleeCombatMethod, PendingHit } = api.core;
    class SulphurNaguaMelee extends MeleeCombatMethod {
      hits(npc, target) {
        return [new PendingHit(npc, target, this, { hitAmount: 2, hitMaximumSplitCount: 2 })];
      }
    }
    api.registerNpcCombatMethodProvider(SULPHUR_NAGUA, SulphurNaguaMelee);
  },
};
