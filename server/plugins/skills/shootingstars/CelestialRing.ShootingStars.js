"use strict";

/**
 * Celestial ring (https://oldschool.runescape.wiki/w/Celestial_ring), from Dusuri's shop.
 *
 * - Worn, charged or not (and the celestial signet), it gives an invisible +4 Mining boost to
 *   success rolls: answered on "mining:level-boost", for rocks and crashed stars alike.
 * - Charged with stardust, one charge each, up to 10,000 ("Charge", or stardust used on it).
 *   "Uncharge" returns every charge as stardust. "Check" tells the charges.
 * - While charged, ores up to adamantite have a 1/10 chance of an extra ore, and each one mined
 *   spends a charge whether or not it procs; crashed stars spend none ("mining:extra-ore").
 *
 * The ring's messages are not captured; the wording here is ours.
 */

const Common = require("./Common.ShootingStars");

const { DATA } = Common;
const RING = DATA.celestialRing;
const CHARGES_META_KEY = "celestial-ring:charges";

function ids() {
  const I = Common.core.ItemIdentifiers;
  return {
    uncharged: I.CELESTIAL_RING_UNCHARGED_,
    charged: I.CELESTIAL_RING,
    boosting: new Set([I.CELESTIAL_RING_UNCHARGED_, I.CELESTIAL_RING, I.CELESTIAL_SIGNET_UNCHARGED_, I.CELESTIAL_SIGNET]),
  };
}

function charges(item) {
  const saved = Number(item?.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(RING.maxCharges, Math.floor(saved))) : 0;
}

function wornRing(player) {
  const ring = player.getEquipment().getItems()[Common.core.Equipment.RING_SLOT];
  return ring && ring.getId() > 0 ? ring : null;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function addBoost(request) {
  const ring = wornRing(request.player);
  if (ring && ids().boosting.has(ring.getId())) request.boost += RING.boost;
}

function extraOre(request, random = Math.random) {
  const ring = wornRing(request.player);
  if (!ring || ring.getId() !== ids().charged || request.rockLevel > RING.extraOreMaxLevel) return;
  if (random() * RING.extraOreChance < 1) request.extra = true;
  const left = charges(ring) - 1;
  if (left > 0) {
    ring.setMetaValue(CHARGES_META_KEY, left);
    return;
  }
  ring.setId(ids().uncharged);
  ring.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(request.player);
  request.player.sendMessage("Your celestial ring has run out of charges.");
}

/** Moves up to `amount` stardust from the inventory into the ring. */
function addCharges(player, ring, amount) {
  const inventory = player.getInventory();
  const stardust = Common.core.ItemIdentifiers.STARDUST;
  const room = RING.maxCharges - charges(ring);
  const added = Math.min(Math.floor(amount), inventory.getAmount(stardust), room);
  if (room <= 0) {
    player.sendMessage("Your celestial ring cannot hold any more charges.");
    return;
  }
  if (!(added > 0)) {
    player.sendMessage("You need stardust to charge the celestial ring.");
    return;
  }
  inventory.deleteNumber(stardust, added);
  if (ring.getId() === ids().uncharged) ring.setId(ids().charged);
  ring.setMetaValue(CHARGES_META_KEY, charges(ring) + added);
  refresh(player);
  player.sendMessage(`You add ${added.toLocaleString("en-US")} stardust to the ring. It has ${charges(ring).toLocaleString("en-US")} charges.`);
}

function charge({ player, item }) {
  player.setEnteredAmountAction({ execute: (amount) => addCharges(player, item, Number(amount)) });
  player.getPacketSender().sendEnterAmountPrompt("How much stardust would you like to add?");
}

function chargeWithStardust(event) {
  const ringIds = ids();
  const isRing = (id) => id === ringIds.uncharged || id === ringIds.charged;
  const ring = isRing(event.usedWithItemId) ? event.usedWithItem : isRing(event.usedItemId) ? event.usedItem : null;
  if (!ring) return;
  event.handled = true;
  charge({ player: event.player, item: ring });
}

function check({ player, item }) {
  player.sendMessage(`Your celestial ring has ${charges(item).toLocaleString("en-US")} charges.`);
}

function uncharge({ player, item }) {
  const left = charges(item);
  const inventory = player.getInventory();
  const stardust = Common.core.ItemIdentifiers.STARDUST;
  if (left > 0 && inventory.getAmount(stardust) <= 0 && inventory.getFreeSlots() <= 0) {
    inventory.full();
    return;
  }
  item.setId(ids().uncharged);
  item.setMetaValue(CHARGES_META_KEY, undefined);
  if (left > 0) inventory.adds(stardust, left);
  refresh(player);
  player.sendMessage(`You remove ${left.toLocaleString("en-US")} stardust from the ring.`);
}

module.exports = function attachCelestialRing(api) {
  api.onCustomEvent("mining:level-boost", addBoost);
  api.onCustomEvent("mining:extra-ore", extraOre);
  api.onItemAction("Celestial ring (uncharged)", { Charge: charge });
  api.onItemAction("Celestial ring", { Charge: charge, Check: check, Uncharge: uncharge });
  api.onItemOnItem("Stardust", "Celestial ring (uncharged)", chargeWithStardust, { noted: false });
  api.onItemOnItem("Stardust", "Celestial ring", chargeWithStardust, { noted: false });
};

Object.assign(module.exports, { charges, addBoost, extraOre, addCharges, uncharge, check, CHARGES_META_KEY });
