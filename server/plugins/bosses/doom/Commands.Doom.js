"use strict";

/** Developer commands for the Doom of Mokhaiotl. */

const Shared = require("./DoomShared");
const Run = require("./DoomRun");

function toLobby({ player }) {
  player.moveTo(Shared.loc(Shared.TILES.LOBBY));
  return true;
}

/** ::doomdelve <level>: a run starting at that delve (the burrow hole's flow from there). */
function startAt({ player, parts }) {
  const level = Math.max(1, Math.trunc(Number(parts?.[1]) || 1));
  const run = Run.runOf(player) ?? Run.start(player);
  if (run.stage !== "waiting") player.sendMessage("Only before the Doom has surfaced.");
  else {
    run.startedAt = level;
    run.level = level;
    run.place(run.tile(level > 1 ? Shared.TILES.DESCENT : Shared.TILES.ARRIVAL));
    run.startLevel(level);
  }
  return true;
}

/** ::doomkill: beats the Doom of the current delve. */
function kill({ player }) {
  const run = Run.runOf(player);
  if (run?.stage !== "fight") player.sendMessage("The Doom isn't up.");
  else run.defeated();
  return true;
}

module.exports = function registerDoomCommands(api) {
  Shared.bind(api);
  const { PlayerRights } = api.core;
  api.registerCommand("doom", toLobby, PlayerRights.DEVELOPER, "Teleport to the Doom lobby");
  api.registerCommand("doomdelve", startAt, PlayerRights.DEVELOPER, "Start at a chosen delve level");
  api.registerCommand("doomkill", kill, PlayerRights.DEVELOPER, "Defeat the current Doom delve");
};

Object.assign(module.exports, { toLobby, startAt, kill });
