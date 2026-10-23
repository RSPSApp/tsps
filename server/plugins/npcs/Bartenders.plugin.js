/**
 * Standard beer purchases from the Wiki bartender transcripts.
 *
 * NpcDialogues plays the words, but the transcript's `give 2 coins` /
 * `receive Beer` action steps have no owner, so the pint message appeared
 * without taking coins or adding the beer. These are the three F2P pubs whose
 * standard-dialogue pages carry the same ordinary beer branch:
 *   Bartender (Blue Moon Inn)        1312  receive -P7usW  message reFUlS
 *   Bartender (Dancing Donkey Inn)   1311  receive 4ksfKE
 *   Bartender (The Sheared Ram)      7546  receive dqIAGj
 * Beer is 2 coins (standard Beer price).
 */
const BEER_PRICE = 2;
const BLUE_MOON_PINT_MESSAGE = "reFUlS";

/** Step id -> transcript page that owns it. */
const BEER_PURCHASES = new Map([
  ["-P7usW", { page: "Bartender (Blue Moon Inn)" }],
  ["4ksfKE", { page: "Bartender (Dancing Donkey Inn)" }],
  ["dqIAGj", { page: "Bartender (The Sheared Ram)" }],
]);

/** Exact Wiki condition prose for these pages, and the answer it means. */
const COIN_CONDITIONS = new Map([
  ["if the player has at least two coins in their inventory:", true],
  ["if the player does not have at least two coins in their inventory:", false],
  ["if the player has enough coins:", true],
  ["if the player does not have enough coins:", false],
]);

const page = (event, want) => (event.pages ?? []).some((entry) => entry.page === want);

/** A full bag with exactly the price in coins frees the coin stack's slot. */
const canTakeBeer = (inventory, coinAmount) =>
  inventory.getFreeSlots() + (coinAmount === BEER_PRICE ? 1 : 0) >= 1;

function answerCoins(core, event) {
  const text = String(event.text ?? "").toLowerCase();
  const expected = COIN_CONDITIONS.get(text);
  if (expected === undefined) return null;
  if (![...BEER_PURCHASES.values()].some((purchase) => page(event, purchase.page))) return null;
  const coinAmount = event.player.getInventory().getAmount(core.ItemIdentifiers.COINS);
  return expected ? coinAmount >= BEER_PRICE : coinAmount < BEER_PRICE;
}

function purchaseFor(event) {
  const purchase = BEER_PURCHASES.get(event.stepId);
  if (!purchase || event.action !== "receive" || event.kind === "message") return null;
  return page(event, purchase.page) ? purchase : null;
}

function refuse(event, message) {
  event.player.sendMessage(message);
  event.handled = true;
  event.end = true;
}

function buyBeer(core, event) {
  if (!purchaseFor(event)) return;
  const inventory = event.player.getInventory();
  const coinAmount = inventory.getAmount(core.ItemIdentifiers.COINS);
  if (coinAmount < BEER_PRICE) {
    refuse(event, "You don't have enough coins.");
    return;
  }
  if (!canTakeBeer(inventory, coinAmount)) {
    refuse(event, "You need a free inventory slot for the beer.");
    return;
  }
  const beerBefore = inventory.getAmount(core.ItemIdentifiers.BEER);
  inventory.deleteNumber(core.ItemIdentifiers.COINS, BEER_PRICE);
  inventory.adds(core.ItemIdentifiers.BEER, 1);
  if (inventory.getAmount(core.ItemIdentifiers.BEER) !== beerBefore + 1) {
    inventory.adds(core.ItemIdentifiers.COINS, BEER_PRICE);
    refuse(event, "You need a free inventory slot for the beer.");
    return;
  }
  event.handled = true;
}

/** Blue Moon prints the pint message before the receive step; close before it if the beer cannot fit. */
function pintMessage(core, event) {
  if (event.kind !== "message" || event.stepId !== BLUE_MOON_PINT_MESSAGE) return;
  if (!page(event, "Bartender (Blue Moon Inn)")) return;
  const inventory = event.player.getInventory();
  const coinAmount = inventory.getAmount(core.ItemIdentifiers.COINS);
  if (coinAmount >= BEER_PRICE && !canTakeBeer(inventory, coinAmount)) {
    refuse(event, "You need a free inventory slot for the beer.");
  }
}

module.exports = {
  name: "Bartenders",
  register(api) {
    api.onNpcDialogueCondition(answerCoins.bind(null, api.core));
    api.onCustomEvent("npc-dialogue:action", buyBeer.bind(null, api.core));
    api.onCustomEvent("npc-dialogue:action", pintMessage.bind(null, api.core));
  },
};
