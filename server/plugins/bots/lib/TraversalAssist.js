const fs = require("fs");
const path = require("path");
const { MapObjects } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");

// Bump when the dump shape or its inputs change; older dumps are rescanned.
const INDEX_FORMAT_VERSION = 2;

/**
 * The cache revision the server loaded, so a dump from another cache is rebuilt.
 * `target.txt` sits beside the server process, and is packaged into browser worlds.
 */
function readCacheTarget() {
  try {
    return fs.readFileSync(path.join(process.cwd(), "target.txt"), "utf8").trim();
  } catch (_) {
    return null;
  }
}

function regionBounds(regionId) {
  return {
    absX: (regionId >> 8) * 64,
    absY: (regionId & 0xff) * 64,
  };
}

function regionIdsForBounds(regionManager, minX, maxX, minY, maxY) {
  const startRegionX = minX >> 6;
  const endRegionX = maxX >> 6;
  const startRegionY = minY >> 6;
  const endRegionY = maxY >> 6;
  const ids = [];
  for (let regionX = startRegionX; regionX <= endRegionX; regionX++) {
    for (let regionY = startRegionY; regionY <= endRegionY; regionY++) {
      ids.push(regionManager.regionIdForTile(regionX << 6, regionY << 6));
    }
  }
  return ids;
}

function distanceSquared(aX, aY, bX, bY) {
  const dx = aX - bX;
  const dy = aY - bY;
  return dx * dx + dy * dy;
}

function createTraversalAssist(api, options = {}) {
  const RegionManager = api.getRegionManager();
  const trackedObjectIds = new Set(options.objectIds ?? []);
  const objectsByRegion = new Map();
  const cacheTarget = readCacheTarget();
  let indexInitialized = false;
  let nextInitAttemptAtMs = 0;
  const INIT_RETRY_BACKOFF_MS = 5000;
  const persistentIndexPath =
    options.cachePath ??
    path.join(process.cwd(), "plugins", "bots", "data", "object-index.json");

  /** Sorted id list: a dump built for a different set of tracked kinds is rejected. */
  function trackedIdsFingerprint() {
    return [...trackedObjectIds].sort((a, b) => a - b).join(",");
  }

  function parseNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Math.floor(parsed);
  }

  function ensureRegionMap(regionId) {
    let byId = objectsByRegion.get(regionId);
    if (!byId) {
      byId = new Map();
      objectsByRegion.set(regionId, byId);
    }
    return byId;
  }

  function addIndexedLocation(regionId, objectId, x, y, z) {
    const byId = ensureRegionMap(regionId);
    let locations = byId.get(objectId);
    if (!locations) {
      locations = [];
      byId.set(objectId, locations);
    }
    locations.push({ lx: x, ly: y, z });
  }

  function serializeIndexData() {
    // Store the index as region -> objectId -> [localX,localY,z][], so runtime lookups can
    // scope to nearby regions without any full map scans.
    const regions = {};

    for (const [regionId, byId] of objectsByRegion.entries()) {
      const regionData = {};
      for (const [objectId, locations] of byId.entries()) {
        if (!Array.isArray(locations) || locations.length === 0) {
          continue;
        }
        const key = String(objectId);
        regionData[key] = locations.map((entry) => [entry.lx, entry.ly, entry.z]);
      }
      if (Object.keys(regionData).length > 0) {
        regions[String(regionId)] = regionData;
      }
    }

    return {
      v: INDEX_FORMAT_VERSION,
      t: Date.now(),
      cache: cacheTarget,
      ids: trackedIdsFingerprint(),
      r: regions,
    };
  }

  /** Returns counts, or null when the dump is from another format/cache/id set. */
  function loadIndexData(data) {
    if (!data || typeof data !== "object" || data.v !== INDEX_FORMAT_VERSION) {
      return null;
    }
    if (data.cache !== cacheTarget) {
      return null;
    }
    if (data.ids !== trackedIdsFingerprint()) {
      return null;
    }

    const regions = data.r;
    if (!regions || typeof regions !== "object") {
      return null;
    }

    objectsByRegion.clear();
    let objectCount = 0;
    for (const [rawRegionId, byId] of Object.entries(regions)) {
      const regionId = parseNumber(rawRegionId);
      if (!Number.isFinite(regionId) || !byId || typeof byId !== "object") {
        continue;
      }
      for (const [rawObjectId, entries] of Object.entries(byId)) {
        const objectId = parseNumber(rawObjectId);
        if (
          !Number.isFinite(objectId) ||
          !trackedObjectIds.has(objectId) ||
          !Array.isArray(entries)
        ) {
          continue;
        }
        for (const entry of entries) {
          if (!Array.isArray(entry) || entry.length < 3) {
            continue;
          }
          const x = parseNumber(entry[0]);
          const y = parseNumber(entry[1]);
          const z = parseNumber(entry[2]);
          if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(z) ||
            x < 0 || x > 63 || y < 0 || y > 63
          ) {
            continue;
          }
          addIndexedLocation(regionId, objectId, x, y, z);
          objectCount++;
        }
      }
    }

    return {
      regionCount: objectsByRegion.size,
      objectCount,
    };
  }

  function loadPersistentIndexFromFile() {
    if (!fs.existsSync(persistentIndexPath)) {
      return null;
    }
    const raw = fs.readFileSync(persistentIndexPath, "utf8");
    const parsed = JSON.parse(raw);
    return loadIndexData(parsed);
  }

  /** Indexes a region that is already loaded; appends to whatever is there. */
  function scanLoadedRegion(regionId) {
    const region = RegionManager.getRegionid(regionId);
    if (!region?.isLoaded?.()) {
      return 0;
    }
    const { absX, absY } = regionBounds(regionId);

    let matches = 0;
    for (let z = 0; z < 4; z++) {
      for (let localX = 0; localX < 64; localX++) {
        for (let localY = 0; localY < 64; localY++) {
          const x = absX + localX;
          const y = absY + localY;
          const hash = MapObjects.getHash(x, y, z);
          const objects = MapObjects.mapObjects.get(hash);
          if (!objects || objects.length === 0) {
            continue;
          }
          for (const object of objects) {
            const objectId = object?.getId?.();
            if (!trackedObjectIds.has(objectId)) {
              continue;
            }
            const loc = object.getLocation?.();
            if (!loc) {
              continue;
            }
            const localXFromLoc = loc.getX() - absX;
            const localYFromLoc = loc.getY() - absY;
            if (
              localXFromLoc < 0 ||
              localXFromLoc > 63 ||
              localYFromLoc < 0 ||
              localYFromLoc > 63
            ) {
              continue;
            }
            addIndexedLocation(
              regionId,
              objectId,
              localXFromLoc,
              localYFromLoc,
              loc.getZ()
            );
            matches++;
          }
        }
      }
    }
    return matches;
  }

  function scanRegion(regionId) {
    const region = RegionManager.getRegionid(regionId);
    if (!region) {
      return 0;
    }
    if (!region.isLoaded?.()) {
      const { absX, absY } = regionBounds(regionId);
      RegionManager.loadMapFiles(absX, absY);
    }
    return scanLoadedRegion(regionId);
  }

  /** Region loads replace its entries, so late maps and region packs are indexed. */
  function indexLoadedRegion(regionId) {
    objectsByRegion.delete(regionId);
    scanLoadedRegion(regionId);
  }

  function buildPersistentIndexByScanningMap() {
    objectsByRegion.clear();
    const regionIds = [...RegionManager.regions.keys()].sort((a, b) => a - b);
    let objectCount = 0;
    for (const regionId of regionIds) {
      objectCount += scanRegion(regionId);
    }

    const payload = serializeIndexData();
    fs.mkdirSync(path.dirname(persistentIndexPath), { recursive: true });
    const tempPath = `${persistentIndexPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload));
    fs.renameSync(tempPath, persistentIndexPath);
    return {
      regionCount: objectsByRegion.size,
      objectCount,
    };
  }

  function initializePersistentIndex(options = {}) {
    const forceRescan = options.forceRescan === true;
    const nowMs = Date.now();
    if (indexInitialized && !forceRescan) {
      return true;
    }
    if (!forceRescan && nowMs < nextInitAttemptAtMs) {
      return false;
    }

    const startedAt = Date.now();

    // The dump needs no regions, so load it before core has initialized them; a
    // missing or stale dump falls through to the post-startup scan below.
    if (!forceRescan) {
      try {
        const loaded = loadPersistentIndexFromFile();
        if (loaded && loaded.objectCount > 0) {
          indexInitialized = true;
          nextInitAttemptAtMs = 0;
          api?.log?.("object_index_loaded", {
            source: "cache",
            path: persistentIndexPath,
            regionCount: loaded.regionCount,
            objectCount: loaded.objectCount,
            trackedObjectIds: trackedObjectIds.size,
            durationMs: Date.now() - startedAt,
          });
          return true;
        }
      } catch (error) {
        api?.log?.("object_index_load_failed", {
          path: persistentIndexPath,
          message: error?.message ?? String(error),
        });
      }
    }

    if (RegionManager.regions.size === 0) {
      nextInitAttemptAtMs = nowMs + INIT_RETRY_BACKOFF_MS;
      api?.log?.("object_index_init_deferred", {
        reason: "regions_not_initialized",
        retryAfterMs: INIT_RETRY_BACKOFF_MS,
      });
      return false;
    }

    try {
      const scanned = buildPersistentIndexByScanningMap();
      indexInitialized = true;
      nextInitAttemptAtMs = 0;
      api?.log?.("object_index_built", {
        source: "scan",
        path: persistentIndexPath,
        regionCount: scanned.regionCount,
        objectCount: scanned.objectCount,
        trackedObjectIds: trackedObjectIds.size,
        durationMs: Date.now() - startedAt,
      });
      return true;
    } catch (error) {
      nextInitAttemptAtMs = Date.now() + INIT_RETRY_BACKOFF_MS;
      api?.log?.("object_index_build_failed", {
        path: persistentIndexPath,
        message: error?.message ?? String(error),
        retryAfterMs: INIT_RETRY_BACKOFF_MS,
      });
      return false;
    }
  }

  function ensurePersistentIndex() {
    if (indexInitialized) {
      return true;
    }
    return initializePersistentIndex();
  }

  function schedulePersistentIndexInitialization(delayMs = 0) {
    const normalizedDelay = Number.isFinite(delayMs)
      ? Math.max(0, Math.floor(delayMs))
      : 0;
    setTimeout(() => {
      let initialized = false;
      try {
        initialized = initializePersistentIndex();
      } catch (error) {
        api?.log?.("object_index_schedule_init_failed", {
          path: persistentIndexPath,
          message: error?.message ?? String(error),
        });
      }
      // Regions may not exist yet on the first pass; retry until indexing lands.
      if (!initialized) {
        schedulePersistentIndexInitialization(INIT_RETRY_BACKOFF_MS);
      }
    }, normalizedDelay);
  }

  function ensureRegionsLoaded(regionIds) {
    for (const regionId of regionIds) {
      const region = RegionManager.getRegionid(regionId);
      if (!region || region.isLoaded()) {
        continue;
      }
      const { absX, absY } = regionBounds(regionId);
      RegionManager.loadMapFiles(absX, absY);
    }
  }

  function resolveWorldObjectAt(objectId, x, y, z, privateArea = null) {
    if (privateArea) {
      const objects = privateArea.getObjects?.() ?? [];
      for (const object of objects) {
        if (object?.getId?.() !== objectId) {
          continue;
        }
        const loc = object.getLocation?.();
        if (!loc) {
          continue;
        }
        if (loc.getX() === x && loc.getY() === y && loc.getZ() === z) {
          return object;
        }
      }
      return null;
    }

    const hash = MapObjects.getHash(x, y, z);
    const bucket = MapObjects.mapObjects.get(hash);
    if (!bucket || bucket.length === 0) {
      return null;
    }
    for (const object of bucket) {
      if (object?.getId?.() !== objectId) {
        continue;
      }
      const loc = object.getLocation?.();
      if (!loc) {
        continue;
      }
      if (loc.getX() === x && loc.getY() === y && loc.getZ() === z) {
        return object;
      }
    }
    return null;
  }

  function trackObjectId(objectId) {
    if (!Number.isFinite(objectId) || objectId < 0 || trackedObjectIds.has(objectId)) {
      return;
    }
    trackedObjectIds.add(objectId);
    if (indexInitialized) {
      // A new id kind changes the fingerprint; rebuild on the next index use.
      indexInitialized = false;
      nextInitAttemptAtMs = 0;
    }
  }

  function trackObjectIds(objectIds = []) {
    for (const objectId of objectIds) {
      trackObjectId(objectId);
    }
  }

  function findNearestInPrivateArea(
    player,
    privateArea,
    objectId,
    minX,
    maxX,
    minY,
    maxY,
    z
  ) {
    const objects = privateArea?.getObjects?.() ?? [];
    const playerX = player.getLocation().getX();
    const playerY = player.getLocation().getY();
    let closest = null;
    let closestDistance = Number.MAX_SAFE_INTEGER;

    for (const object of objects) {
      if (object?.getId?.() !== objectId) {
        continue;
      }
      const loc = object.getLocation?.();
      if (!loc || loc.getZ() !== z) {
        continue;
      }
      const x = loc.getX();
      const y = loc.getY();
      if (x < minX || x > maxX || y < minY || y > maxY) {
        continue;
      }
      const dist = distanceSquared(playerX, playerY, x, y);
      if (dist < closestDistance) {
        closestDistance = dist;
        closest = object;
      }
    }

    return closest;
  }

  function indexedFindInBounds(player, objectId, minX, maxX, minY, maxY, z) {
    ensurePersistentIndex();

    const playerX = player.getLocation().getX();
    const playerY = player.getLocation().getY();
    let closest = null;
    let closestDistance = Number.MAX_SAFE_INTEGER;
    const regionIds = regionIdsForBounds(RegionManager, minX, maxX, minY, maxY);
    ensureRegionsLoaded(regionIds);
    const privateArea = player.getPrivateArea?.() ?? null;

    for (const regionId of regionIds) {
      const byId = objectsByRegion.get(regionId);
      if (!byId) {
        continue;
      }
      const { absX, absY } = regionBounds(regionId);
      const locations = byId.get(objectId);
      if (!locations || locations.length === 0) {
        continue;
      }
      for (const entry of locations) {
        if (entry.z !== z) {
          continue;
        }
        const x = absX + entry.lx;
        const y = absY + entry.ly;
        if (x < minX || x > maxX || y < minY || y > maxY) {
          continue;
        }
        const object = resolveWorldObjectAt(objectId, x, y, z, privateArea);
        if (!object) {
          continue;
        }
        const dist = distanceSquared(playerX, playerY, x, y);
        if (dist < closestDistance) {
          closestDistance = dist;
          closest = object;
        }
      }
    }

    return closest;
  }

  function findNearestObject(player, objectId, radius = 10) {
    if (!player) {
      return null;
    }
    trackObjectId(objectId);

    const loc = player.getLocation();
    const baseX = loc.getX();
    const baseY = loc.getY();
    const z = loc.getZ();
    const minX = baseX - radius;
    const maxX = baseX + radius;
    const minY = baseY - radius;
    const maxY = baseY + radius;

    const privateArea = player.getPrivateArea();
    if (privateArea) {
      return findNearestInPrivateArea(
        player,
        privateArea,
        objectId,
        minX,
        maxX,
        minY,
        maxY,
        z
      );
    }

    return indexedFindInBounds(player, objectId, minX, maxX, minY, maxY, z);
  }

  function findObjectOnRoute(player, from, to, objectId, margin = 1) {
    if (!player || !from || !to) {
      return null;
    }
    trackObjectId(objectId);

    const z = from.z ?? player.getLocation().getZ();
    const minX = Math.min(from.x, to.x) - margin;
    const maxX = Math.max(from.x, to.x) + margin;
    const minY = Math.min(from.y, to.y) - margin;
    const maxY = Math.max(from.y, to.y) + margin;

    const privateArea = player.getPrivateArea();
    if (privateArea) {
      return findNearestInPrivateArea(
        player,
        privateArea,
        objectId,
        minX,
        maxX,
        minY,
        maxY,
        z
      );
    }

    return indexedFindInBounds(player, objectId, minX, maxX, minY, maxY, z);
  }

  function regionIdsAroundPlayer(player, regionRadius = 1) {
    if (!player) {
      return [];
    }
    const loc = player.getLocation?.();
    if (!loc) {
      return [];
    }
    const radius = Math.max(0, Math.floor(regionRadius));
    const minX = loc.getX() - radius * 64;
    const maxX = loc.getX() + radius * 64;
    const minY = loc.getY() - radius * 64;
    const maxY = loc.getY() + radius * 64;
    return regionIdsForBounds(RegionManager, minX, maxX, minY, maxY);
  }

  function findCandidatesByIds(player, objectIds, options = {}) {
    if (!player || !Array.isArray(objectIds) || objectIds.length === 0) {
      return [];
    }
    const loc = player.getLocation?.();
    if (!loc) {
      return [];
    }

    const privateArea = options.privateArea ?? player.getPrivateArea?.() ?? null;
    const targetZ = Number.isFinite(options.z) ? Math.floor(options.z) : loc.getZ();
    const regionRadius = Number.isFinite(options.regionRadius)
      ? Math.max(0, Math.floor(options.regionRadius))
      : 1;

    const uniqueIds = [...new Set(objectIds.filter((id) => Number.isFinite(id)))];
    if (uniqueIds.length === 0) {
      return [];
    }

    for (const objectId of uniqueIds) {
      trackObjectId(objectId);
    }
    const hasIndex = ensurePersistentIndex();

    if (privateArea) {
      const objects = privateArea.getObjects?.() ?? [];
      const regionX = loc.getX() >> 6;
      const regionY = loc.getY() >> 6;
      const result = [];
      for (const object of objects) {
        const objectId = object?.getId?.();
        if (!uniqueIds.includes(objectId)) {
          continue;
        }
        const objectLoc = object.getLocation?.();
        if (!objectLoc || objectLoc.getZ() !== targetZ) {
          continue;
        }
        const objectRegionX = objectLoc.getX() >> 6;
        const objectRegionY = objectLoc.getY() >> 6;
        if (
          Math.abs(objectRegionX - regionX) > regionRadius ||
          Math.abs(objectRegionY - regionY) > regionRadius
        ) {
          continue;
        }
        result.push(object);
      }
      return result;
    }

    const regionIds = regionIdsAroundPlayer(player, regionRadius);
    ensureRegionsLoaded(regionIds);
    const candidates = [];
    const privateAreaRef = player.getPrivateArea?.() ?? null;

    if (!hasIndex) {
      return [];
    }

    for (const regionId of regionIds) {
      const byId = objectsByRegion.get(regionId);
      if (!byId) {
        continue;
      }
      const { absX, absY } = regionBounds(regionId);
      for (const objectId of uniqueIds) {
        const objects = byId.get(objectId);
        if (!objects || objects.length === 0) {
          continue;
        }
        for (const entry of objects) {
          if (entry.z !== targetZ) {
            continue;
          }
          const object = resolveWorldObjectAt(
            objectId,
            absX + entry.lx,
            absY + entry.ly,
            entry.z,
            privateAreaRef
          );
          if (!object) {
            continue;
          }
          candidates.push(object);
        }
      }
    }

    return candidates;
  }

  // Keep the index authoritative: a region loaded after startup (lazy region, region
  // pack, edited map) replaces its entries, so searches never read stale coordinates.
  if (typeof api?.onRegionLoaded === "function") {
    api.onRegionLoaded((event) => {
      const regionId = Number(event?.regionId);
      if (!Number.isFinite(regionId)) {
        return;
      }
      indexLoadedRegion(Math.floor(regionId));
    });
  }

  return {
    regionIdForTile: RegionManager.regionIdForTile,
    findNearestObject,
    findObjectOnRoute,
    findCandidatesByIds,
    trackObjectId,
    trackObjectIds,
    initializePersistentIndex,
    schedulePersistentIndexInitialization,
  };
}

module.exports = {
  createTraversalAssist,
};
