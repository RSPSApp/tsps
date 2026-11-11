"use strict";

/**
 * Giantsoul amulet (https://oldschool.runescape.wiki/w/Giantsoul_amulet and its transcript).
 *
 * One big bone (noted or not) and one law rune make one charge, up to 16,000; charges can't be
 * taken back out. Each teleport spends one and lands outside the chosen giant's lair: Bryophyta's
 * and Obor's gates (the tiles the teleport menu uses) and the Royal Titans' entrance tunnel. The
 * last charge leaves the uncharged amulet. Kept on a death in the titans' fight: the Royal Titans
 * plugin decides that, as it knows who is fighting. Messages are the transcript's, except a full
 * amulet's, which it doesn't give.
 */

const MAX_CHARGES = 16000;
const CHARGES_META_KEY = "giantsoul-amulet:charges";
const WILDERNESS_LEVEL = 20;
// Cache params for equipment actions, shared with Jewellery.plugin.js.
const WORN_OPTION_PARAM = 451;
const FIRST_WORN_OPTION_CLICK = 2;

const LAIRS = [
  { label: "Bryophyta's lair", wornOption: "bryophyta", tile: [3174, 9900, 0] },
  { label: "Obor's lair", wornOption: "obor", tile: [3095, 9833, 0] },
  { label: "Branda and Eldric's lair", wornOption: "branda and eldric", tile: [2950, 9574, 0] },
];

let api = null;
let core = null;

function ids() {
  const I = core.ItemIdentifiers;
  return { charged: I.GIANTSOUL_AMULET, uncharged: I.GIANTSOUL_AMULET_UNCHARGED_ };
}

function charges(item) {
  if (item?.getId?.() !== ids().charged) return 0;
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function plural(count) {
  return `${count.toLocaleString("en-US")} charge${count === 1 ? "" : "s"}`;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

// ------------------------------------------------------------------ charging

function bonesCarried(player) {
  const I = core.ItemIdentifiers;
  const inventory = player.getInventory();
  return inventory.getAmount(I.BIG_BONES) + inventory.getAmount(I.BIG_BONES_2);
}

function takeBones(player, amount) {
  const I = core.ItemIdentifiers;
  const inventory = player.getInventory();
  const unnoted = Math.min(amount, inventory.getAmount(I.BIG_BONES));
  if (unnoted > 0) inventory.deleteNumber(I.BIG_BONES, unnoted);
  if (amount > unnoted) inventory.deleteNumber(I.BIG_BONES_2, amount - unnoted);
}

/** The most charges the carried bones, law runes and room allow. */
function chargeable(player, amulet) {
  const laws = player.getInventory().getAmount(core.ItemIdentifiers.LAW_RUNE);
  return Math.max(0, Math.min(bonesCarried(player), laws, MAX_CHARGES - charges(amulet)));
}

function held(player, amulet) {
  return [player.getInventory(), player.getEquipment()].some((container) => container.getItems().includes(amulet));
}

function addCharges(player, amulet, requested) {
  const amount = Math.min(Math.floor(Number(requested)) || 0, chargeable(player, amulet));
  if (amount <= 0) return;
  takeBones(player, amount);
  player.getInventory().deleteNumber(core.ItemIdentifiers.LAW_RUNE, amount);
  const total = charges(amulet) + amount;
  amulet.setId(ids().charged);
  amulet.setMetaValue(CHARGES_META_KEY, total);
  refresh(player);
  player.sendMessage(`You add ${plural(amount)} to your Giantsoul amulet, giving it a total of ${plural(total)}.`);
}

function charge(player, amulet) {
  if (charges(amulet) >= MAX_CHARGES) {
    player.sendMessage("Your Giantsoul amulet can't hold any more charges.");
    return;
  }
  const most = chargeable(player, amulet);
  if (most <= 0) {
    player.sendMessage("You need 1 law rune and 1 big bone to charge the Giantsoul amulet.");
    return;
  }
  if (most === 1) {
    addCharges(player, amulet, 1);
    return;
  }
  player.setEnteredAmountAction({ execute: (amount) => {
    // A moved or equipped item may have been cloned since the prompt opened.
    if (!held(player, amulet)) return;
    addCharges(player, amulet, amount);
  } });
  player.getPacketSender().sendEnterAmountPrompt(`How many charges would you like to add? (0 - ${most.toLocaleString("en-US")})`);
}

function isAmulet(itemId) {
  return itemId === ids().charged || itemId === ids().uncharged;
}

function isCharge(itemId) {
  const I = core.ItemIdentifiers;
  return itemId === I.BIG_BONES || itemId === I.BIG_BONES_2 || itemId === I.LAW_RUNE;
}

function chargeWithItems(event) {
  const amulet = isAmulet(event.usedItemId) ? event.usedItem : isAmulet(event.usedWithItemId) ? event.usedWithItem : null;
  const otherId = amulet === event.usedItem ? event.usedWithItemId : event.usedItemId;
  if (!amulet || !isCharge(otherId)) return;
  event.handled = true;
  charge(event.player, amulet);
}

// ------------------------------------------------------------------ teleporting

function teleport(player, amulet, lair) {
  if (!held(player, amulet)) return;
  if (charges(amulet) <= 0) {
    player.sendMessage("You have no remaining charges in your Giantsoul amulet.");
    return;
  }
  const { Location, TeleportHandler, TeleportType } = core;
  const target = new Location(...lair.tile);
  if (!TeleportHandler.checkReqs(player, target, WILDERNESS_LEVEL)) return;
  TeleportHandler.confirm(player, target, () => {
    // Equipping during the animation clones the item, so pay before it can move.
    useCharge(player, amulet);
    TeleportHandler.teleport(player, target, TeleportType.NORMAL, false);
  }, WILDERNESS_LEVEL);
}

function useCharge(player, amulet) {
  const left = charges(amulet) - 1;
  if (left > 0) {
    amulet.setMetaValue(CHARGES_META_KEY, left);
    return;
  }
  amulet.setId(ids().uncharged);
  amulet.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("You have no remaining charges in your Giantsoul amulet.");
}

function rub(player, amulet) {
  api.sendMultiChatboxPrompt(player, "Where would you like to teleport to?",
    ...LAIRS.flatMap((lair) => [lair.label, () => teleport(player, amulet, lair)]),
    "Nowhere", () => player.getPacketSender().sendInterfaceRemoval());
}

function check(player, amulet) {
  player.sendMessage(`Your Giantsoul amulet has ${plural(charges(amulet))} left powering it.`);
}

function itemAction(event) {
  if (!isAmulet(event.itemId) || !event.item) return;
  let optionName = event.option;
  if (!optionName && event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID && event.clickType >= FIRST_WORN_OPTION_CLICK) {
    optionName = core.CacheDefinitions.getItem(event.itemId)?.params?.get(WORN_OPTION_PARAM + event.clickType - FIRST_WORN_OPTION_CLICK);
  }
  const option = String(optionName ?? "").toLowerCase();
  const { player, item } = event;
  const lair = LAIRS.find((entry) => entry.wornOption === option);
  if (option === "charge") charge(player, item);
  else if (option === "check") check(player, item);
  else if (option === "rub") rub(player, item);
  else if (lair) teleport(player, item, lair);
  else return;
  event.handled = true;
}

module.exports = {
  name: "GiantsoulAmulet",
  description: "Charges the giantsoul amulet with big bones and law runes and teleports to Bryophyta's, Obor's or the Royal Titans' lairs, one charge each.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onItemAction(itemAction);
    api.onItemOnItem(chargeWithItems);
  },
  CHARGES_META_KEY,
  MAX_CHARGES,
  _test: { charges, chargeable, addCharges, charge, chargeWithItems, teleport, useCharge, itemAction, LAIRS },
};
