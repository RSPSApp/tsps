// The varbits that describe each of a player's boats to the client (the boat selection
// interface and the sidepanel read them). Live OSRS sends them at login; ids and values from a
// live login capture and cache scripts 9013/9088 (docs/sailing-osrs-reference.md).
const { boatType, dockById, setVarbit } = require("./SailingContent.Sailing");
const { boatStats, partTiers } = require("./BoatParts.Sailing");
const { facilitiesOf, facilitiesUnaltered, teleportFocusOf } = require("./BoatFacilities.Sailing");

const MAX_BOATS = 5;
/** Boat slot 0's block starts at 19258 (`sailing_boat_1_owned`); each slot is 38 ids on. */
const FIRST_BLOCK = 19258;
const BLOCK_SIZE = 38;
const OFFSET = {
  owned: 0,
  type: 1,
  port: 2,
  bottlePreviousPort: 3,
  facilitiesUnaltered: 4,
  name: 5, // three words: +5, +6, +7
  keel: 8,
  hull: 9,
  sail: 10,
  steering: 11,
  /** `sailing_boat_N_teleport_focus`: which boats Summon and Teleport to Boat can choose. */
  teleportFocus: 12,
  /** `sailing_boat_N_flag` and `_brazier`, as captured. */
  flag: 13,
  brazier: 14,
  hotspot: 15, // hotspot n: +15 + n
  trim: 26,
  hotspotData: 27, // hotspot n's extra data: +27 + n
};
const STORED_HP = 19458; // + slot
const STORED_MAX_HP = 19463; // + slot
const NO_PREVIOUS_PORT = 255;
/** Hotspots 0-10 are in the block; a sloop's cannon spots 11 and 12 at 20207 + 4 * slot on. */
const BLOCK_HOTSPOTS = 11;
const EXTRA_HOTSPOTS = 20207;
const EXTRA_HOTSPOTS_SIZE = 4;
/** In that block, after the two hotspots, their extra data. */
const EXTRA_HOTSPOT_DATA = 2;
const MAX_HOTSPOTS = 13;
/**
 * Special `port` values (cache script 8997): 255 bottled, 254 capsized, 253 lost at sea. Port 0
 * is a real dock (Port Sarim), so a boat sunk by a teleport, Escape or death is "lost at sea".
 */
const LOST_AT_SEA = 253;
/** `sailing_boarded_boat_last_dock`, `_last_standard_dock` and `_last_mooring_point`: port ids, as captured. */
const VARBIT_LAST_DOCK = 19145;
const VARBIT_LAST_STANDARD_DOCK = 19146;
const VARBIT_LAST_MOORING_POINT = 19147;

function blockVarbit(slot, offset) {
  return FIRST_BLOCK + BLOCK_SIZE * slot + offset;
}

/** The per-boat varbit holding what is built on a hotspot. */
function hotspotVarbit(slot, hotspot) {
  return hotspot < BLOCK_HOTSPOTS
    ? blockVarbit(slot, OFFSET.hotspot + hotspot)
    : EXTRA_HOTSPOTS + EXTRA_HOTSPOTS_SIZE * slot + hotspot - BLOCK_HOTSPOTS;
}

/** The per-boat varbit holding a hotspot's extra data (`sailing_boat_N_hotspot_M_extra_data`): a keg's drink. */
function hotspotDataVarbit(slot, hotspot) {
  return hotspot < BLOCK_HOTSPOTS
    ? blockVarbit(slot, OFFSET.hotspotData + hotspot)
    : EXTRA_HOTSPOTS + EXTRA_HOTSPOTS_SIZE * slot + EXTRA_HOTSPOT_DATA + hotspot - BLOCK_HOTSPOTS;
}

/**
 * The port a boat is at, for its `port` varbit: the dock's id, "lost at sea" when sunk. At sea
 * it's the port it last docked at (captured: the Pandemonium's 1 while sailing to Port Sarim).
 */
function portOf(boat) {
  if (boat.location.kind === "sunk") return LOST_AT_SEA;
  return dockById(boat.location.dock)?.portId ?? 0;
}

/** The varbit values describing one boat slot (every value 0 for an empty slot). */
function slotVarbits(slot, boat) {
  const values = new Map();
  const set = (offset, value) => values.set(blockVarbit(slot, offset), value);
  const type = boat ? boatType(boat.type) : undefined;
  set(OFFSET.owned, boat ? 1 : 0);
  set(OFFSET.type, type?.typeId ?? 0);
  set(OFFSET.port, boat ? portOf(boat) : 0);
  set(OFFSET.bottlePreviousPort, boat ? NO_PREVIOUS_PORT : 0);
  set(OFFSET.facilitiesUnaltered, boat && facilitiesUnaltered(boat) ? 1 : 0);
  for (let word = 0; word < 3; word++) set(OFFSET.name + word, boat?.name?.[word] ?? 0);
  const tiers = boat ? partTiers(boat) : {};
  for (const part of ["keel", "hull", "sail", "steering", "trim", "flag", "brazier"]) set(OFFSET[part], tiers[part] ?? 0);
  set(OFFSET.teleportFocus, boat && type ? teleportFocusOf(boat) : 0);
  const facilities = boat && type ? facilitiesOf(boat) : [];
  for (let hotspot = 0; hotspot < MAX_HOTSPOTS; hotspot++) values.set(hotspotVarbit(slot, hotspot), facilities[hotspot] ?? 0);
  for (let hotspot = 0; hotspot < MAX_HOTSPOTS; hotspot++) values.set(hotspotDataVarbit(slot, hotspot), boat?.hotspotData?.[hotspot] ?? 0);
  const hitpoints = boat ? boatStats(boat).hitpoints : 0;
  values.set(STORED_HP + slot, Math.max(0, hitpoints - (boat?.damage ?? 0)));
  values.set(STORED_MAX_HP + slot, hitpoints);
  return values;
}

/**
 * Sends every boat slot's varbits, and the player's last dock, last port (not a mooring point)
 * and last mooring point, as at login and after a boat changes.
 */
function sendBoatVarbits(player) {
  const state = player.getSailing();
  for (let slot = 0; slot < MAX_BOATS; slot++) {
    const boat = state.boats.find((candidate) => candidate.slot === slot);
    for (const [id, value] of slotVarbits(slot, boat)) setVarbit(player, id, value);
  }
  setVarbit(player, VARBIT_LAST_DOCK, dockById(state.lastDock)?.portId ?? 0);
  setVarbit(player, VARBIT_LAST_STANDARD_DOCK, dockById(state.lastStandardDock)?.portId ?? 0);
  setVarbit(player, VARBIT_LAST_MOORING_POINT, dockById(state.lastMooringPoint)?.portId ?? 0);
}

module.exports = { blockVarbit, hotspotVarbit, hotspotDataVarbit, slotVarbits, sendBoatVarbits };
