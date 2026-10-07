"use strict";

const { GameConstants } = require("../../../../src/main/typescript/elvarg/game/GameConstants");
const { Location } = require("../../../../src/main/typescript/elvarg/game/model/Location");
const { isMembersArea, isMembersWorld } = require("../../../../src/main/typescript/elvarg/game/definition/WorldDefinition");
const { isLoadoutAvailable } = require("./PvpLoadoutRegistry");
const fs = require("fs");
const path = require("path");

function freezeArea(area) {
  if (!area || !Number.isFinite(area.minX) || !Number.isFinite(area.maxX) ||
      !Number.isFinite(area.minY) || !Number.isFinite(area.maxY)) {
    throw new Error("[pvp bot loadouts] hotspot has an invalid area");
  }
  return Object.freeze({
    minX: area.minX,
    maxX: area.maxX,
    minY: area.minY,
    maxY: area.maxY,
    z: area.z ?? 0,
  });
}

function freezeHotspot(hotspot) {
  return Object.freeze({
    ...hotspot,
    area: freezeArea(hotspot.area),
    combatLevelRange: isMembersWorld() ? hotspot.combatLevelRange : hotspot.freeCombatLevelRange,
    anchor: Object.freeze({ ...(hotspot.anchor ?? {}) }),
    roamRadius: Number.isFinite(hotspot.roamRadius) ? Math.max(1, Math.floor(hotspot.roamRadius)) : 3,
    lingerMs: Number.isFinite(hotspot.lingerMs) ? Math.max(0, Math.floor(hotspot.lingerMs)) : 10000,
    maxSimultaneousFights: Number.isFinite(hotspot.maxSimultaneousFights)
      ? Math.max(1, Math.floor(hotspot.maxSimultaneousFights))
      : null,
    allowedProfiles: Object.freeze([...(hotspot.allowedProfiles ?? [])]),
    // freeWorldLoadouts only join the pool on a free-to-play world (world.json membersWorld false).
    allowedLoadouts: Object.freeze([
      ...(hotspot.allowedLoadouts ?? []),
      ...(isMembersWorld() ? [] : hotspot.freeWorldLoadouts ?? []),
    ]),
    styleWeights: Object.freeze({ ...(hotspot.styleWeights ?? {}) }),
    activityWeights: Object.freeze({ ...(hotspot.activityWeights ?? {}) }),
  });
}

function loadWildernessHotspots() {
  const hotspotFile = path.join(GameConstants.DEFINITIONS_DIRECTORY, "pvp-bot-hotspots.json");
  const loadoutFile = path.join(GameConstants.DEFINITIONS_DIRECTORY, "pvp-bot-loadouts.json");
  const definitions = JSON.parse(fs.readFileSync(hotspotFile, "utf8"));
  if (!Array.isArray(definitions?.hotspots) || definitions.hotspots.length === 0) {
    throw new Error("[pvp bot loadouts] missing hotspots");
  }
  const loadouts = JSON.parse(fs.readFileSync(loadoutFile, "utf8"));
  const loadoutIds = new Set((loadouts.loadouts ?? []).map((loadout) => loadout?.id));
  const hotspots = {};
  for (const definition of definitions.hotspots) {
    if (!definition?.id || hotspots[definition.id]) {
      throw new Error("[pvp bot loadouts] hotspot ids must be unique");
    }
    if (!Array.isArray(definition.allowedLoadouts) ||
        (definition.freeWorldLoadouts !== undefined && !Array.isArray(definition.freeWorldLoadouts)) ||
        ![...definition.allowedLoadouts, ...(definition.freeWorldLoadouts ?? [])]
          .every((loadoutId) => loadoutIds.has(loadoutId))) {
      throw new Error("[pvp bot loadouts] " + definition.id + " has an unknown loadout");
    }
    hotspots[definition.id] = freezeHotspot(definition);
  }
  return Object.freeze(hotspots);
}

const WILDERNESS_HOTSPOTS = loadWildernessHotspots();
const WILDERNESS_HOTSPOT_IDS = Object.freeze(Object.keys(WILDERNESS_HOTSPOTS));

function getWildernessHotspot(hotspotId) {
  return WILDERNESS_HOTSPOTS[hotspotId] ?? null;
}

function listWildernessHotspots() {
  return WILDERNESS_HOTSPOT_IDS.map((hotspotId) => WILDERNESS_HOTSPOTS[hotspotId]);
}

// On a free-to-play world a hotspot also needs an f2p loadout and an anchor in free land.
function isHotspotUsable(hotspot) {
  return hotspot.enabled === true &&
    hotspot.allowedLoadouts.some(isLoadoutAvailable) &&
    !isMembersArea(hotspot.anchor.x, hotspot.anchor.y);
}

// The world type is fixed at startup, so resolve the usable set once: bot navigation
// asks for it inside its tile loops.
const ENABLED_WILDERNESS_HOTSPOTS = Object.freeze(
  WILDERNESS_HOTSPOT_IDS.map((hotspotId) => WILDERNESS_HOTSPOTS[hotspotId]).filter(isHotspotUsable)
);

function getEnabledWildernessHotspots() {
  return ENABLED_WILDERNESS_HOTSPOTS.slice();
}

function hotspotContainsLocation(hotspot, location) {
  if (!hotspot?.area || !location) return false;
  const x = location.getX?.() ?? location.x;
  const y = location.getY?.() ?? location.y;
  const z = location.getZ?.() ?? location.z;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  return z === hotspot.area.z && x >= hotspot.area.minX && x <= hotspot.area.maxX &&
    y >= hotspot.area.minY && y <= hotspot.area.maxY;
}

function createHotspotAnchorLocation(hotspot) {
  if (!hotspot?.anchor) return null;
  return new Location(hotspot.anchor.x, hotspot.anchor.y, hotspot.anchor.z ?? 0);
}

function isOutsideWildernessHotspots(location) {
  return !ENABLED_WILDERNESS_HOTSPOTS.some((hotspot) => hotspotContainsLocation(hotspot, location));
}

module.exports = {
  WILDERNESS_HOTSPOT_IDS,
  WILDERNESS_HOTSPOTS,
  createHotspotAnchorLocation,
  getEnabledWildernessHotspots,
  getWildernessHotspot,
  hotspotContainsLocation,
  isOutsideWildernessHotspots,
  listWildernessHotspots,
};
