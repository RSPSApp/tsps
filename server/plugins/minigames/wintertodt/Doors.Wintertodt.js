"use strict";

/**
 * The Doors of Dinh and the HUD around them.
 *
 * Live captures: the doors fade the screen out, move you two ticks later and fade back in; the
 * HUD (interface 396) is up inside the prison and in the camp, script 1433 showing the points
 * and warmth inside and 1432 hiding them outside. Leaving between rounds asks nothing.
 * Wiki: 50 Firemaking opens the doors, Peek shows the energy and the players inside, and leaving
 * or logging out mid-round loses every point earned in it.
 */

const Shared = require("./WintertodtShared");
const Round = require("./WintertodtRound");
const Warmth = require("./WintertodtWarmth");

function enter(event) {
  const { player } = event;
  if (Round.inPrison(player)) {
    leave(player);
    return true;
  }
  if (Shared.firemakingLevel(player) < Shared.FIREMAKING_REQUIRED) {
    Shared.statement(player, `You require at least ${Shared.FIREMAKING_REQUIRED} Firemaking to take on the Wintertodt.`);
    return true;
  }
  Shared.fadeMove(player, Shared.randomTile(Shared.ENTER_AREA));
  return true;
}

function leave(player) {
  const exit = () => Shared.fadeMove(player, Shared.randomTile(Shared.EXIT_AREA));
  if (!Round.isActive()) {
    exit();
    return;
  }
  Shared.options(player, "Are you sure you want to leave?",
    "Leave and lose all progress.", exit,
    "Stay.", () => {});
}

function peek(event) {
  const inside = Round.playersInPrison().length;
  const players = inside === 1 ? "is 1 player" : `are ${inside === 0 ? "no" : inside} players`;
  Shared.statement(event.player, `The Wintertodt has ${Round.energyPercent()}% energy left. There ${players} within the prison.`);
  return true;
}

/** One place decides the HUD, so the order the zone hooks fire in doesn't matter. */
function syncHud({ player }) {
  const location = player.getLocation();
  if (Shared.inZone(Shared.PRISON_ZONE, location)) Round.openHud(player, true);
  else if (Shared.inZone(Shared.CAMP_ZONE, location)) Round.openHud(player, false);
  else Round.closeHud(player);
}

/** Into the prison: the warmth meter starts full. */
function enteredPrison(event) {
  Warmth.enter(event.player);
  syncHud(event);
}

/** Out of the prison: the round's points are lost and its supplies vanish. */
function leftPrison(event) {
  const { player } = event;
  Round.forgetPlayer(player);
  Shared.stopAction(player);
  Warmth.leave(player);
  Shared.removeItems(player, Shared.PRISON_ITEMS);
  syncHud(event);
}

/** Nobody wakes up inside the prison: a login there puts you back outside the doors. */
function login({ player }) {
  Round.syncVars(player);
  Shared.removeItems(player, Shared.PRISON_ITEMS);
  if (Round.inPrison(player)) player.moveTo(Shared.randomTile(Shared.EXIT_AREA));
}

/** Logging out loses the round's points and the prison's supplies, before the save. */
function logout({ player }) {
  Round.forgetPlayer(player);
  Shared.stopAction(player);
  if (Round.inPrison(player)) Shared.removeItems(player, Shared.PRISON_ITEMS);
  Round.closeHud(player);
}

module.exports = function registerWintertodtDoors(api) {
  Shared.bind(api);
  api.persistAttribute(Round.ATTR_KILLS);
  api.persistAttribute(Round.ATTR_REWARDS);
  api.onServerStartup(Round.start);
  api.onObjectInteraction(Shared.OBJECT.DOORS, { Enter: enter, Peek: peek });
  api.onZoneEnter(Shared.PRISON_ZONE, enteredPrison);
  api.onZoneExit(Shared.PRISON_ZONE, leftPrison);
  api.onZoneEnter(Shared.CAMP_ZONE, syncHud);
  api.onZoneExit(Shared.CAMP_ZONE, syncHud);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
};
