"use strict";

/**
 * Castle Wars climbing ropes.
 *
 * A rope used on a castle's battlements hangs a climbing rope down the outside of the wall.
 * It only goes up and can't be cut down (OSRS Wiki: Castle Wars), so it stays until the game
 * ends.
 *
 * Cache locs: battlements 4446 (Saradomin) / 4447 (Zamorak), climbing rope 4444.
 * RSPS-only (Near-Reality): the rope's tile (the ground tile outside the battlement) and its
 * rotation - check them in game.
 */

const { Anim } = require("../../skills/agility/constants");

const ROPE_OBJECT_TYPE = 4;
const COORD_OFFSETS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

let game;
let core;

// rope tile key -> the battlement tile it climbs to
const ropes = new Map();

const tileKey = (location) => `${location.getX()},${location.getY()}`;

function hangRope(event) {
  const { player, object, itemSlot } = event;
  if (!game.isPlaying(player)) {
    return false;
  }
  const battlement = object.getLocation();
  const face = object.getFace() & 3;
  const [dx, dy] = COORD_OFFSETS[face];
  const ropeTile = new core.Location(battlement.getX() + dx, battlement.getY() + dy, 0);
  if (ropes.has(tileKey(ropeTile))) {
    player.sendMessage("There's already a rope there.");
    return true;
  }
  player.getInventory().deleteAtSlot(itemSlot, 1);
  game.swapObject(null, new core.GameObject(core.ObjectIdentifiers.CLIMBING_ROPE_5, ropeTile, ROPE_OBJECT_TYPE, (face + 2) & 3, null));
  ropes.set(tileKey(ropeTile), new core.Location(battlement.getX(), battlement.getY(), battlement.getZ()));
  return true;
}

function climbRope({ player, object }) {
  const top = ropes.get(tileKey(object.getLocation()));
  if (!top || !game.isPlaying(player)) {
    return false;
  }
  player.performAnimation(new core.Animation(Anim.CLIMB_UP));
  game.later(1, () => player.moveTo(top));
  return true;
}

function forgetRopes() {
  ropes.clear();
}

module.exports = function attachCastleWarsRopes(api, castleWars) {
  game = castleWars;
  core = api.core;
  api.onItemOnObject("Rope", "Battlements", hangRope);
  api.onObjectInteraction("Climbing Rope", { Climb: climbRope });
  api.onCustomEvent("castlewars:reset", forgetRopes);
};
