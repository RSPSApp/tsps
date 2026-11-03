/**
 * Drink purchases from the Wiki bartender transcripts.
 *
 * NpcDialogues plays the words, but the transcript's `give 2 coins` /
 * `receive Beer` action steps have no owner, so the pint message appeared
 * without taking coins or adding the beer. These are the three F2P pubs whose
 * standard-dialogue pages carry the same ordinary beer branch:
 *   Bartender (Blue Moon Inn)        1312  receive -P7usW  message reFUlS
 *   Bartender (Dancing Donkey Inn)   1311  receive 4ksfKE
 *   Bartender (The Sheared Ram)      7546  receive dqIAGj
 * Dragon Inn's Greenman's Ale has only a purchase message (x6UKzD), costing 10 coins.
 */
const BEER_PRICE = 2;
const GREENMANS_ALE_PRICE = 10;
const BLUE_MOON_PINT_MESSAGE = "reFUlS";

/** Step id -> transcript page that owns it. */
const DRINK_PURCHASES = new Map([
  ["-P7usW", { page: "Bartender (Blue Moon Inn)", price: BEER_PRICE, item: "BEER" }],
  ["4ksfKE", { page: "Bartender (Dancing Donkey Inn)", price: BEER_PRICE, item: "BEER" }],
  ["dqIAGj", { page: "Bartender (The Sheared Ram)", price: BEER_PRICE, item: "BEER" }],
  ["x6UKzD", { page: "Bartender (Dragon Inn)", price: GREENMANS_ALE_PRICE, item: "GREENMANS_ALE", message: true }],
]);

/** Exact Wiki condition prose for these pages, and the answer it means. */
const COIN_CONDITIONS = new Map([
  ["if the player has at least two coins in their inventory:", { price: BEER_PRICE, enough: true }],
  ["if the player does not have at least two coins in their inventory:", { price: BEER_PRICE, enough: false }],
  ["if the player has enough coins:", { price: BEER_PRICE, enough: true }],
  ["if the player does not have enough coins:", { price: BEER_PRICE, enough: false }],
  ["if the player has 10 coins:", { price: GREENMANS_ALE_PRICE, enough: true }],
  ["if the player does not have 10 coins:", { price: GREENMANS_ALE_PRICE, enough: false }],
]);

const page = (event, want) => (event.pages ?? []).some((entry) => entry.page === want);

/** A full bag with exactly the price in coins frees the coin stack's slot. */
const canTakeDrink = (inventory, coinAmount, price) =>
  inventory.getFreeSlots() + (coinAmount === price ? 1 : 0) >= 1;

function answerCoins(core, event) {
  const text = String(event.text ?? "").toLowerCase();
  const condition = COIN_CONDITIONS.get(text);
  if (!condition) return null;
  if (![...DRINK_PURCHASES.values()].some((purchase) => purchase.price === condition.price && page(event, purchase.page))) return null;
  const coinAmount = event.player.getInventory().getAmount(core.ItemIdentifiers.COINS);
  return condition.enough ? coinAmount >= condition.price : coinAmount < condition.price;
}

function purchaseFor(event) {
  const purchase = DRINK_PURCHASES.get(event.stepId);
  if (!purchase) return null;
  if (purchase.message ? event.kind !== "message" : event.action !== "receive" || event.kind === "message") return null;
  return page(event, purchase.page) ? purchase : null;
}

function refuse(event, message) {
  event.player.sendMessage(message);
  event.handled = true;
  event.end = true;
}

function buyDrink(core, event) {
  const purchase = purchaseFor(event);
  if (!purchase) return;
  const inventory = event.player.getInventory();
  const coinAmount = inventory.getAmount(core.ItemIdentifiers.COINS);
  if (coinAmount < purchase.price) {
    refuse(event, "You don't have enough coins.");
    return;
  }
  if (!canTakeDrink(inventory, coinAmount, purchase.price)) {
    refuse(event, "You need a free inventory slot for the beer.");
    return;
  }
  const itemId = core.ItemIdentifiers[purchase.item];
  const before = inventory.getAmount(itemId);
  inventory.deleteNumber(core.ItemIdentifiers.COINS, purchase.price);
  inventory.adds(itemId, 1);
  if (inventory.getAmount(itemId) !== before + 1) {
    inventory.adds(core.ItemIdentifiers.COINS, purchase.price);
    refuse(event, "You need a free inventory slot for the beer.");
    return;
  }
  // Message purchases still print their canonical success text after delivery.
  if (!purchase.message) event.handled = true;
}

/** Blue Moon prints the pint message before the receive step; close before it if the beer cannot fit. */
function pintMessage(core, event) {
  if (event.kind !== "message" || event.stepId !== BLUE_MOON_PINT_MESSAGE) return;
  if (!page(event, "Bartender (Blue Moon Inn)")) return;
  const inventory = event.player.getInventory();
  const coinAmount = inventory.getAmount(core.ItemIdentifiers.COINS);
  if (coinAmount >= BEER_PRICE && !canTakeDrink(inventory, coinAmount, BEER_PRICE)) {
    refuse(event, "You need a free inventory slot for the beer.");
  }
}

module.exports = {
  name: "Bartenders",
  register(api) {
    api.onNpcDialogueCondition(answerCoins.bind(null, api.core));
    api.onCustomEvent("npc-dialogue:action", buyDrink.bind(null, api.core));
    api.onCustomEvent("npc-dialogue:action", pintMessage.bind(null, api.core));
  },
};
