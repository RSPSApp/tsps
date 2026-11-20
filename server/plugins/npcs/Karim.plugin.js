/** Karim's one-coin kebab sale, through the existing OSRS Wiki transcript. */
const RECEIVE_KEBAB_STEP = "txBQAi";
let core;

function isKarim(event) {
  return event.npcId === core.NpcIdentifiers.KARIM && event.pages?.some(({ page }) => page === "Karim");
}

function condition(event) {
  if (!isKarim(event)) return null;
  const coins = event.player.getInventory().getAmount(core.ItemIdentifiers.COINS);
  if (event.text === "If the player has at least one coin:") return coins >= 1;
  if (event.text === "If the player has no coins:") return coins === 0;
  return null;
}

function receiveKebab(event) {
  if (!isKarim(event) || event.action !== "receive" || event.stepId !== RECEIVE_KEBAB_STEP) return;
  event.handled = true;
  const inventory = event.player.getInventory(), coins = inventory.getAmount(core.ItemIdentifiers.COINS);
  if (coins < 1) return;
  // Spending the last coin frees its slot even in a full backpack.
  if (inventory.getFreeSlots() === 0 && coins > 1) { inventory.full(); return; }
  inventory.deleteNumber(core.ItemIdentifiers.COINS, 1);
  inventory.adds(core.ItemIdentifiers.KEBAB, 1);
}

module.exports = {
  name: "Karim",
  description: "Karim sells a kebab for one coin through his Talk-to dialogue.",
  register(api) {
    core = api.core;
    api.onNpcDialogueCondition(condition);
    api.onCustomEvent("npc-dialogue:action", receiveKebab);
  },
};
