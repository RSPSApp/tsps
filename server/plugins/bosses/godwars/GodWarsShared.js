"use strict";

// GWD door ids (cache: GODWARS_DUNGEON_DOOR_*), only the base ids are placed
// in the map; they transform into the open "Big door" variants client-side.
const DOOR_BANDOS = 26503;
const DOOR_ARMADYL = 26502;
const DOOR_SARADOMIN = 26504;
const DOOR_ZAMORAK = 26505;
// Cache: GODWARS_DUNGEON_*_ALTAR; right-click Teleport exits the boss room.
const ALTAR_ZAMORAK = 26363;
const ALTAR_SARADOMIN = 26364;
const ALTAR_ARMADYL = 26365;
const ALTAR_BANDOS = 26366;

const KILL_COUNT_LIMIT = 40;
const GOD_WARS_DUNGEON_ZONE = {
  minX: 2760,
  maxX: 3010,
  minY: 5180,
  maxY: 5450,
};

function buildFactions(core) {
  const I = core.NpcIdentifiers;
  return {
    bandos: {
      key: "bandos",
      name: "Bandos",
      doorId: DOOR_BANDOS,
      altarId: ALTAR_BANDOS,
      godKeyword: "bandos",
      generalIds: [I.GENERAL_GRAARDOR, I.GENERAL_GRAARDOR_2],
      guardIds: [I.SERGEANT_STRONGSTACK, I.SERGEANT_STEELWILL, I.SERGEANT_GRIMSPIKE],
      spawns: {
        general: { x: 2872, y: 5358, z: 2 },
        guards: [
          { id: I.SERGEANT_STRONGSTACK, x: 2866, y: 5358, z: 2 },
          { id: I.SERGEANT_STEELWILL, x: 2872, y: 5352, z: 2 },
          { id: I.SERGEANT_GRIMSPIKE, x: 2868, y: 5362, z: 2 },
        ],
      },
      inside: { x: 2867, y: 5357, z: 2 },
      outside: { x: 2860, y: 5351, z: 2 },
      camp: { minX: 2830, maxX: 2905, minY: 5330, maxY: 5395, z: 2 },
      room: { minX: 2840, maxX: 2900, minY: 5340, maxY: 5390, z: 2 },
    },
    armadyl: {
      key: "armadyl",
      name: "Armadyl",
      doorId: DOOR_ARMADYL,
      altarId: ALTAR_ARMADYL,
      godKeyword: "armadyl",
      generalIds: [I.KREEARRA, I.KREEARRA_2],
      guardIds: [I.WINGMAN_SKREE, I.FLOCKLEADER_GEERIN, I.FLIGHT_KILISA],
      spawns: {
        general: { x: 2832, y: 5302, z: 2 },
        guards: [
          { id: I.WINGMAN_SKREE, x: 2840, y: 5303, z: 2 },
          { id: I.FLOCKLEADER_GEERIN, x: 2828, y: 5299, z: 2 },
          { id: I.FLIGHT_KILISA, x: 2833, y: 5297, z: 2 },
        ],
      },
      inside: { x: 2836, y: 5298, z: 2 },
      outside: { x: 2842, y: 5295, z: 2 },
      camp: { minX: 2805, maxX: 2855, minY: 5275, maxY: 5325, z: 2 },
      room: { minX: 2810, maxX: 2850, minY: 5282, maxY: 5320, z: 2 },
    },
    saradomin: {
      key: "saradomin",
      name: "Saradomin",
      doorId: DOOR_SARADOMIN,
      altarId: ALTAR_SARADOMIN,
      godKeyword: "saradomin",
      generalIds: [I.COMMANDER_ZILYANA, I.COMMANDER_ZILYANA_2],
      guardIds: [I.STARLIGHT, I.GROWLER, I.BREE],
      spawns: {
        general: { x: 2897, y: 5269, z: 0 },
        guards: [
          { id: I.STARLIGHT, x: 2903, y: 5261, z: 0 },
          { id: I.GROWLER, x: 2896, y: 5264, z: 0 },
          { id: I.BREE, x: 2902, y: 5274, z: 0 },
        ],
      },
      inside: { x: 2903, y: 5267, z: 0 },
      outside: { x: 2912, y: 5266, z: 0 },
      camp: { minX: 2875, maxX: 2925, minY: 5248, maxY: 5298, z: 0 },
      room: { minX: 2878, maxX: 2920, minY: 5252, maxY: 5292, z: 0 },
    },
    zamorak: {
      key: "zamorak",
      name: "Zamorak",
      doorId: DOOR_ZAMORAK,
      altarId: ALTAR_ZAMORAK,
      godKeyword: "zamorak",
      generalIds: [I.KRIL_TSUTSAROTH, I.KRIL_TSUTSAROTH_2],
      guardIds: [I.TSTANON_KARLAK, I.ZAKLN_GRITCH, I.BALFRUG_KREEYATH],
      spawns: {
        general: { x: 2925, y: 5322, z: 2 },
        guards: [
          { id: I.TSTANON_KARLAK, x: 2932, y: 5328, z: 2 },
          { id: I.ZAKLN_GRITCH, x: 2919, y: 5327, z: 2 },
          { id: I.BALFRUG_KREEYATH, x: 2921, y: 5319, z: 2 },
        ],
      },
      inside: { x: 2923, y: 5326, z: 2 },
      outside: { x: 2928, y: 5335, z: 2 },
      camp: { minX: 2900, maxX: 2955, minY: 5300, maxY: 5355, z: 2 },
      room: { minX: 2902, maxX: 2952, minY: 5302, maxY: 5348, z: 2 },
    },
  };
}

function factionForDoor(factions, objectId) {
  return Object.values(factions).find((faction) => faction.doorId === objectId) ?? null;
}

function factionForAltar(factions, objectId) {
  return Object.values(factions).find((faction) => faction.altarId === objectId) ?? null;
}

function factionForLocation(factions, location) {
  if (!location) {
    return null;
  }
  const x = location.getX();
  const y = location.getY();
  const z = location.getZ();
  return (
    Object.values(factions).find(
      (faction) =>
        faction.camp.z === z &&
        x >= faction.camp.minX &&
        x <= faction.camp.maxX &&
        y >= faction.camp.minY &&
        y <= faction.camp.maxY
    ) ?? null
  );
}

function killCountAttribute(faction) {
  return `gwd:killcount:${faction.key}`;
}

function getKillCount(player, faction) {
  return Math.max(0, Math.trunc(Number(player.getAttribute(killCountAttribute(faction))) || 0));
}

function setKillCount(player, faction, value) {
  player.setAttribute(killCountAttribute(faction), Math.max(0, Math.trunc(value)));
}

function addKillCount(player, faction, amount = 1) {
  setKillCount(player, faction, Math.min(KILL_COUNT_LIMIT, getKillCount(player, faction) + amount));
}

function resetKillCounts(player, factions) {
  for (const faction of Object.values(factions)) {
    setKillCount(player, faction, 0);
  }
}

// God alignment comes from the cache's item name, so every variant is covered.
function godItemEquipped(core, player, faction) {
  for (const item of player.getEquipment().getItems()) {
    if (!item || item.getId() <= 0) {
      continue;
    }
    const name = core.ItemDefinition.forId(item.getId())?.getName?.()?.toLowerCase?.() ?? "";
    if (name.includes(faction.godKeyword)) {
      return true;
    }
  }
  return false;
}

function hasEcumenicalKey(core, player) {
  const I = core.ItemIdentifiers;
  return player.getInventory().contains(I.ECUMENICAL_KEY);
}

function toLocation(core, tile) {
  return new core.Location(tile.x, tile.y, tile.z);
}

module.exports = {
  DOOR_BANDOS,
  DOOR_ARMADYL,
  DOOR_SARADOMIN,
  DOOR_ZAMORAK,
  ALTAR_ZAMORAK,
  ALTAR_SARADOMIN,
  ALTAR_ARMADYL,
  ALTAR_BANDOS,
  KILL_COUNT_LIMIT,
  GOD_WARS_DUNGEON_ZONE,
  buildFactions,
  factionForDoor,
  factionForAltar,
  factionForLocation,
  killCountAttribute,
  getKillCount,
  setKillCount,
  addKillCount,
  resetKillCounts,
  godItemEquipped,
  hasEcumenicalKey,
  toLocation,
};
