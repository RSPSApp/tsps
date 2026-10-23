"use strict";

/**
 * Typeless boss hits (see ../ThermonuclearSmokeDevil.plugin.js for behaviour and sources).
 * Wiki (Thermonuclear smoke devil): "Magical ranged (100% prayer penetration)" -
 * protection prayers give no damage reduction.
 */
const Common = require("./Common.ThermonuclearSmokeDevil");

function thermonuclearTypeless(event) {
  const attacker = event?.attacker;
  if (!attacker?.isNpc?.()) return;
  if (attacker.getId?.() !== Common.BOSS_ID) return;
  event.bypassProtectionPrayer = true;
}

function attach(api) {
  api.onCombatHitRoll(thermonuclearTypeless);
}

module.exports = { attach, thermonuclearTypeless };
