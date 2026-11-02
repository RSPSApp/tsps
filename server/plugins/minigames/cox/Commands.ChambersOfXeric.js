"use strict";

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");

/** ::cox - to Mount Quidamortem, by the recruiting board. */
function toMount({ player }) {
  player.moveTo(Shared.loc({ x: 1234, y: 3566 }));
  return true;
}

/** ::coxlayout - the raid's layout and the room you are in. */
function showLayout({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid?.map) {
    player.sendMessage("You are not in a raid.");
    return true;
  }
  player.sendMessage(`Layout: ${raid.layout.challenge ? "Challenge Mode" : raid.layout.pattern}`);
  raid.layout.floors.forEach((floor, index) => {
    player.sendMessage(`Floor ${index + 1}: ${floor.map((chunk) => chunk.room).join(", ")}`);
  });
  const corners = raid.rooms.filter((entry) => entry.record.gridX !== undefined)
    .map((entry) => `${entry.record.index}:${entry.key}@${raid.map.getBaseX() + entry.record.gridX * 32},${raid.map.getBaseY() + entry.record.gridY * 32},${entry.record.plane}`);
  player.sendMessage(`Rooms: ${corners.join(" ")}`);
  const room = raid.roomAt(player.getLocation());
  player.sendMessage(`You are in: ${room ? `${room.key} (version ${room.record.variant}, turned ${room.record.rotation})` : "no room"}`);
  return true;
}

/** ::coxpoints <amount> - gives you points in your raid. */
function givePoints({ player, parts }) {
  const raid = Raid.raidOf(player);
  const amount = Math.trunc(Number(parts?.[1]));
  if (!raid || !(amount > 0)) {
    player.sendMessage("Use ::coxpoints <amount> inside a started raid.");
    return true;
  }
  raid.addPoints(player, amount);
  return true;
}

/** ::coxnext - to the next floor's start (or the Olm's chamber). */
function nextFloor({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid?.map) return true;
  const plane = player.getLocation().getZ();
  const end = raid.rooms.find((room) => room.key === "FLOOR_END_DOWNSTAIRS" && room.record.plane === plane);
  if (end?.record.bound) player.moveTo(raid.map.landing(end.record.bound));
  return true;
}

/** ::coxclear - completes the room you are in: a puzzle's own ending, or its monsters go and its exit opens. */
function clearRoom({ player }) {
  const raid = Raid.raidOf(player);
  const room = raid?.roomAt(player.getLocation());
  if (!room || raid.stage === Raid.STAGE.WAITING) {
    player.sendMessage("Use ::coxclear in a room of a started raid.");
    return true;
  }
  if (room.devFinish) {
    room.devFinish(player);
  } else {
    room.cleanup();
    room.clearExit();
  }
  player.sendMessage(`Cleared ${room.key}.`);
  return true;
}

module.exports = function registerCoxCommands(api) {
  const { DEVELOPER } = api.core.PlayerRights;
  api.registerCommand("cox", toMount, DEVELOPER);
  api.registerCommand("coxlayout", showLayout, DEVELOPER);
  api.registerCommand("coxpoints", givePoints, DEVELOPER);
  api.registerCommand("coxnext", nextFloor, DEVELOPER);
  api.registerCommand("coxclear", clearRoom, DEVELOPER);
};
