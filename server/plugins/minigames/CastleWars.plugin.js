"use strict";

/**
 * Castle Wars. The shared match state lives in castlewars/Game.CastleWars.js; each unit file
 * wires one part of the minigame against it.
 */

module.exports = {
  name: "CastleWars",
  dependsOn: ["Food", "Mining", "Ladders", "Potions", "Omnishop"],
  register(api) {
    const game = require("./castlewars/Game.CastleWars")(api);
    require("./castlewars/WaitingRoom.CastleWars")(api, game);
    require("./castlewars/Areas.CastleWars")(api, game);
    require("./castlewars/Settings.CastleWars")(api, game);
    require("./castlewars/RewardShop.CastleWars")(api);
    require("./castlewars/Lobby.CastleWars")(api, game);
    require("./castlewars/Flags.CastleWars")(api, game);
    require("./castlewars/Navigation.CastleWars")(api, game);
    require("./castlewars/Supplies.CastleWars")(api, game);
    require("./castlewars/Doors.CastleWars")(api, game);
    require("./castlewars/Tunnels.CastleWars")(api, game);
    require("./castlewars/Catapults.CastleWars")(api, game);
    require("./castlewars/Barricades.CastleWars")(api, game);
    require("./castlewars/Explosives.CastleWars")(api, game);
    require("./castlewars/Cloaks.CastleWars")(api, game);
    require("./castlewars/Ropes.CastleWars")(api, game);
    require("./castlewars/Bandages.CastleWars")(api, game);
    require("./castlewars/Bracelet.CastleWars")(api, game);
    require("./castlewars/Practice.CastleWars")(api, game);
    require("./castlewars/Bots.CastleWars")(api, game);
    require("./castlewars/Scoreboard.CastleWars").attachScoreboard(api);
  },
};
