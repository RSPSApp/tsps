/**
 * Read on the non-quest books that open in the two-page book viewer (392): the Construction
 * guide, the Glassblowing book (with its item pictures) and the Archaeologist's diary.
 * Reading changes nothing in the inventory.
 */
const { openBook, bookPagesFromSpreads } = require("../quests/QuestRuntime");
const books = require("./data/reading-books.json");

const READING_BOOKS = Object.entries(books)
  .filter(([name]) => !name.startsWith("_"))
  .map(([name, { title, spreads }]) => ({ name, title, pages: bookPagesFromSpreads(spreads) }));

module.exports = {
  name: "ReadingBooks",
  description: "Lets players read the Construction guide, the Glassblowing book and the Archaeologist's diary in the book viewer.",
  members: true,
  READING_BOOKS,
  register(api) {
    for (const book of READING_BOOKS) {
      api.onItemAction(book.name, { Read: ({ player }) => openBook(player, book.title, book.pages) });
    }
  },
};
