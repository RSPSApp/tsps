/**
 * Cooking (https://oldschool.runescape.wiki/w/Cooking): fires, ranges and ovens, doughs, pies and
 * pizzas, and wine, from plugins/skills/data/cooking.json and rsprox captures. See
 * docs/cooking.md; the units are in cooking/.
 */
const Common = require("./cooking/Common.Cooking");
const Cookers = require("./cooking/Cookers.Cooking");
const Wine = require("./cooking/Wine.Cooking");

module.exports = {
  name: "Cooking",
  description: "Cooking on fires, ranges and ovens, plus doughs, pies, pizzas, wine, sacred eels, leaping fish, gnome cooking and dairy churns.",
  register(api) {
    require("./cooking/Cookers.Cooking")(api);
    require("./cooking/Recipes.Cooking")(api);
    require("./cooking/Wine.Cooking")(api);
    require("./cooking/SacredEel.Cooking")(api);
    require("./cooking/LeapingFish.Cooking")(api);
    require("./cooking/Gnome.Cooking")(api);
    require("./cooking/Churn.Cooking")(api);
  },
  isCookingActive: Cookers.isCookingActive,
  /** True for a fire, range or oven the game lets you cook on (name and Cook action). */
  isCooker: Cookers.isCooker,
  /** Whether the player may cook this food at all (world, level, quest and rumour gates), without messages. */
  canCookFood: Cookers.canCookFood,
  /** Every food a fire or range cooks, by its raw item id (after register). */
  get COOKABLE_BY_RAW() { return Common.cookables(); },
  COOKABLE_OBJECT_NAMES: Cookers.COOKABLE_OBJECT_NAMES,
  FIRE_OBJECT_NAMES: Cookers.FIRE_OBJECT_NAMES,
  _test: {
    ...Cookers._test,
    wearsCookingCape: Common.wearsCookingCape,
    wine: Wine._test,
    churn: require("./cooking/Churn.Cooking")._test,
    get COOKABLE_BY_RAW() { return Common.cookables(); },
    setApi: (value) => Common.init(value),
  },
};
