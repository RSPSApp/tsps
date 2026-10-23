"use strict";

/**
 * ::gotr <status|tele|skip|power N|win|lose|points E C> - testing the game without waiting for it.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");
const Records = require("./Records.GuardiansOfTheRift");

const USAGE = "Use ::gotr <status|tele|skip|power N|win|lose|points E C>.";

function status(player) {
  player.sendMessage(Game.describe());
}

function teleport(player) {
  player.moveTo(Shared.location(Shared.LOBBY_TILE));
}

function power(player, percent) {
  if (!Game.isRunning()) {
    player.sendMessage("No game is running. ::gotr skip opens the rift.");
    return;
  }
  Game.setPower(percent);
  status(player);
}

function points(player, elemental, catalytic) {
  Records.setPoints(player, elemental, catalytic);
  player.sendMessage(`Points: ${elemental} elemental, ${catalytic} catalytic.`);
}

function gotr({ player, parts }) {
  const action = String(parts?.[1] ?? "status").toLowerCase();
  const value = Number(parts?.[2]);
  if (action === "status") status(player);
  else if (action === "tele") teleport(player);
  else if (action === "skip") {
    Game.skip();
    status(player);
  } else if (action === "power" && Number.isFinite(value)) power(player, value);
  else if (action === "win") power(player, 100);
  else if (action === "lose") power(player, 0);
  else if (action === "points" && Number.isFinite(value)) points(player, value, Number(parts?.[3]) || 0);
  else player.sendMessage(USAGE);
  return true;
}

module.exports = {
  attach(api) {
    api.registerCommand("gotr", gotr, api.core.PlayerRights.OWNER, "Guardians of the Rift: status, tele, skip, power N, win, lose, points E C");
  },
};
