"use strict";

module.exports = {
  name: "ClueCapacity",
  description: "Limits how many clue scrolls, caskets and vessels a player may hold across all six tiers, including case and Mimic bonuses, and opens nests, bottles and geodes.",
  register(api) {
    require("./Capacity.ClueCapacity")(api);
    require("./Vessels.ClueCapacity").attach(api);
  },
};
