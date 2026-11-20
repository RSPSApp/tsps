"use strict";

/**
 * Locs whose Read opens the plain message scroll (messagescroll, 220): the Falador bank notice
 * boards' Bank PIN advice and Varrock's Combat Scroll. Lines per loc: data/message-scrolls.json.
 *
 * rsprox 241/1001398 t254, 233/03237 t1269-t1484 and 240/1001336 t3727: on arrival every line
 * component messcroll1-15 is written (blanks too), then toplevel_mainmodal_open (2524, -1, -1)
 * and the scroll opens as the main modal. The busy varbit (12393) goes to 1 while it is open and
 * back to 0 when it closes (live sends the 1 a tick after the open; it is sent with it here, as
 * the long scroll in QuestRuntime does).
 *
 * The notice boards are read from a distance (an entry's readRange): in 233/03237 the player read
 * both Falador east bank boards without moving, from 3 and 5 tiles away. So, as the Signposts
 * plugin does, a player within readRange tiles of the board with a clear line to it reads where
 * they stand, and one further away walks until they are. The Combat Scroll has no readRange: in
 * 232/03220 the player walked up to it even from 3 tiles away.
 */

const fs = require("node:fs");
const path = require("node:path");

const SCROLLS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "message-scrolls.json"), "utf8")).scrolls;
const INTERFACE_NAME = "messagescroll";
const LINE_COMPONENT = "messcroll";
/** Client script toplevel_mainmodal_open, sent before the modal as recorded. */
const SCRIPT_MAINMODAL_OPEN = 2524;
const BUSY_VARBIT = 12393;
/** Read is op1 on every entry's locs. */
const READ_OP = 1;

let cache = null;
let core = null;
const reading = new WeakSet();

function scrollFor(objectId) {
  return SCROLLS.find((scroll) => scroll.locs.some((loc) => cache.getLocId(loc) === objectId)) ?? null;
}

/** Tiles between the player and the nearest tile of the loc. */
function distanceTo(at, where, width, length) {
  const dx = Math.max(where.getX() - at.getX(), 0, at.getX() - (where.getX() + width - 1));
  const dy = Math.max(where.getY() - at.getY(), 0, at.getY() - (where.getY() + length - 1));
  return Math.max(dx, dy);
}

function readFromAfar(event) {
  const scroll = scrollFor(event.objectId);
  if (!scroll?.readRange) return;
  if (event.clickType !== READ_OP) return;
  const where = event.object?.getLocation?.();
  const player = event.player;
  const at = player.getLocation();
  if (!where || at.getZ() !== where.getZ()) return;
  const definition = event.definition ?? core.ObjectDefinition.forId(event.objectId);
  const width = definition?.getSizeX?.() ?? 1;
  const length = definition?.getSizeY?.() ?? 1;
  if (distanceTo(at, where, width, length) > scroll.readRange ||
      !core.RegionManager.canProjectileAttackBounds(at, where, 1, 1, width, length, player.getPrivateArea?.() ?? null)) {
    event.approachRange = scroll.readRange;
    return;
  }
  event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
}

function read(event) {
  const scroll = scrollFor(event.objectId);
  if (!scroll) return false;
  const { player } = event;
  const sender = player.getPacketSender();
  scroll.lines.forEach((line, index) => {
    sender.sendString(line, cache.getComponentId(`${INTERFACE_NAME}:${LINE_COMPONENT}${index + 1}`));
  });
  sender.sendClientScript(SCRIPT_MAINMODAL_OPEN, -1, -1);
  sender.sendInterface(cache.getInterfaceId(INTERFACE_NAME));
  sender.sendVarbit(BUSY_VARBIT, 1);
  reading.add(player);
  return true;
}

function scrollClosed({ player, interfaceId }) {
  if (interfaceId !== cache.getInterfaceId(INTERFACE_NAME) || !reading.delete(player)) return;
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

function bindCore(api) {
  core = api.core;
  cache = api.core.CacheDefinitions;
}

module.exports = {
  name: "MessageScrolls",
  description: "Reading the Falador bank notice boards (from a few tiles away) and Varrock's Combat Scroll, which open the plain message scroll with their recorded lines.",
  register(api) {
    bindCore(api);
    api.onObjectRoute(readFromAfar);
    api.onObjectInteraction("Notice board", { Read: read });
    api.onObjectInteraction("Combat Scroll", { Read: read });
    api.onCustomEvent("interface:closed", scrollClosed);
  },
  SCROLLS, read, readFromAfar, scrollClosed,
};
