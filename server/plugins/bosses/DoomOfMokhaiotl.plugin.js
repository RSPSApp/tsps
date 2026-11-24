"use strict";

/**
 * The Doom of Mokhaiotl: the ruins' entrance, the lobby and the delves. Each unit lives in
 * ./doom/; add one line per unit.
 */
const Shared = require("./doom/Shared.DoomOfMokhaiotl");

function describeEncounters({ npcIds }) {
  for (const id of Object.values(Shared.NPC)) npcIds.add(id);
}

module.exports = {
  name: "DoomOfMokhaiotl",
  description: "The Doom of Mokhaiotl: the ruins' entrance, the lobby and the delves.",
  register(api) {
    api.onCustomEvent("bestiary:encounters", describeEncounters);
    require("./doom/Lobby.DoomOfMokhaiotl")(api);
    require("./doom/Delve.DoomOfMokhaiotl")(api);
    require("./doom/Rewards.DoomOfMokhaiotl")(api);
    require("./doom/Scoreboard.DoomOfMokhaiotl")(api);
    require("./doom/Commands.DoomOfMokhaiotl")(api);
    require("./doom/CombatAchievements.DoomOfMokhaiotl")(api);
  },
};
