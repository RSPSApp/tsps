"use strict";

/**
 * Guardians of the Rift: the Runecraft minigame in the Temple of the Eye. One game runs for the
 * whole world; each unit lives in ./guardiansoftherift/; add one line per unit.
 * docs/guardians-of-the-rift.md has the captures and Wiki facts it follows.
 */
module.exports = {
  name: "GuardiansOfTheRift",
  members: true,
  register(api) {
    require("./guardiansoftherift/Shared.GuardiansOfTheRift").bind(api);
    require("./guardiansoftherift/Records.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Game.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Temple.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Barrier.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/GreatGuardian.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Mining.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Workbench.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Portals.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/DepositPool.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Altars.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Cells.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/RiftGuardians.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Creatures.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Rewards.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/RewardsGuardian.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Apprentices.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Amulet.GuardiansOfTheRift").attach(api);
    require("./guardiansoftherift/Commands.GuardiansOfTheRift").attach(api);
  },
};
