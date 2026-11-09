/**
 * The Moons of Peril (https://oldschool.runescape.wiki/w/Moons_of_Peril), from
 * plugins/bosses/data/moons-of-peril.json, as captured: the Blood, Blue and Eclipse Moon in their
 * shared arenas under Cam Torum, each on its own loop of glyphs and specials, with a health, curse
 * and special of each player's own; Neypotzli's camps, supplies and river fishing; the Lunar Chest
 * and Eyatlalli's offerings. Each part lives in ./moonsofperil/. See docs/moons-of-peril.md.
 */
const Common = require("./moonsofperil/Common.MoonsOfPeril");
const Cycle = require("./moonsofperil/Cycle.MoonsOfPeril");
const Arena = require("./moonsofperil/Arena.MoonsOfPeril");

module.exports = {
  name: "MoonsOfPeril",
  description: "The Moons of Peril: the Blood, Blue and Eclipse Moons under Cam Torum, Neypotzli's camps and fishing, the Lunar Chest and Eyatlalli's offerings.",
  members: true,
  register(api) {
    Common.init(api);
    Cycle.attachCycle(api);
    Arena.attachArena(api);
    require("./moonsofperil/BloodMoon.MoonsOfPeril")(api);
    require("./moonsofperil/BlueMoon.MoonsOfPeril")(api);
    require("./moonsofperil/EclipseMoon.MoonsOfPeril")(api);
    require("./moonsofperil/Camps.MoonsOfPeril")(api);
    require("./moonsofperil/River.MoonsOfPeril")(api);
    require("./moonsofperil/Chest.MoonsOfPeril")(api);
    require("./moonsofperil/Scoreboard.MoonsOfPeril").attachScoreboard(api);
    require("./moonsofperil/Commands.MoonsOfPeril")(api);
  },
};
