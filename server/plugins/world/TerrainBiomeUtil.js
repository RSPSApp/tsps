const fs = require("fs");
const path = require("path");

const { ObjectType } = require("./ObjectType");
const { decodeRegionObjects, decodeRegionTerrainData } = require("./RegionBuildingAnalysisUtil");
const { PROCEDURAL_DATA_DIRECTORY } = require("./ProceduralDataPaths");
const { isWaterOverlayId } = require("../../src/main/typescript/elvarg/game/cache/TerrainWater");

const TERRAIN_BIOME_DIRECTORY = path.join(PROCEDURAL_DATA_DIRECTORY, "terrain-biomes");

const TREE_NAME_PATTERN =
  /\b(tree|oak|willow|maple|yew|magic|mahogany|teak|blisterwood|sulliuscep|juniper|evergreen|arctic pine|achey)\b/i;
const TREE_NAME_EXCLUDE_PATTERN = /\b(stump|sapling|seedling|roots?)\b/i;
const TREE_ACTION_PATTERN = /\bchop\b/i;
const NON_TREE_INTERACTIVE_NAME_PATTERN =
  /\b(bank|booth|door|wall|ladder|stair|anvil|altar|furnace|range|table|chair|crate|barrel|chest|portal|gate|bench|sign|fountain|statue|obelisk|lever)\b/i;

function sanitizeBiomeName(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) {
    return "";
  }
  return text.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function regionId(regionX, regionY) {
  return ((regionX & 0xff) << 8) | (regionY & 0xff);
}

function isTreeObject(obj) {
  const name = String(obj?.name ?? "");
  const interactions = Array.isArray(obj?.interactions)
    ? obj.interactions.map((action) => String(action ?? "").trim()).filter((action) => action.length > 0)
    : [];
  const hasTreeAction = interactions.some((action) => TREE_ACTION_PATTERN.test(action));

  if (name && TREE_NAME_EXCLUDE_PATTERN.test(name)) {
    return false;
  }

  if (name && TREE_NAME_PATTERN.test(name)) {
    return true;
  }

  if (hasTreeAction) {
    return true;
  }

  return false;
}

function sortedUnique(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

function mergeUniqueSorted(existing, incoming) {
  return sortedUnique([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isGroundDecorationObject(obj) {
  const type = obj?.type | 0;
  return type === ObjectType.GROUND_DECOR;
}

function buildDominantSpawnProfiles(ids, statsMap, fallbackType) {
  const profiles = [];
  for (const id of ids) {
    let best = null;
    for (const [key, count] of statsMap.entries()) {
      const [idText, typeText, orientationText] = key.split(":");
      if ((Number.parseInt(idText, 10) | 0) !== (id | 0)) {
        continue;
      }
      const candidate = {
        id: id | 0,
        type: Number.parseInt(typeText, 10) | 0,
        orientation: Number.parseInt(orientationText, 10) & 0x3,
        count: count | 0,
      };
      if (!best || candidate.count > best.count) {
        best = candidate;
      }
    }
    if (!best) {
      best = { id: id | 0, type: fallbackType | 0, orientation: 0, count: 1 };
    }
    profiles.push(best);
  }
  profiles.sort((a, b) => a.id - b.id);
  return profiles;
}

function buildIdDensityStats(ids, tileSetById, landTileCount) {
  const stats = [];
  const safeLandTiles = Math.max(1, landTileCount | 0);
  for (const id of ids) {
    const set = tileSetById.get(id);
    const tileCount = set instanceof Set ? set.size : 0;
    stats.push({
      id: id | 0,
      tileCount: tileCount | 0,
      density: Number((tileCount / safeLandTiles).toFixed(6)),
    });
  }
  stats.sort((a, b) => a.id - b.id);
  return stats;
}

function sampleRegionTerrainForBiome(regionX, regionY) {
  const mapRegionId = regionId(regionX, regionY);
  const terrainData = decodeRegionTerrainData(mapRegionId);
  if (!terrainData) {
    throw new Error(`Unable to decode terrain for region ${regionX},${regionY} (${mapRegionId}).`);
  }

  const objects = decodeRegionObjects(mapRegionId);
  const baseX = regionX * 64;
  const baseY = regionY * 64;
  const tileObjects = new Map();
  const globallyDetectedTreeIds = new Set();
  const interactiveIdStats = new Map();
  const treeSpawnStats = new Map();
  const groundSpawnStats = new Map();
  const treeTileSetById = new Map();
  const groundTileSetById = new Map();
  const bumpSpawnStat = (map, id, type, orientation) => {
    if (!Number.isInteger(id) || id <= 0) {
      return;
    }
    const key = `${id | 0}:${type | 0}:${orientation & 0x3}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  };
  const touchIdTile = (map, id, tileKey) => {
    let set = map.get(id);
    if (!set) {
      set = new Set();
      map.set(id, set);
    }
    set.add(tileKey);
  };

  for (const obj of objects) {
    if ((obj?.z | 0) !== 0) {
      continue;
    }
    const objId = obj?.id | 0;
    if (objId > 0 && isTreeObject(obj)) {
      globallyDetectedTreeIds.add(objId);
    }
    if ((obj?.type | 0) === ObjectType.INTERACTIVE && objId > 0) {
      const current = interactiveIdStats.get(objId) ?? {
        count: 0,
        treeLikeName: false,
        nonTreeName: false,
        hasChopAction: false,
      };
      current.count++;
      const name = String(obj?.name ?? "");
      if (name && TREE_NAME_PATTERN.test(name) && !TREE_NAME_EXCLUDE_PATTERN.test(name)) {
        current.treeLikeName = true;
      }
      if (name && NON_TREE_INTERACTIVE_NAME_PATTERN.test(name)) {
        current.nonTreeName = true;
      }
      const interactions = Array.isArray(obj?.interactions) ? obj.interactions : [];
      if (interactions.some((action) => TREE_ACTION_PATTERN.test(String(action ?? "")))) {
        current.hasChopAction = true;
      }
      interactiveIdStats.set(objId, current);
    }

    const localX = (obj?.x | 0) - baseX;
    const localY = (obj?.y | 0) - baseY;
    if (localX < 0 || localX >= 64 || localY < 0 || localY >= 64) {
      continue;
    }
    const key = (localX << 6) | localY;
    const list = tileObjects.get(key);
    if (list) {
      list.push(obj);
    } else {
      tileObjects.set(key, [obj]);
    }
  }

  const treeIds = new Set();
  const groundDecorationIds = new Set();
  const underlayIds = new Set();

  let landTileCount = 0;
  let waterTileCount = 0;
  let treeTileCount = 0;
  let treeObjectCount = 0;
  let groundDecorationTileCount = 0;
  let groundDecorationObjectCount = 0;

  for (let localX = 0; localX < 64; localX++) {
    for (let localY = 0; localY < 64; localY++) {
      const overlayId = terrainData?.overlays?.[0]?.[localX]?.[localY] | 0;
      const underlayId = terrainData?.underlays?.[0]?.[localX]?.[localY] | 0;
      if (isWaterOverlayId(overlayId)) {
        waterTileCount++;
        continue;
      }

      landTileCount++;
      if (underlayId > 0) {
        underlayIds.add(underlayId);
      }

      const key = (localX << 6) | localY;
      const objsAtTile = tileObjects.get(key) ?? [];
      let tileHasTree = false;
      let tileHasGroundDecoration = false;
      for (const obj of objsAtTile) {
        const id = obj?.id | 0;
        if (id <= 0) {
          continue;
        }
        if (isGroundDecorationObject(obj) && (obj?.mapFunction | 0) === -1) {
          groundDecorationIds.add(id);
          groundDecorationObjectCount++;
          tileHasGroundDecoration = true;
          bumpSpawnStat(groundSpawnStats, id, obj?.type | 0, obj?.orientation | 0);
          touchIdTile(groundTileSetById, id, key);
        }
        if (isTreeObject(obj)) {
          treeIds.add(id);
          treeObjectCount++;
          tileHasTree = true;
          bumpSpawnStat(treeSpawnStats, id, obj?.type | 0, obj?.orientation | 0);
          touchIdTile(treeTileSetById, id, key);
        }
      }
      if (tileHasTree) {
        treeTileCount++;
      }
      if (tileHasGroundDecoration) {
        groundDecorationTileCount++;
      }
    }
  }

  for (const id of globallyDetectedTreeIds) {
    treeIds.add(id);
  }

  // Fallback for sparse/missing object definition metadata in some caches:
  // if no explicit trees were found, pick frequent interactive ids that look tree-like.
  if (treeIds.size === 0) {
    const fallbackIds = [];
    for (const [id, stat] of interactiveIdStats.entries()) {
      if ((stat?.count | 0) < 6) {
        continue;
      }
      if (stat.hasChopAction || stat.treeLikeName) {
        fallbackIds.push({ id, count: stat.count });
        continue;
      }
      if (!stat.nonTreeName && (stat?.count | 0) >= 24) {
        fallbackIds.push({ id, count: stat.count });
      }
    }
    fallbackIds.sort((a, b) => b.count - a.count);
    for (const candidate of fallbackIds.slice(0, 8)) {
      treeIds.add(candidate.id | 0);
    }
  }

  // Trees must be interactive objects in generation; discard ids that were only seen as non-interactive.
  for (const id of [...treeIds]) {
    if (!interactiveIdStats.has(id) || groundDecorationIds.has(id)) {
      treeIds.delete(id);
    }
  }

  // Recalculate tree tiles/objects from finalized tree id set.
  if (treeIds.size > 0) {
    treeTileCount = 0;
    treeObjectCount = 0;
    for (let localX = 0; localX < 64; localX++) {
      for (let localY = 0; localY < 64; localY++) {
        const overlayId = terrainData?.overlays?.[0]?.[localX]?.[localY] | 0;
        if (isWaterOverlayId(overlayId)) {
          continue;
        }
        const key = (localX << 6) | localY;
        const objsAtTile = tileObjects.get(key) ?? [];
        let tileHasTree = false;
        for (const obj of objsAtTile) {
          const id = obj?.id | 0;
          if ((obj?.type | 0) !== ObjectType.INTERACTIVE || id <= 0 || !treeIds.has(id)) {
            continue;
          }
          treeObjectCount++;
          tileHasTree = true;
        }
        if (tileHasTree) {
          treeTileCount++;
        }
      }
    }
  }

  const treeDensity = landTileCount > 0 ? Number((treeTileCount / landTileCount).toFixed(6)) : 0;
  const groundDecorationDensity =
    landTileCount > 0 ? Number((groundDecorationTileCount / landTileCount).toFixed(6)) : 0;
  const treeProfiles = buildDominantSpawnProfiles(treeIds, treeSpawnStats, ObjectType.INTERACTIVE);
  const groundDecorationProfiles = buildDominantSpawnProfiles(
    groundDecorationIds,
    groundSpawnStats,
    ObjectType.GROUND_DECOR
  );
  const treeIdStats = buildIdDensityStats(treeIds, treeTileSetById, landTileCount);
  const groundDecorationIdStats = buildIdDensityStats(groundDecorationIds, groundTileSetById, landTileCount);

  return {
    regionX,
    regionY,
    regionId: mapRegionId,
    landTileCount,
    waterTileCount,
    treeTileCount,
    treeObjectCount,
    groundDecorationTileCount,
    groundDecorationObjectCount,
    treeDensity,
    groundDecorationDensity,
    treeIds: sortedUnique([...treeIds]),
    underlayIds: sortedUnique([...underlayIds]),
    groundDecorationIds: sortedUnique([...groundDecorationIds]),
    treeProfiles,
    groundDecorationProfiles,
    treeIdStats,
    groundDecorationIdStats,
  };
}

function readBiomeDocument(outputPath, biomeName) {
  const nowIso = new Date().toISOString();
  const emptyDoc = {
    biome: biomeName,
    createdAt: nowIso,
    updatedAt: nowIso,
    sampleCount: 0,
    sampleRegions: [],
    ids: {
      treeIds: [],
      underlayIds: [],
      groundDecorationIds: [],
    },
    metrics: {
      totalLandTiles: 0,
      totalWaterTilesSkipped: 0,
      totalTreeTiles: 0,
      totalTreeObjects: 0,
      totalGroundDecorationTiles: 0,
      totalGroundDecorationObjects: 0,
      averageTreeDensity: 0,
      averageGroundDecorationDensity: 0,
    },
    samples: [],
  };

  if (!fs.existsSync(outputPath)) {
    return emptyDoc;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return emptyDoc;
    }
    return {
      ...emptyDoc,
      ...parsed,
      biome: biomeName,
      ids: {
        ...emptyDoc.ids,
        ...(parsed.ids ?? {}),
      },
      metrics: {
        ...emptyDoc.metrics,
        ...(parsed.metrics ?? {}),
      },
      samples: Array.isArray(parsed.samples) ? parsed.samples : [],
      sampleRegions: Array.isArray(parsed.sampleRegions) ? parsed.sampleRegions : [],
    };
  } catch {
    return emptyDoc;
  }
}

function recomputeMetrics(samples) {
  let totalLandTiles = 0;
  let totalWaterTilesSkipped = 0;
  let totalTreeTiles = 0;
  let totalTreeObjects = 0;
  let totalGroundDecorationTiles = 0;
  let totalGroundDecorationObjects = 0;

  for (const sample of samples) {
    totalLandTiles += sample?.landTileCount | 0;
    totalWaterTilesSkipped += sample?.waterTileCount | 0;
    totalTreeTiles += sample?.treeTileCount | 0;
    totalTreeObjects += sample?.treeObjectCount | 0;
    totalGroundDecorationTiles += sample?.groundDecorationTileCount | 0;
    totalGroundDecorationObjects += sample?.groundDecorationObjectCount | 0;
  }

  const averageTreeDensity = totalLandTiles > 0 ? Number((totalTreeTiles / totalLandTiles).toFixed(6)) : 0;
  const averageGroundDecorationDensity =
    totalLandTiles > 0 ? Number((totalGroundDecorationTiles / totalLandTiles).toFixed(6)) : 0;

  return {
    totalLandTiles,
    totalWaterTilesSkipped,
    totalTreeTiles,
    totalTreeObjects,
    totalGroundDecorationTiles,
    totalGroundDecorationObjects,
    averageTreeDensity,
    averageGroundDecorationDensity,
  };
}

function dumpTerrainBiome(player, biomeArg) {
  const biome = sanitizeBiomeName(biomeArg);
  if (!biome) {
    throw new Error("Usage: ::dumpterrain <biome>");
  }

  const location = player.getLocation();
  const regionX = (location.getX() >> 6) & 0xff;
  const regionY = (location.getY() >> 6) & 0xff;
  const sample = sampleRegionTerrainForBiome(regionX, regionY);

  fs.mkdirSync(TERRAIN_BIOME_DIRECTORY, { recursive: true });
  const outputPath = path.join(TERRAIN_BIOME_DIRECTORY, `${biome}.json`);
  const doc = readBiomeDocument(outputPath, biome);

  doc.updatedAt = new Date().toISOString();
  doc.ids.treeIds = mergeUniqueSorted(doc.ids.treeIds, sample.treeIds);
  doc.ids.underlayIds = mergeUniqueSorted(doc.ids.underlayIds, sample.underlayIds);
  doc.ids.groundDecorationIds = mergeUniqueSorted(doc.ids.groundDecorationIds, sample.groundDecorationIds);
  doc.sampleRegions = mergeUniqueSorted(doc.sampleRegions, [sample.regionId]);

  doc.samples.push({
    capturedAt: new Date().toISOString(),
    regionX: sample.regionX,
    regionY: sample.regionY,
    regionId: sample.regionId,
    landTileCount: sample.landTileCount,
    waterTileCount: sample.waterTileCount,
    treeTileCount: sample.treeTileCount,
    treeObjectCount: sample.treeObjectCount,
    groundDecorationTileCount: sample.groundDecorationTileCount,
    groundDecorationObjectCount: sample.groundDecorationObjectCount,
    treeDensity: sample.treeDensity,
    groundDecorationDensity: sample.groundDecorationDensity,
    treeIds: sample.treeIds,
    underlayIds: sample.underlayIds,
    groundDecorationIds: sample.groundDecorationIds,
    treeProfiles: sample.treeProfiles,
    groundDecorationProfiles: sample.groundDecorationProfiles,
    treeIdStats: sample.treeIdStats,
    groundDecorationIdStats: sample.groundDecorationIdStats,
  });
  if (doc.samples.length > 256) {
    doc.samples = doc.samples.slice(doc.samples.length - 256);
  }

  doc.sampleCount = doc.samples.length;
  doc.metrics = recomputeMetrics(doc.samples);

  fs.writeFileSync(outputPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

  return {
    biome,
    outputPath,
    sample,
    sampleCount: doc.sampleCount,
    totalTreeIds: doc.ids.treeIds.length,
    totalUnderlayIds: doc.ids.underlayIds.length,
    totalGroundDecorationIds: doc.ids.groundDecorationIds.length,
  };
}

function loadTerrainBiome(biomeArg) {
  const biome = sanitizeBiomeName(biomeArg);
  if (!biome) {
    throw new Error("Usage: ::genterrain <biome> [seed]");
  }

  const inputPath = path.join(TERRAIN_BIOME_DIRECTORY, `${biome}.json`);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`No terrain biome dump found for '${biome}'. Use ::dumpterrain ${biome} first.`);
  }

  const doc = readBiomeDocument(inputPath, biome);
  if (!Array.isArray(doc.samples) || doc.samples.length === 0) {
    throw new Error(`Terrain biome '${biome}' has no samples. Use ::dumpterrain ${biome} first.`);
  }

  const treeIds = sortedUnique(doc?.ids?.treeIds ?? []);
  const underlayIds = sortedUnique(doc?.ids?.underlayIds ?? []);
  const groundDecorationIds = sortedUnique(doc?.ids?.groundDecorationIds ?? []);
  const metrics = recomputeMetrics(doc.samples);
  const buildDensityById = (fieldName, ids) => {
    const accum = new Map();
    for (const sample of doc.samples) {
      const entries = Array.isArray(sample?.[fieldName]) ? sample[fieldName] : [];
      for (const entry of entries) {
        const id = entry?.id | 0;
        if (id <= 0) {
          continue;
        }
        const density = Number(entry?.density);
        const tileCount = entry?.tileCount | 0;
        const current = accum.get(id) ?? { sumDensity: 0, samples: 0, maxTileCount: 0 };
        if (Number.isFinite(density) && density >= 0) {
          current.sumDensity += density;
          current.samples++;
        }
        current.maxTileCount = Math.max(current.maxTileCount, tileCount);
        accum.set(id, current);
      }
    }

    const result = {};
    for (const id of ids) {
      const current = accum.get(id);
      if (!current || current.samples <= 0) {
        result[String(id)] = { density: 0, tileCount: 0 };
        continue;
      }
      result[String(id)] = {
        density: Number((current.sumDensity / current.samples).toFixed(6)),
        tileCount: current.maxTileCount | 0,
      };
    }
    return result;
  };
  const buildProfileById = (fieldName, ids, fallbackType) => {
    const counts = new Map();
    for (const sample of doc.samples) {
      const entries = Array.isArray(sample?.[fieldName]) ? sample[fieldName] : [];
      for (const entry of entries) {
        const id = entry?.id | 0;
        if (id <= 0) {
          continue;
        }
        const type = entry?.type | 0;
        const orientation = (entry?.orientation | 0) & 0x3;
        const weight = Math.max(1, entry?.count | 0);
        const key = `${id}:${type}:${orientation}`;
        counts.set(key, (counts.get(key) ?? 0) + weight);
      }
    }

    const profile = {};
    for (const id of ids) {
      let best = null;
      for (const [key, count] of counts.entries()) {
        const [idText, typeText, orientationText] = key.split(":");
        if ((Number.parseInt(idText, 10) | 0) !== (id | 0)) {
          continue;
        }
        const candidate = {
          type: Number.parseInt(typeText, 10) | 0,
          orientation: Number.parseInt(orientationText, 10) & 0x3,
          count: count | 0,
        };
        if (!best || candidate.count > best.count) {
          best = candidate;
        }
      }
      profile[String(id)] = best
        ? { type: best.type, orientation: best.orientation }
        : { type: fallbackType | 0, orientation: 0 };
    }
    return profile;
  };

  const treeDensity = clamp(
    Number.isFinite(metrics.averageTreeDensity) ? metrics.averageTreeDensity : 0,
    0,
    0.9
  );
  const groundDecorationDensity = clamp(
    Number.isFinite(metrics.averageGroundDecorationDensity) ? metrics.averageGroundDecorationDensity : 0,
    0,
    0.9
  );

  return {
    biome,
    inputPath,
    treeIds,
    underlayIds,
    groundDecorationIds,
    treeProfileById: buildProfileById("treeProfiles", treeIds, ObjectType.INTERACTIVE),
    groundDecorationProfileById: buildProfileById(
      "groundDecorationProfiles",
      groundDecorationIds,
      ObjectType.GROUND_DECOR
    ),
    treeDensityById: buildDensityById("treeIdStats", treeIds),
    groundDecorationDensityById: buildDensityById("groundDecorationIdStats", groundDecorationIds),
    treeDensity,
    groundDecorationDensity,
    sampleCount: doc.samples.length,
    metrics,
  };
}

module.exports = {
  dumpTerrainBiome,
  loadTerrainBiome,
  TERRAIN_BIOME_DIRECTORY,
};
