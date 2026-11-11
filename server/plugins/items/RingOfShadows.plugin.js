"use strict";

/**
 * Ring of shadows (https://oldschool.runescape.wiki/w/Ring_of_shadows, Desert Treasure II reward).
 *
 * One soul, blood, death and law rune is one charge, up to 1,000 per ring, and each teleport costs
 * one. The charges are the item's own (the Wiki: rings do not share them). A ring with none left is
 * the uncharged ring again. The Ancient Vault is always open; the other four teleports are unlocked
 * by using that boss's tablet on the ring.
 *
 * The texts of the charge instructions, the amount prompt, the charge result, Check and the locked
 * teleport are from rsprox recordings 1698, 2337 and 3168 (revision 226-229). No capture shows an
 * empty ring, a missing rune or a tablet being used, so those lines are this server's own.
 * Not built: Lassar Undercity taking the worn ring off on arrival.
 */

const CHARGES_META_KEY = "ring-of-shadows:charges";
const UNLOCKED_ATTRIBUTE = "ring-of-shadows:unlocked";
const MAX_CHARGES = 1000;
const WILDERNESS_LEVEL = 20;
// Equipment clicks: op 1 removes the item and the worn options (cache params 451-455) follow.
const WORN_OPTION_PARAM = 451;
const FIRST_WORN_OPTION_CLICK = 2;

const CHARGE_INSTRUCTIONS =
  "To charge the ring of shadows, you will need soul runes, death runes, blood runes and law runes. Runes inside a pouch will not work.";
const LOCKED_MESSAGE = "You have not unlocked that teleport yet.";

/**
 * The teleports in the cache's order (the Teleport submenu, the chat menu and the worn options).
 * Tiles are the Wiki / shortest-path transport destinations. `tablet` is the unlocking item,
 * absent for the Ancient Vault.
 */
const DESTINATIONS = [
  { label: "The Ancient Vault", worn: "Ancient Vault", tile: [3296, 6436, 0] },
  { label: "Ghorrock Dungeon", worn: "Ghorrock Dungeon", tile: [2912, 10336, 0], tablet: "FROZEN_TABLET" },
  { label: "The Scar", worn: "The Scar", tile: [2019, 6434, 0], tablet: "SCARRED_TABLET" },
  { label: "Lassar Undercity", worn: "Lassar Undercity", tile: [2588, 6435, 0], tablet: "SIRENIC_TABLET" },
  { label: "The Stranglewood", worn: "The Stranglewood", tile: [1175, 3424, 0], tablet: "STRANGLED_TABLET" },
];
const RUNES = ["SOUL_RUNE", "BLOOD_RUNE", "DEATH_RUNE", "LAW_RUNE"];

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function charges(item) {
  const saved = Number(item?.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function plural(count, noun) {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function held(player, ring) {
  return [player.getInventory(), player.getEquipment()].some((container) => container.getItems().includes(ring));
}

/** The charge count decides the id: charged with any, uncharged with none. */
function setCharges(player, ring, count) {
  const { ItemIdentifiers } = core;
  ring.setId(count > 0 ? ItemIdentifiers.RING_OF_SHADOWS : ItemIdentifiers.RING_OF_SHADOWS_UNCHARGED_);
  ring.setMetaValue(CHARGES_META_KEY, count > 0 ? count : undefined);
  refresh(player);
}

function itemBox(player, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  const builder = new DialogueChainBuilder().add(new ItemStatementDialogue(0, core.ItemIdentifiers.RING_OF_SHADOWS, text));
  player.getDialogueManager().startDialogues(builder);
}

// ------------------------------------------------------------------ unlocks

function unlockBit(index) {
  return 1 << index;
}

function unlocked(player, index) {
  const destination = DESTINATIONS[index];
  if (!destination.tablet) return true;
  return (Number(player.getAttribute(UNLOCKED_ATTRIBUTE)) || 0) & unlockBit(index);
}

/** Using a boss tablet on the ring unlocks its teleport for good and uses the tablet up. */
function useTablet({ player, usedItem, usedItemId, usedItemSlot, usedWithItem, usedWithItemId, usedWithItemSlot }) {
  const { ItemIdentifiers } = core;
  const tabletIsUsed = DESTINATIONS.some((entry) => entry.tablet && ItemIdentifiers[entry.tablet] === usedItemId);
  const tabletId = tabletIsUsed ? usedItemId : usedWithItemId;
  const tabletSlot = tabletIsUsed ? usedItemSlot : usedWithItemSlot;
  const index = DESTINATIONS.findIndex((entry) => entry.tablet && ItemIdentifiers[entry.tablet] === tabletId);
  if (index < 0) return false;
  if (unlocked(player, index)) {
    player.sendMessage("Your ring of shadows has already been attuned to that tablet.");
    return true;
  }
  player.getInventory().deleteAtSlot(tabletSlot, 1);
  player.setAttribute(UNLOCKED_ATTRIBUTE, (Number(player.getAttribute(UNLOCKED_ATTRIBUTE)) || 0) | unlockBit(index));
  player.sendMessage(`You attune your ring of shadows to the tablet. You can now teleport to ${DESTINATIONS[index].label}.`);
  return true;
}

// ------------------------------------------------------------------ teleporting

function teleport(player, ring, index) {
  const destination = DESTINATIONS[index];
  if (!destination || !held(player, ring)) return;
  if (charges(ring) <= 0) {
    player.sendMessage("Your ring of shadows has no charges left.");
    return;
  }
  if (!unlocked(player, index)) {
    itemBox(player, LOCKED_MESSAGE);
    player.sendMessage(LOCKED_MESSAGE);
    return;
  }
  if (destination.label === "Lassar Undercity" && player.getEquipment().getItems().includes(ring) && player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("You will need one free space in your inventory as entering Lassar will unequip your ring.");
    return;
  }
  const { Location, TeleportHandler, TeleportType } = core;
  const target = new Location(...destination.tile);
  if (!TeleportHandler.checkReqs(player, target, WILDERNESS_LEVEL)) return;
  TeleportHandler.confirm(player, target, (carried) => {
    if (charges(carried) <= 0) return;
    // Equipping during the animation clones the item, so pay before it can move.
    const left = charges(carried) - 1;
    setCharges(player, carried, left);
    if (left === 0) player.sendMessage("Your ring of shadows has run out of charges.");
    TeleportHandler.teleport(player, target, TeleportType.NORMAL, false);
  }, WILDERNESS_LEVEL, { item: ring });
}

/** The inventory's Teleport: a destination from its submenu, or the chat menu when none was picked. */
function inventoryTeleport({ player, item, subOpId }) {
  if (subOpId) {
    teleport(player, item, subOpId - 1);
    return;
  }
  if (charges(item) <= 0) {
    player.sendMessage("Your ring of shadows has no charges left.");
    return;
  }
  api.sendMultiChatboxPrompt(
    player,
    "Where would you like to teleport to?",
    ...DESTINATIONS.flatMap((destination, index) => [destination.label, () => teleport(player, item, index)])
  );
}

/** A worn option names its destination: the cache holds them as item params from the first worn option on. */
function wornTeleport({ player, item, itemId, clickType }) {
  const label = core.CacheDefinitions.getItem(itemId)?.params?.get(WORN_OPTION_PARAM + clickType - FIRST_WORN_OPTION_CLICK);
  const index = DESTINATIONS.findIndex((entry) => entry.worn === label);
  if (index < 0) return false;
  teleport(player, item, index);
}

// ------------------------------------------------------------------ charges

function check({ player, item }) {
  const count = charges(item);
  player.sendMessage(count > 0 ? `Your ring of shadows has ${count.toLocaleString("en-US")} charges remaining.` : "Your ring of shadows has no charges.");
}

function showChargeInstructions({ player }) {
  player.sendMessage(CHARGE_INSTRUCTIONS);
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, CHARGE_INSTRUCTIONS)));
}

/** The most charges the runes in the pack, and the room left in the ring, allow. */
function chargeable(player, ring) {
  const inventory = player.getInventory();
  const runes = Math.min(...RUNES.map((rune) => inventory.getAmount(core.ItemIdentifiers[rune])));
  return Math.max(0, Math.min(runes, MAX_CHARGES - charges(ring)));
}

function addCharges(player, ring, asked) {
  if (!held(player, ring)) return;
  const have = charges(ring);
  if (have >= MAX_CHARGES) {
    player.sendMessage("Your ring of shadows cannot hold any more charges.");
    return;
  }
  const added = Math.min(Math.floor(asked), chargeable(player, ring));
  if (!(added > 0)) {
    player.sendMessage("You need soul, death, blood and law runes to charge the ring of shadows.");
    return;
  }
  for (const rune of RUNES) player.getInventory().deleteNumber(core.ItemIdentifiers[rune], added);
  setCharges(player, ring, have + added);
  const message = `You add ${added.toLocaleString("en-US")} charge${added === 1 ? "" : "s"} to the ring of shadows.`;
  player.sendMessage(message);
  itemBox(player, message);
}

/** Using any of the four runes on the ring asks how many charges to add. */
function useRune({ player, usedItem, usedItemId, usedWithItem, usedWithItemId }) {
  const ringIsUsed = usedItemId === core.ItemIdentifiers.RING_OF_SHADOWS || usedItemId === core.ItemIdentifiers.RING_OF_SHADOWS_UNCHARGED_;
  const ring = ringIsUsed ? usedItem : usedWithItem;
  if (!ring || !(ringIsUsed ? usedWithItemId : usedItemId)) return false;
  if (charges(ring) >= MAX_CHARGES) {
    player.sendMessage("Your ring of shadows cannot hold any more charges.");
    return true;
  }
  player.setEnteredAmountAction({ execute: (amount) => addCharges(player, ring, Number(amount) || 0) });
  player.getPacketSender().sendEnterAmountPrompt(`How many charges do you wish to add? (0 - ${MAX_CHARGES.toLocaleString("en-US")})`);
  return true;
}

/** Wiki: Uncharge needs one empty slot, or all four runes already in the pack. */
function canUncharge(player) {
  const inventory = player.getInventory();
  return inventory.getFreeSlots() >= 1 || RUNES.every((rune) => inventory.contains(core.ItemIdentifiers[rune]));
}

/**
 * Wiki: uncharging refunds one of each rune per charge, in the order soul, blood, death, law. What
 * the pack cannot take (no slot left, or a stack at its cap) is dropped at the player's feet.
 */
function uncharge({ player, item }) {
  const count = charges(item);
  if (count <= 0) return;
  if (!canUncharge(player)) {
    player.sendMessage("You don't have enough inventory space to uncharge the ring.");
    return;
  }
  setCharges(player, item, 0);
  const { Item, ItemOnGroundManager } = core;
  let dropped = false;
  for (const rune of RUNES) {
    const id = core.ItemIdentifiers[rune];
    const fits = Math.min(count, player.getInventory().getAddableAmount(new Item(id, count)));
    if (fits > 0) player.getInventory().adds(id, fits);
    if (fits < count) {
      ItemOnGroundManager.registerLocation(player, new Item(id, count - fits), player.getLocation());
      dropped = true;
    }
  }
  player.sendMessage(`You uncharge your ring of shadows and get back ${plural(count, "charge")} worth of runes.`);
  if (dropped) player.sendMessage("Some of the runes did not fit in your inventory and were dropped on the floor.");
}

function attach(pluginApi) {
  init(pluginApi);
  pluginApi.persistAttribute(UNLOCKED_ATTRIBUTE, 0);
  for (const ring of ["Ring of shadows", "Ring of shadows (uncharged)"]) {
    for (const rune of ["Soul rune", "Blood rune", "Death rune", "Law rune"]) {
      pluginApi.onItemOnItem(rune, ring, useRune, { noted: false });
    }
    for (const tablet of ["Frozen tablet", "Scarred tablet", "Sirenic tablet", "Strangled tablet"]) {
      pluginApi.onItemOnItem(tablet, ring, useTablet, { noted: false });
    }
  }
  pluginApi.onItemAction("Ring of shadows (uncharged)", { Charge: showChargeInstructions });
  pluginApi.onItemAction("Ring of shadows", {
    Teleport: inventoryTeleport,
    Check: check,
    Charge: showChargeInstructions,
    Uncharge: uncharge,
    "Ancient Vault": wornTeleport,
    "Ghorrock Dungeon": wornTeleport,
    "The Scar": wornTeleport,
    "Lassar Undercity": wornTeleport,
    "The Stranglewood": wornTeleport,
  });
}

module.exports = {
  name: "RingOfShadows",
  description: "Charges the ring of shadows with runes and teleports to the Desert Treasure II vaults, unlocking each with its boss tablet, one charge per teleport.",
  members: true,
  register: attach,
  CHARGES_META_KEY,
  UNLOCKED_ATTRIBUTE,
  MAX_CHARGES,
  DESTINATIONS,
  _test: { charges, setCharges, teleport, useRune, addCharges, uncharge, useTablet, check },
};
