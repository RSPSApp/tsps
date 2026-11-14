/**
 * Tyss at the Dark Altar: the Spellbook option toggles the Arceuus spellbook, and the two
 * transcript choices that are conditioned on the current book do the same.
 * His ash sanctifier branch is answered by plugins/items/AshSanctifier.plugin.js.
 *
 * Source: Wiki Tyss ("Players can access the Arceuus spellbook by speaking to him") and
 * Transcript:Tyss step ids O63wRq (not on Arceuus) and AQEl1l (on Arceuus).
 *
 * The first switch here unlocks the book for the altars, the magic cape, the grimoire and Spellbook Swap (core
 * SpellbookLocks asks ARCEUUS_UNLOCK_QUERY_EVENT; Wiki Arceuus spellbook: "accessing the spellbook now requires simply
 * speaking to Tyss"). The cache's `arceuus_spellbook_unlocked` varbit mirrors it for the spellbook's requirement text.
 * A save already on the Arceuus book counts as unlocked (and is marked so at login).
 */
const TYSS_NPC_ID = 7050;
const START_OPTION = "Can I try the magicks myself?";
const STOP_OPTION = "I'd like to stop using your spellbook now.";
const NOT_ON_ARCEUUS_STEP = "O63wRq";
const ON_ARCEUUS_STEP = "AQEl1l";
const ARCEUUS_UNLOCKED_ATTRIBUTE = "tyss:arceuus-spellbook-unlocked";
const ARCEUUS_UNLOCKED_VARBIT_NAME = "arceuus_spellbook_unlocked";

let api = null;
let core = null;

function onArceuus(player) {
  return player.getSpellbook?.() === core.MagicSpellbook.ARCEUUS;
}

function arceuusUnlocked(player) {
  return player.getAttribute?.(ARCEUUS_UNLOCKED_ATTRIBUTE) === true || onArceuus(player);
}

function sendUnlockedVarbit(player) {
  const id = core.CacheDefinitions.getVarbitId(ARCEUUS_UNLOCKED_VARBIT_NAME);
  if (typeof id === "number" && id >= 0) player.getPacketSender?.()?.sendVarbit?.(id, 1);
}

function unlockArceuus(player) {
  if (player.getAttribute?.(ARCEUUS_UNLOCKED_ATTRIBUTE) === true) return;
  player.setAttribute(ARCEUUS_UNLOCKED_ATTRIBUTE, true);
  sendUnlockedVarbit(player);
}

function answerUnlockQuery(query) {
  if (query?.player && arceuusUnlocked(query.player)) query.unlocked = true;
}

function sendUnlockOnLogin({ player }) {
  if (onArceuus(player)) player.setAttribute(ARCEUUS_UNLOCKED_ATTRIBUTE, true);
  if (arceuusUnlocked(player)) sendUnlockedVarbit(player);
}

function switchTo(player, book) {
  // Any switch here is speaking to Tyss, including the way back from his book.
  unlockArceuus(player);
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
  description: "Tyss at the Dark Altar toggles the Arceuus spellbook from his Spellbook option and two dialogue choices.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onNpcInteraction("Tyss", { Spellbook: spellbookOption });
    api.onNpcDialogueCondition(answerCondition);
    api.onCustomEvent("npc-dialogue:choice", handleChoice);
    api.onCustomEvent(core.SpellbookLocks.ARCEUUS_UNLOCK_QUERY_EVENT, answerUnlockQuery);
    api.onPlayerLogin(sendUnlockOnLogin);
    api.persistAttribute(ARCEUUS_UNLOCKED_ATTRIBUTE, false);
  },
  _test: { TYSS_NPC_ID, START_OPTION, STOP_OPTION, ARCEUUS_UNLOCKED_ATTRIBUTE, answerCondition, handleChoice, spellbookOption, switchTo },
};
