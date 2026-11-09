"use strict";

/**
 * Bounty Hunter in Daimon's Crater. The shared crater state lives in
 * bountyhunter/State.BountyHunter.js; each unit file wires one part of the minigame against it.
 */

module.exports = {
  name: "BountyHunter",
  description: "Adds Bounty Hunter in Daimon's Crater, with the shared crater state split into units for each part of the minigame.",
  members: true,
  // Points re-registers the "BOUNTY HUNTER POINTS" shop currency on varp bh_2023_points;
  // the bots are the PlayerBots runtime's PvP bots.
  dependsOn: ["Shopkeepers", "PlayerBots"],
  register(api) {
    const bh = require("./bountyhunter/State.BountyHunter");
    require("./bountyhunter/Hud.BountyHunter")(api, bh);
    require("./bountyhunter/Targets.BountyHunter")(api, bh);
    require("./bountyhunter/Area.BountyHunter")(api, bh);
    require("./bountyhunter/Entry.BountyHunter")(api, bh);
    require("./bountyhunter/Fort.BountyHunter")(api, bh);
    require("./bountyhunter/SupplyCrates.BountyHunter")(api, bh);
    require("./bountyhunter/TargetTeleport.BountyHunter")(api, bh);
    require("./bountyhunter/RiskSkulls.BountyHunter")(api, bh);
    require("./bountyhunter/Points.BountyHunter")(api, bh);
    require("./bountyhunter/Emblems.BountyHunter")(api, bh);
    require("./bountyhunter/EarningPotential.BountyHunter")(api, bh);
    require("./bountyhunter/BountyCrates.BountyHunter")(api, bh);
    require("./bountyhunter/Coffer.BountyHunter")(api, bh);
    require("./bountyhunter/EmblemTrader.BountyHunter")(api, bh);
    require("./bountyhunter/CorruptedWarrior.BountyHunter")(api, bh);
    require("./bountyhunter/Loadouts.BountyHunter")(api, bh);
    require("./bountyhunter/Bots.BountyHunter")(api, bh);
  },
};
