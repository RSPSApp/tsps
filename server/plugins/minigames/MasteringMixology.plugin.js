"use strict";

/**
 * Mastering Mixology: the Alchemical Society's Herblore lab under Aldarin. Each unit lives in
 * ./mixology/; add one line per unit.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Mastering_Mixology (docs/mastering-mixology.md)
 */
module.exports = {
  name: "MasteringMixology",
  members: true,
  register(api) {
    require("./mixology/Shared.Mixology").bind(api);
    require("./mixology/State.Mixology")(api);
    require("./mixology/Area.Mixology")(api);
    require("./mixology/Stairs.Mixology")(api);
    require("./mixology/Supervisor.Mixology")(api);
    require("./mixology/Refiner.Mixology")(api);
    require("./mixology/Mixer.Mixology")(api);
    require("./mixology/Stations.Mixology")(api);
    require("./mixology/Orders.Mixology")(api);
    require("./mixology/Digweed.Mixology")(api);
    require("./mixology/LabNotes.Mixology")(api);
    require("./mixology/RewardShop.Mixology")(api);
    require("./mixology/Goggles.Mixology")(api);
    require("./mixology/Commands.Mixology")(api);
  },
};
