"use strict";

module.exports = {
  name: "BeginnerTreasureTrails",
  register(api) {
    require("./Runtime.BeginnerTreasureTrails")(api);
    require("./Rewards.BeginnerTreasureTrails")(api);
  },
};
