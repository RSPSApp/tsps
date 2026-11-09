/**
 * Shades of Mort'ton, the minigame (https://oldschool.runescape.wiki/w/Shades_of_Mort%27ton_(minigame)),
 * built from rsprox recordings and the Wiki (plugins/minigames/data/shades-of-mortton.json). The quest
 * (quests/quests/ShadesOfMortton.Quest.js) keeps its own steps: the temple, sacred oil, pyre logs.
 * The units are in ./shadesofmortton/:
 * - Shades: shadows rising into shades and sinking back, and their remains;
 * - Catacombs: the hillside entrance, the tomb doors and the chests;
 * - Pyres: the funeral pyres, the Shade Spirit and the reward on the stand (the quest hears of
 *   them for its stages).
 */
const Common = require("./shadesofmortton/Common.ShadesOfMortton");
const Shades = require("./shadesofmortton/Shades.ShadesOfMortton");
const Catacombs = require("./shadesofmortton/Catacombs.ShadesOfMortton");
const Pyres = require("./shadesofmortton/Pyres.ShadesOfMortton");

module.exports = {
  name: "Shades of Mort'ton",
  description: "Adds the Shades of Mort'ton minigame: shades and their remains, the catacombs, tomb doors and chests, and funeral pyres.",
  members: true,
  register(api) {
    Common.init(api);
    Shades.attachShades(api);
    Catacombs.attachCatacombs(api);
    Pyres.attachPyres(api);
  },
};
