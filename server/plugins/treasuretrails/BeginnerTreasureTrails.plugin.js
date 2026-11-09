"use strict";

module.exports = {
  name: "BeginnerTreasureTrails",
  description: "Beginner clue scroll trails: the clue runtime, rewards, collection log count and the minor and major scroll case capacity.",
  register(api) {
    require("./beginner/Runtime.BeginnerTreasureTrails")(api);
    require("./beginner/Rewards.BeginnerTreasureTrails")(api);
    require("./beginner/Capacity.BeginnerTreasureTrails")(api);
  },
};
