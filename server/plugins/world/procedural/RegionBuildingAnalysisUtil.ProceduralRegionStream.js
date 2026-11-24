const fs = require("fs");
const path = require("path");

const { MapRegionReplacementManager } = require("../../../src/main/typescript/elvarg/game/collision/MapRegionReplacementManager");
const { CacheMaps } = require("../../../src/main/typescript/elvarg/game/cache/CacheMaps");
const { Buffer } = require("../../../src/main/typescript/elvarg/game/collision/Buffer");
const { ObjectDefinition } = require("../../../src/main/typescript/elvarg/game/definition/ObjectDefinition");
const { nativeTerrainHeight } = require("../TerrainHeight");
const { ObjectType } = require("./ObjectType.ProceduralRegionStream");
const {
  PRESET_OUTPUT_PATH,
  HOUSE_DUMP_DIRECTORY,
  ANALYSIS_REPORT_DIRECTORY,
} = require("./ProceduralDataPaths.ProceduralRegionStream");
const { buildLadderCatalogFromExamples } = require("./LadderUtil.ProceduralRegionStream");

let RegionManager;

/** Called from each plugin that uses this module, before any region analysis runs. */
function initRegionBuildingAnalysisCoreAccess(api) {
  RegionManager = api.getRegionManager();
}

const STRUCTURE_NAME_PATTERN = /(wall|roof|door|window|house|building|fence|gate|arch)/i;
const STRUCTURE_TYPES = new Set([
  ObjectType.WALL_STRAIGHT,
  ObjectType.WALL_DIAGONAL_CORNER,
  ObjectType.WALL_L,
  ObjectType.WALL_SQUARE_CORNER,
  ObjectType.WALL_DIAGONAL,
  ObjectType.ROOF_SLOPE,
  ObjectType.ROOF_EDGE_CORNER,
  ObjectType.ROOF_TOP_FLAT,
  ObjectType.ROOF_EDGE_SIDE,
  ObjectType.ROOF_TOP_CORNER,
  ObjectType.ROOF_RIDGE_CORNER,
  ObjectType.WALL_DECORATION,
]);
const DECOR_NAME_PATTERN = /(window|banner|painting|torch|sconce|decoration|ornament|curtain)/i;
const INTERIOR_NAME_PATTERN = /(table|chair|bed|stool|shelf|wardrobe|crate|barrel|bookcase|altar|fireplace|range|stove|counter|anvil|loom|pot|bench)/i;
const EXTERIOR_BLOCKLIST_PATTERN = /(tree|bush|rock|water|fountain|flower|grass|fence|gate|wall|roof|door|path|road)/i;
const objectMetaCache = new Map();

function parseIntArg(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeHouseExampleType(raw) {
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function decodeRegionObjects(regionId) {
  const region = RegionManager.getRegionid(regionId);
  if (!region) {
    return [];
  }
  const cached = CacheMaps.getRegion(regionId);
  const replacement = MapRegionReplacementManager.getReplacementMapData(regionId);
  const raw = replacement ? (replacement.objectData ?? cached?.objectData) : cached?.objectData;
  if (!raw) return [];
  const objectStream = new Buffer(raw);
  const absX = ((regionId >> 8) & 0xff) * 64;
  const absY = (regionId & 0xff) * 64;

  const objects = [];
  let objectId = -1;
  let incr;
  while ((incr = objectStream.readSmart()) !== 0) {
    objectId += incr;
    let location = 0;
    let incr2;
    while ((incr2 = objectStream.getUSmart()) !== 0) {
      location += incr2 - 1;
      const localX = (location >> 6) & 0x3f;
      const localY = location & 0x3f;
      const height = location >> 12;
      const hash = objectStream.readUnsignedByte();
      const type = hash >> 2;
      const orientation = hash & 0x3;

      if (localX < 0 || localX >= 64 || localY < 0 || localY >= 64) {
        continue;
      }

      const x = absX + localX;
      const y = absY + localY;
      let name = null;
      let interactions = null;
      let mapFunction = -1;
      try {
        const def = ObjectDefinition.forId(objectId);
        name = def?.getName?.() ?? null;
        interactions = def?.getInteractions?.() ?? null;
        mapFunction = def?.getMinimapFunction?.() ?? -1;
      } catch {
        name = null;
        interactions = null;
        mapFunction = -1;
      }
      objects.push({ id: objectId, x, y, z: height, type, orientation, name, interactions, mapFunction });
    }
  }

  return objects;
}

function decodeRegionTerrainData(regionId) {
  const region = RegionManager.getRegionid(regionId);
  if (!region) {
    return null;
  }
  const cached = CacheMaps.getRegion(regionId);
  const raw = MapRegionReplacementManager.getReplacementMapData(regionId)?.terrainData ?? cached?.terrainData;
  if (!raw) return null;
  const stream = new Buffer(raw);
  const absX = ((regionId >> 8) & 0xff) * 64;
  const absY = (regionId & 0xff) * 64;
  const heights = Array.from({ length: 4 }, () => Array.from({ length: 64 }, () => new Array(64).fill(0)));
  const flags = Array.from({ length: 4 }, () => Array.from({ length: 64 }, () => new Array(64).fill(0)));
  const overlays = Array.from({ length: 4 }, () => Array.from({ length: 64 }, () => new Array(64).fill(0)));
  const underlays = Array.from({ length: 4 }, () => Array.from({ length: 64 }, () => new Array(64).fill(0)));

  for (let z = 0; z < 4; z++) {
    for (let tileX = 0; tileX < 64; tileX++) {
      for (let tileY = 0; tileY < 64; tileY++) {
        while (true) {
          const tileType = stream.readUShort();
          if (tileType === 0) {
            if (z === 0) {
              heights[0][tileX][tileY] = -nativeTerrainHeight(absX + tileX, absY + tileY) * 8;
            } else {
              heights[z][tileX][tileY] = heights[z - 1][tileX][tileY] - 240;
            }
            break;
          }
          if (tileType === 1) {
            let heightByte = stream.readUnsignedByte();
            if (heightByte === 1) {
              heightByte = 0;
            }
            if (z === 0) {
              heights[0][tileX][tileY] = -heightByte * 8;
            } else {
              heights[z][tileX][tileY] = heights[z - 1][tileX][tileY] - heightByte * 8;
            }
            break;
          }
          if (tileType <= 49) {
            overlays[z][tileX][tileY] = stream.readUShort();
          } else if (tileType <= 81) {
            flags[z][tileX][tileY] = tileType - 49;
          } else {
            underlays[z][tileX][tileY] = (tileType - 81) & 0xff;
          }
        }
      }
    }
  }

  return { heights, flags, overlays, underlays };
}

function isStructureObject(obj) {
  if (!obj) {
    return false;
  }
  if (STRUCTURE_TYPES.has(obj.type)) {
    return true;
  }
  return typeof obj.name === "string" && STRUCTURE_NAME_PATTERN.test(obj.name);
}

function isDoorObject(obj) {
  const name = String(obj?.name ?? "").toLowerCase();
  return /door|gate|archway/.test(name);
}

function isWallObject(obj) {
  if (!obj) {
    return false;
  }
  if (isDoorObject(obj)) {
    return false;
  }
  if (obj.type === ObjectType.WALL_STRAIGHT || obj.type === ObjectType.WALL_DIAGONAL) {
    return true;
  }
  return /wall/.test(String(obj.name ?? "").toLowerCase());
}

function isCornerObject(obj) {
  if (!obj) {
    return false;
  }
  if (
    obj.type === ObjectType.WALL_DIAGONAL_CORNER ||
    obj.type === ObjectType.WALL_L ||
    obj.type === ObjectType.WALL_SQUARE_CORNER
  ) {
    return true;
  }
  return /corner/.test(String(obj.name ?? "").toLowerCase());
}

function isRoofEdgeObject(obj) {
  if (!obj) {
    return false;
  }
  if (
    obj.type === ObjectType.ROOF_EDGE_SIDE ||
    obj.type === ObjectType.ROOF_RIDGE_CORNER ||
    obj.type === ObjectType.ROOF_SLOPE_CORNER
  ) {
    return true;
  }
  const name = String(obj.name ?? "").toLowerCase();
  return /roof/.test(name) && /edge|ridge|gable|eave/.test(name);
}

function isRoofTopObject(obj) {
  if (!obj) {
    return false;
  }
  if (
    obj.type === ObjectType.ROOF_SLOPE ||
    obj.type === ObjectType.ROOF_FLAT ||
    obj.type === ObjectType.ROOF_SLOPE_WITH_BORDER ||
    obj.type === ObjectType.ROOF_FLAT_WITH_BORDER ||
    obj.type === ObjectType.ROOF_EDGE_CORNER ||
    obj.type === ObjectType.ROOF_TOP_FLAT ||
    obj.type === ObjectType.ROOF_TOP_CORNER
  ) {
    return true;
  }
  const name = String(obj.name ?? "").toLowerCase();
  return /roof/.test(name) && !/edge|ridge|gable|eave/.test(name);
}

function isDecorObject(obj) {
  if (!obj) {
    return false;
  }
  if (
    obj.type === ObjectType.WALL_DECOR_STRAIGHT ||
    obj.type === ObjectType.WALL_DECOR_DIAGONAL ||
    obj.type === ObjectType.WALL_DECORATION
  ) {
    return true;
  }
  return DECOR_NAME_PATTERN.test(String(obj.name ?? "").toLowerCase());
}

function isWindowObject(obj) {
  return /window/.test(String(obj?.name ?? "").toLowerCase());
}

function isInteriorObject(obj) {
  if (!obj) {
    return false;
  }
  const name = String(obj.name ?? "").toLowerCase();
  if (!name || EXTERIOR_BLOCKLIST_PATTERN.test(name)) {
    return false;
  }
  if (INTERIOR_NAME_PATTERN.test(name)) {
    return true;
  }
  return obj.type === ObjectType.INTERACTIVE || obj.type === ObjectType.GROUND_DECOR;
}

function pointDistance(a, b, mode = "manhattan") {
  const dx = Math.abs((a?.x | 0) - (b?.x | 0));
  const dy = Math.abs((a?.y | 0) - (b?.y | 0));
  if (mode === "chebyshev") {
    return Math.max(dx, dy);
  }
  return dx + dy;
}

function clusterObjectPoints(objects, maxGap = 1, ignoreZ = false, adjacencyMode = "manhattan") {
  const clusters = [];
  const visited = new Set();
  for (let i = 0; i < objects.length; i++) {
    if (visited.has(i)) {
      continue;
    }
    const queue = [i];
    visited.add(i);
    const points = [];
    while (queue.length > 0) {
      const idx = queue.shift();
      const current = objects[idx];
      points.push(current);
      for (let j = 0; j < objects.length; j++) {
        if (visited.has(j)) {
          continue;
        }
        const candidate = objects[j];
        if (!ignoreZ && candidate.z !== current.z) {
          continue;
        }
        if (pointDistance(current, candidate, adjacencyMode) <= maxGap) {
          visited.add(j);
          queue.push(j);
        }
      }
    }
    clusters.push(points);
  }
  return clusters;
}

function describeCluster(points) {
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const z = points[0]?.z ?? 0;
  return {
    z,
    size: points.length,
    bounds: { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 },
    sampleObjectIds: points.slice(0, 24).map((p) => p.id),
  };
}

function clusterStructures(structures, maxGap = 1) {
  return clusterObjectPoints(structures, maxGap, false)
    .map((points) => describeCluster(points))
    .sort((a, b) => b.size - a.size);
}

function summarizeRegion(regionId, objects) {
  const structures = objects.filter(isStructureObject);
  const clusters = clusterStructures(structures, 1);

  const typeHistogram = {};
  const idHistogram = {};
  for (const obj of structures) {
    typeHistogram[obj.type] = (typeHistogram[obj.type] ?? 0) + 1;
    idHistogram[obj.id] = (idHistogram[obj.id] ?? 0) + 1;
  }

  const topIds = Object.entries(idHistogram)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id, count]) => ({ id: Number(id), count }));

  return {
    regionId,
    totalObjects: objects.length,
    structureObjects: structures.length,
    structureDensityPct: Number(((structures.length / 4096) * 100).toFixed(2)),
    typeHistogram,
    topStructureIds: topIds,
    clusterCount: clusters.length,
    largestClusters: clusters.slice(0, 20),
  };
}

function analyzeAroundRegion(centerRegionX, centerRegionY, radius) {
  const perRegion = [];
  const allStructures = [];

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const regionX = centerRegionX + dx;
      const regionY = centerRegionY + dy;
      const regionId = ((regionX & 0xff) << 8) | (regionY & 0xff);
      const objects = decodeRegionObjects(regionId);
      const summary = summarizeRegion(regionId, objects);
      perRegion.push({
        regionX,
        regionY,
        ...summary,
      });
      allStructures.push(...objects.filter(isStructureObject));
    }
  }

  const globalClusters = clusterStructures(allStructures, 1);
  return {
    center: { regionX: centerRegionX, regionY: centerRegionY },
    radius,
    scannedRegionCount: perRegion.length,
    generatedAt: new Date().toISOString(),
    perRegion,
    global: {
      totalStructureObjects: allStructures.length,
      clusterCount: globalClusters.length,
      largestClusters: globalClusters.slice(0, 40),
    },
  };
}

function incrementHistogram(histogram, key, amount = 1) {
  if (!Number.isInteger(key) || key <= 0) {
    return;
  }
  histogram.set(key, (histogram.get(key) ?? 0) + amount);
}

function mergeObjectHistogramByFilter(histogram, objects, predicate) {
  for (const obj of objects) {
    if (!predicate(obj)) {
      continue;
    }
    incrementHistogram(histogram, obj.id);
  }
}

function mergeType0RoleHints(wallHistogram, doorHistogram, objects) {
  const type0Counts = new Map();
  for (const obj of objects) {
    if (obj.type !== ObjectType.WALL_STRAIGHT || !Number.isInteger(obj.id) || obj.id <= 0) {
      continue;
    }
    type0Counts.set(obj.id, (type0Counts.get(obj.id) ?? 0) + 1);
  }
  if (type0Counts.size === 0) {
    return;
  }
  const ranked = [...type0Counts.entries()].sort((a, b) => b[1] - a[1]);
  incrementHistogram(wallHistogram, ranked[0][0], ranked[0][1]);
  if (ranked.length >= 2 && ranked[1][1] >= 1) {
    incrementHistogram(doorHistogram, ranked[1][0], Math.max(1, ranked[1][1]));
  }
}

function topIdsFromHistogram(histogram, limit = 6, minCount = 1) {
  return [...histogram.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

function topIdFromHistogram(histogram, fallback = null) {
  const top = topIdsFromHistogram(histogram, 1);
  return top.length > 0 ? top[0] : fallback;
}

function dedupeStyles(styles, limit = 16) {
  const unique = [];
  const signatures = new Set();
  for (const style of styles) {
    if (!style) {
      continue;
    }
    const signature = `${style.wallId}:${style.wallCornerId}:${style.doorId}:${style.roofEdgeId}:${style.roofTopId}`;
    if (signatures.has(signature)) {
      continue;
    }
    signatures.add(signature);
    unique.push(style);
    if (unique.length >= limit) {
      break;
    }
  }
  return unique;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function estimateSpacing(footprints) {
  if (!Array.isArray(footprints) || footprints.length < 2) {
    return 3;
  }
  const distances = [];
  for (let i = 0; i < footprints.length; i++) {
    let nearest = Number.MAX_SAFE_INTEGER;
    for (let j = 0; j < footprints.length; j++) {
      if (i === j) {
        continue;
      }
      const a = footprints[i];
      const b = footprints[j];
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      const d = dx + dy;
      if (d < nearest) {
        nearest = d;
      }
    }
    if (Number.isFinite(nearest) && nearest < Number.MAX_SAFE_INTEGER) {
      distances.push(nearest);
    }
  }
  if (distances.length === 0) {
    return 3;
  }
  const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
  return clamp(Math.round(avg / 3), 2, 9);
}

function estimateRoadSpacing(footprints) {
  const axisDistances = [];
  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      const a = footprints[i];
      const b = footprints[j];
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dy <= 2 && dx >= 6 && dx <= 30) {
        axisDistances.push(dx);
      } else if (dx <= 2 && dy >= 6 && dy <= 30) {
        axisDistances.push(dy);
      }
    }
  }
  if (axisDistances.length === 0) {
    return 12;
  }
  return clamp(Math.round(median(axisDistances)), 8, 20);
}

function computeClusterFloors(cluster, structures) {
  const { minX, minY, maxX, maxY } = cluster.bounds;
  const zSet = new Set();
  for (const obj of structures) {
    if (obj.x >= minX && obj.x <= maxX && obj.y >= minY && obj.y <= maxY) {
      zSet.add(obj.z);
    }
  }
  return clamp(zSet.size || 1, 1, 3);
}

function insideBounds(obj, bounds) {
  return obj.x >= bounds.minX && obj.x <= bounds.maxX && obj.y >= bounds.minY && obj.y <= bounds.maxY;
}

function buildStyleFromHistograms(index, wallHistogram, cornerHistogram, doorHistogram, roofEdgeHistogram, roofTopHistogram, windowIds, wallDecorIds) {
  const wallId = topIdFromHistogram(wallHistogram);
  const doorId = topIdFromHistogram(doorHistogram, wallId);
  const roofEdgeId = topIdFromHistogram(roofEdgeHistogram);
  const roofTopId = topIdFromHistogram(roofTopHistogram);
  if (!wallId || !doorId || !roofEdgeId || !roofTopId) {
    return null;
  }
  const cornerId = topIdFromHistogram(cornerHistogram, wallId);
  return {
    key: `LEARNED_${index + 1}`,
    floorUnderlay: 22,
    wallId,
    wallCornerId: cornerId,
    wallCornerType: 3,
    doorId,
    roofEdgeId,
    roofTopId,
    windowIds,
    wallDecorIds,
  };
}

function isLikelyBuildingCluster(clusterSummary, clusterObjects) {
  const width = clusterSummary.bounds.width;
  const height = clusterSummary.bounds.height;
  if (width < 5 || width > 28 || height < 5 || height > 28) {
    return false;
  }
  if (clusterSummary.size < 16) {
    return false;
  }
  const wallCount = clusterObjects.filter(isWallObject).length;
  const doorCount = clusterObjects.filter(isDoorObject).length;
  const roofCount = clusterObjects.filter((obj) => isRoofEdgeObject(obj) || isRoofTopObject(obj)).length;
  const uniqueType0Ids = new Set(clusterObjects.filter((obj) => obj.type === ObjectType.WALL_STRAIGHT).map((obj) => obj.id));
  if (wallCount < 8 || (doorCount < 1 && uniqueType0Ids.size < 2)) {
    return false;
  }
  return roofCount >= 3;
}

function createLayoutTemplate(clusterSummary, floors) {
  return {
    width: clamp(clusterSummary.bounds.width, 6, 24),
    height: clamp(clusterSummary.bounds.height, 6, 24),
    floors: clamp(floors, 1, 3),
  };
}

function dedupeLayoutTemplates(templates, limit = 18) {
  const signatures = new Set();
  const unique = [];
  for (const template of templates) {
    const sig = `${template.width}:${template.height}:${template.floors}`;
    if (signatures.has(sig)) {
      continue;
    }
    signatures.add(sig);
    unique.push(template);
    if (unique.length >= limit) {
      break;
    }
  }
  return unique;
}

function sampleTerrainProfileForPlane(
  bounds,
  clampedPlane,
  terrainCache,
  overlayCaptureBounds = bounds,
  options = null
) {
  const includeOverlayPerimeter = options?.includeOverlayPerimeter === true;
  const width = Math.max(1, bounds.maxX - bounds.minX + 1);
  const height = Math.max(1, bounds.maxY - bounds.minY + 1);
  const expectedSamples = width * height;
  const grid = Array.from({ length: height }, () => new Array(width).fill(null));
  const flagGrid = Array.from({ length: height }, () => new Array(width).fill(null));
  const overlayGrid = Array.from({ length: height }, () => new Array(width).fill(null));
  const samples = [];
  const flagHistogram = new Map();
  let roofRemovalTileCount = 0;

  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const regionId = (((x >> 6) & 0xff) << 8) | ((y >> 6) & 0xff);
      if (!terrainCache.has(regionId)) {
        terrainCache.set(regionId, decodeRegionTerrainData(regionId));
      }
      const terrainData = terrainCache.get(regionId);
      const row = y - bounds.minY;
      const col = x - bounds.minX;
      if (!terrainData) {
        continue;
      }
      const localX = x & 0x3f;
      const localY = y & 0x3f;
      const raw = terrainData.heights[clampedPlane]?.[localX]?.[localY];
      if (typeof raw !== "number") {
        continue;
      }
      const normalizedHeight = (-raw) | 0;
      grid[row][col] = normalizedHeight;
      samples.push(normalizedHeight);

      const tileFlag = terrainData.flags[clampedPlane]?.[localX]?.[localY];
      if (typeof tileFlag === "number") {
        const normalizedFlag = tileFlag | 0;
        flagGrid[row][col] = normalizedFlag;
        flagHistogram.set(normalizedFlag, (flagHistogram.get(normalizedFlag) ?? 0) + 1);
        if ((normalizedFlag & 4) !== 0) {
          roofRemovalTileCount++;
        }
      }

      const tileOverlay = terrainData.overlays?.[clampedPlane]?.[localX]?.[localY];
      const captureOverlay = includeOverlayPerimeter
        ? x >= overlayCaptureBounds.minX &&
          x <= overlayCaptureBounds.maxX &&
          y >= overlayCaptureBounds.minY &&
          y <= overlayCaptureBounds.maxY
        : x > overlayCaptureBounds.minX &&
          x < overlayCaptureBounds.maxX &&
          y > overlayCaptureBounds.minY &&
          y < overlayCaptureBounds.maxY;
      if (captureOverlay && typeof tileOverlay === "number") {
        overlayGrid[row][col] = tileOverlay & 0xff;
      }
    }
  }

  if (samples.length === 0) {
    return {
      plane: clampedPlane,
      available: false,
      width,
      height,
      sampleCount: 0,
      missingCount: expectedSamples,
      minHeight: 0,
      maxHeight: 0,
      differential: 0,
      meanHeight: 0,
      slopeMean: 0,
      roofRemovalTileCount: 0,
      roofRemovalCoveragePct: 0,
      flagHistogram: [],
      grid,
      flagGrid,
      overlayGrid,
    };
  }

  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const value of samples) {
    if (value < minHeight) {
      minHeight = value;
    }
    if (value > maxHeight) {
      maxHeight = value;
    }
    sum += value;
  }

  let slopeSum = 0;
  let slopeCount = 0;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const current = grid[row][col];
      if (typeof current !== "number") {
        continue;
      }
      if (col + 1 < width && typeof grid[row][col + 1] === "number") {
        slopeSum += Math.abs(current - grid[row][col + 1]);
        slopeCount++;
      }
      if (row + 1 < height && typeof grid[row + 1][col] === "number") {
        slopeSum += Math.abs(current - grid[row + 1][col]);
        slopeCount++;
      }
    }
  }

  return {
    plane: clampedPlane,
    available: true,
    width,
    height,
    sampleCount: samples.length,
    missingCount: expectedSamples - samples.length,
    minHeight,
    maxHeight,
    differential: maxHeight - minHeight,
    meanHeight: Number((sum / samples.length).toFixed(2)),
    slopeMean: Number((slopeCount > 0 ? slopeSum / slopeCount : 0).toFixed(2)),
    roofRemovalTileCount,
    roofRemovalCoveragePct: Number(((roofRemovalTileCount / Math.max(1, samples.length)) * 100).toFixed(2)),
    flagHistogram: [...flagHistogram.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([flag, count]) => ({ flag, count })),
    grid,
    flagGrid,
    overlayGrid,
  };
}

function buildTerrainProfileForBounds(
  bounds,
  minPlane,
  maxPlane = minPlane,
  overlayCaptureBounds = bounds,
  options = null
) {
  const clampedMinPlane = clamp(minPlane | 0, 0, 3);
  const clampedMaxPlane = clamp(maxPlane | 0, clampedMinPlane, 3);
  const terrainCache = new Map();
  const profilesByZ = {};
  const flagGridsByZ = {};
  const overlayGridsByZ = {};

  let primary = null;
  for (let plane = clampedMinPlane; plane <= clampedMaxPlane; plane++) {
    const relativeZ = plane - clampedMinPlane;
    const profile = sampleTerrainProfileForPlane(bounds, plane, terrainCache, overlayCaptureBounds, options);
    profilesByZ[String(relativeZ)] = profile;
    flagGridsByZ[String(relativeZ)] = profile.flagGrid;
    overlayGridsByZ[String(relativeZ)] = profile.overlayGrid;
    if (plane === clampedMinPlane) {
      primary = profile;
    }
  }

  return {
    ...primary,
    minPlane: clampedMinPlane,
    maxPlane: clampedMaxPlane,
    profilesByZ,
    flagGridsByZ,
    overlayGridsByZ,
  };
}

function sanitizeLabel(rawLabel) {
  const text = String(rawLabel ?? "").trim().toLowerCase();
  if (!text) {
    return "default";
  }
  return text.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "default";
}

function collectObjectsAroundRegion(centerRegionX, centerRegionY, radius = 1) {
  const objects = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const regionX = centerRegionX + dx;
      const regionY = centerRegionY + dy;
      const regionId = ((regionX & 0xff) << 8) | (regionY & 0xff);
      objects.push(...decodeRegionObjects(regionId));
    }
  }
  return objects;
}

function distanceToBounds(x, y, bounds) {
  const dx = x < bounds.minX ? bounds.minX - x : x > bounds.maxX ? x - bounds.maxX : 0;
  const dy = y < bounds.minY ? bounds.minY - y : y > bounds.maxY ? y - bounds.maxY : 0;
  return dx + dy;
}

function isHouseBoundaryObject(obj) {
  return isWallObject(obj) || isDoorObject(obj) || isCornerObject(obj);
}

function summarizeHouseBoundaryCluster(points, playerX, playerY) {
  const summary = describeCluster(points);
  const bounds = summary.bounds;
  const width = bounds.width;
  const height = bounds.height;
  const area = width * height;
  const containsPlayer = playerX >= bounds.minX && playerX <= bounds.maxX && playerY >= bounds.minY && playerY <= bounds.maxY;
  const containsPlayerStrict = playerX > bounds.minX && playerX < bounds.maxX && playerY > bounds.minY && playerY < bounds.maxY;
  const distanceToPlayer = distanceToBounds(playerX, playerY, bounds);
  const wallCount = points.filter(isWallObject).length;
  const doorCount = points.filter(isDoorObject).length;
  const cornerCount = points.filter(isCornerObject).length;

  const perimeterSpan = Math.max(1, 2 * (width + height) - 4);
  const perimeterTiles = new Set();
  for (const obj of points) {
    if (obj.x === bounds.minX || obj.x === bounds.maxX || obj.y === bounds.minY || obj.y === bounds.maxY) {
      perimeterTiles.add(`${obj.x},${obj.y}`);
    }
  }
  const perimeterCoverage = perimeterTiles.size / perimeterSpan;

  return {
    points,
    bounds,
    width,
    height,
    area,
    containsPlayer,
    containsPlayerStrict,
    distanceToPlayer,
    wallCount,
    doorCount,
    cornerCount,
    perimeterSpan,
    perimeterCoverage,
  };
}

function findHouseBoundaryAt(allObjects, playerX, playerY, playerZ) {
  const candidateBoundaries = allObjects.filter((obj) => obj.z === playerZ && isHouseBoundaryObject(obj));
  if (candidateBoundaries.length === 0) {
    return null;
  }

  const buildSummaries = (objects) => {
    if (!Array.isArray(objects) || objects.length === 0) {
      return [];
    }
    const summaries = [];
    const seenBounds = new Set();
    for (const gap of [1, 2]) {
      const clusters = clusterObjectPoints(objects, gap, true, "chebyshev");
      for (const points of clusters) {
        const summary = summarizeHouseBoundaryCluster(points, playerX, playerY);
        const key = `${summary.bounds.minX},${summary.bounds.minY},${summary.bounds.maxX},${summary.bounds.maxY}`;
        if (seenBounds.has(key)) {
          continue;
        }
        seenBounds.add(key);
        summaries.push(summary);
      }
    }
    return summaries;
  };

  const scoreCluster = (cluster) => {
    if (!cluster) {
      return Number.NEGATIVE_INFINITY;
    }
    if (cluster.width < 2 || cluster.height < 2 || cluster.width > 96 || cluster.height > 96) {
      return Number.NEGATIVE_INFINITY;
    }

    const wallLike = cluster.wallCount + cluster.cornerCount + cluster.doorCount;
    if (wallLike < 2) {
      return Number.NEGATIVE_INFINITY;
    }

    const wallDensity = wallLike / Math.max(1, cluster.perimeterSpan);
    let score = 0;
    if (cluster.containsPlayerStrict) {
      score += 2000;
    } else if (cluster.containsPlayer) {
      score += 1400;
    } else if (cluster.distanceToPlayer <= 1) {
      score += 800;
    } else if (cluster.distanceToPlayer <= 3) {
      score += 500;
    } else {
      score += Math.max(0, 220 - cluster.distanceToPlayer * 30);
    }

    score += wallLike * 6;
    score += Math.round((cluster.perimeterCoverage || 0) * 240);
    score += Math.round(wallDensity * 400);
    score -= Math.round(cluster.area * 0.6);
    return score;
  };

  const pickBest = (summaries) => {
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const summary of summaries) {
      const score = scoreCluster(summary);
      if (!Number.isFinite(score)) {
        continue;
      }
      if (score > bestScore) {
        best = summary;
        bestScore = score;
      }
    }
    return best;
  };

  for (const radius of [5, 8, 12, 18, 24]) {
    const local = candidateBoundaries.filter(
      (obj) => Math.abs(obj.x - playerX) <= radius && Math.abs(obj.y - playerY) <= radius
    );
    const bestLocal = pickBest(buildSummaries(local));
    if (bestLocal && (bestLocal.containsPlayer || bestLocal.distanceToPlayer <= 1)) {
      return bestLocal;
    }
  }

  return pickBest(buildSummaries(candidateBoundaries));
}

function resolveHouseAt(player) {
  const location = player.getLocation();
  const playerX = location.getX();
  const playerY = location.getY();
  const playerZ = location.getZ();
  const centerRegionX = (playerX >> 6) & 0xff;
  const centerRegionY = (playerY >> 6) & 0xff;

  const allObjects = collectObjectsAroundRegion(centerRegionX, centerRegionY, 1);
  const boundary = findHouseBoundaryAt(allObjects, playerX, playerY, playerZ);
  if (!boundary) {
    throw new Error("No nearby house wall boundary found. Stand inside a house and try again.");
  }

  const bounds = boundary.bounds;
  const captureBounds = {
    minX: bounds.minX - 3,
    minY: bounds.minY - 3,
    maxX: bounds.maxX + 3,
    maxY: bounds.maxY + 3,
  };

  const inCapture = (obj) =>
    obj.x >= captureBounds.minX && obj.x <= captureBounds.maxX && obj.y >= captureBounds.minY && obj.y <= captureBounds.maxY;

  const structureObjects = allObjects.filter((obj) => inCapture(obj) && isStructureObject(obj));
  const zValues = allObjects
    .filter((obj) => inCapture(obj))
    .map((obj) => obj.z)
    .filter((z) => Number.isInteger(z) && z >= playerZ && z <= playerZ + 3);
  const minZ = playerZ;
  const maxZ = zValues.length > 0 ? Math.max(...zValues) : playerZ;

  const houseObjects = allObjects.filter((obj) => inCapture(obj) && obj.z >= minZ && obj.z <= maxZ + 1);

  return {
    location,
    playerX,
    playerY,
    playerZ,
    centerRegionX,
    centerRegionY,
    allObjects,
    boundary,
    bounds,
    captureBounds,
    minZ,
    maxZ,
    houseObjects,
  };
}

function mapToSortedPairs(histogram, limit = 16) {
  return [...histogram.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }));
}

function addToHistogram(histogram, id) {
  if (!Number.isInteger(id) || id <= 0) {
    return;
  }
  histogram.set(id, (histogram.get(id) ?? 0) + 1);
}

function collectIdsWithCounts(objects, predicate, limit = 16) {
  const histogram = new Map();
  for (const obj of objects) {
    if (!predicate(obj)) {
      continue;
    }
    addToHistogram(histogram, obj.id);
  }
  return mapToSortedPairs(histogram, limit);
}

function isPerimeterTile(obj, bounds) {
  return obj.x === bounds.minX || obj.x === bounds.maxX || obj.y === bounds.minY || obj.y === bounds.maxY;
}

function isInnerPerimeterTile(obj, bounds, inset = 1) {
  if (inset < 1) {
    return false;
  }
  const minX = bounds.minX + inset;
  const maxX = bounds.maxX - inset;
  const minY = bounds.minY + inset;
  const maxY = bounds.maxY - inset;
  if (minX > maxX || minY > maxY) {
    return false;
  }
  return obj.x === minX || obj.x === maxX || obj.y === minY || obj.y === maxY;
}

function isWallDecorationObject(obj) {
  if (!obj) {
    return false;
  }
  // Explicitly exclude type 22 (ground decoration).
  if (obj.type === ObjectType.WALL_DECORATION) {
    return false;
  }
  if (obj.type !== ObjectType.WALL_DECOR_STRAIGHT && obj.type !== ObjectType.WALL_DECOR_DIAGONAL) {
    return false;
  }
  const name = String(obj.name ?? "").toLowerCase();
  if (/grass|stone|rock|bush|tree|flower|plant/.test(name)) {
    return false;
  }
  return /window|banner|painting|torch|sconce|decoration|ornament|curtain|wall/.test(name);
}

function isAllowedHouseDumpObject(obj, bounds, boundaryIdSet, minZ) {
  if (!obj) {
    return false;
  }
  const insideBounds = obj.x >= bounds.minX && obj.x <= bounds.maxX && obj.y >= bounds.minY && obj.y <= bounds.maxY;
  if (insideBounds && isPerimeterTile(obj, bounds) && obj.type === ObjectType.WALL_DECORATION) {
    return false;
  }
  const insideExpandedBounds =
    obj.x >= bounds.minX - 3 && obj.x <= bounds.maxX + 3 && obj.y >= bounds.minY - 3 && obj.y <= bounds.maxY + 3;
  const nearBoundary =
    Math.min(Math.abs(obj.x - bounds.minX), Math.abs(obj.x - bounds.maxX)) <= 3 ||
    Math.min(Math.abs(obj.y - bounds.minY), Math.abs(obj.y - bounds.maxY)) <= 3;
  if (
    !insideBounds &&
    !(obj.z > minZ && insideExpandedBounds && nearBoundary && (isRoofEdgeObject(obj) || isRoofTopObject(obj)))
  ) {
    return false;
  }
  // Preserve all objects inside wall bounds on every floor for exact house replay.
  if (insideBounds) {
    return true;
  }
  // Allow upper-floor roof overhang/corner tiles just outside the wall rectangle.
  return obj.z > minZ && (isRoofEdgeObject(obj) || isRoofTopObject(obj));
}

function isInteriorContentType(type) {
  return (
    type === ObjectType.INTERACTIVE ||
    type === ObjectType.GROUND_DECOR ||
    type === ObjectType.WALL_DECOR_STRAIGHT ||
    type === ObjectType.WALL_DECOR_DIAGONAL ||
    type === ObjectType.WALL_DECORATION
  );
}

function isInteriorContentObject(obj, width, height) {
  if (!obj || !isInteriorContentType(obj.type)) {
    return false;
  }
  if (obj.x <= 0 || obj.x >= width - 1 || obj.y <= 0 || obj.y >= height - 1) {
    return false;
  }
  if (isDoorObject(obj) || isWallObject(obj) || isCornerObject(obj) || isRoofEdgeObject(obj) || isRoofTopObject(obj)) {
    return false;
  }
  return true;
}

function normalizeCapturedObject(obj, minX, minY, minZ) {
  if (!obj || !Number.isInteger(obj.id) || obj.id <= 0) {
    return null;
  }
  return {
    id: obj.id | 0,
    type: obj.type | 0,
    orientation: (obj.orientation | 0) & 0x3,
    x: (obj.x | 0) - (minX | 0),
    y: (obj.y | 0) - (minY | 0),
    z: (obj.z | 0) - (minZ | 0),
  };
}

function buildObjectCatalog(objects) {
  const uniqueIds = new Set();
  for (const obj of objects) {
    const id = obj?.id | 0;
    if (id > 0) {
      uniqueIds.add(id);
    }
  }
  const catalog = {};
  for (const id of [...uniqueIds].sort((a, b) => a - b)) {
    const metadata = getObjectMetadata(id, null);
    catalog[String(id)] = {
      name: metadata.name || null,
      actions: Array.isArray(metadata.actions) ? metadata.actions : [],
      sizeX: metadata.sizeX | 0,
      sizeY: metadata.sizeY | 0,
    };
  }
  return catalog;
}

function getObjectMetadata(id, fallbackName = null) {
  if (!Number.isInteger(id) || id <= 0) {
    return { name: String(fallbackName ?? "").toLowerCase(), actions: [], sizeX: 1, sizeY: 1 };
  }
  if (objectMetaCache.has(id)) {
    return objectMetaCache.get(id);
  }
  let metadata = null;
  try {
    const definition = ObjectDefinition.forId(id);
    const name = String(definition?.getName?.() ?? fallbackName ?? "").toLowerCase();
    const interactions = Array.isArray(definition?.getInteractions?.())
      ? definition.getInteractions()
      : [];
    const actions = interactions
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .map((value) => String(value).toLowerCase());
    const sizeX = clamp(Number.isInteger(definition?.getSizeX?.()) ? definition.getSizeX() : 1, 1, 8);
    const sizeY = clamp(Number.isInteger(definition?.getSizeY?.()) ? definition.getSizeY() : 1, 1, 8);
    metadata = { name, actions, sizeX, sizeY };
  } catch {
    metadata = { name: String(fallbackName ?? "").toLowerCase(), actions: [], sizeX: 1, sizeY: 1 };
  }
  objectMetaCache.set(id, metadata);
  return metadata;
}

function inferLayoutRole(type, distToWall) {
  if (type === ObjectType.WALL_DECORATION || type === ObjectType.WALL_DECOR_STRAIGHT || type === ObjectType.WALL_DECOR_DIAGONAL) {
    return "decor";
  }
  if (type === ObjectType.GROUND_DECOR) {
    return "ground";
  }
  if (distToWall <= 1) {
    return "near_wall";
  }
  return "interior";
}

function sortedHistogramEntries(histogram, limit = 24) {
  return [...histogram.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if ((sorted.length & 1) === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function resolveDominantAxisAndDividerLine(nodes, width, height) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return null;
  }
  const evaluateAxis = (axis) => {
    const histogram = new Map();
    for (const node of nodes) {
      const line = axis === "x" ? node.x : node.y;
      histogram.set(line, (histogram.get(line) ?? 0) + 1);
    }
    const entries = sortedHistogramEntries(histogram, 8);
    if (entries.length === 0) {
      return null;
    }
    const center = axis === "x" ? (width - 1) / 2 : (height - 1) / 2;
    const bestCount = entries[0][1];
    let bestLine = entries[0][0];
    for (const [line, count] of entries) {
      if (count !== bestCount) {
        break;
      }
      if (Math.abs(line - center) < Math.abs(bestLine - center)) {
        bestLine = line;
      }
    }
    const topLineCoverage = entries.slice(0, 3).reduce((sum, [, count]) => sum + count, 0);
    const score = bestCount * 3 + topLineCoverage;
    return {
      axis,
      center,
      bestLine,
      bestCount,
      score,
      histogram,
    };
  };

  const xEval = evaluateAxis("x");
  const yEval = evaluateAxis("y");
  if (!xEval && !yEval) {
    return null;
  }
  if (!xEval) {
    return yEval;
  }
  if (!yEval) {
    return xEval;
  }
  return xEval.score >= yEval.score ? xEval : yEval;
}

function buildLinearLayoutMotif(nodes, width, height) {
  if (!Array.isArray(nodes) || nodes.length < 6) {
    return null;
  }
  const dominant = resolveDominantAxisAndDividerLine(nodes, width, height);
  if (!dominant || dominant.bestCount < 3) {
    return null;
  }
  const dividerAxis = dominant.axis;
  const dividerLine = dominant.bestLine;
  const dividerOffset = Number((dividerLine - dominant.center).toFixed(3));

  const dividerHistogram = new Map();
  const serviceHistogram = new Map();
  const miscHistogram = new Map();
  const serviceOffsetHistogram = new Map();
  const serviceLineByFloor = new Map();
  const rowGapHistogram = new Map();
  const orientationBySide = {
    neg: new Map(),
    pos: new Map(),
  };
  const floorHistogram = new Map();

  const offsetCandidates = new Map();
  for (const node of nodes) {
    const line = dividerAxis === "x" ? node.x : node.y;
    const offset = Math.abs(line - dividerLine);
    if (offset > 0) {
      const bucket = Math.round(offset);
      offsetCandidates.set(bucket, (offsetCandidates.get(bucket) ?? 0) + 1);
    }
  }
  const serviceOffsets = sortedHistogramEntries(offsetCandidates, 3)
    .filter(([, count]) => count >= 2)
    .map(([value]) => value)
    .slice(0, 3);
  if (serviceOffsets.length === 0 && offsetCandidates.size > 0) {
    serviceOffsets.push(sortedHistogramEntries(offsetCandidates, 1)[0][0]);
  }
  const serviceOffsetSet = new Set(serviceOffsets);

  for (const node of nodes) {
    const key = `${node.id}:${node.type}`;
    const line = dividerAxis === "x" ? node.x : node.y;
    const offset = Math.round(Math.abs(line - dividerLine));
    if (offset === 0) {
      dividerHistogram.set(key, (dividerHistogram.get(key) ?? 0) + 1);
      continue;
    }
    if (serviceOffsetSet.has(offset)) {
      serviceHistogram.set(key, (serviceHistogram.get(key) ?? 0) + 1);
      serviceOffsetHistogram.set(offset, (serviceOffsetHistogram.get(offset) ?? 0) + 1);
      floorHistogram.set(node.z, (floorHistogram.get(node.z) ?? 0) + 1);
      const side = line < dividerLine ? "neg" : line > dividerLine ? "pos" : null;
      if (side) {
        orientationBySide[side].set(node.orientation, (orientationBySide[side].get(node.orientation) ?? 0) + 1);
      }
      const rowLineSet = serviceLineByFloor.get(node.z) ?? new Set();
      rowLineSet.add(line);
      serviceLineByFloor.set(node.z, rowLineSet);
    } else {
      miscHistogram.set(key, (miscHistogram.get(key) ?? 0) + 1);
    }
  }

  for (const lineSet of serviceLineByFloor.values()) {
    const lines = [...lineSet].sort((a, b) => a - b);
    for (let i = 1; i < lines.length; i++) {
      const gap = Math.abs(lines[i] - lines[i - 1]);
      if (gap > 0) {
        rowGapHistogram.set(gap, (rowGapHistogram.get(gap) ?? 0) + 1);
      }
    }
  }

  const encodePool = (histogram, limit = 10) =>
    sortedHistogramEntries(histogram, limit)
      .map(([key, count]) => {
        const [idText, typeText] = String(key).split(":");
        const id = Number.parseInt(idText, 10);
        const type = Number.parseInt(typeText, 10);
        if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(type)) {
          return null;
        }
        return { id, type, count };
      })
      .filter((entry) => entry !== null);

  return {
    motifScore: dominant.bestCount * 2 + serviceOffsetSet.size * 3,
    source: "geometry",
    dividerAxis,
    dividerOffset,
    dividerPool: encodePool(dividerHistogram, 12),
    servicePool: encodePool(serviceHistogram, 16),
    miscPool: encodePool(miscHistogram, 16),
    serviceOffsetPool: sortedHistogramEntries(serviceOffsetHistogram, 6).map(([value, count]) => ({ value, count })),
    rowGapPool: sortedHistogramEntries(rowGapHistogram, 6).map(([value, count]) => ({ value, count })),
    floorPool: sortedHistogramEntries(floorHistogram, 4).map(([value, count]) => ({ value, count })),
    orientationBySide: {
      neg: sortedHistogramEntries(orientationBySide.neg, 4).map(([value, count]) => ({ value, count })),
      pos: sortedHistogramEntries(orientationBySide.pos, 4).map(([value, count]) => ({ value, count })),
    },
  };
}

function buildLayoutGraphAndMotifs(normalizedObjects, bounds, houseType = null) {
  const width = Number.isInteger(bounds?.width) ? bounds.width : 0;
  const height = Number.isInteger(bounds?.height) ? bounds.height : 0;
  if (!Array.isArray(normalizedObjects) || width < 3 || height < 3) {
    return { graph: null, motifs: null };
  }

  const nodes = [];
  const roleHistogram = new Map();
  const roleIdHistogram = new Map();
  for (const obj of normalizedObjects) {
    if (!obj) {
      continue;
    }
    if (obj.x < 1 || obj.x > width - 2 || obj.y < 1 || obj.y > height - 2) {
      continue;
    }
    if (isDoorObject(obj) || isWallObject(obj) || isCornerObject(obj) || isRoofEdgeObject(obj) || isRoofTopObject(obj)) {
      continue;
    }
    if (!isInteriorContentType(obj.type)) {
      continue;
    }
    const metadata = getObjectMetadata(obj.id, obj.name);
    const distToWall = Math.min(obj.x, width - 1 - obj.x, obj.y, height - 1 - obj.y);
    const role = inferLayoutRole(obj.type, distToWall);
    const node = {
      i: nodes.length,
      id: obj.id,
      type: obj.type,
      x: obj.x,
      y: obj.y,
      z: obj.z,
      orientation: obj.orientation & 0x3,
      role,
      name: metadata.name || null,
      actions: metadata.actions.slice(0, 3),
      sizeX: metadata.sizeX,
      sizeY: metadata.sizeY,
      xNorm: Number((obj.x / Math.max(1, width - 1)).toFixed(3)),
      yNorm: Number((obj.y / Math.max(1, height - 1)).toFixed(3)),
      distToWall,
      nearWall: distToWall <= 1,
    };
    nodes.push(node);
    roleHistogram.set(role, (roleHistogram.get(role) ?? 0) + 1);
    const roleKey = `${role}|${obj.id}:${obj.type}`;
    roleIdHistogram.set(roleKey, (roleIdHistogram.get(roleKey) ?? 0) + 1);
    if (nodes.length >= 240) {
      break;
    }
  }

  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      if (a.z !== b.z) {
        continue;
      }
      const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (dist > 5) {
        continue;
      }
      const relations = [];
      if (dist <= 1) {
        relations.push("adjacent");
      }
      if (a.x === b.x || a.y === b.y) {
        relations.push("aligned");
      }
      if (a.orientation === b.orientation) {
        relations.push("parallel");
      }
      if (((a.orientation + 2) & 0x3) === b.orientation && (a.x === b.x || a.y === b.y)) {
        relations.push("facing");
      }
      edges.push({
        a: a.i,
        b: b.i,
        z: a.z,
        dist,
        relations,
      });
      if (edges.length >= 420) {
        break;
      }
    }
    if (edges.length >= 420) {
      break;
    }
  }

  const roleStats = sortedHistogramEntries(roleHistogram, 16).map(([role, count]) => ({ role, count }));
  const roleObjectPools = sortedHistogramEntries(roleIdHistogram, 40).map(([key, count]) => {
    const [role, objectKey] = String(key).split("|");
    const [idText, typeText] = String(objectKey).split(":");
    return {
      role,
      id: Number.parseInt(idText, 10),
      type: Number.parseInt(typeText, 10),
      count,
    };
  });

  const graph = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
  };

  const motifs = {
    roleStats,
    roleObjectPools,
  };
  const linearMotif = buildLinearLayoutMotif(nodes, width, height);
  if (linearMotif && linearMotif.motifScore >= 12) {
    motifs.linear = linearMotif;
  }
  return { graph, motifs };
}

function buildInteriorProfile(normalizedObjects, bounds) {
  const width = Number.isInteger(bounds?.width) ? bounds.width : 0;
  const height = Number.isInteger(bounds?.height) ? bounds.height : 0;
  if (!Array.isArray(normalizedObjects) || width < 3 || height < 3) {
    return null;
  }

  const innerArea = Math.max(1, Math.max(1, width - 4) * Math.max(1, height - 4));
  const byFloor = new Map();
  const objectStats = new Map();
  const pairStats = new Map();
  const edgeInset = 2;
  const minInnerX = edgeInset;
  const maxInnerX = Math.max(edgeInset, width - 1 - edgeInset);
  const minInnerY = edgeInset;
  const maxInnerY = Math.max(edgeInset, height - 1 - edgeInset);

  const addFloorObject = (obj) => {
    const z = obj.z | 0;
    let list = byFloor.get(z);
    if (!list) {
      list = [];
      byFloor.set(z, list);
    }
    list.push(obj);
  };

  for (const obj of normalizedObjects) {
    if (!isInteriorContentObject(obj, width, height)) {
      continue;
    }
    const key = `${obj.id}:${obj.type}`;
    const nearWall = obj.x <= minInnerX || obj.x >= maxInnerX || obj.y <= minInnerY || obj.y >= maxInnerY;
    const stats = objectStats.get(key) ?? { id: obj.id, type: obj.type, count: 0, wallAdjacent: 0 };
    stats.count += 1;
    if (nearWall) {
      stats.wallAdjacent += 1;
    }
    objectStats.set(key, stats);
    addFloorObject(obj);
  }

  for (const objects of byFloor.values()) {
    for (let i = 0; i < objects.length; i++) {
      const a = objects[i];
      for (let j = i + 1; j < objects.length; j++) {
        const b = objects[j];
        const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (dist > 4) {
          continue;
        }
        const aKey = `${a.id}:${a.type}`;
        const bKey = `${b.id}:${b.type}`;
        const pairKey = aKey <= bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
        pairStats.set(pairKey, (pairStats.get(pairKey) ?? 0) + 1);
      }
    }
  }

  const densityByFloor = {};
  let totalObjects = 0;
  for (const [z, objects] of byFloor.entries()) {
    totalObjects += objects.length;
    densityByFloor[String(z)] = Number((objects.length / innerArea).toFixed(4));
  }

  return {
    innerArea,
    objectCount: totalObjects,
    floorCount: byFloor.size,
    densityByFloor,
    objectStats: [...objectStats.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 64),
    pairStats: [...pairStats.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 96)
      .map(([pair, count]) => ({ pair, count })),
  };
}

function writeHouseExample(player, labelArg = "default", typeArg = null) {
  const {
    playerX,
    playerY,
    playerZ,
    centerRegionX,
    centerRegionY,
    boundary,
    bounds,
    captureBounds,
    minZ,
    maxZ,
    allObjects,
  } = resolveHouseAt(player);

  const boundaryIdSet = new Set(boundary.points.map((obj) => obj.id).filter((id) => Number.isInteger(id) && id > 0));
  const houseObjects = allObjects.filter(
    (obj) => obj.z >= minZ && obj.z <= maxZ + 1 && isAllowedHouseDumpObject(obj, bounds, boundaryIdSet, minZ)
  );
  const rawCaptureObjects = allObjects.filter(
    (obj) =>
      obj.z >= minZ &&
      obj.z <= maxZ + 1 &&
      obj.x >= captureBounds.minX &&
      obj.x <= captureBounds.maxX &&
      obj.y >= captureBounds.minY &&
      obj.y <= captureBounds.maxY
  );
  const rawBoundsObjects = rawCaptureObjects.filter(
    (obj) => obj.x >= bounds.minX && obj.x <= bounds.maxX && obj.y >= bounds.minY && obj.y <= bounds.maxY
  );

  const normalizedObjects = houseObjects.map((obj) => ({
    id: obj.id,
    type: obj.type,
    orientation: obj.orientation,
    x: obj.x - bounds.minX,
    y: obj.y - bounds.minY,
    z: obj.z - minZ,
    name: obj.name ?? null,
  }));
  const normalizedRawCaptureObjects = rawCaptureObjects
    .map((obj) => normalizeCapturedObject(obj, captureBounds.minX, captureBounds.minY, minZ))
    .filter((obj) => obj !== null);
  const normalizedRawBoundsObjects = rawBoundsObjects
    .map((obj) => normalizeCapturedObject(obj, bounds.minX, bounds.minY, minZ))
    .filter((obj) => obj !== null);
  const houseType = normalizeHouseExampleType(typeArg);
  const interiorProfile = buildInteriorProfile(normalizedObjects, bounds);
  const { graph: layoutGraph, motifs: layoutMotifs } = buildLayoutGraphAndMotifs(normalizedObjects, bounds, houseType);

  const terrainBounds = {
    minX: bounds.minX - 3,
    minY: bounds.minY - 3,
    maxX: bounds.maxX + 3,
    maxY: bounds.maxY + 3,
  };
  const terrainProfile = buildTerrainProfileForBounds(terrainBounds, minZ, Math.min(3, maxZ + 1), bounds);
  terrainProfile.originOffsetX = terrainBounds.minX - bounds.minX;
  terrainProfile.originOffsetY = terrainBounds.minY - bounds.minY;
  const rawTerrainProfile = buildTerrainProfileForBounds(
    bounds,
    minZ,
    Math.min(3, maxZ + 1),
    bounds,
    { includeOverlayPerimeter: true }
  );
  rawTerrainProfile.originOffsetX = 0;
  rawTerrainProfile.originOffsetY = 0;
  const rawObjectCatalog = buildObjectCatalog(rawCaptureObjects);

  const label = sanitizeLabel(labelArg);
  const example = {
    createdAt: new Date().toISOString(),
    type: houseType,
    playerLocation: { x: playerX, y: playerY, z: playerZ },
    region: { regionX: centerRegionX, regionY: centerRegionY, regionId: ((centerRegionX & 0xff) << 8) | (centerRegionY & 0xff) },
    bounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      width: bounds.width,
      height: bounds.height,
      minZ,
      maxZ,
    },
    captureBounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      width: bounds.width,
      height: bounds.height,
    },
    terrainProfile,
    boundary: {
      wallCount: boundary.wallCount,
      doorCount: boundary.doorCount,
      cornerCount: boundary.cornerCount,
      perimeterCoverage: Number(boundary.perimeterCoverage.toFixed(3)),
      perimeterSpan: boundary.perimeterSpan,
      containsPlayer: boundary.containsPlayer,
      containsPlayerStrict: boundary.containsPlayerStrict,
      distanceToPlayer: boundary.distanceToPlayer,
    },
    categories: {
      walls: collectIdsWithCounts(houseObjects, isWallObject, 10),
      doors: collectIdsWithCounts(houseObjects, isDoorObject, 10),
      corners: collectIdsWithCounts(houseObjects, isCornerObject, 10),
      roofEdges: collectIdsWithCounts(houseObjects, isRoofEdgeObject, 10),
      roofTops: collectIdsWithCounts(houseObjects, isRoofTopObject, 10),
      wallDecor: collectIdsWithCounts(houseObjects, isWallDecorationObject, 10),
    },
    interiorProfile,
    layoutGraph,
    layoutMotifs,
    objectCount: houseObjects.length,
    layoutObjects: normalizedObjects,
    raw: {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      bounds: {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
        width: bounds.width,
        height: bounds.height,
        minZ,
        maxZ,
      },
      captureBounds: {
        minX: captureBounds.minX,
        minY: captureBounds.minY,
        maxX: captureBounds.maxX,
        maxY: captureBounds.maxY,
        width: captureBounds.maxX - captureBounds.minX + 1,
        height: captureBounds.maxY - captureBounds.minY + 1,
      },
      objectCounts: {
        replaySelection: normalizedObjects.length,
        inBounds: normalizedRawBoundsObjects.length,
        inCaptureBounds: normalizedRawCaptureObjects.length,
        uniqueIds: Object.keys(rawObjectCatalog).length,
      },
      objectCatalog: rawObjectCatalog,
      objects: {
        bounds: normalizedRawBoundsObjects,
        captureBounds: normalizedRawCaptureObjects,
      },
      terrainProfile: rawTerrainProfile,
    },
  };

  fs.mkdirSync(HOUSE_DUMP_DIRECTORY, { recursive: true });
  const outputPath = path.join(HOUSE_DUMP_DIRECTORY, `${label}.json`);
  let doc = {
    label,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    examples: [],
  };
  if (fs.existsSync(outputPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.examples)) {
        doc = parsed;
      }
    } catch {
      // Ignore malformed existing files and overwrite with fresh document.
    }
  }

  doc.label = label;
  doc.updatedAt = new Date().toISOString();
  doc.examples.push(example);
  if (doc.examples.length > 64) {
    doc.examples = doc.examples.slice(doc.examples.length - 64);
  }
  for (const existingExample of doc.examples) {
    existingExample.type = normalizeHouseExampleType(existingExample?.type);
    if (existingExample?.categories && Object.prototype.hasOwnProperty.call(existingExample.categories, "ladders")) {
      delete existingExample.categories.ladders;
    }
  }
  doc.ladders = buildLadderCatalogFromExamples(doc.examples);
  if (Object.prototype.hasOwnProperty.call(doc, "laddersByType")) {
    delete doc.laddersByType;
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

  return {
    outputPath,
    label,
    type: houseType,
    exampleCount: doc.examples.length,
    width: bounds.width,
    height: bounds.height,
    floors: maxZ - minZ + 1,
    objectCount: houseObjects.length,
    terrainDifferential: terrainProfile.differential,
    terrainAvailable: terrainProfile.available,
  };
}

function checkHouseBoundary(player) {
  const { playerX, playerY, playerZ, bounds, boundary } = resolveHouseAt(player);
  return {
    playerX,
    playerY,
    playerZ,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    width: bounds.width,
    height: bounds.height,
    wallCount: boundary.wallCount,
    doorCount: boundary.doorCount,
    cornerCount: boundary.cornerCount,
    perimeterCoverage: Number(boundary.perimeterCoverage.toFixed(3)),
    containsPlayer: boundary.containsPlayer,
    containsPlayerStrict: boundary.containsPlayerStrict,
    distanceToPlayer: boundary.distanceToPlayer,
  };
}

function learnPresetsAroundRegion(centerRegionX, centerRegionY, radius) {
  const globalWallHistogram = new Map();
  const globalCornerHistogram = new Map();
  const globalDoorHistogram = new Map();
  const globalRoofEdgeHistogram = new Map();
  const globalRoofTopHistogram = new Map();
  const globalWindowHistogram = new Map();
  const globalDecorHistogram = new Map();
  const interiorHistogram = new Map();
  const interiorTypeById = new Map();

  const styleCandidates = [];
  const layoutTemplatesRaw = [];
  const footprints = [];

  let scannedRegions = 0;
  let scannedObjects = 0;
  let scannedStructures = 0;

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const regionX = centerRegionX + dx;
      const regionY = centerRegionY + dy;
      const regionId = ((regionX & 0xff) << 8) | (regionY & 0xff);
      const objects = decodeRegionObjects(regionId);
      const structures = objects.filter(isStructureObject);

      scannedRegions++;
      scannedObjects += objects.length;
      scannedStructures += structures.length;

      mergeObjectHistogramByFilter(globalWallHistogram, structures, isWallObject);
      mergeObjectHistogramByFilter(globalCornerHistogram, structures, isCornerObject);
      mergeObjectHistogramByFilter(globalDoorHistogram, structures, isDoorObject);
      mergeObjectHistogramByFilter(globalRoofEdgeHistogram, structures, isRoofEdgeObject);
      mergeObjectHistogramByFilter(globalRoofTopHistogram, structures, isRoofTopObject);
      mergeObjectHistogramByFilter(globalWindowHistogram, structures, isWindowObject);
      mergeObjectHistogramByFilter(globalDecorHistogram, structures, isDecorObject);
      mergeType0RoleHints(globalWallHistogram, globalDoorHistogram, structures);

      const clusters = clusterObjectPoints(structures, 1, true);
      for (const points of clusters) {
        const summary = describeCluster(points);
        if (!isLikelyBuildingCluster(summary, points)) {
          continue;
        }

        const floors = computeClusterFloors(summary, structures);
        const template = createLayoutTemplate(summary, floors);
        layoutTemplatesRaw.push(template);
        footprints.push({
          x: (summary.bounds.minX + summary.bounds.maxX) >> 1,
          y: (summary.bounds.minY + summary.bounds.maxY) >> 1,
          width: template.width,
          height: template.height,
        });

        const localWallHistogram = new Map();
        const localCornerHistogram = new Map();
        const localDoorHistogram = new Map();
        const localRoofEdgeHistogram = new Map();
        const localRoofTopHistogram = new Map();
        const localWindowHistogram = new Map();
        const localDecorHistogram = new Map();

        mergeObjectHistogramByFilter(localWallHistogram, points, isWallObject);
        mergeObjectHistogramByFilter(localCornerHistogram, points, isCornerObject);
        mergeObjectHistogramByFilter(localDoorHistogram, points, isDoorObject);
        mergeObjectHistogramByFilter(localRoofEdgeHistogram, points, isRoofEdgeObject);
        mergeObjectHistogramByFilter(localRoofTopHistogram, points, isRoofTopObject);
        mergeObjectHistogramByFilter(localWindowHistogram, points, isWindowObject);
        mergeObjectHistogramByFilter(localDecorHistogram, points, isDecorObject);
        mergeType0RoleHints(localWallHistogram, localDoorHistogram, points);

        const localStyle = buildStyleFromHistograms(
          styleCandidates.length,
          localWallHistogram,
          localCornerHistogram,
          localDoorHistogram,
          localRoofEdgeHistogram,
          localRoofTopHistogram,
          topIdsFromHistogram(localWindowHistogram, 4, 1),
          topIdsFromHistogram(localDecorHistogram, 4, 1)
        );
        if (localStyle) {
          styleCandidates.push(localStyle);
        }

        for (const obj of objects) {
          if (!insideBounds(obj, summary.bounds) || obj.z !== 0) {
            continue;
          }
          if (!isInteriorObject(obj)) {
            continue;
          }
          incrementHistogram(interiorHistogram, obj.id);
          if (!interiorTypeById.has(obj.id)) {
            interiorTypeById.set(obj.id, obj.type);
          }
        }
      }
    }
  }

  const globalWindowIds = topIdsFromHistogram(globalWindowHistogram, 6, 1);
  const globalDecorIds = topIdsFromHistogram(globalDecorHistogram, 6, 1);

  const styles = dedupeStyles(styleCandidates, 16);
  if (styles.length === 0) {
    const fallbackStyle = buildStyleFromHistograms(
      0,
      globalWallHistogram,
      globalCornerHistogram,
      globalDoorHistogram,
      globalRoofEdgeHistogram,
      globalRoofTopHistogram,
      globalWindowIds.slice(0, 4),
      globalDecorIds.slice(0, 4)
    );
    if (fallbackStyle) {
      styles.push(fallbackStyle);
    }
  }

  const uniqueTemplates = dedupeLayoutTemplates(layoutTemplatesRaw, 18);
  const widthChoices = [...new Set(uniqueTemplates.map((t) => t.width))].sort((a, b) => a - b).slice(0, 14);
  const heightChoices = [...new Set(uniqueTemplates.map((t) => t.height))].sort((a, b) => a - b).slice(0, 14);
  const floorValues = uniqueTemplates.map((t) => t.floors);
  const minFloors = floorValues.length > 0 ? clamp(Math.min(...floorValues), 1, 3) : 1;
  const maxFloors = floorValues.length > 0 ? clamp(Math.max(...floorValues), 1, 3) : 2;

  const avgFootprintArea =
    footprints.length > 0
      ? footprints.reduce((sum, fp) => sum + fp.width * fp.height, 0) / footprints.length
      : 110;
  const targetCoverage = 0.34;
  const targetCount = clamp(Math.round((targetCoverage * 4096) / Math.max(48, avgFootprintArea)), 8, 36);
  const buildingCountMin = clamp(Math.round(targetCount * 0.8), 8, 30);
  const buildingCountMax = clamp(Math.round(targetCount * 1.35), buildingCountMin + 2, 42);

  const interiorObjects = topIdsFromHistogram(interiorHistogram, 16, 2).map((id) => ({
    id,
    type: interiorTypeById.get(id) ?? 10,
  }));

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    center: { regionX: centerRegionX, regionY: centerRegionY },
    radius,
    scanStats: {
      scannedRegions,
      scannedObjects,
      scannedStructures,
      matchedBuildingClusters: uniqueTemplates.length,
    },
    styles,
    layoutTemplates: uniqueTemplates,
    contents: {
      interiorObjects,
      wallDecorIds: globalDecorIds.slice(0, 8),
      windowIds: globalWindowIds.slice(0, 8),
    },
    params: {
      townMode: true,
      buildingCountMin,
      buildingCountMax,
      widthChoices: widthChoices.length > 0 ? widthChoices : [8, 9, 10, 11, 12, 13, 14],
      heightChoices: heightChoices.length > 0 ? heightChoices : [8, 9, 10, 11, 12, 13, 14],
      minSpacing: estimateSpacing(footprints),
      minFloors,
      maxFloors,
      roadSpacing: estimateRoadSpacing(footprints),
      roadWidth: 2,
    },
  };
}

function writeLearnedPresetFile(player, radius = 1) {
  const location = player.getLocation();
  const centerRegionX = (location.getX() >> 6) & 0xff;
  const centerRegionY = (location.getY() >> 6) & 0xff;
  const clampedRadius = clamp(parseIntArg(String(radius)) ?? 1, 1, 8);
  const preset = learnPresetsAroundRegion(centerRegionX, centerRegionY, clampedRadius);
  fs.mkdirSync(path.dirname(PRESET_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(PRESET_OUTPUT_PATH, `${JSON.stringify(preset, null, 2)}\n`, "utf8");
  return {
    outputPath: PRESET_OUTPUT_PATH,
    styleCount: Array.isArray(preset.styles) ? preset.styles.length : 0,
    layoutCount: Array.isArray(preset.layoutTemplates) ? preset.layoutTemplates.length : 0,
    interiorCount: Array.isArray(preset.contents?.interiorObjects) ? preset.contents.interiorObjects.length : 0,
    params: preset.params,
    scanStats: preset.scanStats,
  };
}

function writeAnalysisReport(player, radius = 1) {
  const location = player.getLocation();
  const centerRegionX = (location.getX() >> 6) & 0xff;
  const centerRegionY = (location.getY() >> 6) & 0xff;
  const clampedRadius = clamp(parseIntArg(String(radius)) ?? 1, 1, 6);

  const report = analyzeAroundRegion(centerRegionX, centerRegionY, clampedRadius);
  const outputDir = ANALYSIS_REPORT_DIRECTORY;
  fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `region-structure-scan-r${clampedRadius}-${Date.now()}.json`;
  const outputPath = path.join(outputDir, fileName);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}

module.exports = {
  initRegionBuildingAnalysisCoreAccess,
  writeAnalysisReport,
  writeLearnedPresetFile,
  writeHouseExample,
  checkHouseBoundary,
  decodeRegionObjects,
  decodeRegionTerrainData,
  PRESET_OUTPUT_PATH,
  HOUSE_DUMP_DIRECTORY,
};
