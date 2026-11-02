/**
 * Mage Training Arena (https://oldschool.runescape.wiki/w/Mage_Training_Arena), from
 * plugins/minigames/data/mage-training-arena.json: the entrance hall with its guardian and the
 * Pizazz Progress Hat, the Pizazz Points, the Telekinetic Theatre, the Enchanting Chamber, the
 * Alchemists' Playground and the Creature Graveyard. Each lives in ./magetrainingarena/.
 */
const Common = require("./magetrainingarena/Common.MageTrainingArena");
const Guardians = require("./magetrainingarena/Guardians.MageTrainingArena");
const Lobby = require("./magetrainingarena/Lobby.MageTrainingArena");
const Telekinetic = require("./magetrainingarena/Telekinetic.MageTrainingArena");
const Enchanting = require("./magetrainingarena/Enchanting.MageTrainingArena");
const Alchemists = require("./magetrainingarena/Alchemists.MageTrainingArena");
const Graveyard = require("./magetrainingarena/Graveyard.MageTrainingArena");
const Rewards = require("./magetrainingarena/Rewards.MageTrainingArena");

module.exports = {
  name: "MageTrainingArena",
  members: true,
  register(api) {
    Common.init(api);
    Common.attach(api);
    Guardians.attach(api);
    Lobby.attach(api);
    Telekinetic.attach(api);
    Enchanting.attach(api);
    Alchemists.attach(api);
    Graveyard.attach(api);
    Rewards.attach(api);
  },
};
