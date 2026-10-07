"use strict";

/**
 * Fortis Colosseum: the lobby under Civitas illa Fortis, each player's run of waves with
 * Minimus's modifiers, Sol Heredit, and the rewards chest. Each unit lives in
 * ./colosseum/; add one line per unit.
 */
module.exports = {
  name: "Colosseum",
  register(api) {
    require("./colosseum/Lobby.Colosseum")(api);
    require("./colosseum/Arena.Colosseum")(api);
    require("./colosseum/Enemies.Colosseum")(api);
    require("./colosseum/ModifierEffects.Colosseum")(api);
    require("./colosseum/SolHeredit.Colosseum")(api);
    require("./colosseum/Rewards.Colosseum")(api);
    require("./colosseum/Commands.Colosseum")(api);
  },
};
