"use strict";

/**
 * The Gauntlet and the Corrupted Gauntlet: the lobby under Prifddinas, the maze built for each
 * run, and the Crystalline Hunllef. Each unit lives in ./gauntlet/; add one line per unit.
 */
module.exports = {
  name: "Gauntlet",
  members: true,
  register(api) {
    require("./gauntlet/Lobby.Gauntlet")(api);
    require("./gauntlet/Run.Gauntlet")(api);
    require("./gauntlet/Prep.Gauntlet")(api);
    require("./gauntlet/Weapons.Gauntlet")(api);
    require("./gauntlet/Commands.Gauntlet")(api);
  },
};
