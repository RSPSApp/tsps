/**
 * Ring of endurance (https://oldschool.runescape.wiki/w/Ring_of_endurance).
 *
 * Charged with stamina potions and mixes (one charge per dose) and extended stamina
 * potions (two per dose), 1,000 max. While a charged ring is worn, a dose is doubled
 * (a stamina potion's 40% energy and 4-minute buff) and spends one charge, or two for an
 * extended dose; uncharging does not refund charges.
 * With 500 or more charges, run-energy drain is 85% of normal (a stamina effect wins
 * and the two do not stack).
 */
const Equipment = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment").Equipment;
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const MAX_CHARGES = 1000;
const PASSIVE_MIN_CHARGES = 500;
const PASSIVE_DRAIN_MULTIPLIER = 0.85;
const CHARGES_META_KEY = "ring-of-endurance";
/** Potions plugin: when the stamina effect ends (it already cuts the drain to 30%). */
const STAMINA_END_ATTRIBUTE = "potions:stamina:end";

/** Charges a potion adds to the ring: one per stamina dose, two per extended stamina dose. */
const CHARGES_BY_ITEM = new Map([
  [ItemIdentifiers.STAMINA_POTION_4_, 4],
  [ItemIdentifiers.STAMINA_POTION_3_, 3],
  [ItemIdentifiers.STAMINA_POTION_2_, 2],
  [ItemIdentifiers.STAMINA_POTION_1_, 1],
  [ItemIdentifiers.STAMINA_MIX_2_, 2],
  [ItemIdentifiers.STAMINA_MIX_1_, 1],
  [ItemIdentifiers.EXTENDED_STAMINA_POTION_4_, 8],
  [ItemIdentifiers.EXTENDED_STAMINA_POTION_3_, 6],
  [ItemIdentifiers.EXTENDED_STAMINA_POTION_2_, 4],
  [ItemIdentifiers.EXTENDED_STAMINA_POTION_1_, 2],
]);

let core = null;
let chargedIds = new Set();
let unchargedByCharged = new Map();
let chargedByUncharged = new Map();

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function wornRing(player) {
  const item = player?.getEquipment?.()?.get?.(Equipment.RING_SLOT);
  return item && chargedIds.has(Number(item.getId?.() ?? -1)) ? item : null;
}

function passiveApplies(player) {
  const ring = wornRing(player);
  return ring != null && charges(ring) >= PASSIVE_MIN_CHARGES;
}

function staminaActive(player) {
  const endsAt = Number(player?.getAttribute?.(STAMINA_END_ATTRIBUTE));
  return Number.isFinite(endsAt) && Date.now() < endsAt;
}

/** 500+ charges cut run-energy drain to 85%; a stamina potion's 30% wins and they don't stack. */
function drainModifier(entity, amount) {
  if (!entity?.isPlayer?.()) {
    return amount;
  }
  const player = entity.getAsPlayer();
  if (staminaActive(player)) {
    return amount;
  }
  return passiveApplies(player) ? Math.floor(amount * PASSIVE_DRAIN_MULTIPLIER) : amount;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function useCharge(player, item, cost = 1) {
  const left = charges(item) - cost;
  if (left > 0) {
    item.setMetaValue(CHARGES_META_KEY, left);
    return;
  }
  item.setId(unchargedByCharged.get(item.getId()));
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("Your ring of endurance has run out of charges.");
}

/** Doubles a dose and spends the charges it costs: one, or two for an extended stamina dose (Wiki). */
function doubleStamina(request) {
  const ring = wornRing(request?.player);
  if (!ring) {
    return;
  }
  request.energy *= 2;
  request.durationMs *= 2;
  request.player.sendMessage("Your Ring of endurance doubles the duration of your stamina potion's effect.");
  useCharge(request.player, ring, request.charges ?? 1);
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your Ring of endurance is charged with ${charges(item).toLocaleString("en-US")} charges.`);
}

function chargeRing(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const ring = chargedIds.has(usedItemId) || chargedByUncharged.has(usedItemId) ? usedItem : chargedIds.has(usedWithItemId) || chargedByUncharged.has(usedWithItemId) ? usedWithItem : null;
  const otherId = ring === usedItem ? usedWithItemId : usedItemId;
  const potionCharges = CHARGES_BY_ITEM.get(Number(otherId));
  if (!ring || !potionCharges) {
    return;
  }
  const room = MAX_CHARGES - charges(ring);
  if (room <= 0) {
    player.sendMessage("Your ring of endurance cannot hold any more charges.");
    event.handled = true;
    return;
  }
  const added = Math.min(potionCharges, room);
  player.getInventory().deleteNumber(otherId, 1);
  if (chargedByUncharged.has(ring.getId())) {
    ring.setId(chargedByUncharged.get(ring.getId()));
    refresh(player);
  }
  const total = charges(ring) + added;
  ring.setMetaValue(CHARGES_META_KEY, total);
  player.sendMessage(`You load your Ring of endurance with ${added} charge${added === 1 ? "" : "s"}. It now has ${total.toLocaleString("en-US")} charges.`);
  event.handled = true;
}

function uncharge({ player, item }) {
  item.setId(unchargedByCharged.get(item.getId()) ?? item.getId());
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("You discharge your ring of endurance; the stamina is lost.");
  player.sendMessage("Your Ring of endurance is charged with 0 charges.");
  return true;
}

module.exports = {
  name: "RingOfEndurance",
  members: true,
  _test: { charges, wornRing, useCharge, doubleStamina, chargeRing, uncharge, passiveApplies, drainModifier, MAX_CHARGES },
  register(api) {
    core = api.core;
    const I = core.ItemIdentifiers;
    chargedIds = new Set([I.RING_OF_ENDURANCE, I.RING_OF_ENDURANCE_2]);
    unchargedByCharged = new Map([...chargedIds].map((id) => [id, I.RING_OF_ENDURANCE_UNCHARGED_]));
    chargedByUncharged = new Map([
      [I.RING_OF_ENDURANCE_UNCHARGED_, I.RING_OF_ENDURANCE],
      [I.RING_OF_ENDURANCE_UNCHARGED__2, I.RING_OF_ENDURANCE],
    ]);

    api.onCustomEvent("potions:stamina-effect", doubleStamina);
    api.registerRunEnergyDrainModifier(drainModifier);
    api.onItemAction((event) => {
      if (chargedIds.has(event.itemId)) {
        const option = String(event.option ?? "").toLowerCase();
        if (option === "check") {
          event.handled = true;
          checkCharges(event);
        } else if (option === "uncharge") {
          event.handled = uncharge(event);
        }
      }
    });
    api.onItemOnItem(chargeRing, { noted: false });
  },
};
