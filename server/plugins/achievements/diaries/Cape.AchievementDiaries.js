/** Twiggy's Achievement Diary cape and hood, using her imported Talk-to transcript. */
const PRICE = 99000;
const COMPLETE_VARIANT = "standard-dialogue-if-the-player-has-completed-all-achievement-diaries";
const OWNED_VARIANT = "standard-dialogue-if-the-player-has-an-achievement-diary-cape-in-their-bank-or-inventory";
let pluginApi;

function isTwiggy(event) {
  return event.npcId === pluginApi.core.NpcIdentifiers.TWIGGY_OKORN;
}

function allDiariesComplete(player) {
  const request = { player, complete: false };
  pluginApi.emitCustomEvent("diary:all-complete", request);
  return request.complete === true;
}

function ownsCape(player) {
  const items = pluginApi.core.ItemIdentifiers;
  const capeIds = [items.ACHIEVEMENT_DIARY_CAPE, items.ACHIEVEMENT_DIARY_CAPE_T_];
  const searchTab = pluginApi.core.Bank.BANK_SEARCH_TAB_INDEX;
  return capeIds.some(id => player.getInventory().contains(id)
    || player.getBanks().some((bank, tab) => tab !== searchTab && bank?.getAmount(id) > 0));
}

function variant(event) {
  if (isTwiggy(event) && allDiariesComplete(event.player)) {
    return ownsCape(event.player) ? OWNED_VARIANT : COMPLETE_VARIANT;
  }
  return null;
}

function condition(event) {
  if (!isTwiggy(event)) return null;
  const inventory = event.player.getInventory();
  const enoughCoins = inventory.getAmount(pluginApi.core.ItemIdentifiers.COINS) >= PRICE;
  const enoughSpace = inventory.getFreeSlots() >= 2;
  switch (event.stepId) {
    case "rY_q1o": return !enoughCoins;
    case "Q8V1Xr": return enoughCoins && !enoughSpace;
    case "AvsC0t": return enoughCoins && enoughSpace;
    case "djujm5": return !enoughCoins;
    case "VPVZQm": return enoughCoins && enoughSpace;
    case "nPYAs0": return enoughCoins && !enoughSpace;
    case "r1Btt5": return inventory.getFreeSlots() < 1;
    case "C1nfpR": return inventory.getFreeSlots() >= 1;
    default: return null;
  }
}

function sale(event) {
  if (!isTwiggy(event) || event.kind !== "message" || !["TkdagW", "VYbFWp"].includes(event.stepId)) return;
  const { player } = event;
  const inventory = player.getInventory();
  const items = pluginApi.core.ItemIdentifiers;
  // Recheck after confirmation and before the transcript's success message.
  if (!allDiariesComplete(player) || (event.stepId === "VYbFWp" && !ownsCape(player))
    || inventory.getAmount(items.COINS) < PRICE || inventory.getFreeSlots() < 2) {
    event.end = true;
    player.sendMessage("You can no longer buy the cape and hood. Please speak to Twiggy again.");
    return;
  }
  const quests = { player, canUse: false };
  pluginApi.emitCustomEvent("quest-cape:can-use", quests);
  const cape = quests.canUse === true ? items.ACHIEVEMENT_DIARY_CAPE_T_ : items.ACHIEVEMENT_DIARY_CAPE;
  inventory.deleteNumber(items.COINS, PRICE);
  inventory.adds(cape, 1);
  inventory.adds(items.ACHIEVEMENT_DIARY_HOOD, 1);
  inventory.refreshItems();
}

function hood(event) {
  if (!isTwiggy(event) || event.kind !== "message" || event.stepId !== "wOENj7") return;
  const { player } = event, inventory = player.getInventory();
  const item = pluginApi.core.ItemIdentifiers.ACHIEVEMENT_DIARY_HOOD;
  if (!allDiariesComplete(player) || !ownsCape(player) || inventory.getFreeSlots() < 1) {
    event.end = true;
    player.sendMessage("You can no longer receive a hood. Please speak to Twiggy again.");
    return;
  }
  inventory.adds(item, 1);
  inventory.refreshItems();
}

function receipt(event) {
  // The preceding sale message committed both items; this transcript action is descriptive.
  if (isTwiggy(event) && event.stepId === "IrG5Gq" && event.action === "receive") event.handled = true;
}

module.exports = function attachCape(api) {
  pluginApi = api;
  api.onNpcDialogueVariant(variant);
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:action", sale);
  api.onCustomEvent("npc-dialogue:action", hood);
  api.onCustomEvent("npc-dialogue:action", receipt);
};
