/**
 * Herblore (https://oldschool.runescape.wiki/w/Herblore): cleaning grimy herbs, mixing potions
 * and grinding secondaries with a pestle and mortar, from plugins/skills/data/herblore.json and
 * rsprox captures. See docs/herblore.md; the custom events it answers are in
 * herblore/Events.Herblore.js.
 */
module.exports = {
  name: "Herblore",
  members: true,
  register(api) {
    require("./herblore/Events.Herblore")(api);
    require("./herblore/Cleaning.Herblore")(api);
    require("./herblore/Mixing.Herblore")(api);
    require("./herblore/Grinding.Herblore")(api);
  },
};
