"use strict";

/**
 * The Sacraments of Ent Folk, the miniquest's notebook: Read opens the indexed book (680).
 *
 * RSProx 20261109T224258-5ab63b4 (rev 242), ticks 826-847: Read plays human_readbook and opens
 * ten pages. Page 1 is the contents ("My Notes" and "Ranulph's Notes", both links), page 2 the
 * reader's own notes and pages 3-9 Ranulph's notes (data/sacraments-of-ent-folk.json, as
 * captured, "Initally" included); page 10 is blank. The reader's notes give the totems built,
 * the rummages and the research points (varp ent_totems_research_points); live sends no var for
 * the first two, so they are counted here (State.count).
 *
 * The capture has one of each ("<col=004d05>1 Vale" / "<col=004d05>Totem</col>", "Vale Offerings
 * once", "1 Vale" / "Research Point"). The plurals are the Wiki transcript's ("Vale Totem[s]",
 * "[#] times", "Vale Research Points"); ours: they keep the captured line breaks.
 *
 * Destroy (tick 882): confirmdestroy with "Ranulph in Auburnvale can give you another.".
 */
const Shared = require("./Shared.ValeTotems");
const State = require("./State.ValeTotems");
const BOOK = require("../data/sacraments-of-ent-folk.json");

const GREEN = "<col=004d05>";
const DESTROY_WARNING = "Ranulph in Auburnvale can give you another.";
const NOTES_SPREAD = 0;
const RANULPH_SPREAD = 1;
const INDEX_SPREADS = { "My Notes": NOTES_SPREAD, "Ranulph's Notes": RANULPH_SPREAD };

function plural(count, word) {
  return count === 1 ? word : `${word}s`;
}

/** Page 2: what the reader has done so far. */
function myNotes(player) {
  const built = State.count(player, "totems-built", 0);
  const rummages = State.count(player, "rummages", 0);
  const points = State.researchPoints(player);
  return [
    "<u>My Notes</u>",
    "",
    "Since observing the ents with",
    "Ranulph, I have been",
    "conducting my own research.",
    "",
    `To date, I've built ${GREEN}${built} Vale`,
    `${GREEN}${plural(built, "Totem")}</col> and rummaged`,
    `through ${GREEN}Vale Offerings ${rummages === 1 ? "once" : `${rummages} times`}</col>.`,
    "",
    `I've also earned ${GREEN}${points} Vale`,
    `${GREEN}Research ${plural(points, "Point")}</col> which`,
    "Ranulph will exchange for",
    "items he finds around the",
    "Auburn Valley.",
  ];
}

function spreads(player) {
  const pages = [BOOK.contents, myNotes(player), ...BOOK.ranulphsNotes];
  const result = [];
  for (let page = 0; page < pages.length; page += 2) result.push([pages[page], pages[page + 1] ?? []]);
  return result;
}

function read({ player }) {
  const { openIndexedBook } = require("../../quests/QuestRuntime");
  Shared.animate(player, "human_readbook");
  openIndexedBook(player, { title: BOOK.title, spreads: spreads(player), spreadOf: (index) => INDEX_SPREADS[index] });
  return true;
}

function destroyWarning(prompt) {
  if (prompt.item?.getId?.() === Shared.obj("ent_totems_intro_book")) prompt.warning = DESTROY_WARNING;
}

function attach(api) {
  api.onItemAction("Sacraments of Ent Folk", { Read: read });
  api.onCustomEvent("destroy-item:prompt", destroyWarning);
}

module.exports = { attach, myNotes };
