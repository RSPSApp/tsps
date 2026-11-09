const attachQuestCape = require("./QuestCape.QuestCape");

module.exports = {
  name: "QuestCape",
  description: "Sells the Quest point cape and hood for 99,000 coins from the Wise Old Man once the player has finished every quest that counts.",
  members: true,
  register(api) {
    attachQuestCape(api);
  },
};
