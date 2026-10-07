"use strict";

/**
 * Keeps the world map's player marker on the player while the map is open. Opening the map sends
 * worldmap_transmitdata (1749) with the player's position (PacketSender.toggleWorldMap); after
 * that, as in OSRS captures (docs/world-map.md), the server sends it again every 3 ticks, but
 * only when it changed since the last send:
 * - on land, the player's position from the start of that tick;
 * - aboard a boat, the boat's own tile after it moved that tick.
 */

const { packWorldMapCoord } = require("../../src/main/typescript/elvarg/net/protocol/WorldMapProtocol");
const { BoatManager } = require("../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");

const UPDATE_TICKS = 3;

/** player -> { ticks since the map opened, the player's position at the end of the last tick } */
const openMaps = new WeakMap();
/** Players aboard a boat whose update is due this tick, sent once the boats have moved. */
const boatUpdates = new Set();

function send(player, location) {
  const packetSender = player.getPacketSender();
  const packed = packWorldMapCoord(location.getX(), location.getY(), location.getZ());
  if (packed !== packetSender.getWorldMapPosition()) packetSender.sendWorldMapPosition(location);
}

function updateWorldMapPosition({ player }) {
  const packetSender = player.getPacketSender();
  if (!packetSender.isWorldMapOpen()) {
    openMaps.delete(player);
    return;
  }
  // The tick the map opened on counts as 0, so the first check is 3 ticks later.
  const state = openMaps.get(player) ?? { ticks: -1, last: null };
  openMaps.set(player, state);
  // This hook runs after the player's movement, so the tick started where the last one ended.
  const tickStart = state.last;
  state.last = player.getLocation().clone();
  if (++state.ticks % UPDATE_TICKS !== 0) return;
  if (BoatManager.getBoatAboard(player)) {
    // Boats move after the players: the boat's tile is sent once it has.
    boatUpdates.add(player);
    return;
  }
  if (tickStart) send(player, tickStart);
}

function sendBoatPositions() {
  for (const player of boatUpdates) {
    const boat = BoatManager.getBoatAboard(player);
    if (boat && player.getPacketSender().isWorldMapOpen()) {
      const tile = boat.worldTile();
      send(player, new Location(tile.x, tile.y, tile.level));
    }
  }
  boatUpdates.clear();
}

module.exports = {
  name: "WorldMapPosition",
  register(api) {
    api.onPlayerProcess(updateWorldMapPosition);
    BoatManager.onAfterTick(sendBoatPositions);
  },
};

module.exports._test = { updateWorldMapPosition, sendBoatPositions };
