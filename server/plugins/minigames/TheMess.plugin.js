"use strict";

/**
 * The Mess, Hosidius: the servery where players cook meat pies, stews and pineapple pizzas
 * for the Shayzien soldiers and serve them at the buffet tables. Each unit lives in
 * ./themess/.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Mess
 */
const Shared = require("./themess/Shared.TheMess");
const Recipes = require("./themess/Recipes.TheMess");
const Stations = require("./themess/Stations.TheMess");

module.exports = {
  name: "TheMess",
  members: true,
  register(api) {
    Shared.init(api);
    Stations(api);
  },
  _test: {
    init: Shared.init,
    ITEM: Shared.ITEM,
    OBJECT: Shared.OBJECT,
    APPRECIATION: Shared.APPRECIATION,
    HUD: Shared.HUD,
    sessions: Shared.sessions,
    sessionOf: Shared.sessionOf,
    level: Shared.level,
    xpFor: Shared.xpFor,
    applyServe: Shared.applyServe,
    decayTick: Shared.decayTick,
    cleanUp: Shared.cleanUp,
    COMBINES: Recipes.COMBINES,
    COOKS: Recipes.COOKS,
    COOK_BY_RAW: Recipes.COOK_BY_RAW,
    combine: Recipes.combine,
    cook: Recipes.cook,
    cookSuccess: Recipes.cookSuccess,
    makeFlourWater: Recipes.makeFlourWater,
    assemblePineapplePizza: Recipes.assemblePineapplePizza,
    ...Stations._test,
  },
};
