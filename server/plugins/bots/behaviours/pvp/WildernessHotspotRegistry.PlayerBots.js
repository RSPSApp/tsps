"use strict";

const { GameConstants } = require("../../../../src/main/typescript/elvarg/game/GameConstants");
const { Location } = require("../../../../src/main/typescript/elvarg/game/model/Location");
const { isMembersArea, isMembersWorld } = require("../../../../src/main/typescript/elvarg/game/definition/WorldDefinition");
const { isLoadoutAvailable } = require("./PvpLoadoutRegistry.PlayerBots");
const { listPvpProfiles } = require("./PvpProfileRegistry.PlayerBots");
const { readBotSites } = require("../../brain/Sites.PlayerBots");
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
    // Free worlds only have f2p gear, which can't reach members combat bands.
    combatLevelRange: isMembersWorld() ? hotspot.combatLevelRange : undefined,
    anchor: Object.freeze({ ...(hotspot.anchor ?? {}) }),
    roamRadius: Number.isFinite(hotspot.roamRadius) ? Math.max(1, Math.floor(hotspot.roamRadius)) : 3,
    lingerMs: Number.isFinite(hotspot.lingerMs) ? Math.max(0, Math.floor(hotspot.lingerMs)) : 10000,
    maxSimultaneousFights: Number.isFinite(hotspot.maxSimultaneousFights)
      ? Math.max(1, Math.floor(hotspot.maxSimultaneousFights))
      : null,
    allowedProfiles: Object.freeze([...(hotspot.allowedProfiles ?? [])]),
    allowedLoadouts: Object.freeze([...hotspot.allowedLoadouts]),
    activityWeights: Object.freeze({ ...(hotspot.activityWeights ?? {}) }),
  });
}

/**
 * PvP bots are configured with the rest of the bot population, in bot-sites.json: the
 * "pvp" block holds pool size and active-region spread, and every site with a `pvp`
 * block is a hotspot. Its gear is the loadout groups `pvp.loadouts` lists from
 * pvp-bot-loadouts.json or, without that list, the groups tagged with its `style`.
 */
const SITES_FILE = readBotSites(path.join(GameConstants.DEFINITIONS_DIRECTORY, "bot-sites.json"));
const PVP_BOT_CONFIG = SITES_FILE.pvp ?? {};
const SMITE_ONLY_REGIONS = new Set(PVP_BOT_CONFIG.smiteOnlyRegions ?? []);

/** How many wilderness bot names exist and how they spread over players' active regions. */
const PVP_BOT_SETTINGS = Object.freeze({
  botPool: Math.max(0, Math.floor(Number(PVP_BOT_CONFIG.botPool ?? 0))),
  activeRegionBotsPerRegion: Math.max(0, Math.floor(Number(PVP_BOT_CONFIG.activeRegionBotsPerRegion ?? 0))),
  activeRegionInset: Math.max(0, Math.floor(Number(PVP_BOT_CONFIG.activeRegionInset ?? 0))),
});

/** A bot-sites.json PvP site in the hotspot shape the PvP brain reads. */
function siteToHotspot(site, loadouts) {
  const { pvp } = site;
  const z = site.z ?? 0;
  const radius = site.radius ?? 6;
  let allowedLoadouts;
  if (pvp.loadouts !== undefined) {
    // An explicit list of loadout groups wins over the style's tags.
    const known = new Set(loadouts.map((loadout) => loadout.id));
    if (!Array.isArray(pvp.loadouts) || pvp.loadouts.length === 0) {
      throw new Error(`[bot sites] ${site.id}: pvp.loadouts must list at least one loadout`);
    }
    const unknown = pvp.loadouts.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`[bot sites] ${site.id}: unknown loadout ${unknown.join(", ")}`);
    }
    allowedLoadouts = [...new Set(pvp.loadouts)];
  } else {
    // f2p gear only joins f2p sites; a free world filters to f2p gear on its own.
    allowedLoadouts = loadouts
      .filter((loadout) => loadout.tags?.includes(pvp.style))
      .filter((loadout) => pvp.style === "f2p" || !loadout.tags.includes("f2p"))
      .map((loadout) => loadout.id);
    if (allowedLoadouts.length === 0) {
      throw new Error(`[bot sites] ${site.id}: no loadout is tagged '${pvp.style}'`);
    }
  }
  return {
    id: site.id,
    enabled: site.enabled === true,
    targetBots: site.bots,
    anchor: { x: site.x, y: site.y, z },
    area: site.area
      ? { ...site.area, z: site.area.z ?? z }
      : { minX: site.x - radius, maxX: site.x + radius, minY: site.y - radius, maxY: site.y + radius, z },
    roamRadius: pvp.roam,
    lingerMs: pvp.lingerMs,
    maxSimultaneousFights: pvp.maxFights,
    smiteOnly: pvp.smiteOnly === true,
    combatLevelRange: pvp.combat ? { min: pvp.combat[0], max: pvp.combat[1] } : undefined,
    allowedProfiles: pvp.profiles ?? listPvpProfiles().map((profile) => profile.id),
    allowedLoadouts,
    activityWeights: pvp.weights,
  };
}

function loadWildernessHotspots() {
  const loadoutFile = path.join(GameConstants.DEFINITIONS_DIRECTORY, "pvp-bot-loadouts.json");
  const loadouts = JSON.parse(fs.readFileSync(loadoutFile, "utf8")).loadouts ?? [];
  const hotspots = {};
  for (const site of (SITES_FILE.sites ?? []).filter((entry) => entry.pvp)) {
    if (!site.id || hotspots[site.id]) {
      throw new Error("[bot sites] PvP site ids must be unique");
    }
    hotspots[site.id] = freezeHotspot(siteToHotspot(site, loadouts));
  }
  return Object.freeze(hotspots);
}

const WILDERNESS_HOTSPOTS = loadWildernessHotspots();
const WILDERNESS_HOTSPOT_IDS = Object.freeze(Object.keys(WILDERNESS_HOTSPOTS));

function getWildernessHotspot(hotspotId) {
  return WILDERNESS_HOTSPOTS[hotspotId] ?? null;
}

function usesSmiteOnlyPrayers(player, state) {
  if (getWildernessHotspot(state?.pvp?.hotspotId)?.smiteOnly === true) return true;
  const location = player?.getLocation?.();
  return location != null && SMITE_ONLY_REGIONS.has(
    `${location.getZ()}:${location.getX() >> 6}:${location.getY() >> 6}`
  );
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
  _test: { siteToHotspot },
  PVP_BOT_SETTINGS,
  WILDERNESS_HOTSPOT_IDS,
  WILDERNESS_HOTSPOTS,
  createHotspotAnchorLocation,
  getEnabledWildernessHotspots,
  getWildernessHotspot,
  hotspotContainsLocation,
  isOutsideWildernessHotspots,
  listWildernessHotspots,
  usesSmiteOnlyPrayers,
};
