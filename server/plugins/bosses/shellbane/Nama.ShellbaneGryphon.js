"use strict";

/**
 * Elder Nama at the cave entrance (Wiki: Elder_Nama, Transcript:Elder_Nama, Shellbane_gryphon):
 * - Talk-to plays the first-time conversation once, then the subsequent one with its menu;
 * - "Do you have any useful statistics for me?" and the Statistics option open the scoreboard
 *   (Scoreboard.ShellbaneGryphon.js);
 * - "Can I come in if I have a clue scroll?" shows only with the gryphon's elite clue step
 *   (Clue scroll (elite) - Their bane awaits) in the inventory; Nama then allows one fight ("I
 *   will allow you to fight it once, but no more than that"), which the cave entrance spends;
 * - a player the entrance turns away hears "Sorry, but I can't let you go in there without
 *   permission." (the transcript's attempting-to-enter variant).
 */

const Common = require("./Common.ShellbaneGryphon");
const Scoreboard = require("./Scoreboard.ShellbaneGryphon");

const NAME = "Elder Nama";
const MET_ATTRIBUTE = "shellbane-gryphon:met-nama";
const CLUE_PERMISSION_ATTRIBUTE = "shellbane-gryphon:clue-permission";
const FIRST_TIME = "first-time-dialogue";
const SUBSEQUENT = "first-time-dialogue-subsequent-dialogue";
const REFUSAL = "attempting-to-enter-cave-entrance";
const STATISTICS_TARGET = "Shellbane Gryphon Statistics";
const CLUE_CONDITION = /shellbane gryphon elite clue step/i;
const FIRST_LINE = "Hello! You must be the human";
const PERMISSION_LINE = "Hmm... yes, that would appear to be this gryphon.";

const isNama = (definition) => definition?.getName?.() === NAME;

/** First-time until that conversation has shown its first line. */
function dialogueVariant({ player, definition }) {
  if (!isNama(definition)) return null;
  return player.getAttribute(MET_ATTRIBUTE) === true ? SUBSEQUENT : FIRST_TIME;
}

function dialogueCondition({ player, definition, text }) {
  if (!isNama(definition) || !CLUE_CONDITION.test(String(text ?? ""))) return null;
  return Common.holdsClueStep(player);
}

/** State changes as the line shows (`before`), not as the chain is built. */
function dialogueLine(request) {
  if (!isNama(request.definition) || typeof request.text !== "string") return;
  const { player } = request;
  if (request.text.startsWith(FIRST_LINE)) {
    request.before = () => player.setAttribute(MET_ATTRIBUTE, true);
  } else if (request.text.startsWith(PERMISSION_LINE)) {
    request.before = () => {
      if (Common.holdsClueStep(player)) player.setAttribute(CLUE_PERMISSION_ATTRIBUTE, true);
    };
  }
}

/** "Opens Shellbane Gryphon Statistics": the board, once the chat has closed. */
function dialogueAction(action) {
  if (!isNama(action.definition) || action.action !== "open_interface" || action.target !== STATISTICS_TARGET) return;
  const { player } = action;
  Common.later(1, () => {
    if (player.isRegistered?.() !== false) Scoreboard.show(player);
  });
  action.handled = true;
  action.end = true;
}

/** Elder Nama: Statistics. */
function statistics({ player }) {
  Scoreboard.show(player);
  return true;
}

/** Spends Nama's one-fight permission when the clue step is still held; false otherwise. */
function spendClueFight(player) {
  if (player.getAttribute(CLUE_PERMISSION_ATTRIBUTE) !== true || !Common.holdsClueStep(player)) return false;
  player.setAttribute(CLUE_PERMISSION_ATTRIBUTE, false);
  return true;
}

/** The entrance turned the player away: Nama says so, else the transcript's own box line. */
function refuse(player) {
  const request = { player, npcId: Common.ids.npcs.nama, variant: REFUSAL, exact: true, handled: false };
  Common.api.emitCustomEvent("npc-dialogue:start", request);
  if (!request.handled) player.sendMessage(Common.message("noTask"));
}

function attachNama(api) {
  api.persistAttribute(MET_ATTRIBUTE, false);
  api.persistAttribute(CLUE_PERMISSION_ATTRIBUTE, false);
  api.onNpcDialogueVariant(dialogueVariant);
  api.onNpcDialogueCondition(dialogueCondition);
  api.onCustomEvent("npc-dialogue:line", dialogueLine);
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
  api.onNpcInteraction(NAME, { Statistics: statistics });
}

module.exports = {
  attachNama, dialogueVariant, dialogueCondition, dialogueLine, dialogueAction, statistics, spendClueFight, refuse,
  MET_ATTRIBUTE, CLUE_PERMISSION_ATTRIBUTE,
};
