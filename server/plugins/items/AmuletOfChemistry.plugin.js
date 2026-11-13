"use strict";

/**
 * Amulet of chemistry (https://oldschool.runescape.wiki/w/Amulet_of_chemistry). Worn while mixing
 * a potion it has a 5% chance of giving one dose more (a 3-dose potion comes as a 4-dose one) and
 * spends a charge. Its 5 charges belong to the player, not the amulet; the last one crumbles it,
 * and Break (or the crumble) leaves the next amulet starting afresh from 5. Messages, menus and
 * the dialogue texts are from rsprox captures, recordings 4211 and 4213 (rev 238). Nothing is
 * captured for a lone charge's Check/Status wording, nor for the "Stop making potions" setting
 * beyond its menu, so those follow the Wiki: "Its Options menu setting decides whether you keep
 * making potions or stop afterward". A new player's setting is to continue (recording 4213 kept
 * mixing after the amulet crumbled without it ever being set).
 *
 * It answers the Herblore "herblore:mix" request (the extra dose) and "herblore:made" (the charge,
 * after the mix message, as captured), and reads a potion's doses from Potions'
 * "potions:dose-family".
 */

const CHARGES_ATTRIBUTE = "amulet-of-chemistry:charges";
const STOP_ON_BREAK_ATTRIBUTE = "amulet-of-chemistry:stop-on-break";
const MAX_CHARGES = 5;
const EXTRA_DOSE_CHANCE = 0.05;
const MAX_DOSES = 4;
const UNFINISHED_POTION = /\(unf\)$/i;
const CHARGE_WORDS = { 1: "one charge" };
/**
 * Products outside the cache's potion dose families that the amulet still upgrades, by cache name. Wiki:
 * "Despite not being a potion, the amulet also affects Haemostatic dressing, creating 4 'doses' instead of 3."
 */
const NON_POTION_EXTRA_DOSES = { "3dosehaemostaticdressing": "4dosehaemostaticdressing" };

let core;
let api;
let amuletIds;
let nonPotionExtraDoses;

function wornAmulet(player) {
  const worn = player.getEquipment().get(core.Equipment.AMULET_SLOT);
  return worn && amuletIds.has(worn.getId()) ? worn : null;
}

function chargesLeft(player) {
  const value = player.getAttribute(CHARGES_ATTRIBUTE);
  return Number.isInteger(value) ? Math.max(1, Math.min(MAX_CHARGES, value)) : MAX_CHARGES;
}

function chargeText(left) {
  return CHARGE_WORDS[left] ?? `${left} charges`;
}

/** The product with one dose more, when it is a finished potion of fewer than four doses. */
function withExtraDose(productId) {
  if (UNFINISHED_POTION.test(core.ItemDefinition.forId(productId)?.getName?.() ?? "")) return null;
  if (nonPotionExtraDoses.has(productId)) return nonPotionExtraDoses.get(productId);
  const request = { itemId: productId, family: null };
  api.emitCustomEvent("potions:dose-family", request);
  const { family } = request;
  if (!family || family.doses < 1 || family.doses >= MAX_DOSES) return null;
  const next = family.byDose[family.doses + 1];
  return next > 0 ? next : null;
}

function breakAmulet(player) {
  player.setAttribute(CHARGES_ATTRIBUTE, MAX_CHARGES);
  const equipment = player.getEquipment();
  const slot = core.Equipment.AMULET_SLOT;
  equipment.set(slot, new core.Item(-1));
  equipment.refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

/** One charge spent on a brew, after "You mix ...": the message, and the crumble that ends the amulet. */
function spendCharge({ player, mix }) {
  const left = chargesLeft(player) - 1;
  const base = "Your amulet of chemistry helps you create a 4-dose potion.";
  if (left > 1) {
    player.setAttribute(CHARGES_ATTRIBUTE, left);
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, `${base} It has ${chargeText(left)} left.`);
    return;
  }
  if (left === 1) {
    player.setAttribute(CHARGES_ATTRIBUTE, left);
    player.sendMessage(`${base} <col=ff0000>It has ${chargeText(left)} left.</col>`);
    return;
  }
  breakAmulet(player);
  player.sendMessage(`${base} <col=ff0000>It then crumbles to dust.</col>`);
  mix.stop = player.getAttribute(STOP_ON_BREAK_ATTRIBUTE) === true;
}

/** "herblore:mix": 5% of the time a finished potion comes with one dose more. */
function onMix(request) {
  if (!wornAmulet(request.player) || Math.random() >= EXTRA_DOSE_CHANCE) return;
  const productId = withExtraDose(request.productId);
  if (productId == null) return;
  request.productId = productId;
  request.extraDose = true;
}

/** "herblore:made": a brew given its extra dose costs its charge. */
function onMade(made) {
  if (made.mix?.extraDose === true) spendCharge(made);
}

function options({ player }) {
  player.getPacketSender().sendInterfaceRemoval();
  api.sendMultiChatboxPrompt(player, "Select an option",
    "Check charges.", checkCharges,
    "Toggle action when amulet breaks.", chooseBreakAction);
  return true;
}

function checkCharges(player) {
  player.getPacketSender().sendInterfaceRemoval();
  player.sendMessage(`Your amulet of chemistry has ${chargeText(chargesLeft(player))} left.`);
}

function chooseBreakAction(player) {
  api.sendMultiChatboxPrompt(player, "When your amulet breaks, what would you like to do?",
    "Stop making potions when my amulet breaks.", (who) => setStopOnBreak(who, true),
    "Continue making potions when my amulet breaks.", (who) => setStopOnBreak(who, false));
}

function setStopOnBreak(player, stop) {
  player.getPacketSender().sendInterfaceRemoval();
  player.setAttribute(STOP_ON_BREAK_ATTRIBUTE, stop);
}

function breakOption({ player, item }) {
  api.sendMultiChatboxPrompt(player, `Status: ${chargeText(chargesLeft(player))} left.`,
    "Break the amulet.", (who) => breakClicked(who, item),
    "Cancel.", (who) => who.getPacketSender().sendInterfaceRemoval());
  return true;
}

/** Break: the amulet goes, the player's charges start afresh for the next one (recording 4211). */
function breakClicked(player, item) {
  player.getPacketSender().sendInterfaceRemoval();
  const inventory = player.getInventory();
  if (!inventory.getItems().includes(item)) return;
  const itemId = item.getId();
  inventory.deleteNumber(itemId, 1);
  inventory.refreshItems();
  player.setAttribute(CHARGES_ATTRIBUTE, MAX_CHARGES);
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId,
    "The amulet shatters. Your next amulet of chemistry will<br>start afresh from 5 charges.")));
}

function initialize(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  amuletIds = new Set([core.ItemIdentifiers.AMULET_OF_CHEMISTRY]);
  nonPotionExtraDoses = new Map(Object.entries(NON_POTION_EXTRA_DOSES).map(([from, to]) => {
    const fromId = core.CacheDefinitions.getObjId(from), toId = core.CacheDefinitions.getObjId(to);
    if (fromId == null || toId == null) throw new Error(`Missing amulet of chemistry product: ${from} or ${to}`);
    return [fromId, toId];
  }));
}

module.exports = {
  name: "AmuletOfChemistry",
  description: "Amulet of chemistry: 5% chance of an extra potion dose when mixing in Herblore, five charges per amulet, with Options and Break.",
  members: true,
  _test: { initialize, onMix, onMade, withExtraDose, breakClicked, CHARGES_ATTRIBUTE, STOP_ON_BREAK_ATTRIBUTE, MAX_CHARGES },
  register(api) {
    api.onServerStartup(initialize.bind(null, api));
    api.persistAttribute(CHARGES_ATTRIBUTE, MAX_CHARGES);
    api.persistAttribute(STOP_ON_BREAK_ATTRIBUTE, false);
    api.onCustomEvent("herblore:mix", onMix);
    api.onCustomEvent("herblore:made", onMade);
    api.onItemAction("Amulet of chemistry", { Options: options, Break: breakOption });
  },
};
