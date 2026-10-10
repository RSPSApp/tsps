const attachQuestCape = require("./quest-cape/QuestCape.QuestCape");

module.exports = {
  name: "QuestCape",
  members: true,
  register(api) {
    attachQuestCape(api);
  },
};
