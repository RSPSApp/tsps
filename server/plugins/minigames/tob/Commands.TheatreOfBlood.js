"use strict";

/** Developer commands for testing the Theatre of Blood. */

const Shared = require("./TobShared");
const Raid = require("./TobRaid");

/** ::tob - to Ver Sinhaza, by the notice board. */
function toVerSinhaza({ player }) {
  player.moveTo(Shared.loc({ x: 3667, y: 3219, z: 0 }));
  return true;
}

/** ::tobcomplete - completes the room your party has reached. */
function completeRoom({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid?.room) {
    player.sendMessage("You're not in the Theatre of Blood.");
    return true;
  }
  raid.room.start();
  raid.room.complete();
  return true;
}

/** ::tobroom <MAIDEN|BLOAT|NYLOCAS|SOTETSEG|XARPUS|VERZIK|REWARDS> - moves your party to a room. */
function jumpToRoom({ player, parts }) {
  const raid = Raid.raidOf(player);
  const key = String(parts?.[1] ?? "").toUpperCase();
  if (!raid || !Shared.ROOMS[key]) {
    player.sendMessage(`Use ::tobroom <${Shared.ROOM_ORDER.join("|")}> inside the Theatre of Blood.`);
    return true;
  }
  const room = raid.buildRoom(key);
  for (const member of raid.players) raid.follow(member);
  player.sendMessage(`Your party moves to ${room.def.name}.`);
  return true;
}

module.exports = function registerTheatreCommands(api) {
  const { DEVELOPER } = api.core.PlayerRights;
  api.registerCommand("tob", toVerSinhaza, DEVELOPER);
  api.registerCommand("tobcomplete", completeRoom, DEVELOPER);
  api.registerCommand("tobroom", jumpToRoom, DEVELOPER);
};
