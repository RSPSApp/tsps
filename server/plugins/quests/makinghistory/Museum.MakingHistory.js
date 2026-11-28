"use strict";

/**
 * Making History's reading: Drozal's journal (Read) and, once the outpost is the museum
 * (makinghistory_objloc 1390 = 1 turns the crates into the displays), the Study option on the
 * Shield Display, both Large Displays and Jorral's bookcase.
 *
 * Text and line breaks are the OSRS Wiki's (data/museum.json says which pages); no rsprox capture
 * reads the journal or studies a display. The journal and the bookcase's two long books open in
 * the two-page book (392) as the Wiki's interface pictures show them; the displays and The Times
 * of Lathas are message boxes (the Wiki's tbox lines).
 *
 * Ours: the Shield Display's line is a message box like the Large Displays' (the Wiki only calls it
 * "the message"). The bookcase's prompt and menu are the RuneScape Wiki's transcript (the OSRS
 * Wiki has none); the prompt is shown as a message box before the menu.
 */
const { openBook, bookPagesFromSpreads } = require("../QuestRuntime");
const museum = require("./data/museum.json");

const PLAYER_NAME = /\[player name\]/g;
const PRONOUN = /\[pronoun\]/g;
const SONG_OF_THE_ELVES = "song_of_the_elves";

const JOURNAL_PAGES = bookPagesFromSpreads(museum.journal.spreads);

let api;
let core;

/** The player's pronoun set: 0 he, 1 she, 2 they (Appearance.getPronouns). */
function pronouns(player) {
  const appearance = player.getAppearance?.();
  return appearance?.getPronouns?.() ?? (appearance?.isMale?.() === false ? 1 : 0);
}

/** A book's spreads with the reader's name (and pronoun phrase) filled in. */
function personalPages(player, { spreads, pronounPhrases }) {
  const name = String(player.getDisplayName?.() ?? player.getUsername?.() ?? "");
  const phrase = pronounPhrases ? pronounPhrases[pronouns(player)] ?? pronounPhrases[0] : "";
  const fill = (line) => line.replace(PLAYER_NAME, name).replace(PRONOUN, phrase);
  return bookPagesFromSpreads(spreads.map((sides) => sides.map((lines) => lines.map(fill))));
}

function messageBoxes(player, lines) {
  const chain = new core.DialogueChainBuilder();
  lines.forEach((line, index) => chain.add(new core.StatementDialogue(index, line)));
  player.getDialogueManager().startDialogues(chain);
}

function songOfTheElvesComplete(player) {
  const request = { player, key: SONG_OF_THE_ELVES, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function readJournal({ player, itemId }) {
  if (itemId !== core.ItemIdentifiers.JOURNAL_4) return false;
  openBook(player, museum.journal.title, JOURNAL_PAGES);
  return true;
}

function studyShieldDisplay({ player, definition }) {
  if (definition?.id !== core.ObjectIdentifiers.SHIELD_DISPLAY) return false;
  messageBoxes(player, [museum.shieldDisplay]);
  return true;
}

/** The ground-floor (10269) or first-floor (10271) display's three cards. */
function largeDisplayLines(id) {
  if (id === core.ObjectIdentifiers.LARGE_DISPLAY) return museum.largeDisplays.groundFloor;
  if (id === core.ObjectIdentifiers.LARGE_DISPLAY_2) return museum.largeDisplays.firstFloor;
  return null;
}

function studyLargeDisplay({ player, definition }) {
  const lines = largeDisplayLines(definition?.id);
  if (!lines) return false;
  messageBoxes(player, lines);
  return true;
}

function readShelfBook(player, option) {
  player.getDialogueManager().reset();
  if (option === 1) openBook(player, museum.historyOfTheOutpost.title, personalPages(player, museum.historyOfTheOutpost));
  else if (option === 2) {
    const { before, afterSongOfTheElves } = museum.timesOfLathas;
    messageBoxes(player, [songOfTheElvesComplete(player) ? afterSongOfTheElves : before]);
  } else if (option === 3) {
    openBook(player, museum.mysteriousAdventurer.title, personalPages(player, museum.mysteriousAdventurer));
  }
}

function studyBookcase({ player, definition }) {
  if (definition?.id !== core.ObjectIdentifiers.BOOKCASE_44) return false;
  const chain = new core.DialogueChainBuilder();
  chain.add(new core.StatementDialogue(0, museum.bookcase.prompt));
  chain.add(new core.OptionDialogue(1, { executeOption: (option) => readShelfBook(player, Number(option)) },
    ...museum.bookcase.options));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.onItemAction("Journal", { Read: readJournal });
  api.onObjectInteraction("Shield Display", { Study: studyShieldDisplay });
  api.onObjectInteraction("Large Display", { Study: studyLargeDisplay });
  api.onObjectInteraction("Bookcase", { Study: studyBookcase });
};

module.exports._test = { personalPages, JOURNAL_PAGES };
