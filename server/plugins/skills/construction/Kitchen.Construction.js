"use strict";

const { api, Animation, CountdownTask, ItemIdentifiers, TaskManager } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const Menu = require("./Menu.Construction");
const KITCHEN = require("./data/kitchen.json");

// rsprox captures: filling a glass plays poh_barrel_use1, then the barrel's pour animation with
// the glass changing two ticks later.
const BARREL_USE = Ids.seq("poh_barrel_use1");
const MENU_SIZE = 5;

function kitchenFurniture(event) {
  const house = House.houseFor(event.player);
  return house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10) ?? null;
}

/** "Select an option" over `items` ([label, itemId]), four at a time with More... (captures). */
function offer(player, items) {
  const page = items.length <= MENU_SIZE ? items : items.slice(0, MENU_SIZE - 1);
  const rest = items.slice(page.length);
  const options = page.flatMap(([label, itemId]) => [label, () => take(player, itemId)]);
  if (rest.length) options.push("More...", () => offer(player, rest));
  api.sendMultiChatboxPrompt(player, "Select an option", ...options);
}

function take(player, itemId) {
  if (!House.houseFor(player)) return;
  if (player.getInventory().getFreeSlots() === 0 && !player.getInventory().contains(itemId)) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  player.getInventory().adds(itemId, 1);
}

function search(event) {
  const furniture = kitchenFurniture(event);
  const items = furniture && (KITCHEN.larders[furniture.buildableKey] ?? KITCHEN.shelves[furniture.buildableKey]);
  if (!items) return false;
  offer(event.player, items);
  return true;
}

function fillGlass(event) {
  const furniture = kitchenFurniture(event);
  const barrel = furniture && KITCHEN.barrels[furniture.buildableKey];
  if (!barrel) return false;
  const [drink, name, pour] = barrel;
  const player = event.player;
  player.performAnimation(new Animation(BARREL_USE));
  TaskManager.submit(new CountdownTask(player, 2, () => {
    if (!player.getInventory().contains(ItemIdentifiers.BEER_GLASS)) return;
    player.performAnimation(new Animation(pour));
    player.getInventory().delete(ItemIdentifiers.BEER_GLASS, 1);
    player.getInventory().adds(drink, 1);
    player.sendMessage(`You fill the glass with ${name}.`);
  }));
  return true;
}

// Spice rack (Wiki: Spice rack, Transcript:Spice rack; rsprox captures, rev 229 recordings 271 and
// 272). The rack keeps the owner's doses of the four spices, up to 2,147,483,647 of each; they stay
// with the player when the kitchen or the rack is removed. Menus, Check and the box lines list the
// colours in this order.
const SPICE_RACK = "SPICE_RACK";
const MAX_STORED_DOSES = 2147483647;
const SHAKER_DOSES = 4;
const SPICES = [
  ["Red", "red", [ItemIdentifiers.RED_SPICE_1_, ItemIdentifiers.RED_SPICE_2_, ItemIdentifiers.RED_SPICE_3_, ItemIdentifiers.RED_SPICE_4_]],
  ["Brown", "brown", [ItemIdentifiers.BROWN_SPICE_1_, ItemIdentifiers.BROWN_SPICE_2_, ItemIdentifiers.BROWN_SPICE_3_, ItemIdentifiers.BROWN_SPICE_4_]],
  ["Yellow", "yellow", [ItemIdentifiers.YELLOW_SPICE_1_, ItemIdentifiers.YELLOW_SPICE_2_, ItemIdentifiers.YELLOW_SPICE_3_, ItemIdentifiers.YELLOW_SPICE_4_]],
  ["Orange", "orange", [ItemIdentifiers.ORANGE_SPICE_1_, ItemIdentifiers.ORANGE_SPICE_2_, ItemIdentifiers.ORANGE_SPICE_3_, ItemIdentifiers.ORANGE_SPICE_4_]],
].map(([name, colour, shakers]) => ({ name, colour, shakers, attribute: `construction:spice-rack-${colour}` }));
const SPICE_BY_SHAKER = new Map(SPICES.flatMap((spice) => spice.shakers.map((id, index) => [id, { spice, doses: index + 1 }])));

/** The spice rack the event clicked, in the house the player stands in, or null. */
function spiceRackAt(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  return furniture?.buildableKey === SPICE_RACK ? house : null;
}

/** The rack's house when the player owns it; a visitor gets the captured refusal (rec 272, all three options). */
function ownRack(event) {
  const house = spiceRackAt(event);
  if (!house) return null;
  if (house.owner !== event.player) {
    event.player.sendMessage("You can only use this in your own house.");
    return false;
  }
  return house;
}

function box(player, text) {
  Menu.refuse(player, Menu.messageBox(text));
}

function storedDoses(player, spice) {
  return Math.max(0, Math.floor(Number(player.getAttribute(spice.attribute)) || 0));
}

function carriedDoses(player, spice) {
  return spice.shakers.reduce((total, id, index) => total + player.getInventory().getAmount(id) * (index + 1), 0);
}

/** Every shaker of `spice` goes onto the rack (captures: Red. took the red (4)s and the (2) alike). */
function storeSpice(player, spice) {
  const inventory = player.getInventory();
  let stored = storedDoses(player, spice);
  spice.shakers.forEach((id, index) => {
    const doses = index + 1;
    // Ours: shakers that would take a colour past the Wiki's 2,147,483,647 stay in the inventory.
    const shakers = Math.min(inventory.getAmount(id), Math.floor((MAX_STORED_DOSES - stored) / doses));
    if (shakers <= 0) return;
    inventory.delete(id, shakers);
    stored += shakers * doses;
  });
  player.setAttribute(spice.attribute, stored);
}

/** The menu was answered where it was opened: the owner is still in that house. */
function stillHome(player, house) {
  return House.houseFor(player) === house && !house.isDestroyed() && house.owner === player;
}

function storeChoice(player, house, spice) {
  if (!stillHome(player, house)) return;
  if (!carriedDoses(player, spice)) return box(player, `You have no ${spice.colour} spice to store.`);
  storeSpice(player, spice);
  box(player, "Your spices have been stored.");
}

function storeAll(player, house) {
  if (!stillHome(player, house)) return;
  for (const spice of SPICES) storeSpice(player, spice);
  box(player, "Your spices have been stored.");
}

function storeOnRack(event) {
  const house = ownRack(event);
  if (house === null) return false;
  if (!house) return true;
  const player = event.player;
  if (!SPICES.some((spice) => carriedDoses(player, spice))) return box(player, "You don't have any spices to store on the spice rack."), true;
  api.sendMultiChatboxPrompt(player, "Which Spice would you like to store?",
    ...SPICES.flatMap((spice) => [`${spice.name}.`, () => storeChoice(player, house, spice)]), "All.", () => storeAll(player, house));
  return true;
}

/**
 * Up to `amount` doses into new full shakers, the rest in one smaller shaker (captures: 500 asked of
 * 22 stored gave five (4)s and a (2); 3 gave a (3)). Each shaker needs a free slot: with two free,
 * 50 asked gave two (4)s, and a full inventory gave nothing and no message.
 */
function takeSpice(player, house, spice, amount) {
  if (!stillHome(player, house)) return;
  const inventory = player.getInventory();
  const doses = Math.min(Math.floor(amount), storedDoses(player, spice), inventory.getFreeSlots() * SHAKER_DOSES);
  if (!(doses > 0)) return;
  const full = Math.floor(doses / SHAKER_DOSES), rest = doses % SHAKER_DOSES;
  if (full) inventory.adds(spice.shakers[SHAKER_DOSES - 1], full);
  if (rest) inventory.adds(spice.shakers[rest - 1], 1);
  player.setAttribute(spice.attribute, storedDoses(player, spice) - doses);
}

function takeChoice(player, house, spice) {
  if (!stillHome(player, house)) return;
  if (!storedDoses(player, spice)) return box(player, `You don't have any ${spice.colour} spice on the shelf to take.`);
  player.setEnteredAmountAction({ execute: (amount) => takeSpice(player, house, spice, amount) });
  player.getPacketSender().sendEnterAmountPrompt("How much spice would you like to take?:");
}

function takeFromRack(event) {
  const house = ownRack(event);
  if (house === null) return false;
  if (!house) return true;
  const player = event.player;
  api.sendMultiChatboxPrompt(player, "Which Spice would you like to take?",
    ...SPICES.flatMap((spice) => [`${spice.name}.`, () => takeChoice(player, house, spice)]));
  return true;
}

function checkRack(event) {
  const house = ownRack(event);
  if (house === null) return false;
  if (house) box(event.player, SPICES.map((spice) => `${storedDoses(event.player, spice)} x ${spice.name} Spice.`).join("<br>"));
  return true;
}

/** A spice on the rack stores every shaker of its colour (captures); anything else is refused (Wiki transcript). */
function useOnSpiceRack(event) {
  if (!spiceRackAt(event)) return;
  event.handled = true;
  const player = event.player;
  const shaker = SPICE_BY_SHAKER.get(event.itemId);
  if (!shaker) return player.sendMessage("You can't store this in the spice rack.");
  // Ours: a visitor's spice gets the same refusal as the rack's options.
  if (ownRack(event) === false) return;
  storeSpice(player, shaker.spice);
  box(player, "Your spices have been stored.");
}

function attachKitchen(api) {
  for (const spice of SPICES) api.persistAttribute(spice.attribute, 0);
  api.onObjectInteraction("Larder", { Search: search });
  api.onObjectInteraction("Shelves", { Search: search });
  api.onObjectInteraction("Spice Rack", { Store: storeOnRack, Take: takeFromRack, Check: checkRack });
  api.onItemOnObject(useOnBarrel, { noted: false });
  api.onItemOnObject(useOnSpiceRack);
}

function useOnBarrel(event) {
  if (event.itemId === ItemIdentifiers.BEER_GLASS && fillGlass(event)) event.handled = true;
}

Object.assign(module.exports, { attachKitchen, SPICES, storeOnRack, takeFromRack, checkRack, useOnSpiceRack });
