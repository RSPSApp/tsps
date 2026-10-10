"use strict";

/**
 * Mage Arena (https://oldschool.runescape.wiki/w/Mage_Arena), the deep-Wilderness magic
 * minigame: the battle mages and their god-spell aggression, the arena levers and sparkling
 * pools, the god statues that hand out capes, and the 100-cast charging that unlocks each god
 * spell outside the arena. Units live in ./magearena/. The Mage Arena bank's lever pair, bank
 * chest, deposit box, Kolodion and the Chamber guardian's staff shop are already world content
 * (shops.json binds shop 1225 to NPC 1602), so nothing here duplicates them.
 */
const BattleMages = require("./magearena/BattleMages.MageArena");
const Levers = require("./magearena/Levers.MageArena");
const Spells = require("./magearena/Spells.MageArena");
const Statues = require("./magearena/Statues.MageArena");

module.exports = {
  name: "MageArena",
  members: true,
  register(api) {
    BattleMages(api);
    Levers(api);
    Spells(api);
    Statues(api);
  },
  _test: {
    battleMages: BattleMages._test,
    levers: Levers._test,
    spells: Spells._test,
    statues: Statues._test,
  },
};
