"use strict";

/**
 * Sorceress's Garden, the Thieving/Farming minigame in Al Kharid: the Apprentice's
 * teleport in, the four seasonal mazes with their elemental patrols and sq'irk trees, the
 * fountain out, the house shelves' beer glasses, and brewing/handing in sq'irkjuice. Each unit lives in
 * ./sorceressgarden/.
 */
const Gardens = require("./sorceressgarden/Gardens.SorceresssGarden");
const Maze = require("./sorceressgarden/Maze.SorceresssGarden");
const Juice = require("./sorceressgarden/Juice.SorceresssGarden");
const Apprentice = require("./sorceressgarden/Apprentice.SorceresssGarden");
const Shelves = require("./sorceressgarden/Shelves.SorceresssGarden");

module.exports = {
  name: "SorceresssGarden",
  description: "Adds Sorceress's Garden in Al Kharid: the four seasonal mazes with elementals and sq'irk trees, searching the house shelves for beer glasses, and brewing and handing in sq'irkjuice.",
  members: true,
  register(api) {
    Apprentice(api);
    Maze(api);
    Juice(api);
    Shelves(api);
  },
};

module.exports._test = {
  ...Gardens._test,
  ...Maze._test,
  ...Juice._test,
  ...Apprentice._test,
  ...Shelves._test,
  setCore(core) {
    Maze._test.setCore(core);
    Juice._test.setCore(core);
    Apprentice._test.setCore(core);
  },
  setApi(api) {
    Maze._test._setApi(api);
    Juice._test._setApi(api);
    Apprentice._test._setApi(api);
  },
};
