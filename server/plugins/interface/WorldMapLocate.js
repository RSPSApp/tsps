"use strict";

/**
 * "Locate" on the world map, shared by the panels that point at a place (Combat Achievements'
 * boss tab, the league area panel's Echo boss): as captured, the map opens as it always does if
 * it is closed, then script 3331 centres it on the packed coord.
 */

const SCRIPT_WORLDMAP_LOCATE = 3331;
const WORLDMAP = 595;
const WORLDMAP_NOCLICK = 3;

const uid = (group, child) => (group << 16) | child;

/** Opens the world map if it is closed and centres it on `coord` (plane << 28 | x << 14 | y). */
function locate(player, coord) {
  if (!Number.isFinite(coord)) return false;
  const sender = player.getPacketSender();
  if (!sender.isWorldMapOpen()) sender.toggleWorldMap();
  sender.sendInterfaceScript(SCRIPT_WORLDMAP_LOCATE, [uid(WORLDMAP, WORLDMAP_NOCLICK), coord, -1]);
  return true;
}

module.exports = { locate };
