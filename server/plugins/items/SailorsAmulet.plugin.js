"use strict";

/**
 * Sailors' amulet (https://oldschool.runescape.wiki/w/Sailors%27_amulet).
 *
 * A law or water rune used on the amulet, inert or charged, with both kinds in the inventory,
 * asks how many charges to add, ten at a time, up to 10,000. Every ten charges cost one law rune
 * and ten water runes, from the inventory only (a staff of water doesn't count). The amulet then
 * shows in an object box with the new total. Charges can't be taken back out. Check gives the
 * count in the chat.
 */

const MAX_CHARGES = 10000;
const CHARGES_PER_SET = 10;
const WATER_RUNES_PER_SET = 10;
const LAW_RUNES_PER_SET = 1;
const CHARGES_META_KEY = "sailors-amulet:charges";
const CHARGE_SOUND = 30;
// Cache params for equipment actions, shared with Jewellery.plugin.js.
const WORN_OPTION_PARAM = 451;
const FIRST_WORN_OPTION_CLICK = 2;

let core = null;

function ids() {
  const I = core.ItemIdentifiers;
  return { charged: I.SAILORS_AMULET, inert: I.SAILORS_AMULET_INERT_, law: I.LAW_RUNE, water: I.WATER_RUNE };
}

function charges(item) {
  if (item?.getId?.() !== ids().charged) return 0;
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function format(count) {
  return count.toLocaleString("en-US");
}

function plural(count) {
  return `${format(count)} charge${count === 1 ? "" : "s"}`;
}

function held(player, amulet) {
  return [player.getInventory(), player.getEquipment()].some((container) => container.getItems().includes(amulet));
}

/** The most charges the carried runes and the room left allow, in whole sets of ten. */
function chargeable(player, amulet) {
  const { law, water } = ids();
  const inventory = player.getInventory();
  const sets = Math.min(
    Math.floor(inventory.getAmount(law) / LAW_RUNES_PER_SET),
    Math.floor(inventory.getAmount(water) / WATER_RUNES_PER_SET),
    Math.floor((MAX_CHARGES - charges(amulet)) / CHARGES_PER_SET),
  );
  return Math.max(0, sets) * CHARGES_PER_SET;
}

function addCharges(player, amulet, requested) {
  const wanted = Math.floor(Number(requested)) || 0;
  // Ours: an amount between the tens rounds down to them.
  const sets = Math.floor(Math.min(wanted, chargeable(player, amulet)) / CHARGES_PER_SET);
  if (sets <= 0) return;
  const { charged, law, water } = ids();
  const amount = sets * CHARGES_PER_SET;
  const total = charges(amulet) + amount;
  const inventory = player.getInventory();
  inventory.deleteNumber(law, sets * LAW_RUNES_PER_SET);
  inventory.deleteNumber(water, sets * WATER_RUNES_PER_SET);
  amulet.setId(charged);
  amulet.setMetaValue(CHARGES_META_KEY, total);
  inventory.refreshItems();
  player.getEquipment().refreshItems();
  player.getPacketSender().sendSound(CHARGE_SOUND, 100, 0);
  const text = `You add ${plural(amount)} to your amulet. It now has ${plural(total)}.`;
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, charged, core.ChatTextLayout.wrap(text).join("<br>"))));
}

function charge(player, amulet) {
  if (charges(amulet) >= MAX_CHARGES) {
    // Ours: the full amulet's line.
    player.sendMessage("Your amulet can't hold any more charges.");
    return;
  }
  const most = chargeable(player, amulet);
  if (most <= 0) {
    // Ours: the line when a law rune or ten water runes are missing.
    player.sendMessage(`You need at least ${LAW_RUNES_PER_SET} law rune and ${WATER_RUNES_PER_SET} water runes to charge the amulet.`);
    return;
  }
  player.setEnteredAmountAction({ execute: (amount) => {
    // A moved or equipped item may have been cloned since the prompt opened.
    if (!held(player, amulet)) return;
    addCharges(player, amulet, amount);
  } });
  player.getPacketSender().sendEnterAmountPrompt(`How many charges would you like to add? (${CHARGES_PER_SET} - ${format(most)})`);
}

function isAmulet(itemId) {
  const { charged, inert } = ids();
  return itemId === charged || itemId === inert;
}

function isRune(itemId) {
  const { law, water } = ids();
  return itemId === law || itemId === water;
}

function chargeWithRunes(event) {
  const amulet = isAmulet(event.usedItemId) ? event.usedItem : isAmulet(event.usedWithItemId) ? event.usedWithItem : null;
  const otherId = amulet === event.usedItem ? event.usedWithItemId : event.usedItemId;
  if (!amulet || !isRune(otherId)) return;
  event.handled = true;
  charge(event.player, amulet);
}

function check(player, amulet) {
  player.sendMessage(`The amulet has ${plural(charges(amulet))}.`);
}

function itemAction(event) {
  if (event.itemId !== ids().charged || !event.item) return;
  let optionName = event.option;
  if (!optionName && event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID && event.clickType >= FIRST_WORN_OPTION_CLICK) {
    optionName = core.CacheDefinitions.getItem(event.itemId)?.params?.get(WORN_OPTION_PARAM + event.clickType - FIRST_WORN_OPTION_CLICK);
  }
  if (String(optionName ?? "").toLowerCase() !== "check") return;
  check(event.player, event.item);
  event.handled = true;
}

module.exports = {
  name: "SailorsAmulet",
  description: "Charges the sailors' amulet with law and water runes, ten charges for one law and ten water runes, up to 10,000, and Check shows its charges.",
  members: true,
  register(pluginApi) {
    core = pluginApi.core;
    pluginApi.onItemAction(itemAction);
    pluginApi.onItemOnItem(chargeWithRunes);
  },
  CHARGES_META_KEY,
  MAX_CHARGES,
  _test: { charges, chargeable, addCharges, charge, chargeWithRunes, itemAction },
};
