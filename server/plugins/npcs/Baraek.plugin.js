/** Baraek's standard fur sale (Wiki transcript: 20 coins, with an 18-coin fallback). */
const PAGE = "Baraek";
const SALE_PRICES = new Map([["pIACpD", 20], ["CYQA8Q", 18]]);
const COIN_CONDITIONS = new Map([
  ["If the player has 20 coins:", 20],
  ["If the player does not have 20 coins:", -20],
  ["If the player has 18 coins:", 18],
  ["If the player does not have 18 coins:", -18],
]);

function isBaraek(core, event) {
  const ids = core.NpcIdentifiers;
  return (event.npcId === ids.BARAEK || event.npcId === ids.BARAEK_2)
    && event.pages?.some(({ page }) => page === PAGE);
}

function dialogueCondition(core, event) {
  if (!isBaraek(core, event)) return null;
  const amount = event.player.getInventory().getAmount(core.ItemIdentifiers.COINS);
  const threshold = COIN_CONDITIONS.get(event.text);
  if (threshold === undefined) return null;
  return threshold > 0 ? amount >= threshold : amount < -threshold;
}

function refuse(event, text) {
  event.text = text;
  event.box = { statement: true };
  event.handled = true;
}

function sellFur(core, event) {
  const price = SALE_PRICES.get(event.stepId);
  if (event.kind !== "message" || price === undefined || !isBaraek(core, event)) return;

  const inventory = event.player.getInventory();
  const coins = core.ItemIdentifiers.COINS;
  const fur = core.ItemIdentifiers.FUR;
  const coinAmount = inventory.getAmount(coins);
  if (coinAmount < price) {
    refuse(event, "You don't have enough coins.");
    return;
  }
  if (inventory.getFreeSlots() < 1 && coinAmount !== price) {
    refuse(event, "You need a free inventory slot for the fur.");
    return;
  }

  const furBefore = inventory.getAmount(fur);
  inventory.deleteNumber(coins, price);
  inventory.adds(fur, 1);
  if (inventory.getAmount(fur) !== furBefore + 1) {
    inventory.adds(coins, price);
    refuse(event, "You need a free inventory slot for the fur.");
    return;
  }
  event.handled = true;
  event.box = { items: [fur] };
}

module.exports = {
  name: "Baraek",
  description: "Makes Baraek in Varrock sell fur for 20 coins, or 18 as the fallback, taking the coins and giving the fur from his dialogue.",
  register(api) {
    api.onNpcDialogueCondition(dialogueCondition.bind(null, api.core));
    api.onCustomEvent("npc-dialogue:action", sellFur.bind(null, api.core));
  },
};
