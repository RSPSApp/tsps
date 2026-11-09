/**
 * Fletching (docs/fletching.md): every recipe on the Wiki's Fletching page, from
 * data/fletching.json, with menus, messages and animations from rsprox captures.
 */

const Shared = require("./fletching/Shared.Fletching");

/** "fletching:shafts": the arrow shafts request.logId fletches into, how many and the XP, for content that fletches as it chops (a league relic); a log with no arrow-shaft recipe answers nothing. */
function answerShafts(request) {
  const shaft = Shared.getCore().ItemIdentifiers.ARROW_SHAFT;
  const recipe = Shared.getRecipes().find((candidate) => candidate.outputId === shaft
    && candidate.materials.some((material) => material.ids.includes(request.logId)));
  if (!recipe) return;
  request.itemId = recipe.outputId;
  request.amount = recipe.amount;
  request.xp = recipe.xp;
}

const UNITS = [
  Shared,
  require("./fletching/Recipes.Fletching"),
  require("./fletching/Spool.Fletching"),
  require("./fletching/Diaries.Fletching"),
];

module.exports = {
  answerShafts,
  name: "Fletching",
  description: "Fletching: every Wiki recipe for bows, arrows, bolts and more, with menus and animations, plus an arrow shaft event for other content.",
  members: true,
  register(api) {
    for (const unit of UNITS) unit.init?.(api);
    for (const unit of UNITS) unit.attach?.(api);
    api.onCustomEvent("fletching:shafts", answerShafts);
  },
};
