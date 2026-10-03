"use strict";

/**
 * Castle Wars. The shared match state lives in castlewars/Game.CastleWars.js; each unit file
 * wires one part of the minigame against it.
 */

module.exports = {
  name: "CastleWars",
  dependsOn: ["Food", "Mining", "Ladders"],
  register(api) {
    const game = require("./castlewars/Game.CastleWars")(api);
    require("./castlewars/Areas.CastleWars")(api, game);
    require("./castlewars/Lobby.CastleWars")(api, game);
    require("./castlewars/Flags.CastleWars")(api, game);
    require("./castlewars/Navigation.CastleWars")(api, game);
    require("./castlewars/Supplies.CastleWars")(api, game);
    require("./castlewars/Doors.CastleWars")(api, game);
    require("./castlewars/Tunnels.CastleWars")(api, game);
    require("./castlewars/Catapults.CastleWars")(api, game);
    require("./castlewars/Barricades.CastleWars")(api, game);
    require("./castlewars/Ropes.CastleWars")(api, game);
    require("./castlewars/Bandages.CastleWars")(api, game);
    require("./castlewars/Bracelet.CastleWars")(api, game);
  },
};
