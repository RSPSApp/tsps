/**
 * Read on the non-quest books and papers: the Construction guide, the Glassblowing book (with
 * its item pictures), the Archaeologist's diary, the Lithkren vault notes (rsprox.net 231/00722
 * ticks 1717-1723) and the three Slepe Sisterhood books open in the two-page book viewer (392);
 * the Elixir of Everlasting opens the long scroll (625) and the Crombwick deed the handwritten
 * scroll (rsprox 391, 392). Reading changes nothing in the inventory.
 */
const { openBook, bookPagesFromSpreads, registerQuestWidgets } = require("../quests/QuestRuntime");
const books = require("./data/reading-books.json");

const LONGSCROLL = "longscroll";
const LONGSCROLL_SETUP = 418;
const MAINMODAL_OPEN = 2524;

const entries = Object.entries(books).filter(([name]) => !name.startsWith("_"));

const READING_BOOKS = entries
  .filter(([, entry]) => entry.spreads)
  .map(([name, { title, spreads }]) => ({ name, title, pages: bookPagesFromSpreads(spreads) }));

const READING_SCROLLS = entries
  .filter(([, entry]) => !entry.spreads)
  .map(([name, entry]) => ({ name, ...entry }));

function interfaceId(api, gameval) {
  return api.core.CacheDefinitions.getInterfaceId(gameval);
}

/** The long scroll: the client lays out the title and text from longscroll_setup (rsprox 392 tick 523). */
function openLongScroll(api, player, { title, text }) {
  player.getPacketSender()
    .sendInterfaceScript(MAINMODAL_OPEN, [-1, -1])
    .sendInterface(interfaceId(api, LONGSCROLL))
    .sendClientScript(LONGSCROLL_SETUP, title, text);
}

/** A handwritten scroll: every line component is written, blanks too, then it opens (rsprox 391 tick 4736). */
function openHandwriting(api, player, { interface: gameval, lines }) {
  const sender = player.getPacketSender();
  lines.forEach((line, index) => {
    sender.sendString(line, api.core.CacheDefinitions.getComponentId(`${gameval}:messagescroll${index + 1}_hw`));
  });
  sender.sendInterfaceScript(MAINMODAL_OPEN, [-1, -1]).sendInterface(interfaceId(api, gameval));
}

/** Read on a scroll entry: the long scroll or the handwritten one, by the entry's shape. */
function readScroll(api, scroll) {
  return ({ player }) => (scroll.longscroll
    ? openLongScroll(api, player, scroll.longscroll)
    : openHandwriting(api, player, scroll.handwriting));
}

module.exports = {
  name: "ReadingBooks",
  description: "Lets players read the Construction guide, the Glassblowing book, the Archaeologist's diary, the Lithkren vault notes and the Slepe Sisterhood books and papers.",
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
