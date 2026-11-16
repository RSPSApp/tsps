"use strict";

/**
 * Using things with the Rotten potato (Wiki: Rotten potato, Uses):
 *
 *   an item on it        deletes that item: "Whee... [Item] All gone!"
 *   it on the party chest  fills the chest with one of each colour hat, through the PartyRoom plugin
 *   it on a player       shows that player's inventory, here as chat lines
 *
 * Someone below owner gets nothing special: the use falls through to "Nothing interesting happens."
 */
const Common = require("./Common.RottenPotato");

const PARTYHATS = ["RED_PARTYHAT", "YELLOW_PARTYHAT", "BLUE_PARTYHAT", "GREEN_PARTYHAT", "PURPLE_PARTYHAT", "WHITE_PARTYHAT"];
const CHEST_REFUSALS = {
  full: "The chest has no room for the hats.",
  unavailable: "The chest can't be changed right now.",
  write: "The chest can't be changed right now.",
};

const isPotato = (id) => id === Common.potatoId();
const allowedQuietly = (player) => player?.getRights?.()?.getId?.() >= Common.getCore().PlayerRights.OWNER.getId();

function itemOnPotato(event) {
  const { player, usedItemId, usedWithItemId } = event;
  if (isPotato(usedItemId) === isPotato(usedWithItemId) || !allowedQuietly(player)) return;
  const [slot, item] = isPotato(usedItemId)
    ? [event.usedWithItemSlot, event.usedWithItem]
    : [event.usedItemSlot, event.usedItem];
  const inventory = player.getInventory();
  if (!item || inventory.getItems()[slot] !== item) return;
  event.handled = true;
  const name = Common.getCore().CacheDefinitions.getItem(item.getId())?.name ?? "item";
  inventory.deleteAtSlot(slot, item.getAmount(), true);
  player.sendMessage(`Whee... ${name} All gone!`);
}

function potatoOnObject(event) {
  const { player, itemId, objectId } = event;
  if (!isPotato(itemId) || !allowedQuietly(player)) return;
  const I = Common.getCore().ItemIdentifiers;
  const request = { objectId, items: PARTYHATS.map((name) => ({ id: I[name], amount: 1 })), handled: false, result: null };
  Common.getApi().emitCustomEvent("party-room:fill-chest", request);
  if (!request.handled) return;
  event.handled = true;
  player.sendMessage(request.result?.ok ? "The chest fills with party hats." : CHEST_REFUSALS[request.result?.reason] ?? CHEST_REFUSALS.unavailable);
}

function potatoOnPlayer(event) {
  const { player, target, itemId } = event;
  if (!isPotato(itemId) || !target || !allowedQuietly(player)) return;
  event.handled = true;
  const definitions = Common.getCore().CacheDefinitions;
  const counts = new Map();
  for (const item of target.getInventory().getItems()) {
    if (!item || item.getId() <= 0) continue;
    counts.set(item.getId(), (counts.get(item.getId()) ?? 0) + item.getAmount());
  }
  player.sendMessage(`${target.getDisplayName()}'s inventory${counts.size ? ":" : " is empty."}`);
  for (const [id, amount] of counts) {
    player.sendMessage(`${amount.toLocaleString("en-US")} x ${definitions.getItem(id)?.name ?? `item ${id}`}`);
  }
}

module.exports = function attach(api) {
  api.onItemOnItem(itemOnPotato);
  api.onItemOnObject(potatoOnObject);
  api.onItemOnPlayer(potatoOnPlayer);
};
