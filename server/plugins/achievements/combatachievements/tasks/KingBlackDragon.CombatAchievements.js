/**
 * The King Black Dragon's Combat Achievement that the fight decides. Antifire Protection (Wiki:
 * "Kill the King Black Dragon with an antifire potion active and an antidragon shield equipped"):
 * checked when he dies. Any antifire potion counts (the task names none), and so does every
 * shield that protects like the anti-dragon shield: the Wiki names the dragonfire shield,
 * dragonfire ward and ancient wyvern shield as alternatives (CombatEquipment's list). Only the
 * potion counts: other dragonfire immunity (a league relic) is not "an antifire potion active".
 */
const { DragonfireProtectionTier, getDragonfirePotionTier } = require("../../../combat/DragonfireProtection");

module.exports = function attachKingBlackDragonTasks(api, Fights) {
  Fights.onKill("King Black Dragon", {
    "Antifire Protection": (fight) => getDragonfirePotionTier(fight.player) >= DragonfireProtectionTier.ANTIFIRE
      && api.core.CombatEquipment.hasDragonProtectionGear(fight.player),
  });
};
