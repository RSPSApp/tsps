/**
 * The Shantay Guards in the Ruins of Unkah (NPC 10634, `tempoross_pass_guard`) sell Shantay
 * passes. Their transcript (npc-dialogues.json "Shantay Guard (Ruins of Unkah)") is played by
 * NpcDialogues; this unit answers its coin conditions and carries out its "receive" action.
 *
 * As rsprox.net recordings 327 (rev 230) and 1437 (rev 224) show:
 * - "Buy-pass" (op4) takes 5 coins at once and shows the pass in an item box, "You purchase a
 *   Shantay Pass.", with no lines before it.
 * - "I want to buy a Shantay pass for 5 gold coins." does the same after "Absolutely, friend.".
 * - Without 5 coins the transcript's line plays: "Sorry friend, the Shantay Pass is 5 gold
 *   coins. You don't seem to have enough money!". Ours: Buy-pass without the coins plays that
 *   line too; no recording has it.
 */
const Common = require("./Common.ShantayPass");

const NAME = "Shantay Guard";
const PAGE = "Shantay Guard (Ruins of Unkah)";
const BUY_OPTION = "I want to buy a Shantay pass for 5 gold coins.";
const PURCHASE_MESSAGE = "You purchase a Shantay Pass.";
const FULL_MESSAGE = "You cannot hold any more Shantay passes.";
const NO_MONEY_LINE = "Sorry friend, the Shantay Pass is 5 gold coins. You don't seem to have enough money!";
const COIN_CONDITIONS = new Map([
  ["If the player has 5 coins:", true],
  ["If the player does not have 5 coins:", false],
]);

function isGuard(event) {
  const { NpcIdentifiers } = Common.getCore();
  return event.npcId === NpcIdentifiers.SHANTAY_GUARD_3
    && (event.pages ?? []).some(({ page }) => page === PAGE);
}

function dialogueCondition(event) {
  const has = COIN_CONDITIONS.get(event.text);
  if (has === undefined || !isGuard(event)) return null;
  return (Common.coins(event.player) >= Common.FINE) === has;
}

function dialogueAction(event) {
  if (!isGuard(event)) return;
  const { player } = event;
  const { Item, ItemIdentifiers } = Common.getCore();
  if (event.kind === "message") {
    if (event.text === PURCHASE_MESSAGE) event.box = { items: [ItemIdentifiers.SHANTAY_PASS] };
    return;
  }
  if (event.action !== "receive") return;
  event.handled = true;
  // The coins could have gone between the condition and this step.
  if (Common.coins(player) < Common.FINE) {
    event.steps = [{ npc: NO_MONEY_LINE }, { type: "end" }];
    return;
  }
  const inventory = player.getInventory();
  if (inventory.getAddableAmount(new Item(ItemIdentifiers.SHANTAY_PASS, 1)) < 1) {
    player.sendMessage(FULL_MESSAGE);
    event.end = true;
    return;
  }
  inventory.deleteNumber(ItemIdentifiers.COINS, Common.FINE);
  inventory.adds(ItemIdentifiers.SHANTAY_PASS, 1);
  inventory.refreshItems();
}

/** The purchase steps of the "I want to buy a Shantay pass" option, without its two lines. */
function purchaseSteps(steps) {
  const menu = steps.find((step) => step?.type === "choice");
  const option = menu?.options?.find((entry) => entry.text === BUY_OPTION);
  return (option?.steps ?? []).filter((step) => step?.type === "condition");
}

function buyPass({ player, npc }) {
  const { NpcIdentifiers } = Common.getCore();
  if (npc?.getId?.() !== NpcIdentifiers.SHANTAY_GUARD_3) return false;
  const request = { player, npc, npcId: NpcIdentifiers.SHANTAY_GUARD_3, select: purchaseSteps };
  Common.getApi().emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

function attach(api) {
  api.onNpcInteraction(NAME, { "Buy-pass": buyPass });
  api.onNpcDialogueCondition(dialogueCondition);
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
}

module.exports = attach;
module.exports.purchaseSteps = purchaseSteps;
