/** Motherlode Mine: changing its locs and playing sounds to the players nearby. */
const { GameObject } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { ObjectManager } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/ObjectManager");
const { MapObjects } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { World } = require("../../../src/main/typescript/elvarg/game/World");

/** How far away a player still hears the mine's area sounds and sees its projectiles. */
const VIEW_DISTANCE = 15;

function loc(id, [x, y], type, face) {
  return new GameObject(id, new Location(x, y, 0), type, face, null);
}

/**
 * Replaces `from` with `to` on its tile, sending only the new loc (OSRS sends a vein depleting
 * or a strut breaking as one loc add). Remove the old one first so its clipping goes before the
 * new one's is added.
 */
function swapLoc(from, to) {
  MapObjects.remove(from);
  ObjectManager.deregister(from, false);
  ObjectManager.register(to, true);
}

/** The loc with this id on the tile, if any (map or spawned). */
function findLoc(id, [x, y]) {
  return MapObjects.get(id, new Location(x, y, 0), null);
}

function nearbyPlayers(x, y, z = 0, distance = VIEW_DISTANCE) {
  const players = [];
  for (const player of World.getPlayers()) {
    if (!player) continue;
    const at = player.getLocation();
    if (at.getZ() === z && Math.abs(at.getX() - x) <= distance && Math.abs(at.getY() - y) <= distance) {
      players.push(player);
    }
  }
  return players;
}

function areaSound(soundId, [x, y], { delay = 0, radius = 5 } = {}) {
  for (const player of nearbyPlayers(x, y)) {
    player.getPacketSender().sendAreaSound(soundId, x, y, 0, 1, delay, radius);
  }
}

module.exports = { loc, swapLoc, findLoc, nearbyPlayers, areaSound, ObjectManager };
