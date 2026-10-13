"use strict";

/**
 * Theatre of Blood: parties at Ver Sinhaza, the raid's rooms in their private copy of the
 * theatre, and the retrieval chest. Each unit lives in ./tob/; add one line per unit.
 */
module.exports = {
  name: "TheatreOfBlood",
  register(api) {
    require("./tob/Lobby.TheatreOfBlood")(api);
    require("./tob/Raid.TheatreOfBlood")(api);
    require("./tob/Retrieval.TheatreOfBlood")(api);
    require("./tob/Supplies.TheatreOfBlood")(api);
    require("./tob/Maiden.TheatreOfBlood")(api);
    require("./tob/Bloat.TheatreOfBlood")(api);
    require("./tob/Nylocas.TheatreOfBlood")(api);
    require("./tob/Sotetseg.TheatreOfBlood")(api);
    require("./tob/Xarpus.TheatreOfBlood")(api);
    require("./tob/Verzik.TheatreOfBlood")(api);
    require("./tob/Rewards.TheatreOfBlood")(api);
    require("./tob/Commands.TheatreOfBlood")(api);
  },
};
