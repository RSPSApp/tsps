/**
 * Fletching (docs/fletching.md): every recipe on the Wiki's Fletching page, from
 * data/fletching.json, with menus, messages and animations from rsprox captures.
 */
const UNITS = [
  require("./fletching/Shared.Fletching"),
  require("./fletching/Recipes.Fletching"),
  require("./fletching/Spool.Fletching"),
  require("./fletching/Diaries.Fletching"),
];

module.exports = {
  name: "Fletching",
  members: true,
  register(api) {
    for (const unit of UNITS) unit.init?.(api);
    for (const unit of UNITS) unit.attach?.(api);
  },
};
