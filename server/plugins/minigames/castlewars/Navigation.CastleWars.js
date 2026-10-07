"use strict";

/**
 * Getting around Castle Wars: stairs, ladders, trapdoors and the tunnel gates lead to fixed tiles
 * through the shared ladder climb; energy barriers only let their own team walk through; the
 * stepping stones hop one stone per click.
 */

const ObstacleRunner = require("../../skills/agility/ObstacleRunner");

let game;
let core;
let data;

function climbFromRoutes(player, object, routes) {
  const route = routes.find(([from]) => game.isAt(object, from[0], from[1], from[2]));
  if (!route) {
    return false;
  }
  game.climbTo(player, route[1]);
  return true;
}

function useTrapdoor(player, trapdoor) {
  if (game.getTeamId(player) === trapdoor.blockedTeam) {
    player.sendMessage(data.ENEMY_SPAWN_MESSAGE);
    return true;
  }
  game.climbTo(player, trapdoor.to);
  return true;
}

/** Stairs, ladders, trapdoors and gates; true when the object is one of the castle's. */
function climb(player, object) {
  const O = core.ObjectIdentifiers;
  const id = object.getId();
  const x = player.getLocation().getX();
  if (data.CLIMB_ROUTES[id]) {
    return climbFromRoutes(player, object, data.CLIMB_ROUTES[id]);
  }
  if (data.FIXED_MOVES[id]) {
    game.climbTo(player, data.FIXED_MOVES[id]);
    return true;
  }
  if (data.TRAPDOOR_ROUTES[id]) {
    return useTrapdoor(player, data.TRAPDOOR_ROUTES[id]);
  }
  if (id === O.STAIRCASE_17 && game.isAt(object, 2417, 3074, 0)) {
    game.climbTo(player, x === 2416 ? [2417, 3077, 0] : [2416, 3074, 0]);
    return true;
  }
  if (id === O.STAIRCASE_18 && game.isAt(object, 2382, 3131, 0)) {
    game.climbTo(player, x >= 2383 && x <= 2385 ? [2382, 3130, 0] : [2383, 3133, 0]);
    return true;
  }
  if (id === O.GATE_26) {
    game.climbTo(player, game.isAt(object, 2399, 3099, 0) ? [2399, 9500, 0] : [2400, 9507, 0]);
    return true;
  }
  return false;
}

function passEnergyBarrier(player, object, barrier) {
  if (game.getTeamId(player) !== barrier.team) {
    player.sendMessage(data.ENEMY_SPAWN_MESSAGE);
    return;
  }
  game.resetIdleTicks(player);
  const tile = game.getLocationTile(player);
  const crossing = barrier.crossings.find(([at, from]) => game.isAt(object, at[0], at[1], at[2]) && game.isAt(tile, from[0], from[1], from[2]));
  if (crossing && !ObstacleRunner.isBusy(player)) {
    // The leading wait keeps it to one tile per tick (see AlKharidGate).
    ObstacleRunner.run({ player }, [{ wait: 1 }, { walk: [[crossing[2][0], crossing[2][1]]] }]);
  }
}

/** Walk to the barrier tile on the player's side before passing through it. */
function routeToBarrier(event) {
  const barrier = data.ENERGY_BARRIERS[event.objectId];
  if (!barrier) {
    return;
  }
  const tile = event.sourceLocation;
  const distance = ([, from]) => Math.abs(from[0] - tile.x) + Math.abs(from[1] - tile.y);
  const crossing = barrier.crossings
    .filter(([at]) => game.isAt(event.object, at[0], at[1], at[2]))
    .sort((a, b) => distance(a) - distance(b))[0];
  if (crossing) {
    const [, from] = crossing;
    event.destination = { x: from[0], y: from[1], z: from[2] };
  }
}

function hopSteppingStone(player, object) {
  const tile = game.getLocationTile(player);
  const objectX = object.getLocation().getX();
  const objectY = object.getLocation().getY();
  if (objectX === tile.x && objectY === tile.y) {
    player.sendMessage("You are standing on the rock you clicked.");
    return;
  }
  const dx = Math.sign(objectX - tile.x);
  const dy = Math.sign(objectY - tile.y);
  if (dx !== 0 && dy !== 0) {
    player.sendMessage("Can't reach that.");
    return;
  }
  player.getMovementQueue().walkStep(dx, dy);
}

function useCastleObject(event) {
  const { player, object } = event;
  if (!game.inGameBounds(object.getLocation())) {
    return;
  }
  const barrier = data.ENERGY_BARRIERS[object.getId()];
  if (barrier) {
    passEnergyBarrier(player, object, barrier);
    event.handled = true;
  } else if (object.getId() === core.ObjectIdentifiers.STEPPING_STONE) {
    hopSteppingStone(player, object);
    event.handled = true;
  } else if (climb(player, object)) {
    event.handled = true;
  }
}

/** Castle stairs and ladders lead to fixed tiles; claim them before Ladders.plugin.js offers its up/down menu. */
function claimCastleClimb(request) {
  if (game.inGameBounds(request.object.getLocation())) {
    request.handled = climb(request.player, request.object);
  }
}

module.exports = function attachCastleWarsNavigation(api, castleWars) {
  game = castleWars;
  core = api.core;
  data = castleWars.data;
  ObstacleRunner.init(api);
  api.onObjectRoute(routeToBarrier);
  api.onObjectInteraction(useCastleObject);
  api.onCustomEvent("ladders:climb", claimCastleClimb);
};
