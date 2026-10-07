/**
 * Fallen From Grace isn't on this server, so every player has its finished state on login: the
 * varbits the cache's own multilocs read (the post-quest Mad Angel in Ardeaglais, the powered
 * golem in the cave, the mined rocks at the top of the cliff shortcut).
 */
const Common = require("./Common.Wyrmscraig");

function sendQuestState({ player }) {
  const sender = player.getPacketSender();
  for (const { id, value } of Common.data.openAccess.varbits) sender.sendVarbit(id, value);
}

module.exports = function attachOpenAccess(api) {
  api.onPlayerLogin(sendQuestState);
};
