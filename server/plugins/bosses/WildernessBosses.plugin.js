/**
 * The Wilderness bosses (https://oldschool.runescape.wiki/w/Wilderness_bosses), as reworked in
 * 2023: Callisto, Vet'ion and Venenatis in multi-combat lairs joined by the Escape Caves, and
 * their weaker variants Artio, Calvar'ion and Spindel in singles-plus lairs, all behind one
 * shared entry fee; and Scorpia beneath the Scorpion Pit. Built from rsprox captures and the Wiki
 * (docs/wilderness-bosses.md).
 */
const Common = require("./wildernessbosses/Common.WildernessBosses");
const Caves = require("./wildernessbosses/Caves.WildernessBosses");
const EscapeCaves = require("./wildernessbosses/EscapeCaves.WildernessBosses");
const Hud = require("./wildernessbosses/Hud.WildernessBosses");
const Loot = require("./wildernessbosses/Loot.WildernessBosses");
const Traps = require("./wildernessbosses/Traps.WildernessBosses");
const Bears = require("./wildernessbosses/Bears.WildernessBosses");
const Vetion = require("./wildernessbosses/Vetion.WildernessBosses");
const Spiders = require("./wildernessbosses/Spiders.WildernessBosses");
const Scorpia = require("./wildernessbosses/Scorpia.WildernessBosses");
const Commands = require("./wildernessbosses/Commands.WildernessBosses");

module.exports = {
  name: "WildernessBosses",
  description: "The Wilderness bosses: Callisto, Vet'ion, Venenatis, their Artio, Calvar'ion and Spindel variants, shared entry fee, Escape Caves and Scorpia.",
  config: {
    "WildernessBosses:requireDiary": {
      type: "boolean", label: "Wilderness boss lairs need the diary", default: true,
      help: "As on the Wiki, each lair needs the medium Wilderness Diary or a Slayer task for that boss. Turn off to let anyone in.",
    },
  },
  members: true,
  register(api) {
    Common.attach(api);
    Hud.attach(api);
    EscapeCaves.attach(api);
    Caves.attach(api);
    Loot.attach(api, { addDiscount: Caves.addDiscount, playersIn: Caves.playersIn });
    Traps.attach(api, { playersIn: Caves.playersIn });
    Bears.attach(api);
    Vetion.attach(api);
    Spiders.attach(api);
    Scorpia.attach(api);
    Commands.attach(api);
  },
};
