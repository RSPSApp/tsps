/**
 * Lithkren Vault notes (docs/lithkren-vault-notes.md): the seven old notes found next to the
 * vault's machinery, incubators and a stone crate, Read on each note, and combining all seven
 * into the Lithkren vault notes book (whose Read is in ReadingBooks).
 *
 * Sources (rsprox.net index, rev 224/231):
 * - rec 722 ticks 12, 439, 450, 480, 505, 511 and rec 1528 tick 9: Inspect on each loc gives its
 *   note with sound 2582 and an item box, the line also sent as a mesbox message;
 * - rec 722 tick 1260: Search on the stone crate gives note 7 the same way;
 * - rec 722 tick 17 and rec 1528 tick 19: Inspect again while carrying that note only sends the
 *   "but find nothing of interest" game message;
 * - rec 722 ticks 586-1281: Read on each note opens interface 291 with its twelve lines;
 * - rec 722 tick 1434: one note used on another with all seven carried sets varbit
 *   ds2_lithkren_notes to 1, swaps the seven notes for the book and shows it in an item box.
 *
 * Ours: a banked note or an owned book also counts as having it, a full inventory gets the
 * core "not enough space" line, the crate's nothing-found line follows the others' wording, and
 * using notes on each other without all seven falls through to the core default (no response).
 */
const NOTE_TEXTS = require("./data/lithkren-vault-notes.json").notes;

const NOTE_INTERFACE = 291;
const NOTE_FIRST_LINE = 5;
const FIND_SOUND = 2582;
const COMBINED_VARBIT = "ds2_lithkren_notes";
const COMBINED_ATTRIBUTE = "lithkren-vault-notes:combined";
const BOOK = "ds2_lithkren_notes_complete";

/** Each loc's note, and the word live uses for the loc in its lines. */
const SOURCES = [
  { loc: "lithkren_vault_machine_notes", note: "ds2_lithkren_notes_1", place: "machinery" },
  { loc: "lithkren_vault_machine_notes_2", note: "ds2_lithkren_notes_2", place: "machinery" },
  { loc: "lithkren_vault_machine_notes_3", note: "ds2_lithkren_notes_3", place: "machinery" },
  { loc: "lithkren_vault_machine_notes_4", note: "ds2_lithkren_notes_4", place: "incubator" },
  { loc: "lithkren_vault_machine_notes_5", note: "ds2_lithkren_notes_5", place: "incubator" },
  { loc: "lithkren_vault_machine_notes_6", note: "ds2_lithkren_notes_6", place: "machinery" },
  { loc: "lithkren_vault_crate_notes", note: "ds2_lithkren_notes_7", place: "crate" },
];

const found = (place) => place === "crate" ? "You find some notes in the crate." : `You find some notes next to the ${place}.`;
const nothing = (place) => place === "crate"
  ? "You search the crate, but find nothing of interest."
  : `You inspect the ${place}, but find nothing of interest.`;
const COMBINED = "You combine the notes into a makeshift book.";

let api;
let core;

const obj = (gameval) => core.CacheDefinitions.getObjId(gameval);
const loc = (gameval) => core.CacheDefinitions.getLocId(gameval);
const noteIds = () => SOURCES.map((source) => obj(source.note));

function owns(player, id) {
  return player.getInventory().contains(id)
    || (player.getBanks?.() ?? []).some((bank) => bank?.contains?.(id));
}

function itemBox(player, text, itemId) {
  const { DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = core;
  player.sendMessage(text);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, itemId, text),
    new EndDialogue(1),
  ));
}

/** Inspect (or the crate's Search): the loc's note, once per player while they keep it. */
function searchForNote({ player, objectId }) {
  const source = SOURCES.find((entry) => loc(entry.loc) === objectId);
  if (!source) return false;
  const note = obj(source.note);
  if (owns(player, note) || owns(player, obj(BOOK))) {
    player.sendMessage(nothing(source.place));
    return true;
  }
  if (player.getInventory().getFreeSlots() < 1) {
    player.getInventory().full();
    return true;
  }
  player.getInventory().add(new core.Item(note, 1), true);
  player.getPacketSender().sendSound(FIND_SOUND, 255, 0);
  itemBox(player, found(source.place), note);
  return true;
}

function readNote({ player, itemId }) {
  const source = SOURCES.find((entry) => obj(entry.note) === itemId);
  if (!source) return false;
  const sender = player.getPacketSender();
  NOTE_TEXTS[source.note].forEach((line, index) => sender.sendString(line, (NOTE_INTERFACE << 16) | (NOTE_FIRST_LINE + index)));
  sender.sendInterface(NOTE_INTERFACE);
  return true;
}

/** One note on another: with all seven carried they become the book. */
function combineNotes({ player, usedItemId, usedWithItemId }) {
  const ids = noteIds();
  if (!ids.includes(usedItemId) || !ids.includes(usedWithItemId)) return false;
  const inventory = player.getInventory();
  if (!ids.every((id) => inventory.contains(id))) return false;
  for (const id of ids) inventory.deleteAtSlot(inventory.getItems().findIndex((item) => item?.getId() === id), 1);
  inventory.add(new core.Item(obj(BOOK), 1), true);
  player.setAttribute(COMBINED_ATTRIBUTE, 1);
  sendCombined(player);
  itemBox(player, COMBINED, obj(BOOK));
  return true;
}

function sendCombined(player) {
  const varbit = core.CacheDefinitions.getVarbitId?.(COMBINED_VARBIT);
  if (varbit != null && player.getAttribute(COMBINED_ATTRIBUTE)) player.getPacketSender().sendVarbit(varbit, 1);
}

function login({ player }) {
  sendCombined(player);
}

module.exports = {
  name: "LithkrenVaultNotes",
  description: "Lithkren Vault notes: Inspect the vault's machinery, incubators and stone crate for the seven old notes, Read them, and combine all seven into the Lithkren vault notes book.",
  members: true,
  _test: { SOURCES, COMBINED, FIND_SOUND, COMBINED_ATTRIBUTE, found, nothing, searchForNote, readNote, combineNotes, login },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(COMBINED_ATTRIBUTE, 0);
    api.onObjectInteraction("Machinery", { Inspect: searchForNote });
    api.onObjectInteraction("Ancient Machinery", { Inspect: searchForNote });
    api.onObjectInteraction("Incubator", { Inspect: searchForNote });
    api.onObjectInteraction("Stone crate", { Search: searchForNote });
    api.onItemAction("Old notes", { Read: readNote });
    api.onItemOnItem("Old notes", "Old notes", combineNotes, { noted: false });
    api.onPlayerLogin(login);
  },
};
