"use strict";

/**
 * Corporeal Beast: the lair under the Wilderness, the Beast, its dark energy core and the
 * spirit shields made from its drops. Each unit lives in ./corporealbeast/; add one line per
 * unit.
 */
module.exports = {
  name: "CorporealBeast",
  register(api) {
    require("./corporealbeast/Lair.CorporealBeast")(api);
    require("./corporealbeast/Beast.CorporealBeast")(api);
    require("./corporealbeast/DarkCore.CorporealBeast")(api);
    require("./corporealbeast/SpiritShields.CorporealBeast")(api);
    require("./corporealbeast/Commands.CorporealBeast")(api);
  },
};
