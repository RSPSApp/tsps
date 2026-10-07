/**
 * Ring of endurance (https://oldschool.runescape.wiki/w/Ring_of_endurance).
 *
 * Charged with stamina potions and mixes, one charge per dose (1,000 max).
 * While a charged ring is worn, a stamina dose is doubled (40% energy and a
 * 4-minute buff) and spends one charge; uncharging does not refund charges.
 * The 500-charge passive run-drain reduction is not modelled because the run
 * energy drain rate has no plugin hook yet.
 */
const Equipment = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment").Equipment;
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const MAX_CHARGES = 1000;
const CHARGES_META_KEY = "ring-of-endurance";

const DOSE_BY_ITEM = new Map([
  [ItemIdentifiers.STAMINA_POTION_4_, 4],
  [ItemIdentifiers.STAMINA_POTION_3_, 3],
  [ItemIdentifiers.STAMINA_POTION_2_, 2],
  [ItemIdentifiers.STAMINA_POTION_1_, 1],
  [ItemIdentifiers.STAMINA_MIX_2_, 2],
  [ItemIdentifiers.STAMINA_MIX_1_, 1],
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

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function useCharge(player, item) {
  const left = charges(item) - 1;
  if (left > 0) {
    item.setMetaValue(CHARGES_META_KEY, left);
    return;
  }
  item.setId(unchargedByCharged.get(item.getId()));
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("Your ring of endurance has run out of charges.");
}

/** Doubles a stamina dose and spends one charge (Wiki). */
function doubleStamina(request) {
  const ring = wornRing(request?.player);
  if (!ring) {
    return;
  }
  request.energy *= 2;
  request.durationMs *= 2;
  useCharge(request.player, ring);
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your ring of endurance has ${charges(item).toLocaleString("en-US")} charges left.`);
}

function chargeRing(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const ring = chargedIds.has(usedItemId) || chargedByUncharged.has(usedItemId) ? usedItem : usedWithItem;
  const otherId = ring === usedItem ? usedWithItemId : usedItemId;
  const doses = DOSE_BY_ITEM.get(Number(otherId));
  if (!ring || !doses) {
    return;
  }
  const room = MAX_CHARGES - charges(ring);
  if (room <= 0) {
    player.sendMessage("Your ring of endurance cannot hold any more charges.");
    event.handled = true;
    return;
  }
  const added = Math.min(doses, room);
  player.getInventory().deleteNumber(otherId, 1);
  if (chargedByUncharged.has(ring.getId())) {
    ring.setId(chargedByUncharged.get(ring.getId()));
    refresh(player);
  }
  ring.setMetaValue(CHARGES_META_KEY, charges(ring) + added);
  player.sendMessage(`You add ${added} charge${added === 1 ? "" : "s"} to your ring of endurance.`);
  event.handled = true;
}

function uncharge({ player, item }) {
  item.setId(unchargedByCharged.get(item.getId()) ?? item.getId());
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("You discharge your ring of endurance; the stamina is lost.");
  return true;
}

module.exports = {
  name: "RingOfEndurance",
  members: true,
  _test: { charges, wornRing, useCharge, doubleStamina, chargeRing, uncharge, MAX_CHARGES },
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
