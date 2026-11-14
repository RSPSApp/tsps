/**
 * Read on the non-quest books that open in the two-page book viewer (392): the Construction
 * guide, the Glassblowing book (with its item pictures), the Archaeologist's diary, the
 * Lithkren vault notes (rsprox.net 231/00722 ticks 1717-1723), the Tattered journal from
 * The Blood Moon Rises (rsprox.net recording 4288, rev 239, tick 19533: one spread, both page
 * buttons hidden) and the Journal page from the Icyene Graveyard's mud mound (rsprox 231/00392
 * ticks 8232, 8280: one spread, both page buttons hidden). Reading changes nothing in the
 * inventory.
 */
const { openBook, bookPagesFromSpreads, registerQuestWidgets } = require("../quests/QuestRuntime");
const books = require("./data/reading-books.json");

const READING_BOOKS = Object.entries(books)
  .filter(([name]) => !name.startsWith("_"))
  .map(([name, { title, spreads }]) => ({ name, title, pages: bookPagesFromSpreads(spreads) }));

module.exports = {
  name: "ReadingBooks",
  description: "Lets players read the Construction guide, the Glassblowing book, the Archaeologist's diary, the Lithkren vault notes, the Tattered journal and the mud mound's Journal page in the book viewer.",
  members: true,
  READING_BOOKS,
  register(api) {
    registerQuestWidgets(api);
    for (const book of READING_BOOKS) {
      api.onItemAction(book.name, { Read: ({ player }) => openBook(player, book.title, book.pages) });
    }
  },
};
