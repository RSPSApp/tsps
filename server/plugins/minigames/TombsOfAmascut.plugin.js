"use strict";

/**
 * Tombs of Amascut: the Jaltevas pyramid lobby and party board, the raid itself (Nexus, the
 * four paths with their puzzles and bosses, the Wardens) and its rewards. Each unit lives in
 * ./toa/; add one line per unit.
 */
module.exports = {
  name: "TombsOfAmascut",
  members: true,
  register(api) {
    require("./toa/Lobby.TombsOfAmascut")(api);
    require("./toa/Raid.TombsOfAmascut")(api);
    require("./toa/Nexus.TombsOfAmascut")(api);
    require("./toa/Supplies.TombsOfAmascut")(api);
    require("./toa/Scabaras.TombsOfAmascut")(api);
    require("./toa/Kephri.TombsOfAmascut")(api);
    require("./toa/Het.TombsOfAmascut")(api);
    require("./toa/Akkha.TombsOfAmascut")(api);
    require("./toa/Crondis.TombsOfAmascut")(api);
    require("./toa/Zebak.TombsOfAmascut")(api);
    require("./toa/Apmeken.TombsOfAmascut")(api);
    require("./toa/BaBa.TombsOfAmascut")(api);
    require("./toa/Wardens.TombsOfAmascut")(api);
    require("./toa/Rewards.TombsOfAmascut")(api);
    require("./toa/Items.TombsOfAmascut")(api);
    require("./toa/Shadow.TombsOfAmascut")(api);
    require("./toa/Commands.TombsOfAmascut")(api);
  },
};
