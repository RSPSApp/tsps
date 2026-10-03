"use strict";

/**
 * God Wars Dungeon: entrance access and essence gates, the private boss rooms
 * with their generals and bodyguards, and one combat unit per general. Each
 * unit lives in ./godwars/; add one line per unit.
 */
module.exports = {
  name: "GodWars",
  members: true,
  register(api) {
    require("./godwars/GodWarsAccess")(api);
    require("./godwars/GodWarsEncounters")(api);
    require("./godwars/GeneralGraardor.GodWars")(api);
    require("./godwars/KreeArra.GodWars")(api);
    require("./godwars/CommanderZilyana.GodWars")(api);
    require("./godwars/KrilTsutsaroth.GodWars")(api);
  },
};
