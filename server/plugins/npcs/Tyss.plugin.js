/**
 * Tyss at the Dark Altar: the Spellbook option toggles the Arceuus spellbook, and the two
 * transcript choices that are conditioned on the current book do the same.
 *
 * Source: Wiki Tyss ("Players can access the Arceuus spellbook by speaking to him") and
 * Transcript:Tyss step ids O63wRq (not on Arceuus) and AQEl1l (on Arceuus).
 */
const TYSS_NPC_ID = 7050;
const START_OPTION = "Can I try the magicks myself?";
const STOP_OPTION = "I'd like to stop using your spellbook now.";
const NOT_ON_ARCEUUS_STEP = "O63wRq";
const ON_ARCEUUS_STEP = "AQEl1l";

let api = null;
let core = null;

function onArceuus(player) {
  return player.getSpellbook?.() === core.MagicSpellbook.ARCEUUS;
}

function switchTo(player, book) {
  if (player.getSpellbook?.() === book) return false;
  core.MagicSpellbook.changeSpellbook(player, book);
  if (player.getSpellbook?.() !== book) return false;
  if (book === core.MagicSpellbook.ARCEUUS) api.emitCustomEvent("tyss:spellbook-switched", { player });
  return true;
}

function spellbookOption(event) {
  if (event.npcId !== TYSS_NPC_ID) return;
  event.handled = true;
  switchTo(event.player, onArceuus(event.player) ? core.MagicSpellbook.NORMAL : core.MagicSpellbook.ARCEUUS);
}

function answerCondition(event) {
  if (event.npcId !== TYSS_NPC_ID) return null;
  if (event.stepId === NOT_ON_ARCEUUS_STEP) return !onArceuus(event.player);
  if (event.stepId === ON_ARCEUUS_STEP) return onArceuus(event.player);
  return null;
}

function handleChoice(event) {
  if (event.npcId !== TYSS_NPC_ID) return;
  const option = String(event.option ?? "").trim();
  if (option === START_OPTION) switchTo(event.player, core.MagicSpellbook.ARCEUUS);
  else if (option === STOP_OPTION) switchTo(event.player, core.MagicSpellbook.NORMAL);
}

module.exports = {
  name: "Tyss",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onNpcInteraction("Tyss", { Spellbook: spellbookOption });
    api.onNpcDialogueCondition(answerCondition);
    api.onCustomEvent("npc-dialogue:choice", handleChoice);
  },
  _test: { TYSS_NPC_ID, START_OPTION, STOP_OPTION, answerCondition, handleChoice, spellbookOption, switchTo },
};
