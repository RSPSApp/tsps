/**
 * The Alchemical Hydra (https://oldschool.runescape.wiki/w/Alchemical_Hydra), from
 * plugins/bosses/data/alchemical-hydra.json: its private chamber in Karuulm Slayer Dungeon, the
 * four-phase fight with its vents, poison, lightning and fire, and the kill. Each lives in
 * ./alchemicalhydra/.
 */
const Common = require("./alchemicalhydra/Common.AlchemicalHydra");
const Lair = require("./alchemicalhydra/Lair.AlchemicalHydra");
const Combat = require("./alchemicalhydra/Combat.AlchemicalHydra");
const Kills = require("./alchemicalhydra/Kills.AlchemicalHydra");

module.exports = {
  name: "AlchemicalHydra",
  description: "The Alchemical Hydra in Karuulm Slayer Dungeon: its private chamber, four-phase fight with vents, poison, lightning and fire, and the kill.",
  members: true,
  register(api) {
    Common.init(api);
    Lair.attach(api);
    Combat.attach(api);
    Kills.attach(api);
  },
};
