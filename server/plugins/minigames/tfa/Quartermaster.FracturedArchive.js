"use strict";

/**
 * The Quartermaster (16761) in the hub after the second boss: "Resupply" opens Alliance
 * Supplies, the cache's omnishop row tfa_midraid_supplies_shop. Its stock costs Supply Credits
 * (omnishop_currency_tfa_supply_points, no item), kept in tfa_supply_points (16381, 7 bits).
 *
 * From the cache: the stock and prices (Saradomin brew(4) and Super restore(4) 3, Prayer
 * potion(4), Manta ray, Halibut, Ranging potion(2) and Super combat potion(2) 2, Giant krill
 * and Prayer potion(2) 1, the Alliance log free) and the buy amounts 1/2/3/5. The
 * tfa_midraid_supplies_shop_failure row adds Leftovers.
 * Estimates (a spectator has no credits and sees no shop): credits earned per completed
 * challenge, the failure row opening once anyone in the party has died, and the dialogue.
 */

const Shared = require("./Shared.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");

const SHOP = "tfa_midraid_supplies_shop";
const SHOP_FAILURE = "tfa_midraid_supplies_shop_failure";
const CURRENCY = "omnishop_currency_tfa_supply_points";
const ATTR_CREDITS = "fractured-archive:supply-credits";
const CREDITS_PER_CHALLENGE = 10;
const MAX_CREDITS = 127;

function credits(player) {
  return Number(player.getAttribute(ATTR_CREDITS)) || 0;
}

function setCredits(player, value) {
  const amount = Math.max(0, Math.min(MAX_CREDITS, value));
  player.setAttribute(ATTR_CREDITS, amount);
  player.getPacketSender().sendVarbit(Shared.named("varbit", "tfa_supply_points"), amount);
}

function onRoomComplete({ room, players }) {
  if (room === "HUB" || room === "VAULT") return;
  for (const player of players) setCredits(player, credits(player) + CREDITS_PER_CHALLENGE);
}

function resupply({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  Shared.api().emitCustomEvent("omnishop:open", { player, shop: raid.deathCount > 0 ? SHOP_FAILURE : SHOP });
  return true;
}

function talk({ player }) {
  if (!Raid.raidOf(player)) return false;
  Shared.mesbox(player, "The Quartermaster trades supplies for the Supply Credits your party has earned in the Archive.");
  return true;
}

function onCurrency(request) {
  if ((request.shop !== SHOP && request.shop !== SHOP_FAILURE) || request.currency !== Shared.named("dbrow", CURRENCY)) return;
  request.balance = credits(request.player);
  request.set = (value) => setCredits(request.player, value);
}

/** Credits belong to one raid: gone when a player leaves or the raid ends. */
function onLeave({ player }) {
  setCredits(player, 0);
}

module.exports = function registerQuartermaster(api) {
  Shared.bind(api);
  api.onNpcInteraction("Quartermaster", { Resupply: resupply, "Talk-to": talk });
  api.onCustomEvent("fractured-archive:room-complete", onRoomComplete);
  api.onCustomEvent("omnishop:currency", onCurrency);
  api.onCustomEvent("fractured-archive:left", onLeave);
  api.onPlayerLogin(onLeave);
};
