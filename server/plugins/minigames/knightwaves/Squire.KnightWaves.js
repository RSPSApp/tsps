"use strict";

/**
 * The Camelot squire outside the training room. King's Ransom owns the quest conversation and
 * emits `knight-waves:squire` once the quest is complete; this unit plays the activity's own
 * transcript there:
 * - before the activity: the rules, the repeated explanations and "No, thank you.";
 * - after it: "Once you have won, you cannot re-enter."
 *
 * The page and variants are the cache transcript's (npc-dialogues.json): "Squire (Camelot)".
 */
const Common = require("./Common.KnightWaves");

const SQUIRE = 4353;
const PAGE = "Squire (Camelot)";

/** The transcript that follows King's Ransom's post-quest squire line. */
function squireDialogue(event) {
  const { player, npcId, npc } = event;
  if (npcId !== SQUIRE || !Common.kingsRansomComplete(player)) return;
  const variant = Common.completed(player) >= Common.COMPLETE
    ? "after-completing-the-knight-waves"
    : "before-completing-the-knight-waves";
  const startTranscript = require("../../quests/QuestRuntime").startTranscript;
  if (startTranscript(Common.api, player, npcId, PAGE, variant, null, npc)) {
    event.handled = true;
  }
}

function attachSquire(api) {
  api.onCustomEvent("knight-waves:squire", squireDialogue);
}

module.exports = { attachSquire, squireDialogue, SQUIRE, PAGE };
