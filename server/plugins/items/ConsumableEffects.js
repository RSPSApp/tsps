"use strict";

// Shared canonical effects for potions and restorative food.
function restoreRunEnergy(player, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  player.setRunEnergy(Math.max(0, Math.min(100, Math.floor(player.getRunEnergy() + amount))));
  player.getPacketSender().sendRunEnergy();
}

function curePoisonAndVenom(player) {
  player.setPoisonDamage(0);
  // Venom remains sticky until explicitly cured.
  if (typeof player.setVenomed === "function") player.setVenomed(false);
  player.getPacketSender().sendPoisonType(0);
}

module.exports = { restoreRunEnergy, curePoisonAndVenom };
