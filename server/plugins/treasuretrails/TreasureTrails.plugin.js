"use strict";

module.exports = {
  name: "TreasureTrails",
  description: "Clue scroll treasure trails: clue steps, caskets, STASH units, puzzle boxes, skill and light clues, Falo, hot-cold devices and Watson.",
  members: true,
  register(api) {
    require("./trails/Runtime.TreasureTrails")(api);
    require("./trails/Caskets.TreasureTrails")(api);
    require("./trails/Stash.TreasureTrails")(api);
    require("./trails/Puzzle.TreasureTrails")(api);
    require("./trails/Skills.TreasureTrails")(api);
    require("./trails/Light.TreasureTrails")(api);
    require("./trails/Falo.TreasureTrails")(api);
    require("./trails/HotCold.TreasureTrails")(api);
    require("./trails/Parts.TreasureTrails")(api);
    require("./trails/Watson.TreasureTrails")(api);
  },
};
