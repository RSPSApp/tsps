/**
 * Wyson the gardener's woad leaf sale (Wiki transcript "Wyson the gardener"): 15 coins buys
 * one leaf, 20 coins buys two. The transcript's coin conditions decide which branch plays;
 * its "receive" actions take the coins and hand over the leaves.
 */
const PAGE = "Wyson the gardener";
/** Receive action id -> { price, leaves }. */
const SALES = new Map([
  ["bywQsQ", { price: 15, leaves: 1 }],
  ["F6m-S9", { price: 20, leaves: 2 }],
]);
/** Condition text -> coins needed (negative: the player has fewer than that). */
const COIN_CONDITIONS = new Map([
  ["If the player has at least 15 coins:", 15],
  ["If the player doesn't have 15 coins:", -15],
  ["If the player has at least 20 coins:", 20],
  ["If the player doesn't have 20 coins:", -20],
]);
const NOT_ENOUGH_COINS_LINE = "I don't have enough coins to buy the leaves. I'll come back later.";
const NO_ROOM_MESSAGE = "You don't have enough inventory space.";

function isWyson(core, event) {
  return event.npcId === core.NpcIdentifiers.WYSON_THE_GARDENER
    && event.pages?.some(({ page }) => page === PAGE);
}

function dialogueCondition(core, event) {
  const threshold = COIN_CONDITIONS.get(event.text);
  if (threshold === undefined || !isWyson(core, event)) return null;
  const amount = event.player.getInventory().getAmount(core.ItemIdentifiers.COINS);
  return threshold > 0 ? amount >= threshold : amount < -threshold;
}

function sellWoad(core, event) {
  const sale = SALES.get(event.stepId);
  if (event.action !== "receive" || sale === undefined || !isWyson(core, event)) return;

  const inventory = event.player.getInventory();
  const coins = core.ItemIdentifiers.COINS;
  const leaf = core.ItemIdentifiers.WOAD_LEAF;
  event.handled = true;
  // The coins could have gone between the condition and this step.
  if (inventory.getAmount(coins) < sale.price) {
    event.steps = [{ player: NOT_ENOUGH_COINS_LINE }, { type: "end" }];
    return;
  }

  const leavesBefore = inventory.getAmount(leaf);
  inventory.deleteNumber(coins, sale.price);
  inventory.adds(leaf, sale.leaves);
  const given = inventory.getAmount(leaf) - leavesBefore;
  if (given !== sale.leaves) {
    if (given > 0) inventory.deleteNumber(leaf, given);
    inventory.adds(coins, sale.price);
    event.player.sendMessage(NO_ROOM_MESSAGE);
    event.end = true;
  }
}

module.exports = {
  name: "Wyson",
  register(api) {
    api.onNpcDialogueCondition(dialogueCondition.bind(null, api.core));
    api.onCustomEvent("npc-dialogue:action", sellWoad.bind(null, api.core));
  },
};
