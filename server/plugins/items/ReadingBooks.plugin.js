/**
 * Read on the books that open in the two-page book viewer (392): the Construction guide, the
 * Glassblowing book (with its item pictures), the Archaeologist's diary, the Lithkren vault notes
 * (rsprox.net 231/00722 ticks 1717-1723), the rotten diary and the Tattered journal from The Blood
 * Moon Rises (rsprox.net recording 4288, rev 239, tick 19533: one spread, both page buttons
 * hidden), the Journal page from the Icyene Graveyard's mud mound (rsprox 231/00392 ticks 8232,
 * 8280: one spread, both page buttons hidden) and the three Slepe Sisterhood books (rsprox 391);
 * on the scrolls that open in the long scroll (625): the Castle Drakan poem scroll and the Elixir
 * of Everlasting (rsprox 392 tick 523); and on the Crombwick deed, which opens the handwritten
 * scroll (rsprox 391 tick 4736). Reading changes nothing in the inventory.
 */
const { openBook, openLongScroll, bookPagesFromSpreads, registerQuestWidgets } = require("../quests/QuestRuntime");
const books = require("./data/reading-books.json");
const scrolls = require("./data/reading-scrolls.json");

const READING_BOOKS = Object.entries(books)
  .filter(([name]) => !name.startsWith("_"))
  .map(([name, { title, spreads }]) => ({ name, title, pages: bookPagesFromSpreads(spreads) }));
const READING_SCROLLS = Object.entries(scrolls)
  .filter(([name]) => !name.startsWith("_"))
  .map(([name, entry]) => ({ name, ...entry }));

/** A handwritten scroll: every line component is written, blanks too, then it opens (rsprox 391 tick 4736). */
function openHandwriting(api, player, { interface: gameval, lines }) {
  const sender = player.getPacketSender();
  lines.forEach((line, index) => {
    sender.sendString(line, api.core.CacheDefinitions.getComponentId(`${gameval}:messagescroll${index + 1}_hw`));
  });
  sender.sendInterfaceScript(2524, [-1, -1]).sendInterface(api.core.CacheDefinitions.getInterfaceId(gameval));
}

/** Read on a scroll entry: the handwritten scroll for a `handwriting` entry, else the long scroll. */
function readScroll(api, scroll) {
  return ({ player }) => (scroll.handwriting
    ? openHandwriting(api, player, scroll.handwriting)
    : openLongScroll(player, scroll.title, scroll.lines));
}

module.exports = {
  name: "ReadingBooks",
  description: "Lets players read the Construction guide, the Glassblowing book, the Archaeologist's diary, the Lithkren vault notes, the rotten diary, the Tattered journal, the mud mound's Journal page, the Castle Drakan poem scroll and the Slepe Sisterhood books and papers.",
  members: true,
  READING_BOOKS,
  READING_SCROLLS,
  register(api) {
    registerQuestWidgets(api);
    for (const book of READING_BOOKS) {
      api.onItemAction(book.name, { Read: ({ player }) => openBook(player, book.title, book.pages) });
    }
    for (const scroll of READING_SCROLLS) api.onItemAction(scroll.name, { Read: readScroll(api, scroll) });
  },
};
