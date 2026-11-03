"use strict";

/**
 * The Grand Tree's front doors (Tree Door 1967 west leaf, 1968 east leaf; 2x1 scenery).
 *
 * As captured (rsprox 1150 tick 3209, 3434 tick 77, 4263 tick 692): Open swaps only the clicked
 * leaf for its open model in place (1967 -> 1969, 1968 -> 1970, same tile, shape and rotation)
 * with door sound 62. The player waits that tick, then walks across the doorway a tile a tick:
 * onto the door's row, then the row past it. Five ticks after opening, the leaf is shut again.
 * The open leaves block like the closed ones, so the crossing is a forced walk.
 */

const ObstacleRunner = require("../skills/agility/ObstacleRunner.Agility");

/** Cache-nameless open leaves: the closed leaf's id + 2, same size, model 1352. */
const TREE_DOOR_OPEN = 1969;
const TREE_DOOR_2_OPEN = 1970;
const SCENERY_SHAPE = 10;
const SHUT_TICKS = 5;

let core;
let OPEN_IDS;

/** Leaves swung open right now: [tile key, private area] pairs. */
const openLeaves = [];

function defineDoors({ ObjectIdentifiers: O }) {
  OPEN_IDS = new Map([[O.TREE_DOOR, TREE_DOOR_OPEN], [O.TREE_DOOR_2, TREE_DOOR_2_OPEN]]);
}

/**
 * The tile column the player crosses: the leaf's tile beside the doorway's middle. The west
 * leaf (rotation 0) is crossed on its east tile, the east leaf (rotation 2) on its own tile.
 */
function crossingX(x, face) {
  return (face & 0x3) === 0 ? x + 1 : x;
}

/** From the side the player stands on to the row past the door, a tile a tick. */
function crossingPath(from, x, y, face) {
  const column = crossingX(x, face);
  const north = from.getY() > y;
  const path = [];
  if (from.getX() !== column) path.push([column, from.getY()]);
  path.push([column, y], [column, north ? y - 1 : y + 1]);
  return path;
}

function leaf(id, x, y, z, face, privateArea) {
  return new core.GameObject(id, new core.Location(x, y, z), SCENERY_SHAPE, face, privateArea);
}

function shutLater(entry, closed, opened) {
  const task = new core.Task(SHUT_TICKS, entry[0]);
  task.execute = () => {
    task.stop();
    openLeaves.splice(openLeaves.indexOf(entry), 1);
    core.ObjectManager.deregister(opened, true);
    core.ObjectManager.register(closed, true);
  };
  core.TaskManager.submit(task);
}

function openLeaf(player, objectId, x, y, z, face) {
  const privateArea = player.getPrivateArea?.() ?? null;
  const key = `${x},${y},${z}`;
  if (openLeaves.some(([openKey, area]) => openKey === key && area === privateArea)) return;
  const entry = [key, privateArea];
  openLeaves.push(entry);
  const closed = leaf(objectId, x, y, z, face, privateArea);
  const opened = leaf(OPEN_IDS.get(objectId), x, y, z, face, privateArea);
  core.ObjectManager.deregister(closed, true);
  core.ObjectManager.register(opened, true);
  core.Sounds.sendSound(player, core.Sound.DOOR_OPEN);
  shutLater(entry, closed, opened);
}

/** `door:toggle` is emitted by Doors.plugin.js before it swings a door. */
function crossTreeDoor(event) {
  if (event.handled || !event.player || !event.object || !OPEN_IDS.has(event.objectId)) return;
  const { player, object } = event;
  event.handled = true;
  if (ObstacleRunner.isBusy(player)) return;
  const location = object.getLocation();
  const [x, y, z] = [location.getX(), location.getY(), location.getZ()];
  const face = Number(object.getFace?.() ?? 0) & 0x3;
  openLeaf(player, event.objectId, x, y, z, face);
  ObstacleRunner.run({ player }, [{ wait: 1 }, { walk: crossingPath(player.getLocation(), x, y, face) }]);
}

module.exports = {
  name: "GrandTree",
  members: true,
  _test: { crossTreeDoor, crossingPath, openLeaves },
  register(pluginApi) {
    core = pluginApi.core;
    defineDoors(core);
    ObstacleRunner.init(pluginApi);
    pluginApi.onCustomEvent("door:toggle", crossTreeDoor);
  },
};
