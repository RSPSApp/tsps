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
  // rsprox 226/01663.txt:8340: "Baraek sells you a fur." gives fur (948), the cache's bear fur (Wiki store: Bear fur).
  const fur = core.ItemIdentifiers.BEAR_FUR;
  if (inventory.getAmount(coins) < price) {
    refuse(event, "You don't have enough coins.");
    return;
  }

  inventory.deleteNumber(coins, price);
  // Wiki (Transcript:Baraek): with a full inventory the fur "Drops to the ground".
  const item = new core.Item(fur, 1);
  if (inventory.getAddableAmount(item) >= 1) inventory.adds(fur, 1);
  else core.ItemOnGroundManager.registerLocation(event.player, item, event.player.getLocation().clone());
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
