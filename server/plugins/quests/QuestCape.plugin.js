const attachQuestCape = require("./QuestCape.QuestCape");

module.exports = {
  name: "QuestCape",
  description: "Sells the Quest point cape for 99,000 coins at the Legends' Guild once the player has finished every quest that counts.",
  members: true,
  register(api) {
    attachQuestCape(api);
  },
};
