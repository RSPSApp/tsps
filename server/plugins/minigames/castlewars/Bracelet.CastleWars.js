"use strict";

/**
 * Castle wars bracelet. A worn bracelet spends a charge as the game starts (CastleWars.plugin.js);
 * for that game its wearer hits 20% harder against whoever carries their team's flag
 * (OSRS Wiki: Castle wars bracelet). The bandage bonus lives in Bandages.CastleWars.js.
 */

const FLAG_CARRIER_DAMAGE_MULTIPLIER = 1.2;

let game;
let api;
const STORED_CHARGES_ATTRIBUTE = "castlewars:bracelet-charges";
const AUTO_CHARGE_ATTRIBUTE = "castlewars:bracelet-auto-charge";

function boostAgainstFlagCarrier(attacker, maxHit) {
  const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
  const target = attacker?.getCombat?.()?.getTarget?.();
  if (!player || !target?.isPlayer?.() || !game.hasBraceletEffect(player)) {
    return maxHit;
  }
  const carrier = target.getAsPlayer();
  if (!game.isPlaying(carrier) || game.getCarriedFlagTeam(carrier) !== game.getTeamId(player)) {
    return maxHit;
  }
  return Math.floor(maxHit * FLAG_CARRIER_DAMAGE_MULTIPLIER);
}

/** Spends one stored charge; returns the charges left, or null when none was spent. */
function spendStoredCharge(player) {
  const charges = player.getAttribute(STORED_CHARGES_ATTRIBUTE) ?? 0;
  if (charges <= 0 || player.getAttribute(AUTO_CHARGE_ATTRIBUTE) === false) return null;
  player.setAttribute(STORED_CHARGES_ATTRIBUTE, charges - 1);
  return { remaining: charges - 1 };
}

function showCharges(player) {
  const charges = player.getAttribute(STORED_CHARGES_ATTRIBUTE) ?? 0;
  const enabled = player.getAttribute(AUTO_CHARGE_ATTRIBUTE) !== false;
  api.sendMultiChatboxPrompt(player, `Castle wars bracelet: ${charges} stored charges`,
    `Automatic charges: ${enabled ? "on" : "off"}`, () => {
      player.setAttribute(AUTO_CHARGE_ATTRIBUTE, !enabled);
      showCharges(player);
    },
    "Done", () => {});
}

function depositBracelets(event) {
  if ((event.definition ?? event.target.getCurrentDefinition(event.player)).getName() !== "Lanthus") return;
  const definition = api.core.ItemDefinition.forId(event.itemId);
  const id = definition.isNoted() ? definition.unNote() : event.itemId;
  const ids = Object.keys(game.data.BRACELET_NEXT).map(Number);
  const charges = ids.indexOf(id) < 0 ? 0 : ids.length - ids.indexOf(id);
  if (!charges) return;
  event.handled = true;
  const { player, itemId } = event;
  const inventory = player.getInventory();
  const count = inventory.getAmount(itemId);
  api.sendMultiChatboxPrompt(player, `Deposit ${count} bracelet${count === 1 ? "" : "s"} (${count * charges} charges)?`,
    "Deposit", () => {
      if (inventory.getAmount(itemId) < count || count <= 0) return;
      inventory.deleteNumber(itemId, count);
      player.setAttribute(STORED_CHARGES_ATTRIBUTE, (player.getAttribute(STORED_CHARGES_ATTRIBUTE) ?? 0) + count * charges);
      showCharges(player);
    },
    "Cancel", () => {});
}

module.exports = function attachCastleWarsBracelet(registry, castleWars) {
  api = registry;
  game = castleWars;
  game.spendStoredBraceletCharge = spendStoredCharge;
  game.showBraceletCharges = showCharges;
  api.persistAttribute(STORED_CHARGES_ATTRIBUTE, 0);
  api.persistAttribute(AUTO_CHARGE_ATTRIBUTE, true);
  api.onItemOnNpc(depositBracelets);
  api.registerMeleeHitModifier(boostAgainstFlagCarrier);
  api.registerRangedHitModifier(boostAgainstFlagCarrier);
  api.registerMagicHitModifier(boostAgainstFlagCarrier);
};
