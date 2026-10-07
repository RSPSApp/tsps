const fs = require("fs");
const path = require("path");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const { PacketBuilder } = require("../../src/main/typescript/elvarg/net/packet/PacketBuilder");
const { PacketType } = require("../../src/main/typescript/elvarg/net/packet/PacketType");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { generateBuildingsForRegion, generateSingleHouseForRegion } = require("./BuildingUtil");
const { generateStreetTownForRegion } = require("./TownUtil");
const { ObjectType } = require("./ObjectType");
const {
  writeAnalysisReport,
  writeLearnedPresetFile,
  writeHouseExample,
  checkHouseBoundary,
  decodeRegionObjects,
  decodeRegionTerrainData,
  HOUSE_DUMP_DIRECTORY,
  initRegionBuildingAnalysisCoreAccess,
} = require("./RegionBuildingAnalysisUtil");
const { dumpTerrainBiome, loadTerrainBiome } = require("./TerrainBiomeUtil");

const PROCEDURAL_REGION_OPCODE = 12;
const REGION_PACKET_TYPE = Object.freeze({
  META: 0,
  CHUNK: 1,
  END: 2,
  ERROR: 3,
  CLEAR: 4,
});
const CHUNK_TEXT_SIZE = 220;
const REGION_SIZE = 64;
const REGION_PLANES = 4;
const PROCEDURAL_FLOOR_OVERLAYS_ENABLED = true;

let requestCounter = 0;
const playerProceduralRegionOverrides = new Map();
const playerProceduralRegionPayloads = new Map();
const regionProceduralClipOverrides = new Map();

function parseIntArg(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSeed(seedArg) {
  const parsed = parseIntArg(seedArg);
  if (parsed === null) {
    return (Date.now() & 0x7fffffff) >>> 0;
  }
  return parsed >>> 0;
}

function sanitizeStyleTag(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) {
    return "";
  }
  return text.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeHouseType(raw) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return null;
  }
  const normalized = text
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

function regionId(regionX, regionY) {
  return ((regionX & 0xff) << 8) | (regionY & 0xff);
}

function getPlayerOverrideKey(player) {
  const username = String(player?.getUsername?.() ?? "").trim().toLowerCase();
  return username || null;
}

function getOrCreatePlayerOverrideSet(player) {
  const key = getPlayerOverrideKey(player);
  if (!key) {
    return null;
  }
  let set = playerProceduralRegionOverrides.get(key);
  if (!set) {
    set = new Set();
    playerProceduralRegionOverrides.set(key, set);
  }
  return set;
}

function trackPlayerOverrideRegion(player, id) {
  if (!Number.isInteger(id) || id < 0) {
    return;
  }
  const set = getOrCreatePlayerOverrideSet(player);
  if (!set) {
    return;
  }
  set.add(id);
}

function clearTrackedOverrideRegionsForPlayer(player) {
  const key = getPlayerOverrideKey(player);
  if (!key) {
    return;
  }
  playerProceduralRegionOverrides.delete(key);
  playerProceduralRegionPayloads.delete(key);
}

function getTrackedOverrideRegionsForPlayer(player) {
  const key = getPlayerOverrideKey(player);
  if (!key) {
    return null;
  }
  return playerProceduralRegionOverrides.get(key) ?? null;
}

function trackPlayerRegionPayload(player, payload) {
  const key = getPlayerOverrideKey(player);
  const regionIdValue = payload?.regionId | 0;
  if (!key || !payload || !Number.isInteger(regionIdValue) || regionIdValue < 0) {
    return;
  }
  let perPlayer = playerProceduralRegionPayloads.get(key);
  if (!perPlayer) {
    perPlayer = new Map();
    playerProceduralRegionPayloads.set(key, perPlayer);
  }
  perPlayer.set(regionIdValue, payload);
}

function getTrackedRegionPayload(player, regionIdValue) {
  const key = getPlayerOverrideKey(player);
  if (!key || !Number.isInteger(regionIdValue) || regionIdValue < 0) {
    return null;
  }
  const perPlayer = playerProceduralRegionPayloads.get(key);
  if (!perPlayer) {
    return null;
  }
  return perPlayer.get(regionIdValue) ?? null;
}

function createEmptyClipGrid() {
  return Array.from({ length: REGION_PLANES }, () => Array.from({ length: REGION_SIZE }, () => new Array(REGION_SIZE).fill(0)));
}

function resetRegionToTerrainOnlyClipping(regionId) {
  if (!Number.isInteger(regionId) || regionId < 0) {
    return { appliedTerrainTiles: 0, terrainData: null };
  }
  const region = RegionManager.getRegionid(regionId);
  if (!region) {
    return { appliedTerrainTiles: 0, terrainData: null };
  }

  region.clips = createEmptyClipGrid();

  const terrainData = decodeRegionTerrainData(regionId);
  if (!terrainData) {
    return { appliedTerrainTiles: 0, terrainData: null };
  }

  const absX = ((regionId >> 8) & 0xff) * REGION_SIZE;
  const absY = (regionId & 0xff) * REGION_SIZE;
  let appliedTerrainTiles = 0;
  for (let z = 0; z < REGION_PLANES; z++) {
    for (let localX = 0; localX < REGION_SIZE; localX++) {
      for (let localY = 0; localY < REGION_SIZE; localY++) {
        const flags = terrainData?.flags?.[z]?.[localX]?.[localY] | 0;
        if ((flags & 1) !== 1) {
          continue;
        }
        let height = z;
        if (((terrainData?.flags?.[1]?.[localX]?.[localY] | 0) & 2) === 2) {
          height--;
        }
        if (height < 0 || height >= REGION_PLANES) {
          continue;
        }
        RegionManager.addClipping(absX + localX, absY + localY, height, 0x200000, null, region);
        appliedTerrainTiles++;
      }
    }
  }

  return { appliedTerrainTiles, terrainData };
}

function applyCacheObjectClipping(regionId, terrainData) {
  const objects = decodeRegionObjects(regionId);
  const absX = ((regionId >> 8) & 0xff) * REGION_SIZE;
  const absY = (regionId & 0xff) * REGION_SIZE;
  let restoredObjects = 0;

  for (const obj of objects) {
    const id = obj?.id | 0;
    if (id <= 0) {
      continue;
    }
    const localX = (obj?.x | 0) - absX;
    const localY = (obj?.y | 0) - absY;
    if (localX < 0 || localX >= REGION_SIZE || localY < 0 || localY >= REGION_SIZE) {
      continue;
    }
    let height = obj?.z | 0;
    if (((terrainData?.flags?.[1]?.[localX]?.[localY] | 0) & 2) === 2) {
      height--;
    }
    if (height < 0 || height >= REGION_PLANES) {
      continue;
    }
    const type = clamp(obj?.type | 0, ObjectType.MIN, ObjectType.MAX);
    const orientation = (obj?.orientation | 0) & 0x3;
    try {
      RegionManager.addObjectClipping(new GameObject(id, new Location(obj.x | 0, obj.y | 0, height), type, orientation, null));
      restoredObjects++;
    } catch {
      // Ignore invalid cache object clipping entries.
    }
  }

  return restoredObjects;
}

function clearProceduralRegionClipping(regionId) {
  const reset = resetRegionToTerrainOnlyClipping(regionId);
  if (!reset.terrainData) {
    regionProceduralClipOverrides.delete(regionId);
    return 0;
  }
  const restoredObjects = applyCacheObjectClipping(regionId, reset.terrainData);
  regionProceduralClipOverrides.delete(regionId);
  return restoredObjects;
}

function buildProceduralClipObjects(payload) {
  if (!payload || !Array.isArray(payload.buildingPlacements)) {
    return [];
  }
  const baseX = (payload.regionX | 0) * REGION_SIZE;
  const baseY = (payload.regionY | 0) * REGION_SIZE;
  const objects = [];
  for (const placement of payload.buildingPlacements) {
    const id = placement?.id | 0;
    if (id <= 0) {
      continue;
    }
    const localX = placement?.x | 0;
    const localY = placement?.y | 0;
    const z = placement?.z | 0;
    if (localX < 0 || localX >= REGION_SIZE || localY < 0 || localY >= REGION_SIZE || z < 0 || z >= REGION_PLANES) {
      continue;
    }
    const type = clamp(placement?.type | 0, ObjectType.MIN, ObjectType.MAX);
    const orientation = (placement?.orientation | 0) & 0x3;
    objects.push(new GameObject(id, new Location(baseX + localX, baseY + localY, z), type, orientation, null));
  }
  return objects;
}

function applyProceduralRegionClipping(payload) {
  const regionIdValue = payload?.regionId | 0;
  if (!Number.isInteger(regionIdValue) || regionIdValue < 0) {
    return { cleared: 0, applied: 0 };
  }
  const reset = resetRegionToTerrainOnlyClipping(regionIdValue);
  const cleared = reset.appliedTerrainTiles;
  if (!reset.terrainData) {
    return { cleared, applied: 0 };
  }
  const objects = buildProceduralClipObjects(payload);
  let applied = 0;
  for (const object of objects) {
    try {
      RegionManager.addObjectClipping(object);
      applied++;
    } catch {
      // Ignore invalid object clipping cases.
    }
  }
  if (applied > 0) {
    regionProceduralClipOverrides.set(regionIdValue, true);
  } else {
    regionProceduralClipOverrides.delete(regionIdValue);
  }
  return { cleared, applied };
}

function clearProceduralClippingForPlayer(player) {
  const tracked = getTrackedOverrideRegionsForPlayer(player);
  if (!tracked || tracked.size === 0) {
    clearTrackedOverrideRegionsForPlayer(player);
    return 0;
  }
  let cleared = 0;
  for (const regionIdValue of tracked) {
    cleared += clearProceduralRegionClipping(regionIdValue);
  }
  clearTrackedOverrideRegionsForPlayer(player);
  return cleared;
}

function tileNoise(x, y, seed) {
  let n =
    (Math.imul(x | 0, 374761393) +
      Math.imul(y | 0, 668265263) +
      Math.imul(seed | 0, 2147483647)) |
    0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = n ^ (n >>> 16);
  return n & 0xff;
}

function smoothedNoise(x, y, seed) {
  const corners =
    tileNoise(x - 1, y - 1, seed) +
    tileNoise(x + 1, y - 1, seed) +
    tileNoise(x - 1, y + 1, seed) +
    tileNoise(x + 1, y + 1, seed);
  const sides =
    tileNoise(x - 1, y, seed) +
    tileNoise(x + 1, y, seed) +
    tileNoise(x, y - 1, seed) +
    tileNoise(x, y + 1, seed);
  const center = tileNoise(x, y, seed);
  return ((corners >> 4) + (sides >> 3) + (center >> 2)) & 0xff;
}

function legacyNoise(x, y) {
  let n = x + y * 57;
  n = (n << 13) ^ n;
  const nn = Math.imul(n, Math.imul(Math.imul(n, n), 15731) + 789221) + 1376312589;
  const raw = nn & 0x7fffffff;
  return (raw >> 19) & 0xff;
}

function legacySmoothNoise(x, y) {
  const corners =
    legacyNoise(x - 1, y - 1) +
    legacyNoise(x + 1, y - 1) +
    legacyNoise(x - 1, y + 1) +
    legacyNoise(x + 1, y + 1);
  const sides =
    legacyNoise(x - 1, y) +
    legacyNoise(x + 1, y) +
    legacyNoise(x, y - 1) +
    legacyNoise(x, y + 1);
  const center = legacyNoise(x, y);
  return ((corners >> 4) + (sides >> 3) + (center >> 2)) | 0;
}

function legacyInterpolate(a, b, angle, frequencyReciprocal) {
  const theta = (angle * Math.PI) / frequencyReciprocal;
  const cosine = (65536 - ((Math.cos(theta) * 65536) | 0)) >> 1;
  return ((a * (65536 - cosine)) >> 16) + ((b * cosine) >> 16);
}

function legacyInterpolatedNoise(x, y, frequencyReciprocal) {
  const l = Math.floor(x / frequencyReciprocal);
  const i1 = x & (frequencyReciprocal - 1);
  const j1 = Math.floor(y / frequencyReciprocal);
  const k1 = y & (frequencyReciprocal - 1);
  const l1 = legacySmoothNoise(l, j1);
  const i2 = legacySmoothNoise(l + 1, j1);
  const j2 = legacySmoothNoise(l, j1 + 1);
  const k2 = legacySmoothNoise(l + 1, j1 + 1);
  const l2 = legacyInterpolate(l1, i2, i1, frequencyReciprocal);
  const i3 = legacyInterpolate(j2, k2, i1, frequencyReciprocal);
  return legacyInterpolate(l2, i3, k1, frequencyReciprocal);
}

function legacyVertexHeight(worldX, worldY) {
  let mapHeight =
    legacyInterpolatedNoise(worldX + 45365, worldY + 91923, 4) -
    128 +
    ((legacyInterpolatedNoise(worldX + 10294, worldY + 37821, 2) - 128) >> 1) +
    ((legacyInterpolatedNoise(worldX, worldY, 1) - 128) >> 2);
  mapHeight = (mapHeight * 0.3 + 35) | 0;
  if (mapHeight < 10) {
    mapHeight = 10;
  } else if (mapHeight > 60) {
    mapHeight = 60;
  }
  return mapHeight;
}

function proceduralTerrainHeight(worldX, worldY, plane, seed) {
  // Match classic RS317 terrain amplitude (10..60) and plane offset behavior.
  // Seed shifts the sampled domain to keep deterministic but varied outputs.
  const seedShiftX = ((seed >>> 8) & 0x3ff) - 512;
  const seedShiftY = ((seed >>> 18) & 0x3ff) - 512;
  const baseHeight = legacyVertexHeight(worldX + seedShiftX, worldY + seedShiftY);
  const detailNoise = smoothedNoise(worldX, worldY, seed) - 128;
  const detailed = baseHeight + Math.round(detailNoise / 24);
  const planePenalty = plane * 30;
  return Math.max(4, Math.min(120, detailed - planePenalty));
}

function flattenHeightsAroundRect(heights, rect, size) {
  const outerMinX = Math.max(0, rect.x - 2);
  const outerMinY = Math.max(0, rect.y - 2);
  const outerMaxX = Math.min(size - 1, rect.x + rect.w + 1);
  const outerMaxY = Math.min(size - 1, rect.y + rect.h + 1);
  const innerMinX = Math.max(0, rect.x + 1);
  const innerMinY = Math.max(0, rect.y + 1);
  const innerMaxX = Math.min(size - 1, rect.x + rect.w - 2);
  const innerMaxY = Math.min(size - 1, rect.y + rect.h - 2);

  const samples = [];
  for (let x = outerMinX; x <= outerMaxX; x++) {
    for (let y = outerMinY; y <= outerMaxY; y++) {
      const insideInner = x >= innerMinX && x <= innerMaxX && y >= innerMinY && y <= innerMaxY;
      if (!insideInner) {
        samples.push(heights[x][y]);
      }
    }
  }
  if (samples.length === 0) {
    return;
  }
  const average = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  for (let x = outerMinX; x <= outerMaxX; x++) {
    for (let y = outerMinY; y <= outerMaxY; y++) {
      heights[x][y] = average;
    }
  }
}

function generateRegionPayload(regionX, regionY, seed, options = null) {
  const customPlacementsMode = Array.isArray(options?.buildingPlacements);
  const terrainUnderlayIds = Array.isArray(options?.terrainUnderlayIds)
    ? options.terrainUnderlayIds.filter((id) => Number.isInteger(id) && id > 0).map((id) => id | 0)
    : [];
  const tileCount = REGION_PLANES * REGION_SIZE * REGION_SIZE;
  const heights = Buffer.allocUnsafe(tileCount * 2);
  const overlays = Buffer.allocUnsafe(tileCount);
  const underlays = Buffer.allocUnsafe(tileCount);
  const flags = Buffer.allocUnsafe(tileCount);

  const baseHeights = Array.from({ length: REGION_SIZE }, () => Array(REGION_SIZE).fill(0));
  for (let localX = 0; localX < REGION_SIZE; localX++) {
    for (let localY = 0; localY < REGION_SIZE; localY++) {
      const worldX = regionX * REGION_SIZE + localX;
      const worldY = regionY * REGION_SIZE + localY;
      baseHeights[localX][localY] = proceduralTerrainHeight(worldX, worldY, 0, seed);
    }
  }

  const generatedBuildings = customPlacementsMode
    ? {
        buildings: Array.isArray(options?.buildings) ? options.buildings : [],
        floorPatches: Array.isArray(options?.floorPatches) ? options.floorPatches : [],
        placements: options.buildingPlacements,
      }
    : generateBuildingsForRegion(regionX, regionY, seed, REGION_SIZE, baseHeights);

  if (customPlacementsMode && Array.isArray(options?.flattenRects)) {
    for (const rect of options.flattenRects) {
      const w = Math.max(1, rect?.w | 0);
      const h = Math.max(1, rect?.h | 0);
      const x = rect?.x | 0;
      const y = rect?.y | 0;
      flattenHeightsAroundRect(baseHeights, { x, y, w, h }, REGION_SIZE);
    }
  }

  let tileIndex = 0;
  for (let plane = 0; plane < REGION_PLANES; plane++) {
    for (let localX = 0; localX < REGION_SIZE; localX++) {
      for (let localY = 0; localY < REGION_SIZE; localY++) {
        const worldX = regionX * REGION_SIZE + localX;
        const worldY = regionY * REGION_SIZE + localY;
        const plane0Height = baseHeights[localX][localY];
        const heightValue = Math.max(4, plane0Height - plane * 30);
        heights.writeUInt16LE(heightValue & 0xffff, tileIndex * 2);

        let overlay = 0;
        let underlay = 0;
        if (plane === 0) {
          // Keep world terrain mostly natural/grass-like; avoid blue/grey overlays.
          if (terrainUnderlayIds.length > 0) {
            const underlayNoise = smoothedNoise(worldX + 31, worldY + 17, seed ^ 0x4d3f9b);
            const paletteIndex = Math.min(
              terrainUnderlayIds.length - 1,
              ((underlayNoise * terrainUnderlayIds.length) / 256) | 0
            );
            underlay = terrainUnderlayIds[paletteIndex] | 0;
          } else {
            underlay = 1;
          }
          if (underlay <= 0) {
            underlay = 1;
          }
          overlay = 0;
        }

        overlays[tileIndex] = overlay;
        underlays[tileIndex] = underlay;
        flags[tileIndex] = 0;
        tileIndex++;
      }
    }
  }

  if (PROCEDURAL_FLOOR_OVERLAYS_ENABLED) {
    // Paint procedural building floors into plane-aware underlay/overlay data.
    for (const patch of generatedBuildings.floorPatches) {
      const startX = Math.max(0, patch.x | 0);
      const startY = Math.max(0, patch.y | 0);
      const endX = Math.min(REGION_SIZE, startX + (patch.width | 0));
      const endY = Math.min(REGION_SIZE, startY + (patch.height | 0));
      const floorOverlay = (patch.underlay | 0) & 0xff;
      const plane = clamp(Number.isInteger(patch?.z) ? patch.z : 0, 0, REGION_PLANES - 1);
      const planeOffset = plane * REGION_SIZE * REGION_SIZE;

      for (let localX = startX; localX < endX; localX++) {
        for (let localY = startY; localY < endY; localY++) {
          const idx = planeOffset + localX * REGION_SIZE + localY;
          underlays[idx] = 1;
          overlays[idx] = floorOverlay;
        }
      }
    }
  }

  // Match roof-removal behavior: tile flag bit 4 under roofed buildings.
  // Stamp across planes so roof checks still work when the player/camera plane changes.
  const writeRoofFlagAt = (localX, localY) => {
    if (localX < 0 || localX >= REGION_SIZE || localY < 0 || localY >= REGION_SIZE) {
      return;
    }
    for (let plane = 0; plane < REGION_PLANES; plane++) {
      const idx = plane * REGION_SIZE * REGION_SIZE + localX * REGION_SIZE + localY;
      flags[idx] = (flags[idx] | 4) & 0xff;
    }
  };
  const roofFlagRects = customPlacementsMode
    ? Array.isArray(options?.roofFlagRects)
      ? options.roofFlagRects
      : generatedBuildings.buildings
    : generatedBuildings.buildings;
  for (const rect of roofFlagRects) {
    const startX = Math.max(0, rect?.x | 0);
    const startY = Math.max(0, rect?.y | 0);
    const rectWidth = Math.max(1, (rect?.width ?? rect?.w ?? 1) | 0);
    const rectHeight = Math.max(1, (rect?.height ?? rect?.h ?? 1) | 0);
    const endX = Math.min(REGION_SIZE, startX + rectWidth);
    const endY = Math.min(REGION_SIZE, startY + rectHeight);
    for (let localX = startX; localX < endX; localX++) {
      for (let localY = startY; localY < endY; localY++) {
        writeRoofFlagAt(localX, localY);
      }
    }
  }

  if (customPlacementsMode && Array.isArray(options?.explicitRoofFlagTiles)) {
    for (const tile of options.explicitRoofFlagTiles) {
      const localX = tile?.x | 0;
      const localY = tile?.y | 0;
      writeRoofFlagAt(localX, localY);
    }
  }

  // Optional explicit per-plane flags (for bridge/render-below and other map bits).
  if (customPlacementsMode && Array.isArray(options?.explicitFlagTiles)) {
    for (const tile of options.explicitFlagTiles) {
      const localX = tile?.x | 0;
      const localY = tile?.y | 0;
      const plane = clamp(tile?.z | 0, 0, REGION_PLANES - 1);
      const flagMask = (tile?.flag | 0) & 0xff;
      if (localX < 0 || localX >= REGION_SIZE || localY < 0 || localY >= REGION_SIZE || flagMask === 0) {
        continue;
      }
      const idx = plane * REGION_SIZE * REGION_SIZE + localX * REGION_SIZE + localY;
      flags[idx] = (flags[idx] | flagMask) & 0xff;
    }
  }

  if (PROCEDURAL_FLOOR_OVERLAYS_ENABLED && customPlacementsMode && Array.isArray(options?.explicitOverlayTiles)) {
    for (const tile of options.explicitOverlayTiles) {
      const localX = tile?.x | 0;
      const localY = tile?.y | 0;
      const plane = clamp(tile?.z | 0, 0, REGION_PLANES - 1);
      const overlayValue = Number.isInteger(tile?.overlay) ? tile.overlay & 0xff : null;
      if (localX < 0 || localX >= REGION_SIZE || localY < 0 || localY >= REGION_SIZE || overlayValue === null) {
        continue;
      }
      const idx = plane * REGION_SIZE * REGION_SIZE + localX * REGION_SIZE + localY;
      overlays[idx] = overlayValue;
      if (overlayValue > 0 && underlays[idx] === 0) {
        underlays[idx] = 1;
      }
    }
  }

  return {
    v: 1,
    regionX,
    regionY,
    regionId: regionId(regionX, regionY),
    seed,
    size: REGION_SIZE,
    planes: REGION_PLANES,
    heightsB64: heights.toString("base64"),
    overlaysB64: overlays.toString("base64"),
    underlaysB64: underlays.toString("base64"),
    flagsB64: flags.toString("base64"),
    buildings: generatedBuildings.buildings,
    buildingPlacements: generatedBuildings.placements,
  };
}

function splitIntoChunks(text, maxChunkSize) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxChunkSize) {
    chunks.push(text.slice(i, i + maxChunkSize));
  }
  return chunks;
}

function sendProceduralPacket(player, type, requestId, mapRegionId, chunkIndex, chunkCount, payloadText) {
  const packet = new PacketBuilder(PROCEDURAL_REGION_OPCODE, PacketType.VARIABLE);
  packet
    .put(type)
    .putShort(requestId)
    .putInt(mapRegionId)
    .putShort(chunkIndex)
    .putShort(chunkCount)
    .putString(payloadText || "");
  player.getSession().write(packet);
}

function streamProceduralPayload(player, payload, messagePrefix = "[proc-region] streamed region", options = null) {
  const requestId = ++requestCounter & 0xffff;
  const regionX = payload.regionX;
  const regionY = payload.regionY;
  const seed = payload.seed;
  const mapRegionId = payload.regionId;
  const trackOverride = options?.trackOverride !== false;
  const silent = options?.silent === true;

  const json = JSON.stringify(payload);
  const chunks = splitIntoChunks(json, CHUNK_TEXT_SIZE);

  const meta = JSON.stringify({
    v: payload.v,
    requestId,
    regionX,
    regionY,
    regionId: mapRegionId,
    chunkCount: chunks.length,
    jsonLength: json.length,
  });

  sendProceduralPacket(player, REGION_PACKET_TYPE.META, requestId, mapRegionId, 0, chunks.length, meta);

  for (let i = 0; i < chunks.length; i++) {
    sendProceduralPacket(player, REGION_PACKET_TYPE.CHUNK, requestId, mapRegionId, i, chunks.length, chunks[i]);
  }

  sendProceduralPacket(player, REGION_PACKET_TYPE.END, requestId, mapRegionId, chunks.length, chunks.length, String(json.length));

  if (trackOverride) {
    applyProceduralRegionClipping(payload);
    trackPlayerOverrideRegion(player, mapRegionId);
    trackPlayerRegionPayload(player, payload);
  }
  if (!silent) {
    player.sendMessage(
      `${messagePrefix} ${regionX},${regionY} seed=${seed} request=${requestId} chunks=${chunks.length}`
    );
  }
}

function sendProceduralClear(player) {
  const requestId = ++requestCounter & 0xffff;
  sendProceduralPacket(player, REGION_PACKET_TYPE.CLEAR, requestId, 0, 0, 0, "clear_all");
}

function streamProceduralRegion(player, regionX, regionY, seed) {
  const payload = generateRegionPayload(regionX, regionY, seed);
  streamProceduralPayload(player, payload);
}

function loadHouseDump(styleTag) {
  const safeTag = sanitizeStyleTag(styleTag);
  if (!safeTag) {
    throw new Error("Invalid style tag.");
  }
  const filePath = path.join(HOUSE_DUMP_DIRECTORY, `${safeTag}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No house dump found for '${safeTag}'.`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || !Array.isArray(parsed.examples) || parsed.examples.length === 0) {
    throw new Error(`House dump '${safeTag}' has no examples.`);
  }
  return {
    filePath,
    styleTag: safeTag,
    examples: parsed.examples,
  };
}

function buildHousePayloadAtPlayer(player, styleTag, indexArg) {
  const location = player.getLocation();
  const regionX = (location.getX() / REGION_SIZE) | 0;
  const regionY = (location.getY() / REGION_SIZE) | 0;
  const localPlayerX = location.getX() - regionX * REGION_SIZE;
  const localPlayerY = location.getY() - regionY * REGION_SIZE;
  const playerZ = location.getZ() | 0;

  const dump = loadHouseDump(styleTag);
  let index = indexArg;
  if (index === null || index === undefined) {
    index = (Math.random() * dump.examples.length) | 0;
  }
  if (!Number.isInteger(index) || index < 0 || index >= dump.examples.length) {
    throw new Error(`Invalid house index ${index}. Available range: 0..${dump.examples.length - 1}.`);
  }

  const example = dump.examples[index];
  const bounds = example?.bounds;
  const samplePlayer = example?.playerLocation;
  const layoutObjects = Array.isArray(example?.layoutObjects) ? example.layoutObjects : [];
  if (!bounds || !samplePlayer || layoutObjects.length === 0) {
    throw new Error("Selected house example is missing bounds/player/layout data.");
  }

  const minX = bounds.minX | 0;
  const minY = bounds.minY | 0;
  const width = Math.max(1, Number.isInteger(bounds.width) ? bounds.width : ((bounds.maxX | 0) - minX + 1));
  const height = Math.max(1, Number.isInteger(bounds.height) ? bounds.height : ((bounds.maxY | 0) - minY + 1));

  let playerOffsetX = (samplePlayer.x | 0) - minX;
  let playerOffsetY = (samplePlayer.y | 0) - minY;
  if (playerOffsetX < 0 || playerOffsetX >= width) {
    playerOffsetX = (width / 2) | 0;
  }
  if (playerOffsetY < 0 || playerOffsetY >= height) {
    playerOffsetY = (height / 2) | 0;
  }

  const targetMinLocalX = localPlayerX - playerOffsetX;
  const targetMinLocalY = localPlayerY - playerOffsetY;
  if (
    targetMinLocalX < 0 ||
    targetMinLocalY < 0 ||
    targetMinLocalX + width > REGION_SIZE ||
    targetMinLocalY + height > REGION_SIZE
  ) {
    throw new Error("Not enough room in this 64x64 region. Stand farther from region edges and retry.");
  }

  const samplePlayerZ = samplePlayer.z | 0;
  const zOffset = playerZ - samplePlayerZ;
  const buildingPlacements = [];
  for (const obj of layoutObjects) {
    const id = obj?.id | 0;
    if (id <= 0) {
      continue;
    }
    const localX = targetMinLocalX + (obj?.x | 0);
    const localY = targetMinLocalY + (obj?.y | 0);
    const localZ = (obj?.z | 0) + zOffset;
    if (localX < 0 || localX >= REGION_SIZE || localY < 0 || localY >= REGION_SIZE || localZ < 0 || localZ >= REGION_PLANES) {
      continue;
    }
    const type = clamp(obj?.type | 0, ObjectType.MIN, ObjectType.MAX);
    if (type === ObjectType.GROUND_DECOR) {
      continue;
    }
    const relativeX = obj?.x | 0;
    const relativeY = obj?.y | 0;
    const isPerimeterTile =
      relativeX <= 0 || relativeX >= width - 1 || relativeY <= 0 || relativeY >= height - 1;
    if (type === ObjectType.WALL_DECORATION && isPerimeterTile) {
      continue;
    }
    const orientation = (obj?.orientation | 0) & 0x3;
    buildingPlacements.push({
      id,
      x: localX,
      y: localY,
      z: localZ,
      type,
      orientation,
    });
  }

  if (buildingPlacements.length === 0) {
    throw new Error("Selected house example produced no in-bounds placements for current location.");
  }

  const highestZ = buildingPlacements.reduce((max, obj) => Math.max(max, obj.z), 0);
  const lowestZ = buildingPlacements.reduce((min, obj) => Math.min(min, obj.z), REGION_PLANES - 1);
  const floors = highestZ - playerZ + 1;
  const rect = { x: targetMinLocalX, y: targetMinLocalY, w: width, h: height };
  const explicitFlagMap = new Map();
  const explicitOverlayMap = new Map();
  const tileKey = (x, y, z) => `${x},${y},${z}`;
  const isWithinHouseBounds = (x, y) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
  const isWithinHouseInterior = (x, y) => x > rect.x && x < rect.x + rect.w - 1 && y > rect.y && y < rect.y + rect.h - 1;
  const addFlagTile = (x, y, z, flag) => {
    const localX = x | 0;
    const localY = y | 0;
    const plane = clamp(z | 0, 0, REGION_PLANES - 1);
    const rawFlagMask = (flag | 0) & 0xff;
    // Do not replay bridge/force-lowest-plane bits in relocated house instances;
    // these can incorrectly push object logic/rendering to lower planes.
    const flagMask = rawFlagMask & ~0x0a;
    if (localX < 0 || localX >= REGION_SIZE || localY < 0 || localY >= REGION_SIZE || flagMask === 0) {
      return;
    }
    const key = tileKey(localX, localY, plane);
    explicitFlagMap.set(key, (explicitFlagMap.get(key) ?? 0) | flagMask);
  };
  const addOverlayTile = (x, y, z, overlay) => {
    const localX = x | 0;
    const localY = y | 0;
    const plane = clamp(z | 0, 0, REGION_PLANES - 1);
    if (localX < 0 || localX >= REGION_SIZE || localY < 0 || localY >= REGION_SIZE || !Number.isInteger(overlay)) {
      return;
    }
    const key = tileKey(localX, localY, plane);
    explicitOverlayMap.set(key, overlay & 0xff);
  };
  const terrainProfile = example?.terrainProfile ?? {};
  const terrainOffsetX = Number.isInteger(terrainProfile?.originOffsetX) ? terrainProfile.originOffsetX | 0 : 0;
  const terrainOffsetY = Number.isInteger(terrainProfile?.originOffsetY) ? terrainProfile.originOffsetY | 0 : 0;
  const pushGrid = (grid, sourcePlane, applyFn, options = {}) => {
    const { skipZero = false, restrictToHouse = false, restrictToInterior = false } = options;
    if (!Array.isArray(grid) || grid.length === 0) {
      return;
    }
    const targetPlane = clamp((sourcePlane | 0) + zOffset, 0, REGION_PLANES - 1);
    for (let row = 0; row < grid.length; row++) {
      const rowValues = grid[row];
      if (!Array.isArray(rowValues)) {
        continue;
      }
      for (let col = 0; col < rowValues.length; col++) {
        const value = rowValues[col];
        if (typeof value !== "number") {
          continue;
        }
        const normalizedValue = value & 0xff;
        if (skipZero && normalizedValue === 0) {
          continue;
        }
        const localX = targetMinLocalX + terrainOffsetX + col;
        const localY = targetMinLocalY + terrainOffsetY + row;
        if (restrictToHouse && !isWithinHouseBounds(localX, localY)) {
          continue;
        }
        if (restrictToInterior && !isWithinHouseInterior(localX, localY)) {
          continue;
        }
        applyFn(localX, localY, targetPlane, normalizedValue);
      }
    }
  };
  const pushGridsByZ = (gridsByZ, fallbackGrid, applyFn, options = {}) => {
    if (gridsByZ && typeof gridsByZ === "object") {
      for (const [zText, grid] of Object.entries(gridsByZ)) {
        const relativeZ = Number.parseInt(zText, 10);
        const sourcePlane = Number.isInteger(relativeZ) ? sourceMinPlane + relativeZ : sourceMinPlane;
        pushGrid(grid, sourcePlane, applyFn, options);
      }
      return;
    }
    pushGrid(fallbackGrid, sourceMinPlane, applyFn, options);
  };

  const sourceMinPlane = Number.isInteger(terrainProfile?.minPlane)
    ? terrainProfile.minPlane | 0
    : Number.isInteger(terrainProfile?.plane)
      ? terrainProfile.plane | 0
      : 0;
  pushGridsByZ(terrainProfile?.flagGridsByZ, terrainProfile?.flagGrid, addFlagTile, {
    skipZero: true,
    restrictToHouse: true,
  });
  if (PROCEDURAL_FLOOR_OVERLAYS_ENABLED) {
    pushGridsByZ(terrainProfile?.overlayGridsByZ, terrainProfile?.overlayGrid, addOverlayTile, {
      restrictToHouse: true,
      restrictToInterior: true,
    });
  }

  const explicitFlagTiles = [];
  for (const [key, flag] of explicitFlagMap.entries()) {
    const [xText, yText, zText] = key.split(",");
    explicitFlagTiles.push({
      x: Number.parseInt(xText, 10),
      y: Number.parseInt(yText, 10),
      z: Number.parseInt(zText, 10),
      flag: flag & 0xff,
    });
  }
  const explicitOverlayTiles = [];
  for (const [key, overlay] of explicitOverlayMap.entries()) {
    const [xText, yText, zText] = key.split(",");
    explicitOverlayTiles.push({
      x: Number.parseInt(xText, 10),
      y: Number.parseInt(yText, 10),
      z: Number.parseInt(zText, 10),
      overlay: overlay & 0xff,
    });
  }
  // Stable per-region seed keeps terrain deterministic while using the same clear/flatten flow as ::procregionhere.
  const seed = (regionId(regionX, regionY) ^ 0x517cc1b7) >>> 0;
  const payload = generateRegionPayload(regionX, regionY, seed, {
    buildings: [
      {
        style: dump.styleTag,
        sourceIndex: index,
        x: rect.x,
        y: rect.y,
        width,
        height,
        minZ: lowestZ,
        maxZ: highestZ,
        floors: Math.max(1, floors),
      },
    ],
    floorPatches: [],
    buildingPlacements,
    flattenRects: [rect],
    // Preserve dumped map flags exactly as captured per plane.
    roofFlagRects: [],
    explicitFlagTiles,
    explicitOverlayTiles,
  });

  return {
    payload,
    styleTag: dump.styleTag,
    index,
    filePath: dump.filePath,
    width,
    height,
    objectCount: buildingPlacements.length,
    examplesAvailable: dump.examples.length,
  };
}

function decodeTrackedTerrainArrays(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if ((payload?.size | 0) !== REGION_SIZE || (payload?.planes | 0) !== REGION_PLANES) {
    return null;
  }
  if (
    typeof payload?.heightsB64 !== "string" ||
    typeof payload?.overlaysB64 !== "string" ||
    typeof payload?.underlaysB64 !== "string" ||
    typeof payload?.flagsB64 !== "string"
  ) {
    return null;
  }

  const tileCount = REGION_PLANES * REGION_SIZE * REGION_SIZE;
  try {
    const heightsBuffer = Buffer.from(payload.heightsB64, "base64");
    const overlaysBuffer = Buffer.from(payload.overlaysB64, "base64");
    const underlaysBuffer = Buffer.from(payload.underlaysB64, "base64");
    const flagsBuffer = Buffer.from(payload.flagsB64, "base64");
    if (
      heightsBuffer.length < tileCount * 2 ||
      overlaysBuffer.length < tileCount ||
      underlaysBuffer.length < tileCount ||
      flagsBuffer.length < tileCount
    ) {
      return null;
    }

    const heights = new Int32Array(tileCount);
    const overlays = new Uint8Array(tileCount);
    const underlays = new Uint8Array(tileCount);
    const flags = new Uint8Array(tileCount);
    for (let idx = 0; idx < tileCount; idx++) {
      heights[idx] = heightsBuffer.readUInt16LE(idx * 2) | 0;
      overlays[idx] = overlaysBuffer[idx] & 0xff;
      underlays[idx] = underlaysBuffer[idx] & 0xff;
      flags[idx] = flagsBuffer[idx] & 0xff;
    }
    return { heights, overlays, underlays, flags };
  } catch {
    return null;
  }
}

function normalizePayloadPlacements(payload) {
  if (!Array.isArray(payload?.buildingPlacements)) {
    return [];
  }
  const placements = [];
  for (const placement of payload.buildingPlacements) {
    const id = placement?.id | 0;
    const x = placement?.x | 0;
    const y = placement?.y | 0;
    const z = placement?.z | 0;
    if (id <= 0 || x < 0 || x >= REGION_SIZE || y < 0 || y >= REGION_SIZE || z < 0 || z >= REGION_PLANES) {
      continue;
    }
    placements.push({
      id,
      x,
      y,
      z,
      type: clamp(placement?.type | 0, ObjectType.MIN, ObjectType.MAX),
      orientation: (placement?.orientation | 0) & 0x3,
    });
  }
  return placements;
}

function normalizeCacheHeightForPayload(rawHeight) {
  const value = rawHeight | 0;
  if (value < 0) {
    return clamp(Math.abs(value) >> 3, 4, 120);
  }
  return clamp(value, 4, 120);
}

function buildGeneratedHousePayloadAtPlayer(player, styleTag, seed, houseType = null) {
  const location = player.getLocation();
  const regionX = (location.getX() / REGION_SIZE) | 0;
  const regionY = (location.getY() / REGION_SIZE) | 0;
  const localPlayerX = location.getX() - regionX * REGION_SIZE;
  const localPlayerY = location.getY() - regionY * REGION_SIZE;
  const playerZ = location.getZ() | 0;
  const normalizedSeed = seed >>> 0;
  const mapRegionId = regionId(regionX, regionY);

  const normalizedType = normalizeHouseType(houseType);
  const generated = generateSingleHouseForRegion(
    styleTag,
    normalizedSeed,
    REGION_SIZE,
    localPlayerX,
    localPlayerY,
    playerZ,
    normalizedType
  );
  if (!Array.isArray(generated.placements) || generated.placements.length === 0) {
    throw new Error(`Failed to generate house for style '${styleTag}'.`);
  }
  const primary = generated.buildings?.[0];
  if (!primary) {
    throw new Error(`Generated house for style '${styleTag}' has no footprint.`);
  }

  const placementMargin = 1;
  const flattenMargin = 0;
  const targetX = clamp(
    localPlayerX - ((primary.width / 2) | 0),
    placementMargin,
    REGION_SIZE - primary.width - placementMargin
  );
  const targetY = clamp(
    localPlayerY - ((primary.height / 2) | 0),
    placementMargin,
    REGION_SIZE - primary.height - placementMargin
  );
  const shiftX = targetX - (primary.x | 0);
  const shiftY = targetY - (primary.y | 0);

  const shiftedBuildings = (generated.buildings ?? [])
    .map((building) => ({
      ...building,
      x: (building?.x | 0) + shiftX,
      y: (building?.y | 0) + shiftY,
    }))
    .filter((building) => {
      const x = building.x | 0;
      const y = building.y | 0;
      const w = Math.max(1, building.width | 0);
      const h = Math.max(1, building.height | 0);
      return x >= 0 && y >= 0 && x + w <= REGION_SIZE && y + h <= REGION_SIZE;
    });

  const shiftedFloorPatches = (generated.floorPatches ?? [])
    .map((patch) => ({
      ...patch,
      x: (patch?.x | 0) + shiftX,
      y: (patch?.y | 0) + shiftY,
    }))
    .filter((patch) => {
      const x = patch.x | 0;
      const y = patch.y | 0;
      const w = Math.max(1, patch.width | 0);
      const h = Math.max(1, patch.height | 0);
      return x >= 0 && y >= 0 && x + w <= REGION_SIZE && y + h <= REGION_SIZE;
    });

  const housePlacements = (generated.placements ?? [])
    .map((placement) => ({
      id: placement?.id | 0,
      x: (placement?.x | 0) + shiftX,
      y: (placement?.y | 0) + shiftY,
      z: clamp(placement?.z | 0, 0, REGION_PLANES - 1),
      type: clamp(placement?.type | 0, ObjectType.MIN, ObjectType.MAX),
      orientation: (placement?.orientation | 0) & 0x3,
    }))
    .filter((placement) => placement.id > 0 && placement.x >= 0 && placement.x < REGION_SIZE && placement.y >= 0 && placement.y < REGION_SIZE);

  if (shiftedBuildings.length === 0 || housePlacements.length === 0) {
    throw new Error(`Failed to position generated house for style '${styleTag}' near player.`);
  }

  const placedPrimary = shiftedBuildings[0];
  const clearMinX = clamp((placedPrimary.x | 0) - flattenMargin, 0, REGION_SIZE - 1);
  const clearMinY = clamp((placedPrimary.y | 0) - flattenMargin, 0, REGION_SIZE - 1);
  const clearMaxX = clamp(
    (placedPrimary.x | 0) + (placedPrimary.width | 0) + flattenMargin - 1,
    0,
    REGION_SIZE - 1
  );
  const clearMaxY = clamp(
    (placedPrimary.y | 0) + (placedPrimary.height | 0) + flattenMargin - 1,
    0,
    REGION_SIZE - 1
  );

  const indexFor = (plane, x, y) => plane * REGION_SIZE * REGION_SIZE + x * REGION_SIZE + y;
  const tileCount = REGION_PLANES * REGION_SIZE * REGION_SIZE;
  let heights;
  let overlays;
  let underlays;
  let flags;
  let basePlacements = [];

  const trackedPayload = getTrackedRegionPayload(player, mapRegionId);
  const trackedTerrain = decodeTrackedTerrainArrays(trackedPayload);
  if (trackedTerrain) {
    heights = trackedTerrain.heights;
    overlays = trackedTerrain.overlays;
    underlays = trackedTerrain.underlays;
    flags = trackedTerrain.flags;
    basePlacements = normalizePayloadPlacements(trackedPayload);
  } else {
    const terrainData = decodeRegionTerrainData(mapRegionId);
    if (!terrainData) {
      throw new Error(`Unable to decode terrain for region ${regionX},${regionY}.`);
    }
    heights = new Int32Array(tileCount);
    overlays = new Uint8Array(tileCount);
    underlays = new Uint8Array(tileCount);
    flags = new Uint8Array(tileCount);
    for (let plane = 0; plane < REGION_PLANES; plane++) {
      for (let localX = 0; localX < REGION_SIZE; localX++) {
        for (let localY = 0; localY < REGION_SIZE; localY++) {
          const idx = indexFor(plane, localX, localY);
          heights[idx] = normalizeCacheHeightForPayload(terrainData?.heights?.[plane]?.[localX]?.[localY] | 0);
          overlays[idx] = (terrainData?.overlays?.[plane]?.[localX]?.[localY] | 0) & 0xff;
          underlays[idx] = (terrainData?.underlays?.[plane]?.[localX]?.[localY] | 0) & 0xff;
          flags[idx] = (terrainData?.flags?.[plane]?.[localX]?.[localY] | 0) & 0xff;
        }
      }
    }
    const cacheObjects = decodeRegionObjects(mapRegionId);
    const baseX = regionX * REGION_SIZE;
    const baseY = regionY * REGION_SIZE;
    for (const object of cacheObjects) {
      const id = object?.id | 0;
      if (id <= 0) {
        continue;
      }
      const localX = (object?.x | 0) - baseX;
      const localY = (object?.y | 0) - baseY;
      const localZ = object?.z | 0;
      if (
        localX < 0 ||
        localX >= REGION_SIZE ||
        localY < 0 ||
        localY >= REGION_SIZE ||
        localZ < 0 ||
        localZ >= REGION_PLANES
      ) {
        continue;
      }
      basePlacements.push({
        id,
        x: localX,
        y: localY,
        z: localZ,
        type: clamp(object?.type | 0, ObjectType.MIN, ObjectType.MAX),
        orientation: (object?.orientation | 0) & 0x3,
      });
    }
  }

  let sumHeights = 0;
  let sampleTiles = 0;
  for (let x = clearMinX; x <= clearMaxX; x++) {
    for (let y = clearMinY; y <= clearMaxY; y++) {
      sumHeights += heights[indexFor(0, x, y)];
      sampleTiles++;
    }
  }
  const averageHeight = sampleTiles > 0 ? Math.round(sumHeights / sampleTiles) : heights[indexFor(0, localPlayerX, localPlayerY)];

  for (let x = clearMinX; x <= clearMaxX; x++) {
    for (let y = clearMinY; y <= clearMaxY; y++) {
      heights[indexFor(0, x, y)] = averageHeight;
      for (let plane = 0; plane < REGION_PLANES; plane++) {
        const idx = indexFor(plane, x, y);
        overlays[idx] = 0;
        flags[idx] = 0;
        if (plane > 0) {
          heights[idx] = Math.max(4, averageHeight - plane * 30);
        }
      }
    }
  }

  const keepOutsideClearRect = (localX, localY) =>
    localX < clearMinX || localX > clearMaxX || localY < clearMinY || localY > clearMaxY;
  const isInsideAnyBuildingInterior = (localX, localY) =>
    shiftedBuildings.some((building) => {
      const startX = (building?.x | 0) + 1;
      const startY = (building?.y | 0) + 1;
      const endX = (building?.x | 0) + Math.max(1, building?.width | 0) - 2;
      const endY = (building?.y | 0) + Math.max(1, building?.height | 0) - 2;
      if (startX > endX || startY > endY) {
        return false;
      }
      return localX >= startX && localX <= endX && localY >= startY && localY <= endY;
    });

  const preservedPlacements = [];
  for (const object of basePlacements) {
    const localX = object?.x | 0;
    const localY = object?.y | 0;
    if (!keepOutsideClearRect(localX, localY)) {
      const objectType = object?.type | 0;
      const isGroundDecor = objectType === ObjectType.GROUND_DECOR;
      const shouldClearGroundDecor = isGroundDecor && isInsideAnyBuildingInterior(localX, localY);
      const shouldClearOther = !isGroundDecor;
      if (shouldClearGroundDecor || shouldClearOther) {
        continue;
      }
    }
    preservedPlacements.push({
      id: object.id | 0,
      x: localX,
      y: localY,
      z: object.z | 0,
      type: clamp(object?.type | 0, ObjectType.MIN, ObjectType.MAX),
      orientation: (object?.orientation | 0) & 0x3,
    });
  }

  for (const patch of shiftedFloorPatches) {
    const startX = clamp(patch?.x | 0, 0, REGION_SIZE - 1);
    const startY = clamp(patch?.y | 0, 0, REGION_SIZE - 1);
    const width = Math.max(1, patch?.width | 0);
    const height = Math.max(1, patch?.height | 0);
    const endX = Math.min(REGION_SIZE, startX + width);
    const endY = Math.min(REGION_SIZE, startY + height);
    const plane = clamp(patch?.z | 0, 0, REGION_PLANES - 1);
    const overlayValue = (patch?.underlay | 0) & 0xff;
    for (let x = startX; x < endX; x++) {
      for (let y = startY; y < endY; y++) {
        const idx = indexFor(plane, x, y);
        overlays[idx] = overlayValue;
        if (overlayValue > 0 && underlays[idx] === 0) {
          underlays[idx] = 1;
        }
      }
    }
  }

  for (const building of shiftedBuildings) {
    const startX = clamp(building?.x | 0, 0, REGION_SIZE - 1);
    const startY = clamp(building?.y | 0, 0, REGION_SIZE - 1);
    const width = Math.max(1, building?.width | 0);
    const height = Math.max(1, building?.height | 0);
    const endX = Math.min(REGION_SIZE, startX + width);
    const endY = Math.min(REGION_SIZE, startY + height);
    for (let x = startX; x < endX; x++) {
      for (let y = startY; y < endY; y++) {
        for (let plane = 0; plane < REGION_PLANES; plane++) {
          const idx = indexFor(plane, x, y);
          flags[idx] = (flags[idx] | 4) & 0xff;
        }
      }
    }
  }

  const combinedPlacements = [...preservedPlacements, ...housePlacements];

  const heightBuffer = Buffer.allocUnsafe(tileCount * 2);
  for (let idx = 0; idx < tileCount; idx++) {
    heightBuffer.writeUInt16LE(heights[idx] & 0xffff, idx * 2);
  }

  const payload = {
    v: 1,
    regionX,
    regionY,
    regionId: mapRegionId,
    seed: normalizedSeed,
    size: REGION_SIZE,
    planes: REGION_PLANES,
    heightsB64: heightBuffer.toString("base64"),
    overlaysB64: Buffer.from(overlays).toString("base64"),
    underlaysB64: Buffer.from(underlays).toString("base64"),
    flagsB64: Buffer.from(flags).toString("base64"),
    buildings: shiftedBuildings,
    buildingPlacements: combinedPlacements,
  };

  return {
    payload,
    styleKey: generated.styleKey,
    type: normalizedType,
    width: placedPrimary.width,
    height: placedPrimary.height,
    floors: placedPrimary.floors,
    objectCount: housePlacements.length,
    seed: normalizedSeed,
  };
}

function buildStreetPayloadAtPlayer(player, styleTag, seed, houseType = "SHOP") {
  const location = player.getLocation();
  const regionX = (location.getX() / REGION_SIZE) | 0;
  const regionY = (location.getY() / REGION_SIZE) | 0;
  const normalizedSeed = seed >>> 0;
  const normalizedType = normalizeHouseType(houseType) ?? "SHOP";

  const generated = generateStreetTownForRegion(styleTag, normalizedType, normalizedSeed, REGION_SIZE);
  if (!Array.isArray(generated.placements) || generated.placements.length === 0) {
    throw new Error(`Failed to generate street for style '${styleTag}' type '${normalizedType}'.`);
  }

  const payload = generateRegionPayload(regionX, regionY, normalizedSeed, {
    buildings: generated.buildings,
    floorPatches: generated.floorPatches,
    buildingPlacements: generated.placements,
    flattenRects: generated.flattenRects,
    explicitOverlayTiles: generated.explicitOverlayTiles,
  });

  return {
    payload,
    styleTag: sanitizeStyleTag(styleTag) || "varrock",
    type: normalizedType,
    houseCount: generated.buildings.length,
    streetWidth: generated.streetWidth,
    streetStartY: generated.streetStartY,
    streetEndY: generated.streetEndY,
    seed: normalizedSeed,
  };
}

function buildGeneratedTerrainPayloadAtPlayer(player, biomeArg, seed) {
  const location = player.getLocation();
  const regionX = (location.getX() / REGION_SIZE) | 0;
  const regionY = (location.getY() / REGION_SIZE) | 0;
  const normalizedSeed = seed >>> 0;
  const biome = loadTerrainBiome(biomeArg);

  const treeIds = biome.treeIds;
  const groundDecorationIds = biome.groundDecorationIds;
  const treeProfileById = biome.treeProfileById ?? {};
  const groundDecorationProfileById = biome.groundDecorationProfileById ?? {};
  const treeDensityById = biome.treeDensityById ?? {};
  const groundDecorationDensityById = biome.groundDecorationDensityById ?? {};
  const treeChance = treeIds.length > 0 ? clamp(biome.treeDensity, 0, 0.85) : 0;
  const groundDecorationChance = groundDecorationIds.length > 0 ? clamp(biome.groundDecorationDensity, 0, 0.9) : 0;

  const placements = [];
  const occupiedTiles = new Uint8Array(REGION_SIZE * REGION_SIZE);
  const treePlacedTiles = new Uint8Array(REGION_SIZE * REGION_SIZE);
  const groundPlacedTiles = new Uint8Array(REGION_SIZE * REGION_SIZE);
  const isOccupied = (x, y) => occupiedTiles[x * REGION_SIZE + y] !== 0;
  const markOccupied = (x, y) => {
    occupiedTiles[x * REGION_SIZE + y] = 1;
  };
  const hasNearbyPlaced = (mask, x, y, radius) => {
    if (radius <= 0) {
      return false;
    }
    const minX = Math.max(1, x - radius);
    const maxX = Math.min(REGION_SIZE - 2, x + radius);
    const minY = Math.max(1, y - radius);
    const maxY = Math.min(REGION_SIZE - 2, y + radius);
    for (let nx = minX; nx <= maxX; nx++) {
      for (let ny = minY; ny <= maxY; ny++) {
        if (mask[nx * REGION_SIZE + ny] !== 0) {
          return true;
        }
      }
    }
    return false;
  };
  const markPlaced = (mask, x, y) => {
    mask[x * REGION_SIZE + y] = 1;
  };
  const pickIdByNoise = (ids, worldX, worldY, salt) => {
    if (ids.length <= 1) {
      return ids[0];
    }
    const selector = tileNoise(worldX + salt * 13, worldY - salt * 29, normalizedSeed ^ (salt * 0x9e3779b1));
    const idx = Math.min(ids.length - 1, ((selector / 256) * ids.length) | 0);
    return ids[idx];
  };
  const placementTypeForId = (id, profileById, fallbackType) => {
    const profile = profileById[String(id)];
    const type = profile?.type;
    return Number.isInteger(type) ? (type | 0) : fallbackType | 0;
  };
  const placementOrientationForId = (id, worldX, worldY, profileById, fallbackSeedSalt = 0) => {
    const profile = profileById[String(id)];
    const orientation = profile?.orientation;
    if (Number.isInteger(orientation)) {
      return orientation & 0x3;
    }
    return tileNoise(worldX + 43 + fallbackSeedSalt, worldY - 17 - fallbackSeedSalt, normalizedSeed ^ 0x56ab331) & 0x3;
  };
  const densityForId = (id, densityById, fallbackDensity, totalIds, scale = 1) => {
    const entry = densityById[String(id)];
    const parsed = Number(entry?.density);
    const base = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackDensity / Math.max(1, totalIds);
    return clamp(base * scale, 0, 0.9);
  };
  const spacingRadiusForDensity = (density, category) => {
    if (category === "tree") {
      if (density <= 0.008) {
        return 3;
      }
      if (density <= 0.02) {
        return 2;
      }
      return 1;
    }
    if (density <= 0.006) {
      return 2;
    }
    if (density <= 0.02) {
      return 1;
    }
    return 0;
  };
  const candidatesForId = (source, id, scoreField, salt) =>
    [...source].sort((a, b) => {
      const aNoise = tileNoise(a.worldX + salt, a.worldY - salt, normalizedSeed ^ Math.imul(id | 0, 0x45d9f3b));
      const bNoise = tileNoise(b.worldX + salt, b.worldY - salt, normalizedSeed ^ Math.imul(id | 0, 0x45d9f3b));
      const aScore = a[scoreField] * 0.8 + (aNoise / 255) * 0.2;
      const bScore = b[scoreField] * 0.8 + (bNoise / 255) * 0.2;
      if (aScore !== bScore) {
        return aScore - bScore;
      }
      return aNoise - bNoise;
    });

  let treeCount = 0;
  let groundDecorationCount = 0;
  const tileCandidates = [];
  const maxPlacements = (REGION_SIZE - 2) * (REGION_SIZE - 2);
  for (let localX = 1; localX < REGION_SIZE - 1; localX++) {
    for (let localY = 1; localY < REGION_SIZE - 1; localY++) {
      const worldX = regionX * REGION_SIZE + localX;
      const worldY = regionY * REGION_SIZE + localY;
      const treeMacro = smoothedNoise((worldX >> 1) + 97, (worldY >> 1) - 41, normalizedSeed ^ 0x13f29a7) / 255;
      const treeDetail = smoothedNoise(worldX + 197, worldY - 89, normalizedSeed ^ 0x4a31d2f) / 255;
      const treeScore = treeMacro * 0.7 + treeDetail * 0.3;

      const decorMacro = smoothedNoise(worldX - 37, worldY + 79, normalizedSeed ^ 0x3358af) / 255;
      const decorDetail = smoothedNoise((worldX >> 1) + 141, (worldY >> 1) + 53, normalizedSeed ^ 0x12be47) / 255;
      const decorScore = decorMacro * 0.65 + decorDetail * 0.35;
      tileCandidates.push({ localX, localY, worldX, worldY, treeScore, decorScore });
    }
  }

  if (treeChance > 0 && treeIds.length > 0) {
    const treeIdsByDensity = [...treeIds].sort((a, b) => {
      const da = densityForId(a, treeDensityById, treeChance, treeIds.length, 1);
      const db = densityForId(b, treeDensityById, treeChance, treeIds.length, 1);
      return db - da;
    });
    for (const id of treeIdsByDensity) {
      if (placements.length >= maxPlacements) {
        break;
      }
      const idDensity = densityForId(id, treeDensityById, treeChance, treeIds.length, 1);
      const targetForId = Math.max(1, Math.round(idDensity * tileCandidates.length));
      const idCandidates = candidatesForId(tileCandidates, id, "treeScore", 211);
      const strictRadius = spacingRadiusForDensity(idDensity, "tree");
      let placedForId = 0;
      const placeWithRadius = (radius) => {
        for (const candidate of idCandidates) {
          if (placedForId >= targetForId || placements.length >= maxPlacements) {
            break;
          }
          if (isOccupied(candidate.localX, candidate.localY)) {
            continue;
          }
          if (hasNearbyPlaced(treePlacedTiles, candidate.localX, candidate.localY, radius)) {
            continue;
          }
          placements.push({
            id,
            x: candidate.localX,
            y: candidate.localY,
            z: 0,
            type: placementTypeForId(id, treeProfileById, ObjectType.INTERACTIVE),
            orientation: placementOrientationForId(id, candidate.worldX, candidate.worldY, treeProfileById),
          });
          markOccupied(candidate.localX, candidate.localY);
          markPlaced(treePlacedTiles, candidate.localX, candidate.localY);
          treeCount++;
          placedForId++;
        }
      };
      placeWithRadius(strictRadius);
      if (placedForId < targetForId) {
        placeWithRadius(Math.max(0, strictRadius - 1));
      }
      if (placedForId < targetForId) {
        placeWithRadius(0);
      }
    }
  }

  if (groundDecorationChance > 0 && groundDecorationIds.length > 0 && placements.length < maxPlacements) {
    const groundIdsByDensity = [...groundDecorationIds].sort((a, b) => {
      const da = densityForId(a, groundDecorationDensityById, groundDecorationChance, groundDecorationIds.length, 1.15);
      const db = densityForId(b, groundDecorationDensityById, groundDecorationChance, groundDecorationIds.length, 1.15);
      return db - da;
    });
    for (const id of groundIdsByDensity) {
      if (placements.length >= maxPlacements) {
        break;
      }
      const idDensity = densityForId(id, groundDecorationDensityById, groundDecorationChance, groundDecorationIds.length, 1.15);
      const remaining = maxPlacements - placements.length;
      const targetForId = Math.min(remaining, Math.max(1, Math.round(idDensity * tileCandidates.length)));
      const idCandidates = candidatesForId(tileCandidates, id, "decorScore", 157);
      const strictRadius = spacingRadiusForDensity(idDensity, "ground");
      let placedForId = 0;
      const placeWithRadius = (radius) => {
        for (const candidate of idCandidates) {
          if (placedForId >= targetForId || placements.length >= maxPlacements) {
            break;
          }
          if (isOccupied(candidate.localX, candidate.localY)) {
            continue;
          }
          if (hasNearbyPlaced(groundPlacedTiles, candidate.localX, candidate.localY, radius)) {
            continue;
          }
          placements.push({
            id,
            x: candidate.localX,
            y: candidate.localY,
            z: 0,
            type: placementTypeForId(id, groundDecorationProfileById, ObjectType.GROUND_DECOR),
            orientation: placementOrientationForId(id, candidate.worldX, candidate.worldY, groundDecorationProfileById, 7),
          });
          markOccupied(candidate.localX, candidate.localY);
          markPlaced(groundPlacedTiles, candidate.localX, candidate.localY);
          groundDecorationCount++;
          placedForId++;
        }
      };
      placeWithRadius(strictRadius);
      if (placedForId < targetForId) {
        placeWithRadius(Math.max(0, strictRadius - 1));
      }
      if (placedForId < targetForId) {
        placeWithRadius(0);
      }
    }
  }

  const payload = generateRegionPayload(regionX, regionY, normalizedSeed, {
    buildings: [],
    floorPatches: [],
    buildingPlacements: placements,
    roofFlagRects: [],
    terrainUnderlayIds: biome.underlayIds,
  });

  return {
    payload,
    biome: biome.biome,
    sampleCount: biome.sampleCount,
    treeIds: biome.treeIds.length,
    underlayIds: biome.underlayIds.length,
    groundDecorationIds: biome.groundDecorationIds.length,
    treeDensity: treeChance,
    groundDecorationDensity: groundDecorationChance,
    treeCount,
    groundDecorationCount,
    seed: normalizedSeed,
  };
}

let RegionManager;

module.exports = {
  name: "ProceduralRegionStream",
  register(api) {
    RegionManager = api.getRegionManager();
    initRegionBuildingAnalysisCoreAccess(api);
    api.registerCommand("procregion", ({ player, parts }) => {
      if (parts.length < 3 || parts.length > 4) {
        player.sendMessage("Usage: ::procregion <regionX> <regionY> [seed]");
        return true;
      }

      const regionX = parseIntArg(parts[1]);
      const regionY = parseIntArg(parts[2]);
      const seed = normalizeSeed(parts[3]);

      if (regionX === null || regionY === null) {
        player.sendMessage("Usage: ::procregion <regionX> <regionY> [seed]");
        return true;
      }

      try {
        streamProceduralRegion(player, regionX, regionY, seed);
      } catch (error) {
        const reason = error?.message ?? String(error);
        sendProceduralPacket(player, REGION_PACKET_TYPE.ERROR, 0, 0, 0, 0, reason);
        player.sendMessage(`[proc-region] failed: ${reason}`);
      }

      return true;
    }, PlayerRights.OWNER, "Load generated region");

    api.registerCommand("procregionhere", ({ player, parts }) => {
      const location = player.getLocation();
      const regionX = (location.getX() / REGION_SIZE) | 0;
      const regionY = (location.getY() / REGION_SIZE) | 0;
      const seed = normalizeSeed(parts[1]);

      try {
        streamProceduralRegion(player, regionX, regionY, seed);
      } catch (error) {
        const reason = error?.message ?? String(error);
        sendProceduralPacket(player, REGION_PACKET_TYPE.ERROR, 0, 0, 0, 0, reason);
        player.sendMessage(`[proc-region] failed: ${reason}`);
      }

      return true;
    }, PlayerRights.OWNER, "Generate current region");

    api.registerCommand("cleargen", ({ player }) => {
      const restoredCacheObjects = clearProceduralClippingForPlayer(player);
      sendProceduralClear(player);
      player.sendMessage(
        `[proc-region] cleargen requested: client procedural overrides cleared and region reload forced (cache object clips restored=${restoredCacheObjects}).`
      );
      return true;
    }, PlayerRights.OWNER, "Clear generated region");

    api.registerCommand("procregscan", ({ player, parts }) => {
      const radius = parseIntArg(parts[1] ?? "1");
      const scanRadius = radius === null ? 1 : radius;
      try {
        const outputPath = writeAnalysisReport(player, scanRadius);
        player.sendMessage(`[proc-region] structure scan saved: ${outputPath}`);
      } catch (error) {
        const reason = error?.message ?? String(error);
        player.sendMessage(`[proc-region] structure scan failed: ${reason}`);
      }
      return true;
    }, PlayerRights.OWNER, "Scan region");

    api.registerCommand("procreglearn", ({ player, parts }) => {
      const radius = parseIntArg(parts[1] ?? "2");
      const learnRadius = radius === null ? 2 : radius;
      try {
        const result = writeLearnedPresetFile(player, learnRadius);
        player.sendMessage(
          `[proc-region] learned styles=${result.styleCount} layouts=${result.layoutCount} interior=${result.interiorCount} radius=${learnRadius} saved: ${result.outputPath}`
        );
        if (result.scanStats) {
          player.sendMessage(
            `[proc-region] scan regions=${result.scanStats.scannedRegions} objects=${result.scanStats.scannedObjects} structures=${result.scanStats.scannedStructures} buildingClusters=${result.scanStats.matchedBuildingClusters}`
          );
        }
      } catch (error) {
        const reason = error?.message ?? String(error);
        player.sendMessage(`[proc-region] learn failed: ${reason}`);
      }
      return true;
    }, PlayerRights.OWNER, "Learn region style");

    api.registerCommand("dumphouse", ({ player, parts }) => {
      if (parts.length < 2 || parts.length > 3) {
        player.sendMessage("Usage: ::dumphouse <tag> [type]");
        return true;
      }

      const tag = String(parts[1] ?? "").trim();
      if (!tag) {
        player.sendMessage("Usage: ::dumphouse <tag> [type]");
        return true;
      }
      const houseType = parts.length >= 3 ? normalizeHouseType(parts[2]) : null;

      try {
        const result = writeHouseExample(player, tag, houseType);
        player.sendMessage(
          `[proc-region] dumped house ${result.label}${result.type ? ` type=${result.type}` : ""} #${result.exampleCount} ${result.width}x${result.height} floors=${result.floors} objects=${result.objectCount} terrainDiff=${result.terrainAvailable ? result.terrainDifferential : "n/a"}`
        );
        player.sendMessage(`[proc-region] saved: ${result.outputPath}`);
      } catch (error) {
        const reason = error?.message ?? String(error);
        player.sendMessage(`[proc-region] dumphouse failed: ${reason}`);
      }
      return true;
    }, PlayerRights.OWNER, "Save house example");

    api.registerCommand("dumpterrain", ({ player, parts }) => {
      if (parts.length !== 2) {
        player.sendMessage("Usage: ::dumpterrain <biome>");
        return true;
      }

      const biome = String(parts[1] ?? "").trim();
      if (!biome) {
        player.sendMessage("Usage: ::dumpterrain <biome>");
        return true;
      }

      try {
        const result = dumpTerrainBiome(player, biome);
        const sample = result.sample;
        player.sendMessage(
          `[proc-region] dumpterrain biome=${result.biome} region=${sample.regionX},${sample.regionY} landTiles=${sample.landTileCount} waterTilesSkipped=${sample.waterTileCount} treeDensity=${sample.treeDensity}`
        );
        player.sendMessage(
          `[proc-region] ids trees=${result.totalTreeIds} underlays=${result.totalUnderlayIds} groundDecor=${result.totalGroundDecorationIds} samples=${result.sampleCount} saved: ${result.outputPath}`
        );
      } catch (error) {
        const reason = error?.message ?? String(error);
        player.sendMessage(`[proc-region] dumpterrain failed: ${reason}`);
      }
      return true;
    }, PlayerRights.OWNER, "Save terrain data");

    api.registerCommand("genterrain", ({ player, parts }) => {
      if (parts.length < 2 || parts.length > 3) {
        player.sendMessage("Usage: ::genterrain <biome> [seed]");
        return true;
      }

      const biome = String(parts[1] ?? "").trim();
      if (!biome) {
        player.sendMessage("Usage: ::genterrain <biome> [seed]");
        return true;
      }

      const explicitSeed = parts.length === 3 ? parseIntArg(parts[2]) : null;
      if (parts.length === 3 && explicitSeed === null) {
        player.sendMessage("Usage: ::genterrain <biome> [seed]");
        return true;
      }
      const seed = explicitSeed === null ? normalizeSeed(undefined) : explicitSeed >>> 0;

      try {
        const result = buildGeneratedTerrainPayloadAtPlayer(player, biome, seed);
        streamProceduralPayload(player, result.payload, "[proc-region] generated terrain region");
        player.sendMessage(
          `[proc-region] genterrain biome=${result.biome} trees=${result.treeCount} groundDecor=${result.groundDecorationCount} treeIds=${result.treeIds} underlays=${result.underlayIds} groundDecorIds=${result.groundDecorationIds} samples=${result.sampleCount} seed=${result.seed}`
        );
      } catch (error) {
        const reason = error?.message ?? String(error);
        player.sendMessage(`[proc-region] genterrain failed: ${reason}`);
      }
      return true;
    }, PlayerRights.OWNER, "Generate terrain");

    api.registerCommand("buildhouse", ({ player, parts }) => {
      if (parts.length < 2 || parts.length > 3) {
        player.sendMessage("Usage: ::buildhouse <style> [index]");
        return true;
      }

      const styleTag = String(parts[1] ?? "").trim();
      if (!styleTag) {
        player.sendMessage("Usage: ::buildhouse <style> [index]");
        return true;
      }

      const explicitIndex = parts.length >= 3 ? parseIntArg(parts[2]) : null;
      if (parts.length >= 3 && explicitIndex === null) {
        player.sendMessage("Usage: ::buildhouse <style> [index]");
        return true;
      }

      try {
        const result = buildHousePayloadAtPlayer(player, styleTag, explicitIndex);
        streamProceduralPayload(player, result.payload, "[proc-region] built house region");
        player.sendMessage(
          `[proc-region] buildhouse style=${result.styleTag} index=${result.index}/${result.examplesAvailable - 1} size=${result.width}x${result.height} objects=${result.objectCount}`
        );
      } catch (error) {
        const reason = error?.message ?? String(error);
        player.sendMessage(`[proc-region] buildhouse failed: ${reason}`);
      }
      return true;
    }, PlayerRights.OWNER, "Build saved house");

    api.registerCommand("genhouse", ({ player, parts }) => {
      if (parts.length < 2 || parts.length > 4) {
        player.sendMessage("Usage: ::genhouse <style> [type] [seed]");
        return true;
      }

      const styleTag = String(parts[1] ?? "").trim();
      if (!styleTag) {
        player.sendMessage("Usage: ::genhouse <style> [type] [seed]");
        return true;
      }

      let houseType = null;
      let explicitSeed = null;
      if (parts.length === 3) {
        const maybeSeed = parseIntArg(parts[2]);
        if (maybeSeed !== null) {
          explicitSeed = maybeSeed;
        } else {
          houseType = normalizeHouseType(parts[2]);
        }
      } else if (parts.length === 4) {
        houseType = normalizeHouseType(parts[2]);
        explicitSeed = parseIntArg(parts[3]);
        if (explicitSeed === null) {
          player.sendMessage("Usage: ::genhouse <style> [type] [seed]");
          return true;
        }
      }

      const seed = explicitSeed === null ? normalizeSeed(undefined) : explicitSeed >>> 0;
      try {
        const result = buildGeneratedHousePayloadAtPlayer(player, styleTag, seed, houseType);
        streamProceduralPayload(player, result.payload, "[proc-region] generated house region");
        player.sendMessage(
          `[proc-region] genhouse style=${result.styleKey}${result.type ? ` type=${result.type}` : ""} size=${result.width}x${result.height} floors=${result.floors} objects=${result.objectCount} seed=${result.seed}`
        );
      } catch (error) {
        const reason = error?.message ?? String(error);
        player.sendMessage(`[proc-region] genhouse failed: ${reason}`);
      }
      return true;
    }, PlayerRights.OWNER, "Generate house");

    api.registerCommand("genstreet", ({ player, parts }) => {
      if (parts.length > 4) {
        player.sendMessage("Usage: ::genstreet [style] [type] [seed]");
        return true;
      }

      const styleTag = parts.length >= 2 ? String(parts[1] ?? "").trim() : "varrock";
      if (!styleTag) {
        player.sendMessage("Usage: ::genstreet [style] [type] [seed]");
        return true;
      }

      let houseType = "SHOP";
      let explicitSeed = null;
      if (parts.length >= 3) {
        const maybeSeed = parseIntArg(parts[2]);
        if (maybeSeed !== null) {
          explicitSeed = maybeSeed >>> 0;
        } else {
          const parsedType = normalizeHouseType(parts[2]);
          if (parsedType) {
            houseType = parsedType;
          }
        }
      }
      if (parts.length >= 4) {
        const parsedType = normalizeHouseType(parts[2]);
        if (parsedType) {
          houseType = parsedType;
        }
        const parsedSeed = parseIntArg(parts[3]);
        if (parsedSeed === null) {
          player.sendMessage("Usage: ::genstreet [style] [type] [seed]");
          return true;
        }
        explicitSeed = parsedSeed >>> 0;
      }

      const seed = explicitSeed === null ? normalizeSeed(undefined) : explicitSeed;
      try {
        const result = buildStreetPayloadAtPlayer(player, styleTag, seed, houseType);
        streamProceduralPayload(player, result.payload, "[proc-region] generated street region");
        player.sendMessage(
          `[proc-region] genstreet style=${result.styleTag} type=${result.type} houses=${result.houseCount} streetWidth=${result.streetWidth} y=${result.streetStartY}..${result.streetEndY} seed=${result.seed}`
        );
      } catch (error) {
        const reason = error?.message ?? String(error);
        player.sendMessage(`[proc-region] genstreet failed: ${reason}`);
      }
      return true;
    }, PlayerRights.OWNER, "Generate street");

    api.registerCommand("checkhouse", ({ player }) => {
      try {
        const result = checkHouseBoundary(player);
        player.sendMessage(
          `[proc-region] checkhouse ${result.width}x${result.height} bounds=(${result.minX},${result.minY})..(${result.maxX},${result.maxY}) z=${result.playerZ}`
        );
      } catch (error) {
        const reason = error?.message ?? String(error);
        player.sendMessage(`[proc-region] checkhouse failed: ${reason}`);
      }
      return true;
    }, PlayerRights.OWNER, "Check house bounds");
  },
};
