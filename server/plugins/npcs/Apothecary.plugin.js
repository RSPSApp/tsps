/**
 * The Apothecary's strength-potion service in Varrock.
 *
 * The shop lists strength potions, but the Wiki service charges 5 coins and consumes one
 * limpwurt root and one red spiders' eggs per potion. The shop's own stock is infinite, so
 * the buy limit stops the purchase taking more materials than the player has. A successful
 * purchase emits the ordinary success event the Varrock diary listens for.
 *
 * OSRS Wiki: Apothecary.
 */
const APOTHECARY_SHOP_ID = 1423;
const STRENGTH_POTION_4 = 113;
const LIMPWURT_ROOT = 225;
const RED_SPIDERS_EGGS = 223;
const STRENGTH_POTION_COST = 5;
const STRENGTH_POTION_MADE_EVENT = "apothecary:strength-potion-made";

function buyPrice(event) {
  if (event?.shopId !== APOTHECARY_SHOP_ID || event?.itemId !== STRENGTH_POTION_4) return;
  event.price = STRENGTH_POTION_COST;
}

function buyLimit(api, event) {
  if (event?.shopId !== APOTHECARY_SHOP_ID || event?.itemId !== STRENGTH_POTION_4) return;
  const inventory = event.player?.getInventory?.();
  if (!inventory) return;
  const materials = Math.min(inventory.getAmount(LIMPWURT_ROOT), inventory.getAmount(RED_SPIDERS_EGGS));
  const affordable = Math.floor(inventory.getAmount(api.core.ItemIdentifiers.COINS) / STRENGTH_POTION_COST);
  const limit = Math.max(0, Math.min(materials, affordable));
  event.limit = limit;
  if (limit > 0) return;
  event.message = materials <= 0
    ? "The Apothecary needs a limpwurt root and red spiders' eggs to make a strength potion."
    : "You need 5 coins for the strength potion.";
}

/** The shop has already taken 5 coins each; the service consumes one root and one egg each. */
function purchase(api, event) {
  if (event?.shopId !== APOTHECARY_SHOP_ID || event?.itemId !== STRENGTH_POTION_4) return;
  const inventory = event.player?.getInventory?.();
  const amount = Number(event.amount) || 0;
  if (!inventory || amount <= 0) return;
  if (inventory.getAmount(LIMPWURT_ROOT) < amount || inventory.getAmount(RED_SPIDERS_EGGS) < amount) return;
  inventory.deleteNumber(LIMPWURT_ROOT, amount);
  inventory.deleteNumber(RED_SPIDERS_EGGS, amount);
  api.emitCustomEvent(STRENGTH_POTION_MADE_EVENT, { player: event.player, amount });
}

module.exports = {
  name: "Apothecary",
  register(api) {
    api.onCustomEvent("shop:buy-price", buyPrice);
    api.onCustomEvent("shop:buy-limit", buyLimit.bind(null, api));
    api.onCustomEvent("shop:purchase", purchase.bind(null, api));
  },
  _test: {
    APOTHECARY_SHOP_ID, STRENGTH_POTION_4, LIMPWURT_ROOT, RED_SPIDERS_EGGS,
    STRENGTH_POTION_COST, STRENGTH_POTION_MADE_EVENT, buyPrice, buyLimit, purchase,
  },
};
