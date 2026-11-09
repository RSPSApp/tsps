// A boat's facility hotspots and what is built on them, read from the cache's sailing tables:
// each boat type's row (table 166, column 32) lists its hotspots as [template tile, a, b,
// hotspot row]; a hotspot row (table 175) lists the facilities it allows; a facility row (table
// 176) gives its loc, levels and materials. A boat stores, per hotspot, the facility's 1-based
// position in that list (0 = empty), which is also what the hotspot varbits hold. Facts and
// captures are in docs/sailing-osrs-reference.md.
const { CacheDefinitions } = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { boatType } = require("./SailingContent.Sailing");

const FACILITIES_TABLE = 176;
/** Table 166's `hotspot` column (31 before rev 241 added sail_pattern_option at 27). */
const TYPE_HOTSPOTS = 32;
const HOTSPOT_FACILITIES = 2;
const FACILITY = { name: 0, loc: 6, sailing: 12, construction: 13, materials: 17, category: 22, overSide: 23 };
const HOTSPOT_TUPLE = 4;
const LOC_SHAPE = 10;

function typeRow(type) {
  const row = boatType(type)?.sidepanelBoatType;
  return row === undefined ? undefined : CacheDefinitions.getDbRow(row);
}

/**
 * A boat type's hotspots: where each sits on the deck (relative to the base-tier template, as
 * the deck locs are), which side it's on (the tuple's `a`: 1 west, 3 east, 0 the centre line)
 * and the facility rows it allows.
 */
function hotspotsOf(type) {
  const spec = boatType(type);
  const flat = typeRow(type)?.column(TYPE_HOTSPOTS) ?? [];
  const hotspots = [];
  for (let at = 0; at + HOTSPOT_TUPLE <= flat.length; at += HOTSPOT_TUPLE) {
    const coord = flat[at];
    hotspots.push({
      id: at / HOTSPOT_TUPLE,
      x: ((coord >> 14) & 0x3fff) - spec.templateChunkX * 8,
      y: (coord & 0x3fff) - spec.templateChunkY * 8,
      level: coord >>> 28,
      side: flat[at + 1],
      allowed: CacheDefinitions.getDbRow(flat[at + 3])?.column(HOTSPOT_FACILITIES) ?? [],
    });
  }
  return hotspots;
}

/**
 * What each hotspot holds, as positions in its allowed list. A boat whose facilities were
 * never changed has its type's defaults (boats.json `hotspots`, as a new boat comes).
 */
function facilitiesOf(boat) {
  const count = hotspotsOf(boat.type).length;
  if (boat.facilities?.length) {
    return Array.from({ length: count }, (_, hotspot) => boat.facilities[hotspot] ?? 0);
  }
  const defaults = boatType(boat.type)?.hotspots ?? {};
  return Array.from({ length: count }, (_, hotspot) => defaults[hotspot] ?? 0);
}

/** Whether the boat still has the facilities it came with (the `facilities_unaltered` varbit). */
function facilitiesUnaltered(boat) {
  return !boat.facilities?.length;
}

/** The facility row built on a hotspot, or undefined when it's empty. */
function facilityAt(boat, hotspot) {
  const position = facilitiesOf(boat)[hotspot] ?? 0;
  return position > 0 ? hotspotsOf(boat.type)[hotspot]?.allowed[position - 1] : undefined;
}

/** Builds (a facility row) or clears (undefined) a hotspot. */
function setFacility(boat, hotspot, facilityRow) {
  const facilities = facilitiesOf(boat);
  const allowed = hotspotsOf(boat.type)[hotspot]?.allowed ?? [];
  facilities[hotspot] = facilityRow === undefined ? 0 : allowed.indexOf(facilityRow) + 1;
  boat.facilities = facilities;
  // What the old facility held (a keg's drink) goes with it.
  if (boat.hotspotData?.[hotspot]) boat.hotspotData[hotspot] = 0;
}

/** Whether a hotspot allows a facility row. */
function allows(boat, hotspot, facilityRow) {
  return hotspotsOf(boat.type)[hotspot]?.allowed.includes(facilityRow) === true;
}

/** The hotspot at a deck tile, or undefined. */
function hotspotAt(boat, x, y) {
  return hotspotsOf(boat.type).find((hotspot) => hotspot.x === x && hotspot.y === y)?.id;
}

/**
 * How many customisation interface slots to enable for a hotspot: enough for its facilities
 * and a heading for each category. OSRS enabled 0-8 on a sloop cannon spot and 0-12 on its
 * range hotspot; this covers both.
 */
function optionSlots(boat, hotspot) {
  const allowed = hotspotsOf(boat.type)[hotspot]?.allowed ?? [];
  const categories = new Set(allowed.map((row) => CacheDefinitions.getDbRow(row)?.int(FACILITY.category, 0)));
  return allowed.length + categories.size;
}

/** What building a facility needs: levels and materials as [item, count] pairs. */
function facilityRequirements(facilityRow) {
  const row = CacheDefinitions.getDbRow(facilityRow);
  const flat = row?.column(FACILITY.materials) ?? [];
  const materials = [];
  for (let i = 0; i + 1 < flat.length; i += 2) materials.push([flat[i], flat[i + 1]]);
  return {
    name: row?.string(FACILITY.name) ?? "",
    sailing: row?.int(FACILITY.sailing, 1) ?? 1,
    construction: row?.int(FACILITY.construction, 1) ?? 1,
    materials,
  };
}

/** The first facility row with a name (any case), such as "range" or "mithril salvaging hook". */
function facilityNamed(name) {
  const wanted = name.trim().toLowerCase();
  return CacheDefinitions.getDbTableRows(FACILITIES_TABLE)
    .find((row) => row.string(FACILITY.name).toLowerCase() === wanted)?.id;
}

/**
 * Which way a loc on a hotspot faces. On the centre line, 0. On a side, facilities that work
 * over it (those with column 23: cannons, hooks, nets, chum stations, wind catchers) face out,
 * rotation `side`; the rest (a range, a keg) face in towards the deck, the opposite way.
 * Placeholders face 1 on either side. As captured: a hook on a west hotspot at 1, a range on
 * an east one at 1, cargo holds and the inoculation station on the centre line at 0. Chum
 * stations and spreaders face in like a range although they work over the side (rsprox: every
 * placement, 431 across both boats and both sides, at the side's opposite).
 */
function rotationOf(hotspot, facilityRow) {
  if (hotspot.side === 0) return 0;
  if (facilityRow === undefined) return 1;
  const row = CacheDefinitions.getDbRow(facilityRow);
  const overSide = (row?.column(FACILITY.overSide)?.length ?? 0) > 0;
  const facesIn = !overSide || /chum/i.test(row?.string(FACILITY.name) ?? "");
  return facesIn ? (hotspot.side + 2) & 3 : hotspot.side;
}

/**
 * A built facility's op flags (loc_add_change): at sea its ops 1-4 and not Modify, in the shipyard
 * only Modify (op5) (rsprox: the user's captures, every facility, both ways).
 */
const FACILITY_OPS = Object.freeze({ AT_SEA: 0b1111, SHIPYARD: 0b10000 });

/** The wind and gale catchers' switched-off locs and their switched-on ones (cache, rsprox 907). */
const CATCHER_SWITCHED_ON = { 59684: 59683, 59685: 59686 };

/** The empty keg's loc: a filled keg is the loc its drink (the hotspot's extra data) counts on from it. */
const KEG_EMPTY = 59691;

/**
 * The deck locs for a boat's hotspots: each facility's loc, blocking its tile when the loc is
 * solid in the cache (a range or cargo hold, not a hook). With `placeholders`, as in the
 * shipyard, empty hotspots show their "Facility hotspot" loc; at sea they show nothing.
 */
function hotspotLocs(boat, placeholders = false) {
  const placeholderIds = placeholders ? boatType(boat.type)?.placeholders ?? [] : [];
  const facilities = facilitiesOf(boat);
  return hotspotsOf(boat.type).flatMap((hotspot) => {
    const facility = facilities[hotspot.id] > 0 ? hotspot.allowed[facilities[hotspot.id] - 1] : undefined;
    let id = facility !== undefined
      ? CacheDefinitions.getDbRow(facility)?.column(FACILITY.loc)?.[0]
      : placeholderIds[hotspot.id];
    // A wind or gale catcher left switched on is built that way.
    if (boat.windCatcherOn && CATCHER_SWITCHED_ON[id] !== undefined) id = CATCHER_SWITCHED_ON[id];
    if (id === KEG_EMPTY) id += boat.hotspotData?.[hotspot.id] ?? 0;
    if (typeof id !== "number") return [];
    const blocks = (CacheDefinitions.getObject(id)?.clipType ?? 0) !== 0;
    const opFlags = facility === undefined ? undefined : placeholders ? FACILITY_OPS.SHIPYARD : FACILITY_OPS.AT_SEA;
    return [{ id, x: hotspot.x, y: hotspot.y, level: hotspot.level, shape: LOC_SHAPE, rotation: rotationOf(hotspot, facility), blocks, hotspot: hotspot.id, opFlags }];
  });
}

/**
 * A boat's teleport focus, as its `sailing_boat_N_teleport_focus` varbit holds it (rsprox: 1, or
 * 2 once greater): 0 without one, 1 for a teleport focus, 2 for a greater teleport focus.
 */
function teleportFocusOf(boat) {
  const built = hotspotsOf(boat.type).map((hotspot) => facilityAt(boat, hotspot.id));
  if (built.includes(facilityNamed("Greater teleport focus"))) return 2;
  return built.includes(facilityNamed("Teleport focus")) ? 1 : 0;
}

module.exports = {
  CATCHER_SWITCHED_ON,
  KEG_EMPTY,
  FACILITY_OPS,
  teleportFocusOf,
  TYPE_HOTSPOTS,
  HOTSPOT_FACILITIES,
  FACILITY,
  hotspotsOf,
  facilitiesOf,
  facilitiesUnaltered,
  facilityAt,
  setFacility,
  allows,
  hotspotAt,
  optionSlots,
  facilityRequirements,
  facilityNamed,
  hotspotLocs,
};
