"use strict";

/**
 * Wintertodt: the world's one round against the Wintertodt behind the Doors of Dinh, the camp
 * outside and its reward cart. Each unit lives in ./wintertodt/; add one line per unit.
 */
module.exports = {
  name: "Wintertodt",
  register(api) {
    require("./wintertodt/Doors.Wintertodt")(api);
    require("./wintertodt/Braziers.Wintertodt")(api);
    require("./wintertodt/Supplies.Wintertodt")(api);
    require("./wintertodt/Pyromancers.Wintertodt")(api);
    require("./wintertodt/Cart.Wintertodt")(api);
    require("./wintertodt/Commands.Wintertodt")(api);
  },
};
