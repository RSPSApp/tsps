/**
 * Obor (https://oldschool.runescape.wiki/w/Obor) and Bryophyta
 * (https://oldschool.runescape.wiki/w/Bryophyta), from data/definitions/giant-boss-lairs.json:
 * their key-locked lairs, fights and chests, and their giant bones, as captured. Each lives in
 * ./giantlairs/. See docs/edgeville-dungeon.md.
 */
const Lairs = require("./giantlairs/Common.GiantLairs");

module.exports = {
  name: "GiantLairs",
  register(api) {
    Lairs.init(api);
    require("./giantlairs/Lair.GiantLairs")(api);
    require("./giantlairs/Obor.GiantLairs")(api);
    require("./giantlairs/Bryophyta.GiantLairs")(api);
    require("./giantlairs/GiantBones.GiantLairs")(api);
  },
};
