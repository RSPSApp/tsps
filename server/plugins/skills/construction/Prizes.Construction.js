"use strict";

const { api, DialogueChainBuilder, Item, ItemIdentifiers, StatementDialogue } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");

// Games room prize chests (rsprox captures): Open tells everyone else "You must have a prize key or
// be in building mode to take the prize. Prize amount: <n>." and which game the prize is on. Whoever
// starts a game while the chest holds a prize is asked "Offer the prize for this game?"; the winner
// of that game hears synth 933 and "A little key appears in your pack!" (a prize key), which opens
// the chest. The owner fills the chest with coins, up to the Wiki's maximum per chest; that coins
// are the prize, and how they go in, is this server's reading of "Prize amount".
const COINS = ItemIdentifiers.COINS;
const PRIZE_KEY = Ids.obj("poh_prize_key");
const KEY_SOUND = 933;
const CHEST_LIMITS = { OAK_PRIZE_CHEST: 20000, TEAK_PRIZE_CHEST: 50000, MAHOGANY_PRIZE_CHEST: 100000 };
const GAME_NAMES = {
  darts: "the winner of the darts game",
  hoop: "the winner of the stick-and-hoop game",
  archery: "the winner of the archery game",
  hangman: "the winner of the hangman game",
  mime: "the winner of the mime game",
  balance: "whoever balances the elemental balance",
  stone: "whoever destroys the attack stone",
  treasure: "whoever finds the treasure fairy",
};

/** house -> the game the prize is on */
const offeredTo = new WeakMap();

function say(player, text) {
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function chestIn(house) {
  return house.furnitureEntries().find(entry => CHEST_LIMITS[entry.furniture.buildableKey]) ?? null;
}

function prizeOf(house) {
  return house.save.prize ?? 0;
}

function chestAt(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  return furniture && CHEST_LIMITS[furniture.buildableKey] ? { house, limit: CHEST_LIMITS[furniture.buildableKey] } : null;
}

function open(event) {
  const found = chestAt(event);
  if (!found) return false;
  const { house } = found;
  const player = event.player;
  const prize = prizeOf(house);
  const owner = house.owner === player && house.buildingMode;
  const keyed = !owner && player.getInventory().contains(PRIZE_KEY);
  if (!owner && !keyed) {
    const game = offeredTo.get(house);
    const status = game ? `The prize will be awarded to ${GAME_NAMES[game]}.` : "No game is currently being played for the prize.";
    say(player, `You must have a prize key or be in building mode to take the prize. Prize amount: <col=ff0000>${prize.toLocaleString("en-US")}</col>. ${status}`);
    return true;
  }
  if (prize <= 0) return say(player, "The chest is empty."), true;
  // The whole prize or none (a key is spent per take): a coin stack near the cap, or one with other metadata and no
  // free slot, passed the old slot check and the add kept only part, or none, of the zeroed prize.
  if (player.getInventory().getAddableAmount(new Item(COINS, prize)) < prize) {
    return player.sendMessage("You don't have enough inventory space."), true;
  }
  if (keyed) player.getInventory().delete(PRIZE_KEY, 1);
  house.save.prize = 0;
  offeredTo.delete(house);
  player.getInventory().adds(COINS, prize);
  House.saveHouse(house);
  player.sendMessage(`You take ${prize.toLocaleString("en-US")} coins from the chest.`);
  return true;
}

function deposit(event) {
  if (event.itemId !== COINS) return;
  const found = chestAt(event);
  if (!found) return;
  event.handled = true;
  const { house, limit } = found;
  const player = event.player;
  if (house.owner !== player) return player.sendMessage("Only the owner of the house can put a prize in the chest.");
  const room = limit - prizeOf(house);
  if (room <= 0) return player.sendMessage(`The chest can't hold a prize of more than ${limit.toLocaleString("en-US")} coins.`);
  const amount = Math.min(room, player.getInventory().getAmount(COINS));
  player.getInventory().delete(COINS, amount);
  house.save.prize = prizeOf(house) + amount;
  House.saveHouse(house);
  player.sendMessage(`You put ${amount.toLocaleString("en-US")} coins into the prize chest.`);
}

/**
 * A game is starting: when its starter is the owner and the chest holds an unclaimed prize, ask
 * "Offer the prize for this game?" first. `start` runs either way.
 */
function offer(player, house, game, start, valid = null) {
  const canStart = () => !valid || valid();
  if (house.owner !== player || prizeOf(house) <= 0 || offeredTo.has(house) || !chestIn(house)) return canStart() && start();
  api.sendMultiChatboxPrompt(player, "Offer the prize for this game?",
    "Yes", () => { if (canStart()) { if (!valid || !offeredTo.has(house)) offeredTo.set(house, game); start(); } },
    "No", () => { if (canStart()) start(); });
}

/** The game is over: its winner gets the key when the prize was on it. */
function award(house, game, winner) {
  if (offeredTo.get(house) !== game || !winner) return;
  offeredTo.delete(house);
  winner.getPacketSender().sendSound(KEY_SOUND, 0, 0);
  winner.getInventory().adds(PRIZE_KEY, 1);
  winner.sendMessage("A little key appears in your pack!");
}

/** The game ended without a winner (banished, building mode): the prize goes back to waiting. */
function withdraw(house, game) {
  if (offeredTo.get(house) === game) offeredTo.delete(house);
}

function attachPrizes(api) {
  for (const name of ["Oak prize chest", "Teak prize chest", "Mahogany prize chest"]) api.onObjectInteraction(name, { Open: open });
  api.onItemOnObject(deposit);
}

Object.assign(module.exports, { attachPrizes, offer, award, withdraw, open });
