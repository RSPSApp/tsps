/**
 * Forestry (https://oldschool.runescape.wiki/w/Forestry): chopping near other woodcutters with
 * a forestry kit brings events that pay Anima-infused bark. Built from rsprox recordings
 * (plugins/minigames/data/forestry.json); the units are in ./forestry/:
 * - Spawns: when and where an event appears and who it rewards;
 * - Sapling: the Struggling Sapling;
 * - Roots: Rising Roots.
 */
const Common = require("./forestry/Common.Forestry");
const Spawns = require("./forestry/Spawns.Forestry");
const Sapling = require("./forestry/Sapling.Forestry");
const Roots = require("./forestry/Roots.Forestry");
const Forester = require("./forestry/Forester.Forestry");

module.exports = {
  name: "Forestry",
  register(api) {
    Common.init(api);
    Spawns.attachSpawns(api);
    Sapling.attachSapling(api);
    Roots.attachRoots(api);
    Forester.attachForester(api);
  },
};
