"use strict";

/**
 * Wintertodt: the world's one round against the Wintertodt behind the Doors of Dinh, the camp
 * outside and its reward cart. Each unit lives in ./wintertodt/; add one line per unit.
 */
module.exports = {
  name: "Wintertodt",
  description: "Adds Wintertodt: the world-wide round behind the Doors of Dinh, the camp outside and its reward cart.",
  members: true,
  register(api) {
    require("./wintertodt/Doors.Wintertodt")(api);
    require("./wintertodt/Braziers.Wintertodt")(api);
    require("./wintertodt/Supplies.Wintertodt")(api);
    require("./wintertodt/Pyromancers.Wintertodt")(api);
    require("./wintertodt/Cart.Wintertodt")(api);
    require("./wintertodt/Ignisia.Wintertodt")(api);
    require("./wintertodt/Crates.Wintertodt")(api);
    require("./wintertodt/Commands.Wintertodt")(api);
    require("./wintertodt/CombatAchievements.Wintertodt")(api);
  },
};
