const { openBook } = require("../quests/QuestRuntime");
const book = require("./data/goblin-book");

function readGoblinBook({ player }) {
  openBook(player, book.title, book.pages);
}

module.exports = {
  name: "GoblinBook",
  members: true,
  register(api) {
    api.onItemAction("Goblin book", { Read: readGoblinBook });
  },
};
