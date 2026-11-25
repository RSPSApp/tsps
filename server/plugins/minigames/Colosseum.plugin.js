"use strict";

/**
 * Fortis Colosseum: the lobby under Civitas illa Fortis, each player's run of waves with
 * Minimus's modifiers, Sol Heredit, and the rewards chest. Each unit lives in
 * ./colosseum/; add one line per unit.
 */
/** Playable encounter IDs, read without starting a run or rolling rewards. */
function describeEncounters({ npcIds }) {
  for (const id of Object.values(require("./colosseum/Waves.Colosseum").ids())) npcIds.add(id);
}

module.exports = {
  name: "Colosseum",
  description: "Adds the Fortis Colosseum: the lobby, waves with Minimus's modifiers, Sol Heredit and the rewards chest.",
  members: true,
  register(api) {
    api.onCustomEvent("bestiary:encounters", describeEncounters);
    require("./colosseum/Lobby.Colosseum")(api);
    require("./colosseum/Arena.Colosseum")(api);
    require("./colosseum/Enemies.Colosseum")(api);
    require("./colosseum/ModifierEffects.Colosseum")(api);
    require("./colosseum/SolHeredit.Colosseum")(api);
    require("./colosseum/Rewards.Colosseum")(api);
    require("./colosseum/Scoreboard.Colosseum")(api);
    require("./colosseum/Commands.Colosseum")(api);
    require("./colosseum/CombatAchievements.Colosseum")(api);
    require("./colosseum/QuiverExchange.Colosseum")(api);
  },
};
