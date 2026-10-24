/**
 * Mage Training Arena (https://oldschool.runescape.wiki/w/Mage_Training_Arena), from
 * plugins/minigames/data/mage-training-arena.json: the entrance hall with its guardian and the
 * Pizazz Progress Hat, the Pizazz Points, and the Enchanting Chamber. Each lives in
 * ./magetrainingarena/.
 */
const Common = require("./magetrainingarena/Common.MageTrainingArena");
const Guardians = require("./magetrainingarena/Guardians.MageTrainingArena");
const Lobby = require("./magetrainingarena/Lobby.MageTrainingArena");
const Enchanting = require("./magetrainingarena/Enchanting.MageTrainingArena");

module.exports = {
  name: "MageTrainingArena",
  members: true,
  register(api) {
    Common.init(api);
    Guardians.attach(api);
    Lobby.attach(api);
    Enchanting.attach(api);
  },
};
