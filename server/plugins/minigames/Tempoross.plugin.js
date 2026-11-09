"use strict";

/**
 * Tempoross: the Spirit Anglers' skilling boss. The Ruins of Unkah lobby and ferries, a cove
 * instance per departure, the fight, and the reward pool. Each unit lives in ./tempoross/; add
 * one line per unit. docs/tempoross.md has the captures and Wiki numbers.
 */
module.exports = {
  name: "Tempoross",
  description: "Adds Tempoross, the Spirit Anglers' fishing boss: the Ruins of Unkah ferries, a cove instance per trip, the fight and the reward pool.",
  members: true,
  register(api) {
    require("./tempoross/Cove.Tempoross").attachCove(api);
    require("./tempoross/Records.Tempoross").attachRecords(api);
    require("./tempoross/Lobby.Tempoross").attachLobby(api);
    require("./tempoross/Hosts.Tempoross").attachHosts(api);
    require("./tempoross/Spots.Tempoross").attachSpots(api);
    require("./tempoross/Shrine.Tempoross").attachShrine(api);
    require("./tempoross/Cannons.Tempoross").attachCannons(api);
    require("./tempoross/Supplies.Tempoross").attachSupplies(api);
    require("./tempoross/Tethers.Tempoross").attachTethers(api);
    require("./tempoross/Attacks.Tempoross").attachAttacks(api);
    require("./tempoross/Rewards.Tempoross").attachRewards(api);
    require("./tempoross/Commands.Tempoross").attachCommands(api);
  },
};
