"use strict";

/**
 * The Temple of the Eye as an Area: who is in it, and what happens when a player in the game
 * leaves it.
 *
 * - Players in the game stay in it through altar trips (the Portal Guardians send them to the
 *   altars and the altars' portals bring them back); any other way out of the temple ends their
 *   game and takes its items (Wiki: fragments, essence and portal talismans can't leave).
 * - A login inside the game's side of the temple starts in the lobby, as nobody can be in a
 *   game they weren't in when it opened; game items left on a player are taken at login.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");

/** Units that send players out of the temple and back (altar trips) say who may be away. */
const awayChecks = [];
const visitors = new Set();
/** Absent players are checked this often, not every tick. */
const AWAY_CHECK_TICKS = 5;
let awayTimer = 0;

function allowAway(check) {
  awayChecks.push(check);
}

function mayBeAway(player) {
  return awayChecks.some((check) => check(player));
}

function inTemple() {
  return [...visitors];
}

function enterTemple(player) {
  visitors.add(player);
}

function leaveTemple(player, logout) {
  visitors.delete(player);
  if (logout || !Game.isPlaying(player) || mayBeAway(player)) return;
  Game.leave(player);
}

/** A player in the game who ended up neither in the temple nor on an altar trip is out of it. */
function checkAway() {
  if (++awayTimer < AWAY_CHECK_TICKS) return;
  awayTimer = 0;
  for (const player of Game.players()) {
    if (!player.isRegistered?.()) continue;
    if (Shared.inTemple(player.getLocation()) || mayBeAway(player)) continue;
    Game.leave(player);
  }
}

function login({ player }) {
  Shared.setVarbit(player, Shared.VARBIT.IS_PLAYING, 0);
  Shared.setVarbit(player, Shared.VARBIT.FINISHED_GAME, 0);
  Shared.setVarp(player, Shared.VARP.GAME_ID, 0);
  Shared.setVarbit(player, Shared.VARBIT.PORTAL_BOTTOM_VISIBLE, 0);
  // Temple of the Eye's tutorial uses the same items, and keeps them over a relog.
  if (Shared.questComplete(player)) {
    Shared.removeItems(player, Shared.GAME_ITEMS);
    Shared.api().emitCustomEvent("runecrafting:remove-guardian-essence", { player });
  }
  if (Shared.inGameSide(player.getLocation())) player.moveTo(Shared.location(Shared.LOBBY_TILE));
}

function logout({ player }) {
  visitors.delete(player);
  Game.leave(player);
}

function createArea() {
  const { Area, Boundary } = Shared.core();
  const temple = Shared.TEMPLE;
  class TempleOfTheEye extends Area {
    postEnter(mobile) {
      if (mobile.isPlayer()) enterTemple(mobile.getAsPlayer());
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer()) leaveTemple(mobile.getAsPlayer(), logout);
    }
  }
  return new TempleOfTheEye([new Boundary(temple.minX, temple.maxX, temple.minY, temple.maxY, temple.z)]);
}

module.exports = {
  allowAway, inTemple,
  attach(api) {
    api.registerArea(createArea());
    api.onPlayerLogin(login);
    api.onPlayerLogout(logout);
    Game.on("tick", checkAway);
  },
};
