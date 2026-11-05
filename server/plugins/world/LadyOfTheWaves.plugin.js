/**
 * Captain Shanks and the Lady of the Waves, docked south of Cairn Isle.
 *
 * After Shilo Village he sells a ship ticket on the spot (the Wiki's 20-50 coins, randomised
 * each time he is asked) and sails to Port Khazard or Port Sarim; a ticket held already skips
 * the sale. The transcript is npc-dialogues.json "Captain Shanks". The Wiki also has Karamja
 * rum lost to a sailor's dice game during the trip.
 *
 * OSRS Wiki: Lady of the Waves, Transcript:Captain Shanks.
 */
const SHANKS = 5364; // NpcIdentifiers.CAPTAIN_SHANKS
const SHIP_TICKET = 621; // ItemIdentifiers.SHIP_TICKET
const MIN_PRICE = 20;
const MAX_PRICE = 50;
const DESTINATIONS = new Map([
  ["You arrive safely in the quiet fishing port of Khazard.", { key: "port-khazard", to: [2680, 3150, 0] }],
  ["The ship arrives in busy Port Sarim.", { key: "port-sarim", to: [3050, 3192, 0] }],
]);

let core;
let api;
/** The price quoted for this conversation, so the line, prompt and guards agree. */
const prices = new WeakMap();

function isShanks(definition) {
  return definition?.getName?.() === "Captain Shanks";
}

function shiloComplete(player) {
  const request = { player, key: "shilo_village", complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** One Small Favour gives Captain Shanks his own transcript while it runs; leave that alone. */
function osfInProgress(player) {
  const complete = { player, key: "one_small_favour", complete: false };
  api.emitCustomEvent("quest:is-complete", complete);
  if (complete.complete === true) return false;
  const started = { player, key: "one_small_favour", started: false };
  api.emitCustomEvent("quest:is-started", started);
  return started.started === true;
}

function priceFor(player) {
  if (!prices.has(player)) prices.set(player, MIN_PRICE + Math.floor(Math.random() * (MAX_PRICE - MIN_PRICE + 1)));
  return prices.get(player);
}

function coinsOf(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS);
}

function hasTicket(player) {
  return player.getInventory().getAmount(SHIP_TICKET) > 0;
}

function selectVariant({ player, definition }) {
  if (!isShanks(definition) || osfInProgress(player)) return null;
  prices.delete(player);
  if (!shiloComplete(player)) return "before-completion-of-shilo-village";
  priceFor(player);
  return hasTicket(player)
    ? "after-completion-of-shilo-village-if-the-player-has-a-ship-ticket"
    : "after-completion-of-shilo-village-if-the-player-does-not-have-a-ship-ticket";
}

function answerCondition({ player, definition, text }) {
  if (!isShanks(definition)) return null;
  if (text === "If the player does not have enough money:") return coinsOf(player) < priceFor(player);
  if (text === "If the player has enough money:") return coinsOf(player) >= priceFor(player);
  return null;
}

/** The transcript's "[number]" blanks: his line and the buy prompt. */
function fillNumber(event) {
  if (!isShanks(event.definition)) return;
  const price = String(priceFor(event.player));
  if (typeof event.text === "string") event.text = event.text.split("[number]").join(price);
  if (typeof event.prompt === "string") event.prompt = event.prompt.split("[number]").join(price);
}

const BUY_LINE = "It's a good deal and no mistake. Here you go, me old shipmate, here's your ticket.";

/** Buying the on-site ticket: take the coins and hand it over, once. */
function buyTicket({ player, definition, text }) {
  if (!isShanks(definition) || text !== BUY_LINE || hasTicket(player)) return;
  const price = priceFor(player);
  const inventory = player.getInventory();
  const coins = inventory.getAmount(core.ItemIdentifiers.COINS);
  if (coins < price) return;
  if (inventory.isFull() && coins > price) {
    player.sendMessage("You need a free inventory space for the ticket.");
    return;
  }
  inventory.deleteNumber(core.ItemIdentifiers.COINS, price);
  inventory.adds(SHIP_TICKET, 1);
  inventory.refreshItems?.();
}

/** The narrated arrival is where the ship lands; the ticket is taken as he said it would be. */
function sail({ player, definition, kind, text }) {
  if (!isShanks(definition) || kind !== "message") return;
  const destination = DESTINATIONS.get(text);
  if (!destination) return;
  const inventory = player.getInventory();
  if (!shiloComplete(player) || !hasTicket(player)) {
    player.sendMessage("You need a ship ticket to sail.");
    return;
  }
  inventory.deleteNumber(SHIP_TICKET, 1);
  if (inventory.getAmount(core.ItemIdentifiers.KARAMJAN_RUM) > 0) {
    inventory.deleteNumber(core.ItemIdentifiers.KARAMJAN_RUM, 1);
    player.sendMessage("During the trip you lose your rum to a sailor in a game of dice. Better luck next time!");
  }
  inventory.refreshItems?.();
  player.moveTo(new core.Location(...destination.to));
  api.emitCustomEvent("lady-of-the-waves:sailed", { player, destination: destination.key });
}

module.exports = {
  name: "LadyOfTheWaves",
  members: true,
  _test: { DESTINATIONS, selectVariant, answerCondition, fillNumber, buyTicket, sail, priceFor, SHIP_TICKET },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onNpcDialogueVariant(selectVariant);
    api.onNpcDialogueCondition(answerCondition);
    api.onCustomEvent("npc-dialogue:line", fillNumber);
    api.onCustomEvent("npc-dialogue:line", buyTicket);
    api.onCustomEvent("npc-dialogue:menu", fillNumber);
    api.onCustomEvent("npc-dialogue:action", sail);
  },
};
