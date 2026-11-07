"use strict";

const { CacheDefinitions, Skill } = require("./Core.Construction");

/**
 * Construction tables. What the cache has is read from it when the plugin loads: furniture names,
 * levels, menu icons, materials and the hidden flag from DB table `furniture` (110), room levels
 * and costs from `poh_room` (111), and each room's furniture rows in house-viewer slot
 * order from its `hotspot` rows' `builddata` (`poh_hotspot`, 112). ./data keeps only what the
 * cache doesn't: each piece's experience, built locs, build animation, tools and upgrade source;
 * each room's template chunk and hotspot keys; the hotspot locs. Chunk coordinates are tile-chunk
 * coordinates, not map-square coordinates.
 */
/** The player's house save. */
const { HOUSE_ATTRIBUTE } = require("./StorageState.Construction");
const ANY_NAILS_OBJ = 32923; // the furniture table's "any nails"

const column = (table, name) => CacheDefinitions.getDbColumn(CacheDefinitions.getDbTableId(table), name);
const FURNITURE = {
  menuObj: column("furniture", "model_obj"), name: column("furniture", "name"), materials: column("furniture", "material_cost"),
  level: column("furniture", "level_requirement"), hidden: column("furniture", "hidden_in_build_menu"),
};
const ROOM = {
  cost: column("poh_room", "cost"), id: column("poh_room", "room_type"),
  level: column("poh_room", "level_requirement"), hotspots: column("poh_room", "hotspot"),
};
const BUILD_DATA = column("poh_hotspot", "builddata");

/** A furniture row's materials: (obj, count) pairs, the generic nails obj as any nails. */
function cacheMaterials(row) {
  const pairs = row.column(FURNITURE.materials);
  const materials = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    materials.push(pairs[i] === ANY_NAILS_OBJ ? { amount: pairs[i + 1], source: "NAILS" } : { itemId: pairs[i], amount: pairs[i + 1] });
  }
  return materials;
}

/** Validate cache client-stat/level pairs without coercion; unsupported rows refuse at build time. */
function cacheLevels(row) {
  const values = row.column(FURNITURE.level);
  if (!Array.isArray(values) || values.length === 0 || values.length % 2 !== 0)
    return { level: 1, secondaryLevels: [], invalidLevels: true };
  const pairs = [];
  for (let i = 0; i < values.length; i += 2) {
    const [statId, level] = values.slice(i, i + 2);
    if (!Number.isInteger(statId) || !Number.isInteger(level) || level < 1)
      return { level: 1, secondaryLevels: [], invalidLevels: true };
    pairs.push({ statId, level });
  }
  const construction = pairs.filter(pair => pair.statId === Skill.CONSTRUCTION.getClientId());
  if (construction.length !== 1) return { level: 1, secondaryLevels: [], invalidLevels: true };
  return { level: construction[0].level, secondaryLevels: pairs.filter(pair => pair.statId !== Skill.CONSTRUCTION.getClientId()) };
}

/** Furniture: the hand data with the cache's fields on top (rows the cache lacks keep the hand data). */
const CONSTRUCTION_BUILDABLES = require("./data/furniture.json").map((entry) => {
  const row = entry.menuRowId != null ? CacheDefinitions.getDbRow(entry.menuRowId) : null;
  if (!row) return { name: entry.key.toLowerCase().replace(/_/g, " "), level: 1, ...entry };
  const own = entry.materials.filter((material) => material.itemId == null && material.source !== "NAILS");
  const hidden = row.int(FURNITURE.hidden, 0) === 1;
  return {
    ...entry,
    name: String(row.column(FURNITURE.name)[0] ?? entry.key),
    ...cacheLevels(row),
    menuItemId: Number(row.column(FURNITURE.menuObj)[0] ?? -1),
    materials: [...own, ...cacheMaterials(row)],
    ...(hidden ? { hidden } : {}),
  };
});

const roomRows = new Map(CacheDefinitions.getDbTableRows(CacheDefinitions.getDbTableId("poh_room"))
  .map((row) => [row.int(ROOM.id, -1), row]));

/**
 * Rooms: name, template chunk, flags and hotspot keys from ./data (the names are ours: the cache
 * calls the portal chamber "portal room"); level and cost from the cache.
 */
const CONSTRUCTION_ROOMS = require("./data/rooms.json").map((room) => {
  const row = roomRows.get(room.id);
  if (!row) return room;
  return { ...room, level: Number(row.column(ROOM.level)[1] ?? room.level), cost: Number(row.column(ROOM.cost)[0] ?? room.cost) };
});

/** Each room type's poh_room DB row, which the house viewer's script takes. */
const ROOM_ROW_BY_ID = new Map([...roomRows].map(([id, row]) => [id, row.id]));

/** The room door spaces of every style: poh_hotspot_door{l,r}_<style> and poh_hotspot_door_dungeon<n>. */
const ROOM_DOOR_HOTSPOT_IDS = new Set([...CacheDefinitions.getLocNames()].filter(([, name]) => name.startsWith("poh_hotspot_door")).map(([id]) => id));

/** Furniture row choices in house-viewer slot order, by room id. */
const CONSTRUCTION_VIEWER_FURNITURE = Object.fromEntries([...roomRows].filter(([id]) => id > 0).map(([id, row]) => [id,
  row.column(ROOM.hotspots).map((hotspotRow) => CacheDefinitions.getDbRow(Number(hotspotRow))?.column(BUILD_DATA).map(Number) ?? [])]));

/** Blank/floor/roof chunks used when no saved room occupies a grid square. */
const HOUSE_TEMPLATE_CHUNKS = require("./data/template-chunks.json");
/** Construction hotspot object ids. Multiple ids are separate cache variants of one space. */
const CONSTRUCTION_HOTSPOTS = require("./data/hotspots.json");

const ROOM_BY_KEY = new Map(CONSTRUCTION_ROOMS.map((room) => [room.key, room]));
const HOTSPOT_BY_OBJECT_ID = new Map(CONSTRUCTION_HOTSPOTS.flatMap((hotspot) => hotspot.objectIds.map((id) => [id, hotspot])));
const BUILDABLE_BY_KEY = new Map(CONSTRUCTION_BUILDABLES.map((buildable) => [buildable.key, buildable]));
const HOTSPOT_BY_KEY = new Map(CONSTRUCTION_HOTSPOTS.map((hotspot) => [hotspot.key, hotspot]));
// Some hotspot locs are shared between rooms (the hall and dungeon stair spaces), so a room's own
// hotspots decide what a loc is there.
const HOTSPOTS_BY_ROOM = new Map(CONSTRUCTION_ROOMS.map((room) => [room.key, new Map(
  room.hotspots.map((key) => HOTSPOT_BY_KEY.get(key)).filter(Boolean)
    .flatMap((hotspot) => hotspot.objectIds.map((id) => [id, hotspot])).reverse(),
)]));

/** The hotspot `objectId` is in a room of type `roomKey`, or null. */
function hotspotIn(roomKey, objectId) {
  return HOTSPOTS_BY_ROOM.get(roomKey)?.get(objectId) ?? null;
}

Object.assign(module.exports, { cacheLevels, HOUSE_ATTRIBUTE, CONSTRUCTION_ROOMS, HOUSE_TEMPLATE_CHUNKS, CONSTRUCTION_HOTSPOTS, CONSTRUCTION_BUILDABLES, ROOM_BY_KEY, HOTSPOT_BY_OBJECT_ID, HOTSPOT_BY_KEY, BUILDABLE_BY_KEY, CONSTRUCTION_VIEWER_FURNITURE, ROOM_ROW_BY_ID, ROOM_DOOR_HOTSPOT_IDS, hotspotIn });
