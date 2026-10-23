const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");

/**
 * The Spectral spirit shield halves most Prayer-draining attacks outside PvP
 * (https://oldschool.runescape.wiki/w/Spectral_spirit_shield#Passive_effect):
 * it names K'ril's prayer smash (25% instead of 50%) and Nex's attack drains.
 * Mod Ash: a one-point drain rounds up or down so it averages 50%; larger odd
 * drains floor (a 5-point drain becomes 2).
 * The Arcane shield has no passive in OSRS (only +20 Magic attack and +3% Magic
 * damage), and Blessed has none; Elysian is in core combat.
 */
// ponytail: only drains routed through applyPrayerDrainModifiers; move the remaining
// boss/quest drains onto the same hook when touching them.
const SPECTRAL_SHIELDS = new Set([
  ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD,
  ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD_2,
  ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD_3,
]);

function wearsSpectral(player) {
  const id = player.getEquipment?.()?.getItems?.()?.[Equipment.SHIELD_SLOT]?.getId?.();
  return id != null && SPECTRAL_SHIELDS.has(id);
}

function halveSpectralPrayerDrain(entity, amount, context = {}) {
  if (!entity?.isPlayer?.() || amount <= 0) return amount;
  if (context.attacker?.isPlayer?.()) return amount;
  if (!wearsSpectral(entity.getAsPlayer())) return amount;
  if (amount === 1) return Math.random() < 0.5 ? 1 : 0;
  return Math.floor(amount / 2);
}

module.exports = function registerSpiritShieldEffects(api) {
  api.registerPrayerDrainModifier?.(halveSpectralPrayerDrain);
};

module.exports._test = { halveSpectralPrayerDrain, wearsSpectral };
