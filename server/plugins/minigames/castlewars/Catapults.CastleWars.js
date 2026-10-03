"use strict";

/**
 * Castle Wars catapults.
 *
 * A team fires its own catapult with a rock from the supply tables, aiming with the
 * coordinates on the catapult interface (0-30 each way). Everyone in the 5x5 landing area
 * takes 5-15 damage, whichever team they are on (OSRS Wiki: Catapult (Castle Wars)). An
 * explosive potion breaks the enemy catapult; a toolkit repairs your own.
 *
 * Interface 54 (InterfaceID.CastlewarsCatapult): X up/down 18/19, Z up/down 6/7, fire 5,
 * coordinate digits 22/25 (horizontal) and 10/13 (vertical), target marker 17 on the 240px map.
 * Cache locs: catapults 4382 (2413,3088) and 4381 (2384,3117), broken 4385/4386. They stand on
 * bridge tiles, so the server loads them on plane 0.
 * RSPS-only (Near-Reality): the landing-tile mapping, digit models 4863-4872, projectile 304
 * and the marker's 2px-per-click track - check them in game. The Zamorak marker starts at the
 * cache's own marker position; the Saradomin one is NR's start offset from it.
 */

const CATAPULT_INTERFACE = 54;
const BUTTON = { FIRE: 5, Z_UP: 6, Z_DOWN: 7, X_UP: 18, X_DOWN: 19 };
const DIGIT = { V_TENS: 10, V_UNITS: 13, H_TENS: 22, H_UNITS: 25 };
const MARKER = 17;
const MARKER_PIXELS_PER_CLICK = 2;
const DIGIT_ZERO_MODEL = 4863;
const MAX_CLICKS = 30;
const SPLASH_RADIUS = 2;
const SPLASH_MIN = 5;
const SPLASH_MAX = 15;
const ROCK_PROJECTILE = 304;
const ROCK_FLIGHT_TICKS = 3;

let game;
let core;

const aims = new WeakMap();

const uid = (child) => (CATAPULT_INTERFACE << 16) | child;

function catapults() {
  const O = core.ObjectIdentifiers;
  return {
    [game.TEAM.SARADOMIN]: { id: O.CATAPULT_5, brokenId: O.CATAPULT_6, face: 3, from: [2414, 3089], landing: [2412, 3091], marker: [167, 168], step: -1 },
    [game.TEAM.ZAMORAK]: { id: O.CATAPULT_4, brokenId: O.CATAPULT_7, face: 1, from: [2385, 3118], landing: [2387, 3116], marker: [60, 59], step: 1 },
  };
}

function ownerOf(objectId) {
  const all = catapults();
  return Object.keys(all).find((teamId) => all[teamId].id === objectId || all[teamId].brokenId === objectId) ?? null;
}

function catapultObject(teamId, broken, location) {
  const catapult = catapults()[teamId];
  return new core.GameObject(broken ? catapult.brokenId : catapult.id, location, broken ? 10 : 11, catapult.face, null);
}

function showAim(player) {
  const { horizontal, vertical, teamId } = aims.get(player);
  const { marker, step } = catapults()[teamId];
  const sender = player.getPacketSender();
  // The marker tracks the landing tile: east/south for Zamorak, west/north for Saradomin.
  sender.sendInterfacePosition(
    uid(MARKER),
    marker[0] + step * MARKER_PIXELS_PER_CLICK * horizontal,
    marker[1] + step * MARKER_PIXELS_PER_CLICK * vertical
  );
  sender.sendInterfaceRawModel(uid(DIGIT.H_TENS), DIGIT_ZERO_MODEL + Math.floor(horizontal / 10));
  sender.sendInterfaceRawModel(uid(DIGIT.H_UNITS), DIGIT_ZERO_MODEL + (horizontal % 10));
  sender.sendInterfaceRawModel(uid(DIGIT.V_TENS), DIGIT_ZERO_MODEL + Math.floor(vertical / 10));
  sender.sendInterfaceRawModel(uid(DIGIT.V_UNITS), DIGIT_ZERO_MODEL + (vertical % 10));
}

function operateCatapult({ player, objectId }) {
  const owner = ownerOf(objectId);
  if (!owner) {
    return false;
  }
  if (!game.requirePlaying(player)) {
    return true;
  }
  if (game.getTeamId(player) !== owner) {
    player.sendMessage("You can't use the other team's catapult.");
    return true;
  }
  if (!player.getInventory().contains(core.ItemIdentifiers.ROCK_5)) {
    player.sendMessage("You need a rock to launch from the catapult.");
    return true;
  }
  aims.set(player, { horizontal: 0, vertical: 0, teamId: owner });
  const sender = player.getPacketSender();
  sender.sendInterface(CATAPULT_INTERFACE);
  for (const child of Object.values(BUTTON)) {
    sender.sendInterfaceFlags(uid(child), 1 << 1);
  }
  showAim(player);
  return true;
}

function adjustAim({ player, buttonId }) {
  const aim = aims.get(player);
  if (!aim) {
    return false;
  }
  const child = buttonId & 0xffff;
  const change = { [BUTTON.X_UP]: ["horizontal", 1], [BUTTON.X_DOWN]: ["horizontal", -1], [BUTTON.Z_UP]: ["vertical", 1], [BUTTON.Z_DOWN]: ["vertical", -1] }[child];
  if (change) {
    aim[change[0]] = Math.max(0, Math.min(MAX_CLICKS, aim[change[0]] + change[1]));
    showAim(player);
  }
  return true;
}

function landingTile({ horizontal, vertical, teamId }) {
  const { landing, step } = catapults()[teamId];
  return new core.Location(landing[0] + step * Math.trunc(horizontal / 2), landing[1] - step * Math.trunc(vertical / 2), 0);
}

function splash(target) {
  for (const victim of game.gameArea.getPlayers()) {
    const at = victim.getLocation();
    if (at.getZ() === target.getZ() && Math.abs(at.getX() - target.getX()) <= SPLASH_RADIUS && Math.abs(at.getY() - target.getY()) <= SPLASH_RADIUS) {
      victim.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(core.Misc.randomInclusive(SPLASH_MIN, SPLASH_MAX), core.HitMask.RED)]);
    }
  }
}

function fireCatapult({ player }) {
  const aim = aims.get(player);
  aims.delete(player);
  player.getPacketSender().closeInterface(CATAPULT_INTERFACE);
  if (!aim || !game.isPlaying(player) || !player.getInventory().contains(core.ItemIdentifiers.ROCK_5)) {
    return true;
  }
  player.getInventory().delete(core.ItemIdentifiers.ROCK_5, 1);
  const target = landingTile(aim);
  const [x, y] = catapults()[aim.teamId].from;
  new core.Projectile(new core.Location(x, y, 0), target, null, ROCK_PROJECTILE, 0, 100, 50, 5, null).sendProjectile();
  game.later(ROCK_FLIGHT_TICKS, () => splash(target));
  return true;
}

function breakCatapult({ player, objectId, object, itemSlot }) {
  const owner = ownerOf(objectId);
  if (!owner || objectId !== catapults()[owner].id) {
    return false;
  }
  if (!game.requirePlaying(player)) {
    return true;
  }
  if (game.getTeamId(player) === owner) {
    player.sendMessage("You don't want to destroy your team's catapult.");
    return true;
  }
  player.getInventory().deleteAtSlot(itemSlot, 1);
  game.swapObject(object, catapultObject(owner, true, object.getLocation()));
  game.setTeamVar(owner, game.TEAM_VARBIT.CATAPULT_BROKEN, 1);
  return true;
}

function repairCatapult({ player, objectId, object }) {
  const owner = ownerOf(objectId);
  if (!owner || objectId !== catapults()[owner].brokenId) {
    return false;
  }
  if (!game.requirePlaying(player)) {
    return true;
  }
  if (game.getTeamId(player) !== owner) {
    player.sendMessage("You don't want to repair the other team's catapult.");
    return true;
  }
  if (!player.getInventory().contains(core.ItemIdentifiers.TOOLKIT_2)) {
    player.sendMessage("You need a toolkit to repair the catapult.");
    return true;
  }
  game.swapObject(object, catapultObject(owner, false, object.getLocation()));
  game.setTeamVar(owner, game.TEAM_VARBIT.CATAPULT_BROKEN, 0);
  return true;
}

module.exports = function attachCastleWarsCatapults(api, castleWars) {
  game = castleWars;
  core = api.core;
  api.onObjectInteraction("Catapult", { Operate: operateCatapult, Repair: repairCatapult });
  api.onItemOnObject("Explosive potion", "Catapult", breakCatapult);
  api.onItemOnObject("Toolkit", "Catapult", repairCatapult);
  api.onInterfaceActionButton([uid(BUTTON.X_UP), uid(BUTTON.X_DOWN), uid(BUTTON.Z_UP), uid(BUTTON.Z_DOWN)], adjustAim);
  api.onInterfaceActionButton(uid(BUTTON.FIRE), fireCatapult);
};
