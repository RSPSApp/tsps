"use strict";

const { getPvpProfile, listPvpProfiles } = require("./PvpProfileRegistry");
const { getPvpLoadout, isLoadoutAvailable, listPvpLoadouts } = require("./PvpLoadoutRegistry");
const { isMembersWorld } = require("../../../../src/main/typescript/elvarg/game/definition/WorldDefinition");
const {
  getEnabledWildernessHotspots,
  getWildernessHotspot,
} = require("./WildernessHotspotRegistry");

function weightedPick(definitions, rng = Math.random) {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    return null;
  }
  const totalWeight = definitions.reduce((sum, definition) => {
    const weight = Number(definition?.weight ?? 0);
    return weight > 0 ? sum + weight : sum;
  }, 0);
  if (totalWeight <= 0) {
    return definitions[0]?.value ?? null;
  }
  let roll = rng() * totalWeight;
  for (const definition of definitions) {
    const weight = Number(definition?.weight ?? 0);
    if (weight <= 0) {
      continue;
    }
    roll -= weight;
    if (roll <= 0) {
      return definition.value;
    }
  }
  return definitions[definitions.length - 1]?.value ?? null;
}

function buildWeightTable(source, fallbackValues) {
  const values = Array.isArray(source) ? source : fallbackValues;
  return values
    .map((value) => {
      if (!value) {
        return null;
      }
      if (typeof value === "string") {
        return { value, weight: 1 };
      }
      if (typeof value.value === "string") {
        return { value: value.value, weight: Number(value.weight ?? 1) };
      }
      return null;
    })
    .filter((value) => value != null);
}

function resolveProfileId(config) {
  const fallbackIds = listPvpProfiles().map((profile) => profile.id);
  const source = config?.pvp?.profileWeights;
  return (
    weightedPick(buildWeightTable(source, fallbackIds)) ??
    "standard"
  );
}

function resolveHotspotProfileId(config, hotspotId) {
  const hotspot = hotspotId ? getWildernessHotspot(hotspotId) : null;
  const allowedProfiles = Array.isArray(hotspot?.allowedProfiles) && hotspot.allowedProfiles.length > 0
    ? hotspot.allowedProfiles
    : listPvpProfiles().map((profile) => profile.id);
  const configured = buildWeightTable(config?.pvp?.profileWeights, allowedProfiles)
    .filter((entry) => allowedProfiles.includes(entry.value));
  return weightedPick(configured.length > 0 ? configured : allowedProfiles) ?? allowedProfiles[0] ?? "standard";
}

function resolveHotspotId(config, profileId) {
  const enabledHotspots = getEnabledWildernessHotspots();
  if (enabledHotspots.length === 0) {
    return null;
  }
  const configured = buildWeightTable(
    config?.pvp?.hotspotWeights,
    enabledHotspots.map((hotspot) => hotspot.id)
  ).filter((entry) => enabledHotspots.some((hotspot) => hotspot.id === entry.value));
  if (configured.length === 0) {
    return enabledHotspots[0].id;
  }
  const preferred = configured.filter((entry) => {
    const hotspot = getWildernessHotspot(entry.value);
    return hotspot?.allowedProfiles?.includes(profileId);
  });
  return weightedPick(preferred.length > 0 ? preferred : configured) ?? enabledHotspots[0].id;
}

function resolveLoadoutId(config, hotspotId) {
  const fallbackIds = listPvpLoadouts().map((loadout) => loadout.id).filter(isLoadoutAvailable);
  const configured = buildWeightTable(config?.pvp?.loadoutWeights, fallbackIds)
    .filter((entry) => isLoadoutAvailable(entry.value));
  const hotspot = hotspotId ? getWildernessHotspot(hotspotId) : null;
  const filtered = configured.filter((entry) => {
    const loadout = getPvpLoadout(entry.value);
    if (hotspotId != null && !loadout.hotspots.includes(hotspotId)) {
      return false;
    }
    if (Array.isArray(hotspot?.allowedLoadouts) && hotspot.allowedLoadouts.length > 0) {
      return hotspot.allowedLoadouts.includes(loadout.id);
    }
    return true;
  });
  return weightedPick(filtered) ?? hotspot?.allowedLoadouts?.find(isLoadoutAvailable) ?? weightedPick(configured) ?? fallbackIds[0];
}

function resolveRoamingLoadoutId(config, options = {}) {
  const excludeF2p = options.excludeF2p !== false;
  // Members worlds keep roamers off f2p gear by default; free worlds only have f2p gear.
  const allowed = (loadoutId) =>
    isLoadoutAvailable(loadoutId) && (!isMembersWorld() || !excludeF2p || !loadoutId.startsWith("f2p_"));
  const fallbackIds = listPvpLoadouts()
    .map((loadout) => loadout.id)
    .filter(allowed);
  const configured = buildWeightTable(config?.pvp?.loadoutWeights, fallbackIds).filter((entry) =>
    allowed(entry.value)
  );
  return weightedPick(configured.length > 0 ? configured : fallbackIds.map((value) => ({ value, weight: 1 }))) ?? fallbackIds[0];
}

function resolveAlternativeLoadoutId(config, hotspotId, currentLoadoutId) {
  const fallbackIds = listPvpLoadouts().map((loadout) => loadout.id).filter(isLoadoutAvailable);
  const configured = buildWeightTable(config?.pvp?.loadoutWeights, fallbackIds)
    .filter((entry) => isLoadoutAvailable(entry.value));
  const hotspot = hotspotId ? getWildernessHotspot(hotspotId) : null;
  const filtered = configured.filter((entry) => {
    const loadout = getPvpLoadout(entry.value);
    if (hotspotId != null && !loadout.hotspots.includes(hotspotId)) {
      return false;
    }
    if (Array.isArray(hotspot?.allowedLoadouts) && hotspot.allowedLoadouts.length > 0) {
      return hotspot.allowedLoadouts.includes(loadout.id);
    }
    return true;
  });
  const alternatives = filtered.filter((entry) => entry.value !== currentLoadoutId);
  if (alternatives.length > 0) {
    return weightedPick(alternatives) ?? currentLoadoutId ?? alternatives[0]?.value ?? null;
  }
  return weightedPick(filtered) ?? hotspot?.allowedLoadouts?.find(isLoadoutAvailable) ?? weightedPick(configured) ?? currentLoadoutId ?? fallbackIds[0];
}

function buildRoamingPvpMetadata({
  config = {},
  excludeF2p = true,
} = {}) {
  const profileId = resolveProfileId(config);
  const loadoutId = resolveRoamingLoadoutId(config, { excludeF2p });
  const profile = getPvpProfile(profileId);
  return {
    profileId: profile.id,
    loadoutId,
    hotspotId: null,
    engagementStyle: "roaming",
    preferredCombatStyle:
      getPvpLoadout(loadoutId).tags.includes("hybrid")
        ? "hybrid"
        : getPvpLoadout(loadoutId).tags.includes("range")
        ? "range"
        : "melee",
    escapeThreshold: profile.retreatHpRatio,
    riskTolerance: profile.riskTolerance,
    confidenceTier: profile.confidenceTier,
  };
}

function buildHotspotPvpMetadata({
  config = {},
  hotspotId = null,
} = {}) {
  const profileId = resolveHotspotProfileId(config, hotspotId);
  const loadoutId = resolveLoadoutId(config, hotspotId);
  const profile = getPvpProfile(profileId);
  return {
    profileId: profile.id,
    loadoutId,
    hotspotId,
    engagementStyle: hotspotId ? "hotspot" : "roaming",
    preferredCombatStyle:
      getPvpLoadout(loadoutId).tags.includes("hybrid")
        ? "hybrid"
        : getPvpLoadout(loadoutId).tags.includes("range")
        ? "range"
        : "melee",
    escapeThreshold: profile.retreatHpRatio,
    riskTolerance: profile.riskTolerance,
    confidenceTier: profile.confidenceTier,
  };
}

function assignPvpMetadata(state, options = {}) {
  if (!state?.pvp) {
    return state;
  }
  const metadata =
    options?.metadata && typeof options.metadata === "object"
      ? options.metadata
      : buildRoamingPvpMetadata(options);
  state.pvp.profileId = metadata.profileId;
  state.pvp.loadoutId = metadata.loadoutId;
  state.pvp.hotspotId = metadata.hotspotId;
  state.pvp.engagementStyle = metadata.engagementStyle;
  state.pvp.preferredCombatStyle = metadata.preferredCombatStyle;
  state.pvp.escapeThreshold = metadata.escapeThreshold;
  state.pvp.riskTolerance = metadata.riskTolerance;
  state.pvp.confidenceTier = metadata.confidenceTier;
  return state;
}

module.exports = {
  assignPvpMetadata,
  buildHotspotPvpMetadata,
  buildRoamingPvpMetadata,
  getPvpLoadout,
  getPvpProfile,
  getWildernessHotspot,
  resolveAlternativeLoadoutId,
};
