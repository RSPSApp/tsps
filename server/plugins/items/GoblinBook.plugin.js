const { openBook, registerQuestWidgets } = require("../quests/QuestRuntime");
const book = require("./data/goblin-book");

function readGoblinBook({ player }) {
  openBook(player, book.title, book.pages);
}

module.exports = {
  name: "GoblinBook",
  description: "Lets players read the Goblin book, which opens its pages in the book viewer.",
  members: true,
  register(api) {
    registerQuestWidgets(api);
    api.onItemAction("Goblin book", { Read: readGoblinBook });
  },
};
