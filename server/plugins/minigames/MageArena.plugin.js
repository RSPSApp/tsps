"use strict";

/**
 * Mage Arena (https://oldschool.runescape.wiki/w/Mage_Arena), the deep-Wilderness magic
 * minigame: the battle mages and their god-spell aggression, the arena levers and sparkling
 * pools, the god statues that hand out capes, and the 100-cast charging that unlocks each god
 * spell outside the arena, Kolodion, and the Mage Arena II miniquest (the Enchanted symbol, the
 * three followers and imbuing the god capes). Units live in
 * ./magearena/. The Mage Arena bank's lever pair, bank chest, deposit box and the Chamber
 * guardian's staff shop are already world content (shops.json binds shop 1225 to NPC 1602), so
 * nothing here duplicates them.
 */
const BattleMages = require("./magearena/BattleMages.MageArena");
const Followers = require("./magearena/Followers.MageArena");
const Kolodion = require("./magearena/Kolodion.MageArena");
const MageArenaII = require("./magearena/MageArenaII.MageArena");
const Levers = require("./magearena/Levers.MageArena");
const Spells = require("./magearena/Spells.MageArena");
const Statues = require("./magearena/Statues.MageArena");
const EnchantedSymbol = require("./magearena/Symbol.MageArena");

module.exports = {
  name: "MageArena",
  description: "Adds the Mage Arena: battle mages, levers and pools, the god statues' capes, the 100-cast charging for each god spell, Kolodion and the Mage Arena II miniquest.",
  members: true,
  register(api) {
    BattleMages(api);
    MageArenaII(api);
    Followers(api);
    Kolodion(api);
    Levers(api);
    Spells(api);
    Statues(api);
    EnchantedSymbol(api);
  },
  _test: {
    battleMages: BattleMages._test,
    followers: Followers._test,
    kolodion: Kolodion._test,
    mageArenaII: MageArenaII._test,
    levers: Levers._test,
    spells: Spells._test,
    statues: Statues._test,
    symbol: EnchantedSymbol._test,
  },
};
