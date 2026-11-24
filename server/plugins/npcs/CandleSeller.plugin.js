/**
 * The Candle seller's 1,000-coin lit candle, through his OSRS Wiki transcript
 * (Transcript:Candle seller, also played by Death to the Dorgeshuun's tour stop).
 * The transcript guards the sale with two coin conditions and has no hand-over step,
 * so the sale happens when the "has at least 1000 coins" branch is taken.
 */
const NO_COINS_CONDITION = "If the player does not have 1000 coins:";
const HAS_COINS_CONDITION = "If the player has at least 1000 coins:";
const CANDLE_PRICE = 1000;
let core;

function coinsOf(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS);
}

function condition(event) {
  if (event.npcId !== core.NpcIdentifiers.CANDLE_SELLER) return null;
  if (event.text === NO_COINS_CONDITION) return coinsOf(event.player) < CANDLE_PRICE;
  if (event.text === HAS_COINS_CONDITION) return coinsOf(event.player) >= CANDLE_PRICE;
  return null;
}

function sellCandle(event) {
  if (event.npcId !== core.NpcIdentifiers.CANDLE_SELLER || event.text !== HAS_COINS_CONDITION) return;
  const inventory = event.player.getInventory(), coins = coinsOf(event.player);
  if (coins < CANDLE_PRICE) return;
  // Ours: the Wiki does not cover a full backpack. Spending the whole stack frees its slot;
  // otherwise nothing is charged and the standard no-space message is sent.
  if (inventory.getFreeSlots() === 0 && coins > CANDLE_PRICE) { inventory.full(); return; }
  inventory.deleteNumber(core.ItemIdentifiers.COINS, CANDLE_PRICE);
  inventory.adds(core.ItemIdentifiers.LIT_CANDLE, 1);
}

module.exports = {
  name: "CandleSeller",
  description: "The Candle seller by the Lumbridge Swamp Caves sells a lit candle for 1,000 coins through his Talk-to dialogue.",
  members: true,
  register(api) {
    core = api.core;
    api.onNpcDialogueCondition(condition);
    api.onCustomEvent("npc-dialogue:condition", sellCandle);
  },
};
