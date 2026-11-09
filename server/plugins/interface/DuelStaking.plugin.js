const { enableStaking } = require("../minigames/DuelArena.plugin");

module.exports = {
  name: "DuelStaking",
  description: "Adds the staking interface and item stakes to duels. The Duel Arena itself is a separate plugin.",
  dependsOn: ["DuelArena"],
  register() {
    enableStaking();
  },
};
