/**
 * Read on the books that open in the two-page book viewer (392): the Construction guide, the
 * Glassblowing book (with its item pictures), the Archaeologist's diary and the rotten diary;
 * and on the scrolls that open in the long scroll (625): the Castle Drakan poem scroll.
 * Reading changes nothing in the inventory.
 */
const { openBook, openLongScroll, bookPagesFromSpreads, registerQuestWidgets } = require("../quests/QuestRuntime");
const books = require("./data/reading-books.json");
const scrolls = require("./data/reading-scrolls.json");

const READING_BOOKS = Object.entries(books)
  .filter(([name]) => !name.startsWith("_"))
  .map(([name, { title, spreads }]) => ({ name, title, pages: bookPagesFromSpreads(spreads) }));
const READING_SCROLLS = Object.entries(scrolls)
  .filter(([name]) => !name.startsWith("_"))
  .map(([name, { title, lines }]) => ({ name, title, lines }));

module.exports = {
  name: "ReadingBooks",
  description: "Lets players read the Construction guide, the Glassblowing book, the Archaeologist's diary, the rotten diary and the Castle Drakan poem scroll.",
  members: true,
  READING_BOOKS,
  READING_SCROLLS,
  register(api) {
    registerQuestWidgets(api);
    for (const book of READING_BOOKS) {
      api.onItemAction(book.name, { Read: ({ player }) => openBook(player, book.title, book.pages) });
    }
    for (const scroll of READING_SCROLLS) {
      api.onItemAction(scroll.name, { Read: ({ player }) => openLongScroll(player, scroll.title, scroll.lines) });
    }
  },
};
