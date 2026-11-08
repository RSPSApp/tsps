"use strict";

/**
 * The guide signposts (aide_signpost_1, 18493: Read) by Lumbridge, Draynor and south of Falador.
 *
 * rsprox 229/02346, 229/02347 and 223/01318: Read writes the four sides' texts into interface
 * aide_compass (one placement's lines each, plugins/objects/data/signposts.json), opens it as the
 * main modal, turns the camera to face north (cam_forceangle 280, 0) and moves it six tiles south
 * of the player at height 1500, looking at three tiles north of them at height 450 (rates 2 and
 * 10). Closing the compass resets the camera.
 *
 * Read works from a distance: in 28 of the 33 recorded reads the player stood still, up to five
 * tiles from the post, and the compass opened that tick, while walkers kept walking through six
 * to nine tiles and read at five or less. So a player within READ_RANGE tiles of the post, with
 * a clear line to it, reads where they stand. Not matched: a player clicking from further away
 * walks right up to the post (the object route has no approach range to stop at five).
 */

const fs = require("node:fs");
const path = require("node:path");

const SIGNPOSTS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "signposts.json"), "utf8")).signposts;
const INTERFACE_NAME = "aide_compass";
const SIDES = { north: "aide_north_text_2", east: "aide_east_text_2", south: "aide_south_text_2", west: "aide_west_text_2" };
/** Client script cam_forceangle: pitch 280, yaw 0 (north), as recorded. */
const CAM_FORCEANGLE_SCRIPT = 143;
/** Client script toplevel_mainmodal_open, sent before the modal as recorded. */
const SCRIPT_MAINMODAL_OPEN = 2524;
const CAMERA_ANGLE = [280, 0];
const CAMERA = {
  from: { dy: -6, height: 1500 },
  at: { dy: 3, height: 450 },
  motion: { rate: 2, rate2: 10, heightRelative: false },
};
const READING_ATTRIBUTE = "signposts:reading";
const SIGNPOST_LOC = "aide_signpost_1";
const SIGNPOST_SIZE = 2;
const READ_RANGE = 5;

let cache = null;
let core = null;

function signpostAt(location) {
  return SIGNPOSTS.find((post) => post.x === location?.x && post.y === location?.y && post.z === location?.z) ?? null;
}

/** Tiles between the player and the nearest tile of the 2x2 post. */
function distanceToPost(at, post) {
  const dx = Math.max(post.x - at.getX(), 0, at.getX() - (post.x + SIGNPOST_SIZE - 1));
  const dy = Math.max(post.y - at.getY(), 0, at.getY() - (post.y + SIGNPOST_SIZE - 1));
  return Math.max(dx, dy);
}

function readFromAfar(event) {
  if (event.objectId !== cache.getLocId(SIGNPOST_LOC) || event.clickType !== 1) return;
  const where = event.object?.getLocation?.();
  const post = where ? signpostAt({ x: where.getX(), y: where.getY(), z: where.getZ() }) : null;
  const player = event.player;
  const at = player.getLocation();
  if (!post || at.getZ() !== post.z || distanceToPost(at, post) > READ_RANGE) return;
  const { Location, RegionManager } = core;
  const target = new Location(post.x, post.y, post.z);
  if (!RegionManager.canProjectileAttackBounds(at, target, 1, 1, SIGNPOST_SIZE, SIGNPOST_SIZE, player.getPrivateArea?.() ?? null)) return;
  event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
}

function read(event) {
  const post = signpostAt(event.location);
  if (!post) return false;
  const player = event.player;
  const sender = player.getPacketSender();
  // The recorded order. A click closes an open compass (and resets the camera) before this runs.
  const at = player.getLocation();
  sender.sendClientScript(CAM_FORCEANGLE_SCRIPT, ...CAMERA_ANGLE);
  sender.sendCameraMoveTo(at.getX(), at.getY() + CAMERA.from.dy, CAMERA.from.height, CAMERA.motion);
  sender.sendCameraLookAt(at.getX(), at.getY() + CAMERA.at.dy, CAMERA.at.height, CAMERA.motion);
  for (const [side, component] of Object.entries(SIDES)) {
    sender.sendString(post[side], cache.getComponentId(`${INTERFACE_NAME}:${component}`));
  }
  sender.sendClientScript(SCRIPT_MAINMODAL_OPEN, -1, -1);
  sender.sendInterface(cache.getInterfaceId(INTERFACE_NAME));
  player.setAttribute(READING_ATTRIBUTE, true);
  return true;
}

/** The compass closed: the camera goes back to the player (recorded cam_reset). */
function compassClosed({ player, interfaceId }) {
  if (interfaceId !== cache.getInterfaceId(INTERFACE_NAME) || player.getAttribute(READING_ATTRIBUTE) !== true) return;
  player.setAttribute(READING_ATTRIBUTE, null);
  player.getPacketSender().sendCameraReset();
}

function bindCore(api) {
  core = api.core;
  cache = api.core.CacheDefinitions;
}

module.exports = {
  name: "Signposts",
  description: "Reading the guide signposts near Lumbridge, Draynor and Falador, opening the compass interface and moving the camera as the client expects.",
  register(api) {
    bindCore(api);
    api.onObjectRoute(readFromAfar);
    api.onObjectInteraction("Signpost", { Read: read });
    api.onCustomEvent("interface:closed", compassClosed);
  },
  SIGNPOSTS, read, readFromAfar, compassClosed, signpostAt, READING_ATTRIBUTE, READ_RANGE,
};
