/**
 * Peer the Seer as a deposit box (NPC 3895, south of the Rellekka market; Wiki: Peer the Seer,
 * Fremennik Diary rewards): once the easy Fremennik Diary is complete, his Deposit-items option opens
 * the Bank of Gielinor deposit box, like a deposit box loc.
 *
 * - rsprox capture (index rec 1757, rev 227): Deposit-items opens `bank_depositbox` on arrival with
 *   nothing else said or animated; the box itself is BankDepositBooth's ("bank:open-deposit-box").
 * - Before the easy tier is complete, Deposit-items plays the Wiki transcript's variant
 *   "...right-click deposit-items option before completing the easy Fremennik Diary" (npc-dialogues.json):
 *   "I cannot do that for you until you have completed the easy tier of the Fremennik achievement diary."
 * - His after-trials Talk-to "Can you bank my stuff?" ends in the same deposit box (open_interface
 *   "The Bank of Gielinor - Deposit Box", step HBJ1rp). The Wiki gates his deposit box on the easy
 *   diary, so that step checks it too. Ours: without the diary it plays the right-click refusal line,
 *   as no source shows what that branch does then.
 */
const Rewards = require("./Common.DiaryRewards");

const DIARY = "fremennik";
const TIER = "easy";
const REFUSAL_VARIANT = "standard-dialogue-when-using-the-right-click-deposit-items-option-before-completing-the-easy-fremennik-diary";
const DEPOSIT_TARGET = "The Bank of Gielinor - Deposit Box";

function isPeer(npcId) {
  return npcId === Rewards.core.NpcIdentifiers.PEER_THE_SEER;
}

function easyDiaryDone(player) {
  const request = { player, diary: DIARY, tier: TIER, complete: false };
  Rewards.api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

/** Opens the deposit box, or has Peer refuse without the easy Fremennik Diary. */
function depositOrRefuse(player, npcId) {
  if (easyDiaryDone(player)) {
    Rewards.api.emitCustomEvent("bank:open-deposit-box", { player });
    return;
  }
  Rewards.api.emitCustomEvent("npc-dialogue:start", { player, npcId, variant: REFUSAL_VARIANT, exact: true, handled: false });
}

/** Right-click Deposit-items. */
function depositItems({ player, npc }) {
  depositOrRefuse(player, npc.getId());
  return true;
}

/** Talk-to's "Can you bank my stuff?": the chat closes, then the same rule as Deposit-items. */
function bankMyStuff(event) {
  if (event.handled || !isPeer(event.npcId) || event.action !== "open_interface" || event.target !== DEPOSIT_TARGET) return;
  event.handled = true;
  const { player } = event;
  player.getDialogueManager().reset();
  player.getPacketSender().sendInterfaceRemoval();
  depositOrRefuse(player, event.npcId);
}

module.exports = function attachPeerTheSeer(api) {
  api.onNpcInteraction("Peer the Seer", { "Deposit-items": depositItems });
  api.onCustomEvent("npc-dialogue:action", bankMyStuff);
};
module.exports._test = { depositItems, bankMyStuff, REFUSAL_VARIANT };
