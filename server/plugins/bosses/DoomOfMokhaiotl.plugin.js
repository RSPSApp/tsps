"use strict";

/**
 * The Doom of Mokhaiotl: the ruins' entrance, the lobby and the delves. Each unit lives in
 * ./doom/; add one line per unit.
 */
module.exports = {
  name: "DoomOfMokhaiotl",
  register(api) {
    require("./doom/Lobby.Doom")(api);
    require("./doom/Delve.Doom")(api);
    require("./doom/Rewards.Doom")(api);
    require("./doom/Scoreboard.Doom")(api);
    require("./doom/Commands.Doom")(api);
  },
};
