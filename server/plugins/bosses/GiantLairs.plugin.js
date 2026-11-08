/**
 * Obor (https://oldschool.runescape.wiki/w/Obor) and Bryophyta
 * (https://oldschool.runescape.wiki/w/Bryophyta), from plugins/bosses/data/giant-boss-lairs.json:
 * their key-locked lairs, fights and chests, and their giant bones, as captured. Each lives in
 * ./giantlairs/. See docs/edgeville-dungeon.md.
 */
const Lairs = require("./giantlairs/Common.GiantLairs");

module.exports = {
  name: "GiantLairs",
  description: "Obor and Bryophyta: their key-locked lairs, fights, chests and giant bones.",
  register(api) {
    Lairs.init(api);
    require("./giantlairs/Lair.GiantLairs")(api);
    require("./giantlairs/Obor.GiantLairs")(api);
    require("./giantlairs/Bryophyta.GiantLairs")(api);
    require("./giantlairs/CombatAchievements.GiantLairs")(api);
  },
};
