"use strict";

/**
 * Mage Arena (https://oldschool.runescape.wiki/w/Mage_Arena), the deep-Wilderness magic
 * minigame: the battle mages and their god-spell aggression, the arena levers and sparkling
 * pools, the god statues that hand out capes, and the 100-cast charging that unlocks each god
 * spell outside the arena, and which of Kolodion's transcript branches plays. Units live in
 * ./magearena/. The Mage Arena bank's lever pair, bank chest, deposit box and the Chamber
 * guardian's staff shop are already world content (shops.json binds shop 1225 to NPC 1602), so
 * nothing here duplicates them.
 */
const BattleMages = require("./magearena/BattleMages.MageArena");
const Kolodion = require("./magearena/Kolodion.MageArena");
const Levers = require("./magearena/Levers.MageArena");
const Spells = require("./magearena/Spells.MageArena");
const Statues = require("./magearena/Statues.MageArena");

module.exports = {
  name: "MageArena",
  description: "Adds the Mage Arena: battle mages, levers and pools, the god statues' capes and the 100-cast charging for each god spell.",
  members: true,
  register(api) {
    BattleMages(api);
    Kolodion(api);
    Levers(api);
    Spells(api);
    Statues(api);
  },
  _test: {
    battleMages: BattleMages._test,
    kolodion: Kolodion._test,
    levers: Levers._test,
    spells: Spells._test,
    statues: Statues._test,
  },
};
