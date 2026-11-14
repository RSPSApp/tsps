"use strict";

/**
 * Castle Drakan's own map (castle_drakan_world_map, docs/castle-drakan-map.md), from the
 * rsprox.net capture of a Blood Moon Rises run (recording 4288, revision 239):
 * - `in_castle_drakan_instance` is 1 while the player is in the castle's map squares. With it
 *   set and myq6 at most 82, the cache's orbs_worldmap_op1 gives the world map orb a
 *   "View Castle Map" op1, which opens this map in the floater instead of the world map.
 * - `castle_drakan_world_map_floor` is the floor it shows (0 dungeon, 1 ground, 2 first,
 *   3 second floor). The server sets it when the player changes floor, when the map opens
 *   (to the floor they stand on) and when they pick a floor on the map. Walking about one
 *   floor leaves a floor picked on the map alone.
 * - `castle_drakan_last_floor` changes with it on each floor change (not on the open or the
 *   map's buttons). The map marks the player's room only while it equals the floor shown.
 * - The orb's op2 closes this map while it is open; Close (and Escape) close it.
 * - While the player is fighting (tick 13500, attacking a castle crow) op1 opens nothing and
 *   says "You can't do that right now."; being hit while running off (tick 12564) still opens it.
 */

const IN_CASTLE_VARBIT = "in_castle_drakan_instance";
const FLOOR_VARBIT = "castle_drakan_world_map_floor";
/** The floor the map marks the player's room on; it changes with every floor change, as 15489. */
const LAST_FLOOR_VARBIT = "castle_drakan_last_floor";
const QUEST_VARBIT = "myq6";
/** orbs_worldmap_op1 offers the castle map only up to this myq6 value. */
const LAST_MAP_STAGE = 82;

const MAP_CLOSE = "castle_drakan_world_map:close";
/** The map's floor buttons and the floor each one shows. */
const FLOOR_BUTTONS = Object.freeze({
  "castle_drakan_world_map:dungeon": 0,
  "castle_drakan_world_map:floor_0": 1,
  "castle_drakan_world_map:floor_1": 2,
  "castle_drakan_world_map:floor_2": 3,
});
const ORB_COMPONENTS = Object.freeze(["orbs:worldmap", "orbs_nomap:worldmap", "orbs_osm:worldmap"]);
const FLOATER_UID = (161 << 16) | 18;
const OVERLAY = 1;
const IN_COMBAT_MESSAGE = "You can't do that right now.";

/**
 * The castle's map squares (row 115, y 7360-7423) and their floor by plane: square x -> {plane:
 * floor}. Each is where the capture's player stood while the server held that floor.
 */
const CASTLE_ROW = 115;
const FLOOR_BY_SQUARE = Object.freeze({
  36: Object.freeze({ 0: 1, 1: 2 }),
  37: Object.freeze({ 0: 1 }),
  38: Object.freeze({ 0: 2 }),
  39: Object.freeze({ 0: 3 }),
  40: Object.freeze({ 0: 0 }),
});

let api;
let ids;

function cacheIds() {
  if (ids) return ids;
  const { CacheDefinitions } = api.core;
  const component = (name) => CacheDefinitions.getComponentId(name);
  const close = component(MAP_CLOSE);
  const resolved = {
    inCastle: CacheDefinitions.getVarbitId(IN_CASTLE_VARBIT),
    floor: CacheDefinitions.getVarbitId(FLOOR_VARBIT),
    lastFloor: CacheDefinitions.getVarbitId(LAST_FLOOR_VARBIT),
    quest: CacheDefinitions.getVarbitId(QUEST_VARBIT),
    group: close == null ? null : close >>> 16,
    close,
    floorButtons: new Map(Object.entries(FLOOR_BUTTONS).map(([name, floor]) => [component(name), floor])),
    orbs: new Set(ORB_COMPONENTS.map(component).filter((id) => id != null)),
  };
  if (resolved.inCastle == null || resolved.floor == null || resolved.lastFloor == null ||
    resolved.group == null) return null;
  return ids = resolved;
}

/** The map floor of a tile, or null outside the castle. */
function castleFloorAt(location) {
  const x = location?.getX?.() ?? location?.x;
  const y = location?.getY?.() ?? location?.y;
  const z = location?.getZ?.() ?? location?.z;
  if (!Number.isFinite(x) || !Number.isFinite(y) || (y >> 6) !== CASTLE_ROW) return null;
  return FLOOR_BY_SQUARE[x >> 6]?.[z] ?? null;
}

function sendVarbitIfChanged(sender, id, value) {
  if (sender.getVarbit(id) !== value) sender.sendVarbit(id, value);
}

/** Entering, leaving or changing floor inside the castle. */
function syncCastle(player, previousFloor) {
  const resolved = cacheIds();
  if (!resolved) return;
  const sender = player.getPacketSender();
  const floor = castleFloorAt(player.getLocation());
  sendVarbitIfChanged(sender, resolved.inCastle, floor == null ? 0 : 1);
  if (floor == null || floor === previousFloor) return;
  // Live sends both on the same tick with the same value: the map highlights the player's room
  // (castle_drakan_last_room) only when castle_drakan_last_floor equals the floor it shows.
  sendVarbitIfChanged(sender, resolved.floor, floor);
  sendVarbitIfChanged(sender, resolved.lastFloor, floor);
}

function onMapSquareChange({ player, previous, location }) {
  if (castleFloorAt(previous) == null && castleFloorAt(location) == null) return;
  syncCastle(player, castleFloorAt(previous));
}

function onLogin({ player }) {
  if (castleFloorAt(player?.getLocation?.()) != null) syncCastle(player, null);
}

/** The orb offers its castle map op1 when the client's orbs_worldmap_op1 would. */
function offersCastleMap(sender, resolved) {
  if (sender.getVarbit(resolved.inCastle) !== 1) return false;
  return resolved.quest == null || sender.getVarbit(resolved.quest) <= LAST_MAP_STAGE;
}

function openCastleMap(player, resolved) {
  const sender = player.getPacketSender();
  const floor = castleFloorAt(player.getLocation());
  if (floor != null) sendVarbitIfChanged(sender, resolved.floor, floor);
  sender.sendSubInterface(FLOATER_UID, resolved.group, OVERLAY);
}

/**
 * "player:widget-action": the world map orb. Its op1 opens the castle map while the orb offers
 * it; its op2 closes the castle map when it is open (otherwise the world map toggles as usual).
 */
function onOrbClick(event) {
  const resolved = cacheIds();
  if (!resolved || !resolved.orbs.has(Number(event.packet?.widgetId))) return;
  const player = event.player;
  const sender = player.getPacketSender();
  const op = Number(event.packet.buttonNum ?? 0);
  if (op === 1 && offersCastleMap(sender, resolved)) {
    event.handled = true;
    if (api.core.CombatFactory?.isAttacking?.(player)) player.sendMessage(IN_COMBAT_MESSAGE);
    else openCastleMap(player, resolved);
  } else if (op === 2 && sender.isSubInterfaceOpen?.(resolved.group)) {
    event.handled = true;
    sender.closeInterface(resolved.group);
  }
}

/** Close, or a floor button: the map draws the floor; the server keeps the varbit. */
function onMapClick(event) {
  const resolved = cacheIds();
  if (!resolved || Number(event.groupId) !== resolved.group) return;
  const uid = (Number(event.groupId) << 16) | Number(event.childId);
  const sender = event.player.getPacketSender();
  if (uid === resolved.close) {
    event.handled = true;
    sender.closeInterface(resolved.group);
  } else if (resolved.floorButtons.has(uid)) {
    event.handled = true;
    sendVarbitIfChanged(sender, resolved.floor, resolved.floorButtons.get(uid));
  }
}

module.exports = function registerCastleMap(pluginApi) {
  api = pluginApi;
  pluginApi.onPlayerMapSquareChange(onMapSquareChange);
  pluginApi.onPlayerLogin(onLogin);
  pluginApi.onCustomEvent("player:widget-action", onOrbClick);
  pluginApi.onInterfaceActionClick(onMapClick);
};

module.exports.castleFloorAt = castleFloorAt;
