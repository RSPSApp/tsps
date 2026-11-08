"use strict";

const Prizes = require("./Prizes.Construction");
const RangingGames = require("./RangingGames.Construction");
const Hangman = require("./Hangman.Construction");
const ElementalBalance = require("./ElementalBalance.Construction");
const AttackStone = require("./AttackStone.Construction");
const Jester = require("./Jester.Construction");
const TreasureHunt = require("./TreasureHunt.Construction");

// The games room: its prize chest and each game's own unit.

/** Instance.rebuild: building mode packs every game away. */
function resetGames(house) {
  if (!house.buildingMode) return;
  RangingGames.resetGames(house);
  Hangman.resetHangman(house);
  ElementalBalance.resetBalance(house);
  AttackStone.resetStone(house);
  Jester.resetJester(house);
  TreasureHunt.resetHunt(house);
}

/** House.leftHouse */
function leftGamesRoom(player, house) {
  RangingGames.leftGames(player, house);
  TreasureHunt.leftHunt(player);
}

/** Instance.canCastOnNpc */
function castOnGame(player, npc, spell) {
  return ElementalBalance.castOnBalance(player, npc, spell);
}

function attachGamesRoom(api) {
  Prizes.attachPrizes(api);
  RangingGames.attachRangingGames(api);
  Hangman.attachHangman(api);
  ElementalBalance.attachElementalBalance(api);
  AttackStone.attachAttackStone(api);
  Jester.attachJester(api);
  TreasureHunt.attachTreasureHunt(api);
}

Object.assign(module.exports, { attachGamesRoom, resetGames, leftGamesRoom, castOnGame });
