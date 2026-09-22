const { Task } = require("../../../../src/main/typescript/elvarg/game/task/Task");
const { Location } = require("../../../../src/main/typescript/elvarg/game/model/Location");
const { Wilderness } = require("../../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const {
  CanAttackResponse,
} = require("../../../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { Skill } = require("../../../../src/main/typescript/elvarg/game/model/Skill");
const {
  chooseNextTarget,
  peekMovementRequest,
  randomInRange,
} = require("../navigation/BotNavigation");
const { callModeHook } = require("../hooks/ModeHookContract");
const {
  isPvpOnlyBotState,
  isTeleblocked,
  computeEatThreshold,
  resetMovementState,
  setModePvp,
} = require("../state/PlayerBotState");
const { getPvpProfile } = require("../pvp/PvpAssignment");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
} = require("../../runtime/BotRecruitConstants");

const NS_PER_MS = 1_000_000n;
const MOVING_MODE_DECISION_DELAY_MS = 1500;
const BLOCKED_TILE_CHECK_INTERVAL_MS = 5000;
const PVP_INDEX_CHUNK_SIZE_TILES = 16;

class BotBehaviorTask extends Task {
  constructor(entries, traversalService, decisionTicks, options = {}) {
    super(decisionTicks);
    this.entries = entries;
    this.traversalService = traversalService;
    this.api = options.api ?? null;
    this.World = this.api?.getWorld();
    this.RegionManager = this.api?.getRegionManager();
    this.CombatFactory = this.api?.getCombatFactory();
    this.AreaManager = this.api?.getAreaManager();
    this.ServerPerf = this.api?.getServerPerf();
    this.behaviorMode = options.behaviorMode ?? null;
    this.modeHandlers = options.modeHandlers ?? {};
    this.autonomy = {
      decisionDelayMinMs: options.decisionDelayMinMs ?? 4500,
      decisionDelayMaxMs: options.decisionDelayMaxMs ?? 14000,
    };
    this.autonomousModes = Array.isArray(options.autonomousModes)
      ? options.autonomousModes
      : [];
    this.modeStopParamsByMode = options.modeStopParamsByMode ?? {};
    this.transientModes = new Set(options.transientModes ?? []);
    this.npcAggroPolicyHandler = options.npcAggroPolicyHandler ?? null;
    this.modeValidationIntervalMs = Number.isFinite(options.modeValidationIntervalMs)
      ? Math.max(0, Math.floor(options.modeValidationIntervalMs))
      : 1200;
    this.handlePersistentPvpRespawn =
      typeof options.handlePersistentPvpRespawn === "function"
        ? options.handlePersistentPvpRespawn
        : null;
    this.idleEntryStride = Number.isFinite(options.idleEntryStride)
      ? Math.max(1, Math.floor(options.idleEntryStride))
      : 2;
    this.timingDesyncMs = Number.isFinite(options.timingDesyncMs)
      ? Math.max(0, Math.floor(options.timingDesyncMs))
      : 450;
    this.lodConfig = this.resolveLodConfig(options.lodConfig ?? {});
    this._nextLodRefreshAt = 0;
    this._humanObserverBuckets = new Map();
    this._humanObserverCount = 0;
    this._humanObserverRevision = 0;
    this._cycleCounter = 0;
    this.taskProfiler = this.resolveTaskProfiler(options.taskProfiler ?? {});
    this.executionBudget = this.resolveExecutionBudget(options.executionBudget ?? {});
    this._entryCursor = 0;
    this._nextBudgetLogAt = 0;
    this._profileWindow = this.createProfileWindow(Date.now());
  }

  resolveTaskProfiler(rawConfig) {
    const enabled = rawConfig?.enabled === true;
    const intervalMs = Number.isFinite(rawConfig?.intervalMs)
      ? Math.max(1000, Math.floor(rawConfig.intervalMs))
      : 10000;
    const sampleStride = Number.isFinite(rawConfig?.sampleStride)
      ? Math.max(1, Math.floor(rawConfig.sampleStride))
      : 2;
    return {
      enabled,
      intervalMs,
      sampleStride,
    };
  }

  createProfileWindow(nowMs) {
    return {
      startedAt: nowMs,
      sampledEntries: 0,
      heavyEntries: 0,
      traversalMs: 0,
      npcAggroMs: 0,
      heavyGateMs: 0,
      autonomyMs: 0,
      controllerMs: 0,
      totalEntryMs: 0,
      modeSamples: Object.create(null),
    };
  }

  resolveExecutionBudget(rawConfig) {
    const enabled = rawConfig?.enabled !== false;
    const maxMs = Number.isFinite(rawConfig?.maxMs)
      ? Math.max(5, Math.floor(rawConfig.maxMs))
      : 45;
    const minEntriesPerCycle = Number.isFinite(rawConfig?.minEntriesPerCycle)
      ? Math.max(1, Math.floor(rawConfig.minEntriesPerCycle))
      : 48;
    const logCooldownMs = Number.isFinite(rawConfig?.logCooldownMs)
      ? Math.max(1000, Math.floor(rawConfig.logCooldownMs))
      : 5000;
    return {
      enabled,
      maxMs,
      minEntriesPerCycle,
      logCooldownMs,
    };
  }

  getModeProfile(window, mode) {
    if (!window) {
      return null;
    }
    const key = mode || "unknown";
    if (!window.modeSamples[key]) {
      window.modeSamples[key] = {
        sampledEntries: 0,
        heavyEntries: 0,
        autonomyMs: 0,
        controllerMs: 0,
        totalEntryMs: 0,
      };
    }
    return window.modeSamples[key];
  }

  shouldSampleEntry(index) {
    if (!this.taskProfiler.enabled) {
      return false;
    }
    return (this._cycleCounter + index) % this.taskProfiler.sampleStride === 0;
  }

  elapsedMs(startNs, endNs = process.hrtime.bigint()) {
    return Number(endNs - startNs) / Number(NS_PER_MS);
  }

  flushTaskProfileIfDue(nowMs) {
    if (!this.taskProfiler.enabled || !this._profileWindow) {
      return;
    }
    if (nowMs - this._profileWindow.startedAt < this.taskProfiler.intervalMs) {
      return;
    }
    const window = this._profileWindow;
    this._profileWindow = this.createProfileWindow(nowMs);
    if (window.sampledEntries <= 0) {
      return;
    }
    const sampledEntries = window.sampledEntries;
    const heavyEntries = window.heavyEntries;
    const avg = (total, count) => (count > 0 ? Number((total / count).toFixed(4)) : 0);
    const topModes = Object.entries(window.modeSamples)
      .map(([mode, stats]) => ({
        mode,
        sampledEntries: stats.sampledEntries,
        heavyEntries: stats.heavyEntries,
        avgEntryMs: avg(stats.totalEntryMs, stats.sampledEntries),
        avgAutonomyMs: avg(stats.autonomyMs, stats.heavyEntries),
        avgControllerMs: avg(stats.controllerMs, stats.heavyEntries),
      }))
      .sort((a, b) => b.avgEntryMs - a.avgEntryMs)
      .slice(0, 6);
    this.api?.log?.("bot_task_profile_snapshot", {
      windowMs: nowMs - window.startedAt,
      sampledEntries,
      heavyEntries,
      sampleStride: this.taskProfiler.sampleStride,
      avgEntryMs: avg(window.totalEntryMs, sampledEntries),
      avgTraversalMs: avg(window.traversalMs, sampledEntries),
      avgNpcAggroMs: avg(window.npcAggroMs, sampledEntries),
      avgHeavyGateMs: avg(window.heavyGateMs, sampledEntries),
      avgAutonomyMs: avg(window.autonomyMs, heavyEntries),
      avgControllerMs: avg(window.controllerMs, heavyEntries),
      topModes,
    });
  }

  resolveLodConfig(rawConfig) {
    const parseStride = (value, fallback) =>
      Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
    const parseDistance = (value, fallback) =>
      Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
    const parseInterval = (value, fallback) =>
      Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
    const parseChunkSize = (value, fallback) =>
      Number.isFinite(value) ? Math.max(8, Math.floor(value)) : fallback;
    const parseCacheMs = (value, fallback) =>
      Number.isFinite(value) ? Math.max(100, Math.floor(value)) : fallback;

    const enabled = rawConfig?.enabled !== false;
    const nearDistanceTiles = parseDistance(rawConfig?.nearDistanceTiles, 32);
    const mediumDistanceTiles = Math.max(
      nearDistanceTiles,
      parseDistance(rawConfig?.mediumDistanceTiles, 96)
    );

    return {
      enabled,
      refreshIntervalMs: parseInterval(rawConfig?.refreshIntervalMs, 900),
      nearDistanceTiles,
      mediumDistanceTiles,
      chunkSizeTiles: parseChunkSize(rawConfig?.chunkSizeTiles, 32),
      nearStride: parseStride(rawConfig?.nearStride, 1),
      mediumStride: parseStride(rawConfig?.mediumStride, 2),
      farStride: parseStride(rawConfig?.farStride, this.idleEntryStride),
      nearCacheMs: parseCacheMs(rawConfig?.nearCacheMs, 200),
      mediumCacheMs: parseCacheMs(rawConfig?.mediumCacheMs, 450),
      farCacheMs: parseCacheMs(
        rawConfig?.farCacheMs,
        Math.max(600, parseInterval(rawConfig?.refreshIntervalMs, 900))
      ),
    };
  }

  getHumanObserverBucketKey(x, y, z) {
    const chunkSize = this.lodConfig.chunkSizeTiles;
    return `${z}:${Math.floor(x / chunkSize)}:${Math.floor(y / chunkSize)}`;
  }

  getSpatialBucketKey(x, y, z, chunkSize) {
    return `${z}:${Math.floor(x / chunkSize)}:${Math.floor(y / chunkSize)}`;
  }

  addToSpatialBucket(buckets, location, value, chunkSize) {
    if (!buckets || !location || !value) {
      return;
    }
    const x = location.getX?.();
    const y = location.getY?.();
    const z = location.getZ?.();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return;
    }
    const key = this.getSpatialBucketKey(x, y, z, chunkSize);
    const existing = buckets.get(key);
    if (existing) {
      existing.push(value);
    } else {
      buckets.set(key, [value]);
    }
  }

  getTileOccupancyAreaMap(occupancyByArea, privateArea) {
    if (!(occupancyByArea instanceof Map)) {
      return null;
    }
    const areaKey = privateArea ?? null;
    let areaMap = occupancyByArea.get(areaKey);
    if (!(areaMap instanceof Map)) {
      areaMap = new Map();
      occupancyByArea.set(areaKey, areaMap);
    }
    return areaMap;
  }

  addToTileOccupancy(occupancyByArea, privateArea, location) {
    if (!(occupancyByArea instanceof Map) || !location) {
      return;
    }
    const x = location.getX?.();
    const y = location.getY?.();
    const z = location.getZ?.();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return;
    }
    const areaMap = this.getTileOccupancyAreaMap(occupancyByArea, privateArea);
    if (!(areaMap instanceof Map)) {
      return;
    }
    const key = `${z}:${x}:${y}`;
    areaMap.set(key, Number(areaMap.get(key) ?? 0) + 1);
  }

  buildPvpCycleState(nowMs = Date.now()) {
    const chunkSizeTiles = PVP_INDEX_CHUNK_SIZE_TILES;
    const botBuckets = new Map();
    const realPlayerBuckets = new Map();
    const playerTileOccupancyByArea = new Map();
    const activeHotspotCombatCounts = new Map();
    const activePvpTargetCounts = new Map();
    const activePvpTargetByUsername = new Map();
    const shouldRefreshHumanObservers =
      this.lodConfig.enabled && nowMs >= this._nextLodRefreshAt;
    const observerBuckets = shouldRefreshHumanObservers ? new Map() : null;
    let observerCount = 0;

    for (const entry of this.entries) {
      const player = entry?.player;
      const state = entry?.state;
      if (!player || !state) {
        continue;
      }

      const location = player.getLocation?.();
      if (location) {
        this.addToSpatialBucket(botBuckets, location, entry, chunkSizeTiles);
        if (player.isRegistered?.() === true && (player.getHitpoints?.() ?? 0) > 0) {
          this.addToTileOccupancy(
            playerTileOccupancyByArea,
            player.getPrivateArea?.() ?? null,
            location
          );
        }
      }

      if (state.mode !== this.behaviorMode?.PVP) {
        continue;
      }

      const targetUsername = state?.pvp?.targetUsername ?? null;
      const username = player.getUsername?.() ?? null;
      if (targetUsername) {
        activePvpTargetCounts.set(
          targetUsername,
          (activePvpTargetCounts.get(targetUsername) ?? 0) + 1
        );
        if (username) {
          activePvpTargetByUsername.set(username, targetUsername);
        }
      }

      if (state?.pvp?.phase !== "combat" || !this.isInCombat(player)) {
        continue;
      }
      const hotspotId = state?.pvp?.hotspotId ?? null;
      if (!hotspotId) {
        continue;
      }
      activeHotspotCombatCounts.set(
        hotspotId,
        (activeHotspotCombatCounts.get(hotspotId) ?? 0) + 1
      );
    }

    this.World.getPlayers().forEach((candidatePlayer) => {
      if (!candidatePlayer || candidatePlayer.isPlayerBot?.() === true) {
        return;
      }
      if (!this.World.isPlayerSessionConnected(candidatePlayer)) {
        return;
      }
      if (!candidatePlayer.isRegistered?.()) {
        return;
      }
      if ((candidatePlayer.getHitpoints?.() ?? 0) <= 0) {
        return;
      }
      const location = candidatePlayer.getLocation?.();
      if (!location) {
        return;
      }
      if (observerBuckets) {
        const observer = {
          x: location.getX?.(),
          y: location.getY?.(),
          z: location.getZ?.(),
        };
        const key = this.getHumanObserverBucketKey(observer.x, observer.y, observer.z);
        const bucket = observerBuckets.get(key);
        if (bucket) {
          bucket.push(observer);
        } else {
          observerBuckets.set(key, [observer]);
        }
        observerCount += 1;
      }
      if (!Wilderness.isIn(candidatePlayer)) {
        return;
      }
      this.addToSpatialBucket(realPlayerBuckets, location, candidatePlayer, chunkSizeTiles);
      this.addToTileOccupancy(
        playerTileOccupancyByArea,
        candidatePlayer.getPrivateArea?.() ?? null,
        location
      );
    });

    if (observerBuckets) {
      this._humanObserverBuckets = observerBuckets;
      this._humanObserverCount = observerCount;
      this._humanObserverRevision += 1;
      this._nextLodRefreshAt = nowMs + this.lodConfig.refreshIntervalMs;
    }

    return {
      pvpIndex: {
        chunkSizeTiles,
        botBuckets,
        realPlayerBuckets,
        playerTileOccupancyByArea,
        activeHotspotCombatCounts,
        activePvpTargetCounts,
        activePvpTargetByUsername,
      },
    };
  }

  resolveModeActiveDuration(definition) {
    const minMs = Number(definition?.minMs ?? 0);
    const maxMs = Number(definition?.maxMs ?? minMs);
    const safeMinMs = Number.isFinite(minMs) && minMs > 0 ? minMs : 1;
    const safeMaxMs = Number.isFinite(maxMs) && maxMs >= safeMinMs ? maxMs : safeMinMs;
    return randomInRange(safeMinMs, safeMaxMs);
  }

  refreshHumanObservers(nowMs) {
    if (!this.lodConfig.enabled) {
      this._humanObserverBuckets.clear();
      this._humanObserverCount = 0;
      this._nextLodRefreshAt = nowMs + this.lodConfig.refreshIntervalMs;
      return;
    }
    if (nowMs < this._nextLodRefreshAt) {
      return;
    }

    const buckets = new Map();
    let observerCount = 0;
    this.World.getPlayers().forEach((candidate) => {
      if (!candidate || candidate.isPlayerBot?.() === true) {
        return;
      }
      if (!this.World.isPlayerSessionConnected(candidate)) {
        return;
      }
      const location = candidate.getLocation?.();
      if (!location) {
        return;
      }
      const observer = {
        x: location.getX?.(),
        y: location.getY?.(),
        z: location.getZ?.(),
      };
      const key = this.getHumanObserverBucketKey(observer.x, observer.y, observer.z);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(observer);
      } else {
        buckets.set(key, [observer]);
      }
      observerCount += 1;
    });

    this._humanObserverBuckets = buckets;
    this._humanObserverCount = observerCount;
    this._humanObserverRevision += 1;
    this._nextLodRefreshAt = nowMs + this.lodConfig.refreshIntervalMs;
  }

  getLocationSnapshot(player) {
    const location = player?.getLocation?.();
    if (!location) {
      return null;
    }
    const x = location.getX?.();
    const y = location.getY?.();
    const z = location.getZ?.();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    return { location, x, y, z };
  }

  getStrideCacheTtlMs(stride) {
    if (stride <= this.lodConfig.nearStride) {
      return this.lodConfig.nearCacheMs;
    }
    if (stride <= this.lodConfig.mediumStride) {
      return this.lodConfig.mediumCacheMs;
    }
    return this.lodConfig.farCacheMs;
  }

  findNearestHumanObserverDistance(x, y, z, maxDistanceTiles) {
    if (this._humanObserverCount <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    const chunkSize = this.lodConfig.chunkSizeTiles;
    const baseChunkX = Math.floor(x / chunkSize);
    const baseChunkY = Math.floor(y / chunkSize);
    const searchDistance = Number.isFinite(maxDistanceTiles)
      ? Math.max(0, maxDistanceTiles)
      : this.lodConfig.mediumDistanceTiles;
    const chunkRadius = Math.max(1, Math.ceil(searchDistance / chunkSize));
    let bestChebyshevDistance = Number.POSITIVE_INFINITY;

    for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
      for (let dy = -chunkRadius; dy <= chunkRadius; dy++) {
        const bucket = this._humanObserverBuckets.get(
          `${z}:${baseChunkX + dx}:${baseChunkY + dy}`
        );
        if (!bucket || bucket.length === 0) {
          continue;
        }
        for (const observer of bucket) {
          const distance = Math.max(
            Math.abs(observer.x - x),
            Math.abs(observer.y - y)
          );
          if (distance < bestChebyshevDistance) {
            bestChebyshevDistance = distance;
          }
          if (bestChebyshevDistance <= searchDistance) {
            return bestChebyshevDistance;
          }
        }
      }
    }

    return bestChebyshevDistance;
  }

  resolveEntryStride(entry, nowMs) {
    if (!this.lodConfig.enabled) {
      return this.idleEntryStride;
    }
    this.refreshHumanObservers(nowMs);
    if (!entry?.player || this._humanObserverCount === 0) {
      return this.lodConfig.farStride;
    }
    const interactingWithRealPlayer = this.isInteractingWithRealPlayer(entry.player);
    if (interactingWithRealPlayer) {
      return this.lodConfig.nearStride;
    }

    const locationSnapshot = this.getLocationSnapshot(entry.player);
    if (!locationSnapshot) {
      return this.lodConfig.farStride;
    }

    const state = entry?.state;
    const lodCache = state?.lodStrideCache;
    if (
      lodCache &&
      lodCache.revision === this._humanObserverRevision &&
      lodCache.expiresAt > nowMs
    ) {
      return lodCache.stride;
    }

    const bestChebyshevDistance = this.findNearestHumanObserverDistance(
      locationSnapshot.x,
      locationSnapshot.y,
      locationSnapshot.z,
      this.lodConfig.mediumDistanceTiles
    );

    let stride = this.lodConfig.farStride;
    if (bestChebyshevDistance <= this.lodConfig.mediumDistanceTiles) {
      stride = this.lodConfig.mediumStride;
    }
    if (bestChebyshevDistance <= this.lodConfig.nearDistanceTiles) {
      stride = this.lodConfig.nearStride;
    }

    if (state) {
      state.lodStrideCache = {
        stride,
        revision: this._humanObserverRevision,
        expiresAt: nowMs + this.getStrideCacheTtlMs(stride),
      };
    }
    return stride;
  }

  isInteractingWithRealPlayer(player) {
    if (!player || player.isPlayerBot?.() !== true) {
      return false;
    }
    const combat = player.getCombat?.();
    const related = [
      player.getInteractingMobile?.(),
      player.getFollowing?.(),
      player.getCombatFollowing?.(),
      combat?.getTarget?.(),
      combat?.getAttacker?.(),
    ];
    for (const entity of related) {
      if (!entity || entity.isPlayer?.() !== true) {
        continue;
      }
      const other = entity.getAsPlayer?.();
      if (other && other.isPlayerBot?.() !== true && this.World.isPlayerSessionConnected(other)) {
        return true;
      }
    }
    return false;
  }

  hasNearbyHumanObserver(player, nowMs, distanceTiles = this.lodConfig.nearDistanceTiles) {
    if (!player) {
      return false;
    }
    this.refreshHumanObservers(nowMs);
    if (this._humanObserverCount === 0) {
      return false;
    }
    const locationSnapshot = this.getLocationSnapshot(player);
    if (!locationSnapshot) {
      return false;
    }
    return (
      this.findNearestHumanObserverDistance(
        locationSnapshot.x,
        locationSnapshot.y,
        locationSnapshot.z,
        distanceTiles
      ) <= distanceTiles
    );
  }

  hasNearbyHumanObserverCached(
    entry,
    nowMs,
    distanceTiles = this.lodConfig.nearDistanceTiles
  ) {
    const player = entry?.player;
    const state = entry?.state;
    if (!player || !state) {
      return false;
    }
    const normalizedDistance = Math.max(1, Math.floor(distanceTiles));
    const cache = state?.nearHumanObserverUrgencyCache ?? null;
    if (
      cache &&
      cache.revision === this._humanObserverRevision &&
      cache.distanceTiles >= normalizedDistance &&
      cache.expiresAt > nowMs
    ) {
      return cache.near === true;
    }
    const near = this.hasNearbyHumanObserver(player, nowMs, normalizedDistance);
    state.nearHumanObserverUrgencyCache = {
      near: near === true,
      revision: this._humanObserverRevision,
      distanceTiles: normalizedDistance,
      expiresAt: nowMs + Math.max(250, Math.floor(this.lodConfig.refreshIntervalMs / 2)),
    };
    return near;
  }

  isPvpCombatNearHumanInterest(entry, nowMs) {
    const player = entry?.player;
    const state = entry?.state;
    if (!player || !state || state.mode !== this.behaviorMode?.PVP) {
      return true;
    }
    if (this.isInteractingWithRealPlayer(player)) {
      return true;
    }
    const combat = player.getCombat?.();
    const related = [
      combat?.getTarget?.(),
      combat?.getAttacker?.(),
      player.getFollowing?.(),
      player.getInteractingMobile?.(),
      player.getCombatFollowing?.(),
    ];
    for (const entity of related) {
      if (!entity || entity.isPlayer?.() !== true) {
        continue;
      }
      const other = entity.getAsPlayer?.();
      if (other && other.isPlayerBot?.() !== true) {
        return true;
      }
    }
    const observerDistance = Math.max(6, Math.floor(this.lodConfig.nearDistanceTiles));
    return this.hasNearbyHumanObserverCached(entry, nowMs, observerDistance);
  }

  resolveProcessingShard(state, stride) {
    let shard = Number.isFinite(state?.processingShard)
      ? state.processingShard
      : Number.NaN;
    if (!Number.isFinite(shard) || shard < 0 || shard >= stride) {
      shard = Math.floor(Math.random() * stride);
      state.processingShard = shard;
    }
    return shard;
  }

  isUrgentEntry(entry, nowMs = Date.now()) {
    const player = entry?.player;
    const state = entry?.state;
    if (!player || !state) {
      return false;
    }
    if (player.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME)) {
      return true;
    }
    if (state.awaitingDitchTransition != null || state.roaming?.pendingRetry != null) {
      return true;
    }
    if (player.getForceMovement?.() != null) {
      return true;
    }
    const followTarget = player.getFollowing?.();
    const interactTarget = player.getInteractingMobile?.();
    const isLivePlayerBot = (entity) =>
      entity?.isPlayer?.() === true &&
      entity?.isRegistered?.() === true &&
      entity?.getAsPlayer?.()?.isPlayerBot?.() === true;
    if (isLivePlayerBot(followTarget) || isLivePlayerBot(interactTarget)) {
      if (state.mode !== this.behaviorMode?.PVP) {
        return true;
      }
      return this.isPvpCombatNearHumanInterest(entry, nowMs);
    }
    if (
      state.mode === this.behaviorMode?.PVP &&
      (
        (state.pvp?.phase === "combat" &&
          state.pvp?.targetPlayer?.getAsPlayer?.()?.isPlayerBot?.() === true) ||
        state.pvp?.targetPlayer?.getAsPlayer?.()?.isPlayerBot?.() === true
      )
    ) {
      return this.isPvpCombatNearHumanInterest(entry, nowMs);
    }
    const pvpNextActionAt = Number(state.pvp?.nextActionAt ?? 0);
    const urgentPvpObserverDistance = Math.max(
      4,
      Math.floor(this.lodConfig.nearDistanceTiles / 2)
    );
    if (
      state.mode === this.behaviorMode?.PVP &&
      nowMs >= pvpNextActionAt &&
      this.hasNearbyHumanObserverCached(entry, nowMs, urgentPvpObserverDistance)
    ) {
      return true;
    }
    if (this.hasCombatLinks(player) || this.isInCombat(player)) {
      if (state.mode !== this.behaviorMode?.PVP) {
        return true;
      }
      return this.isPvpCombatNearHumanInterest(entry, nowMs);
    }
    return this.isInteractingWithRealPlayer(player);
  }

  shouldYieldForBudget(startedAtMs, processedRegularEntries) {
    if (!this.executionBudget.enabled) {
      return false;
    }
    if (processedRegularEntries < this.executionBudget.minEntriesPerCycle) {
      return false;
    }
    return Date.now() - startedAtMs >= this.executionBudget.maxMs;
  }

  logBudgetYield(nowMs, details) {
    if (!this.api?.log || nowMs < this._nextBudgetLogAt) {
      return;
    }
    this._nextBudgetLogAt = nowMs + this.executionBudget.logCooldownMs;
    this.api.log("bot_task_budget_yield", details);
  }

  resolveEntryNowMs(entry, nowMs) {
    if (this.timingDesyncMs <= 0) {
      return nowMs;
    }
    const state = entry?.state;
    if (!state) {
      return nowMs;
    }
    let offsetMs = Number(state.timingOffsetMs ?? Number.NaN);
    if (!Number.isFinite(offsetMs)) {
      const seedText =
        entry?.entryUsername ??
        entry?.player?.getUsername?.() ??
        String(entry?.entryIndex ?? "");
      let hash = 0;
      for (let index = 0; index < seedText.length; index += 1) {
        hash = (hash * 31 + seedText.charCodeAt(index)) | 0;
      }
      offsetMs = Math.abs(hash) % (this.timingDesyncMs + 1);
      state.timingOffsetMs = offsetMs;
    }
    return nowMs - offsetMs;
  }

  ensureAutonomyState(state) {
    if (!state) {
      return null;
    }
    if (!state.autonomy) {
      state.autonomy = {
        nextDecisionAt: 0,
        modeEndsAt: 0,
        pvpCooldownUntil: 0,
        manualMode: null,
      };
    }
    if (!Object.prototype.hasOwnProperty.call(state.autonomy, "manualMode")) {
      state.autonomy.manualMode = null;
    }
    return state.autonomy;
  }

  isInCombat(player) {
    if (!player) {
      return false;
    }
    const combat = player.getCombat?.();
    return !!(
      combat?.getTarget?.() ||
      combat?.getAttacker?.() ||
      player.getCombatFollowing?.()
    );
  }

  isTraversingBarrier(player, state) {
    if (!player || !state) {
      return false;
    }
    return (
      state.awaitingDitchTransition != null ||
      state.roaming?.pendingRetry != null ||
      player.getForceMovement?.() != null
    );
  }

  shouldDelayModeDecisionWhileMoving(player, state) {
    if (!player || !state || this.transientModes.has(state.mode)) {
      return false;
    }
    if (state.mode === this.behaviorMode?.PVP) {
      return false;
    }
    const queueSize = Number(player.getMovementQueue?.()?.size?.() ?? 0);
    if (queueSize > 0) {
      return true;
    }
    return peekMovementRequest(player) != null;
  }

  scheduleNextDecision(state, nowMs) {
    const autonomy = this.ensureAutonomyState(state);
    if (!autonomy) {
      return;
    }
    autonomy.nextDecisionAt =
      nowMs +
      randomInRange(this.autonomy.decisionDelayMinMs, this.autonomy.decisionDelayMaxMs);
  }

  ensureDecisionScheduled(state, nowMs) {
    const autonomy = this.ensureAutonomyState(state);
    if (!autonomy) {
      return;
    }
    if (!Number.isFinite(autonomy.nextDecisionAt) || autonomy.nextDecisionAt <= nowMs) {
      this.scheduleNextDecision(state, nowMs);
    }
  }

  shouldProcessEntryHeavy(entry, nowMs) {
    // Temporal sharding for performance: calm/idle bots skip heavy BT/autonomy
    // work on some cycles. Urgent bots (combat, traversal, transient, pvp) are
    // always processed every cycle for responsiveness.
    const stride = this.resolveEntryStride(entry, nowMs);
    if (stride <= 1) {
      return true;
    }
    const player = entry?.player;
    const state = entry?.state;
    if (!player || !state) {
      return true;
    }
    const shard = this.resolveProcessingShard(state, stride);
    if (player.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME)) {
      return true;
    }
    if (this.isInCombat(player)) {
      if (state.mode !== this.behaviorMode?.PVP) {
        return true;
      }
      if (this.isPvpCombatNearHumanInterest(entry, nowMs)) {
        return true;
      }
      const offscreenPvpCombatStride = Math.max(
        2,
        Math.max(stride, this.lodConfig.farStride) * 5
      );
      return (this._cycleCounter + shard) % offscreenPvpCombatStride === 0;
    }
    if (state.awaitingDitchTransition != null || state.roaming?.pendingRetry != null) {
      return true;
    }
    if (player.getForceMovement?.() != null) {
      return true;
    }
    const blockedBackoffUntil = Number(state.pathBlockedTracker?.backoffUntil ?? 0);
    if (
      blockedBackoffUntil > nowMs &&
      !this.transientModes.has(state.mode) &&
      state.mode !== this.behaviorMode?.PVP
    ) {
      const backoffStride = Math.max(4, stride * 2);
      return (this._cycleCounter + shard) % backoffStride === 0;
    }
    if (state.mode === this.behaviorMode?.BANK_RUN) {
      const queueSize = Number(player.getMovementQueue?.()?.size?.() ?? 0);
      const nextActionAt = Number(state.bankRun?.nextActionAt ?? 0);
      // Bank runs can spend long periods walking to/from booths; we can
      // downsample BT work while movement is already in progress.
      if (queueSize > 0 && nowMs < nextActionAt) {
        const bankRunStride = Math.max(2, stride);
        return (this._cycleCounter + shard) % bankRunStride === 0;
      }
    }
    const queueSize = Number(player.getMovementQueue?.()?.size?.() ?? 0);
    if (
      queueSize > 0 &&
      !this.transientModes.has(state.mode) &&
      state.mode !== this.behaviorMode?.PVP
    ) {
      const movingStride = Math.max(2, stride);
      return (this._cycleCounter + shard) % movingStride === 0;
    }
    if (this.transientModes.has(state.mode)) {
      return true;
    }
    if (state.mode === this.behaviorMode?.PVP) {
      const pvpNextActionAt = Number(state.pvp?.nextActionAt ?? 0);
      const nearHumanInterest = this.lodConfig.enabled
        ? stride <= this.lodConfig.nearStride
        : this.hasNearbyHumanObserver(player, nowMs);
      if (this.isInCombat(player)) {
        return true;
      }
      if (nowMs >= pvpNextActionAt && nearHumanInterest) {
        return true;
      }
      const noHumanObservers = this.lodConfig.enabled && this._humanObserverCount <= 0;
      const pvpStride = Math.max(
        2,
        noHumanObservers
          ? Math.max(stride, this.lodConfig.farStride) * 5
          : stride
      );
      return (this._cycleCounter + shard) % pvpStride === 0;
    }
    return (this._cycleCounter + shard) % stride === 0;
  }

  behaviorRequirementsMet(mode, player, state, nowMs = Date.now()) {
    return (
      callModeHook({
        modeHandlers: this.modeHandlers,
        mode,
        hookName: "behaviorRequirementsMet",
        payload: { player, state, nowMs },
        fallback: true,
        api: this.api,
        errorEvent: "bot_behavior_requirements_error",
      }) === true
    );
  }

  activateModeWithHandler(entry, mode, reason = "mode_switch") {
    return (
      callModeHook({
        modeHandlers: this.modeHandlers,
        mode,
        hookName: "activateMode",
        payload: {
          player: entry.player,
          state: entry.state,
          nowMs: Date.now(),
          reason,
        },
        fallback: false,
        api: this.api,
        errorEvent: "bot_mode_activation_error",
      }) === true
    );
  }

  startModeWithHandler(entry, mode, nowMs, minMs, maxMs, reason = "auto_switch") {
    const safeMinMs = Number.isFinite(minMs) && minMs > 0 ? minMs : 1;
    const safeMaxMs = Number.isFinite(maxMs) && maxMs >= safeMinMs ? maxMs : safeMinMs;
    const activeForMs = randomInRange(safeMinMs, safeMaxMs);
    const started =
      callModeHook({
        modeHandlers: this.modeHandlers,
        mode,
        hookName: "startMode",
        payload: {
          player: entry.player,
          state: entry.state,
          nowMs,
          activeForMs,
          reason,
        },
        fallback: false,
        api: this.api,
        errorEvent: "bot_mode_start_error",
      }) === true;
    if (!started) {
      return false;
    }
    const autonomy = this.ensureAutonomyState(entry.state);
    autonomy.modeEndsAt = nowMs + activeForMs;
    this.scheduleNextDecision(entry.state, nowMs);
    return true;
  }

  isModeStateValid(mode, entry, nowMs) {
    return (
      callModeHook({
        modeHandlers: this.modeHandlers,
        mode,
        hookName: "isModeStateValid",
        payload: {
          player: entry?.player,
          state: entry?.state,
          nowMs,
        },
        fallback: true,
        api: this.api,
        errorEvent: "bot_mode_state_validation_error",
      }) === true
    );
  }

  stopModeWithHandler(entry, mode, nowMs, reason, params = {}) {
    return (
      callModeHook({
        modeHandlers: this.modeHandlers,
        mode,
        hookName: "stopMode",
        payload: {
          entry,
          nowMs,
          reason,
          ...params,
        },
        fallback: false,
        api: this.api,
        errorEvent: "bot_mode_stop_error",
      }) === true
    );
  }

  tryStartModeWithHandler(entry, mode, nowMs, params = {}, sharedCycleState = null) {
    return (
      callModeHook({
        modeHandlers: this.modeHandlers,
        mode,
        hookName: "tryStartMode",
        payload: {
          entry,
          entries: this.entries,
          sharedCycleState,
          nowMs,
          ...params,
        },
        fallback: false,
        api: this.api,
        errorEvent: "bot_mode_try_start_error",
      }) === true
    );
  }

  getAutonomousModeDefinition(mode) {
    if (!mode || !Array.isArray(this.autonomousModes)) {
      return null;
    }
    return this.autonomousModes.find((definition) => definition?.mode === mode) ?? null;
  }

  isPvpOnlyBot(state) {
    return isPvpOnlyBotState(state);
  }

  needsLowHpSupport(player, state) {
    if (!player || !state?.pvp) {
      return false;
    }
    const skillManager = player.getSkillManager?.();
    if (!skillManager) {
      return false;
    }
    const currentHp = Number(skillManager.getCurrentLevel?.(Skill.HITPOINTS) ?? 0);
    const maxHp = Number(skillManager.getMaxLevel?.(Skill.HITPOINTS) ?? 0);
    if (currentHp <= 0 || maxHp <= 0) {
      return false;
    }
    const eatAtHpRatio = this.getCachedPvpEatAtHpRatio(state);
    const isF2pPvp = state.pvp.loadoutId?.startsWith("f2p_");
    const eatThreshold = computeEatThreshold(maxHp, eatAtHpRatio, isF2pPvp);
    return currentHp <= eatThreshold;
  }

  getCachedPvpEatAtHpRatio(state) {
    const pvp = state?.pvp;
    if (!pvp) {
      return 0.45;
    }
    const profileId = pvp.profileId ?? "standard";
    if (pvp.cachedEatAtHpRatioProfileId !== profileId) {
      pvp.cachedEatAtHpRatioProfileId = profileId;
      pvp.cachedEatAtHpRatio = Number(getPvpProfile(profileId)?.eatAtHpRatio ?? 0.45);
    }
    return Number(pvp.cachedEatAtHpRatio ?? 0.45);
  }

  shouldSkipIdlePvpControllerTick(entry, nowMs) {
    const player = entry?.player;
    const state = entry?.state;
    const pvp = state?.pvp;
    if (!player || !state || !pvp || !this.isPvpOnlyBot(state)) {
      return false;
    }
    if (state.mode !== this.behaviorMode?.PVP) {
      return false;
    }
    if (pvp.retreat) return false;
    if (this.isInCombat(player)) {
      return false;
    }
    if (peekMovementRequest(player)) {
      return false;
    }
    if (pvp.replenishAfterKillPending === true) {
      return false;
    }
    const replenishPrayerUntil = Number(pvp.replenishPrayerUntil ?? 0);
    if (replenishPrayerUntil > 0 && nowMs >= replenishPrayerUntil) {
      return false;
    }
    if (this.needsLowHpSupport(player, state)) {
      return false;
    }
    return nowMs < Number(pvp.nextActionAt ?? 0);
  }

  chooseBlockedTileRecoveryLocation(player, state) {
    if (!player || !state) {
      return null;
    }
    const roamBounds = state?.roaming?.roamBounds ?? null;
    const privateArea = player.getPrivateArea?.() ?? null;
    const target = chooseNextTarget(player, state, 12, {
      bounds: roamBounds,
      acceptTarget: (candidate) => {
        if (!candidate) {
          return false;
        }
        const location = new Location(candidate.x, candidate.y, candidate.z);
        return (
          Wilderness.isInLocation(location) &&
          !this.RegionManager.blocked(location, privateArea)
        );
      },
    });
    if (!target) {
      return null;
    }
    return new Location(target.x, target.y, target.z);
  }

  recoverBlockedWildernessBot(entry, nowMs) {
    const player = entry?.player;
    const state = entry?.state;
    if (!player || !state || !this.isPvpOnlyBot(state)) {
      return false;
    }
    if ((player.getHitpoints?.() ?? 0) <= 0 || player.isDyingReturn?.() === true) {
      return false;
    }
    const location = player.getLocation?.();
    if (!location || !Wilderness.isInLocation(location)) {
      return false;
    }
    if (isTeleblocked(player)) {
      return false;
    }
    const blockedTileCheckAt = Number(state.blockedTileCheckAt ?? 0);
    if (blockedTileCheckAt > nowMs) {
      return false;
    }
    state.blockedTileCheckAt = nowMs + BLOCKED_TILE_CHECK_INTERVAL_MS;
    const privateArea = player.getPrivateArea?.() ?? null;
    if (!this.RegionManager.blocked(location, privateArea)) {
      return false;
    }

    const recoveryLocation = this.chooseBlockedTileRecoveryLocation(player, state);
    if (!recoveryLocation) {
      this.api?.log?.("blocked_wilderness_bot_recovery_failed", {
        username: player.getUsername?.() ?? null,
        x: location.getX?.() ?? null,
        y: location.getY?.() ?? null,
        z: location.getZ?.() ?? null,
      });
      return false;
    }

    resetMovementState(player);
    player.getCombat?.().reset?.();
    player.getCombat?.().setUnderAttack?.(null);
    player.setFollowing?.(null);
    player.setCombatFollowing?.(null);
    player.setMobileInteraction?.(null);
    player.setPositionToFace?.(null);

    if (state?.pvp) {
      state.pvp.targetUsername = null;
      state.pvp.targetPlayer = null;
      state.pvp.currentTargetScore = 0;
      state.pvp.targetLockUntil = 0;
      state.pvp.nextActionAt = nowMs + randomInRange(600, 1500);
      state.pvp.phase = "seeking";
    }
    if (state?.roaming) {
      state.roaming.target = null;
      state.roaming.pendingRetry = null;
      state.roaming.nextWalkAt = nowMs + randomInRange(600, 1500);
    }
    if (state?.home) {
      state.home.x = recoveryLocation.getX();
      state.home.y = recoveryLocation.getY();
      state.home.z = recoveryLocation.getZ();
    }

    player.moveTo?.(recoveryLocation);
    this.api?.log?.("blocked_wilderness_bot_reteleport", {
      username: player.getUsername?.() ?? null,
      fromX: location.getX?.() ?? null,
      fromY: location.getY?.() ?? null,
      fromZ: location.getZ?.() ?? null,
      toX: recoveryLocation.getX(),
      toY: recoveryLocation.getY(),
      toZ: recoveryLocation.getZ(),
    });
    return true;
  }

  clearDeadCombatLinks(entry) {
    const player = entry?.player;
    const state = entry?.state;
    if (!player || !state) {
      return false;
    }
    const combat = player.getCombat?.();
    const target = combat?.getTarget?.();
    const attacker = combat?.getAttacker?.();
    const following = player.getCombatFollowing?.();
    const staleTarget =
      (target && (!target.isRegistered?.() || (target.getHitpoints?.() ?? 0) <= 0)) ||
      (attacker && (!attacker.isRegistered?.() || (attacker.getHitpoints?.() ?? 0) <= 0)) ||
      (following && (!following.isRegistered?.() || (following.getHitpoints?.() ?? 0) <= 0));
    if (!staleTarget) {
      return false;
    }
    combat?.reset?.();
    combat?.setUnderAttack?.(null);
    player.setFollowing?.(null);
    player.setCombatFollowing?.(null);
    player.setMobileInteraction?.(null);
    player.setPositionToFace?.(null);
    player.getMovementQueue?.().reset?.();
    if (state?.pvp) {
      state.pvp.targetUsername = null;
      state.pvp.targetPlayer = null;
      state.pvp.currentTargetScore = 0;
      state.pvp.targetLockUntil = 0;
    }
    return true;
  }

  hasCombatLinks(player) {
    if (!player) {
      return false;
    }
    const combat = player.getCombat?.();
    return !!(
      combat?.getTarget?.() ||
      combat?.getAttacker?.() ||
      player.getCombatFollowing?.()
    );
  }

  tryAdoptCombatAttacker(entry, nowMs) {
    const player = entry?.player;
    const state = entry?.state;
    if (!player || !state || !this.isPvpOnlyBot(state)) {
      return false;
    }
    const combat = player.getCombat?.();
    const attacker = combat?.getAttacker?.();
    if (!attacker || attacker === player) {
      return false;
    }
    if (!attacker.isRegistered?.() || (attacker.getHitpoints?.() ?? 0) <= 0) {
      return false;
    }
    // Core permissions cover PvP worlds, safe zones and single-combat ownership.
    const combatMethod = this.CombatFactory.getMethod(player);
    if (this.CombatFactory.canAttackPermission(player, attacker, false, combatMethod) !==
        CanAttackResponse.CAN_ATTACK) return false;

    const currentTarget = combat?.getTarget?.();
    if (currentTarget) {
      return false;
    }

    if (state.mode !== this.behaviorMode.PVP) {
      setModePvp(
        player,
        state,
        attacker,
        nowMs,
        30000,
        this.behaviorMode,
        { allowInCombatTransition: true }
      );
    } else if (state?.pvp) {
      state.pvp.targetUsername = attacker.getUsername?.() ?? state.pvp.targetUsername;
      state.pvp.targetPlayer = attacker;
      state.pvp.endsAt = Math.max(Number(state.pvp.endsAt ?? 0), nowMs + 30000);
      state.pvp.nextActionAt = nowMs;
      state.pvp.phase = "combat";
    }

    player.getMovementQueue?.().reset?.();
    combat?.attack?.(attacker);
    this.api?.log?.("persistent_pvp_adopt_attacker", {
      bot: player.getUsername?.() ?? null,
      attacker: attacker.getUsername?.() ?? null,
      attackerIsPlayerBot: attacker.isPlayerBot?.() === true,
    });
    return true;
  }

  hasNearbyRealPlayerOpportunity(player, state, nowMs) {
    if (!player || !this.isPvpOnlyBot(state)) {
      return false;
    }
    if (state?.mode !== this.behaviorMode.ROAMING) {
      return false;
    }
    this.refreshHumanObservers(nowMs);
    if (this._humanObserverCount === 0) {
      return false;
    }
    const locationSnapshot = this.getLocationSnapshot(player);
    if (!locationSnapshot || player.getPrivateArea?.() != null) {
      return false;
    }
    return (
      this.findNearestHumanObserverDistance(
        locationSnapshot.x,
        locationSnapshot.y,
        locationSnapshot.z,
        3
      ) <= 3
    );
  }

  selectWeightedMode(definitions) {
    if (!Array.isArray(definitions) || definitions.length === 0) {
      return null;
    }
    const totalWeight = definitions.reduce((sum, definition) => {
      const weight = Number(definition?.weight ?? 0);
      return weight > 0 ? sum + weight : sum;
    }, 0);
    if (totalWeight <= 0) {
      return null;
    }

    let roll = Math.random() * totalWeight;
    for (const definition of definitions) {
      const weight = Number(definition?.weight ?? 0);
      if (weight <= 0) {
        continue;
      }
      roll -= weight;
      if (roll <= 0) {
        return definition;
      }
    }
    return definitions[definitions.length - 1] ?? null;
  }

  startAutonomousMode(entry, definition, nowMs, sharedCycleState = null) {
    const mode = definition?.mode;
    if (!mode) {
      return false;
    }
    const strategy = definition?.strategy ?? "start";
    if (strategy === "try_start") {
      return this.tryStartModeWithHandler(
        entry,
        mode,
        nowMs,
        definition?.params ?? {},
        sharedCycleState
      );
    }
    if (entry?.state?.mode === mode) {
      const autonomy = this.ensureAutonomyState(entry.state);
      if (autonomy) {
        const activeForMs = this.resolveModeActiveDuration(definition);
        autonomy.modeEndsAt = nowMs + activeForMs;
        this.scheduleNextDecision(entry.state, nowMs);
      }
      return true;
    }
    return this.startModeWithHandler(
      entry,
      mode,
      nowMs,
      Number(definition?.minMs ?? 1),
      Number(definition?.maxMs ?? definition?.minMs ?? 1),
      definition?.reason ?? "auto_switch"
    );
  }

  startRoamingFallback(entry, nowMs, reason = "fallback_roaming", sharedCycleState = null) {
    if (this.isPvpOnlyBot(entry?.state)) {
      const pvpDefinition = this.getAutonomousModeDefinition(this.behaviorMode.PVP);
      if (pvpDefinition) {
        return this.startAutonomousMode(
          entry,
          {
            ...pvpDefinition,
            reason: reason === "fallback_roaming" ? "fallback_pvp" : reason,
          },
          nowMs,
          sharedCycleState
        );
      }
      return false;
    }
    const roamingDefinition = this.getAutonomousModeDefinition(this.behaviorMode.ROAMING);
    if (!roamingDefinition) {
      return false;
    }
    return this.startAutonomousMode(
      entry,
      {
        ...roamingDefinition,
        reason,
      },
      nowMs,
      sharedCycleState
    );
  }

  processAutonomousMode(entry, nowMs, sharedCycleState = null) {
    if (!this.behaviorMode || !entry?.state || !entry?.player) {
      return;
    }
    const player = entry.player;
    const state = entry.state;
    const autonomy = this.ensureAutonomyState(state);
    const deadOrDying =
      (player.getHitpoints?.() ?? 0) <= 0 ||
      player.isDyingReturn?.() === true;

    // Ensure bot-specific temporary modes (follow-back/pvp/return-home)
    // are cleared after death so the bot resumes normal autonomous behavior.
    if (deadOrDying) {
      if (!state.deathResetApplied) {
        if (state.pvp?.retreat) {
          player.setAutoRetaliate(state.pvp.retreat.autoRetaliate);
          state.pvp.retreat = null;
        }
        if (state?.pvp) {
          state.pvp.appliedBoostProfileId = null;
        }
        this.activateModeWithHandler(
          entry,
          this.isPvpOnlyBot(state) ? this.behaviorMode.PVP : this.behaviorMode.ROAMING,
          "post_death_reset"
        );
        state.virtualFoodChargesRemaining = null;
        state.nextNoFoodLogAt = 0;
        autonomy.modeEndsAt = 0;
        autonomy.nextDecisionAt = 0;
        state.deathResetApplied = true;
        this.api?.log?.("bot_post_death_reset", {
          username: player.getUsername?.(),
        });
      }
      return;
    }

    if (state.deathResetApplied) {
      if (this.isPvpOnlyBot(state) && this.handlePersistentPvpRespawn) {
        if (!this.handlePersistentPvpRespawn(entry, nowMs)) return;
      }
      state.deathResetApplied = false;
      this.scheduleNextDecision(state, nowMs);
    }

    // Spawning and respawning can briefly retain a combat link. Retry once that link has
    // cleared instead of leaving the bot naked after the first rejected loadout attempt.
    if (this.isPvpOnlyBot(state) && state.pvp) {
      const hasInventory = player.getInventory?.().getItems?.().some((item) => item?.getId?.() > 0);
      const hasEquipment = player.getEquipment?.().getItems?.().some((item) => item?.getId?.() > 0);
      if (!hasInventory && !hasEquipment) state.pvp.loadoutPending = true;
    }
    if (this.isPvpOnlyBot(state) && state.pvp?.loadoutPending &&
        this.handlePersistentPvpRespawn && !this.handlePersistentPvpRespawn(entry, nowMs)) return;

    if (state.pvp?.retreat) return;

    const recruitOwnerUsername = player.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME);
    if (recruitOwnerUsername) {
      const autonomy = this.ensureAutonomyState(state);
      autonomy.manualMode = this.behaviorMode.FOLLOW_BACK;
      autonomy.nextDecisionAt = Number.MAX_SAFE_INTEGER;
      autonomy.modeEndsAt = Number.MAX_SAFE_INTEGER;
      if (!state.followTargetUsername) {
        state.followTargetUsername = recruitOwnerUsername;
      }
      const combat = player.getCombat?.();
      const inCombatWithLiveTarget = !!(
        combat?.getTarget?.() ||
        combat?.getAttacker?.() ||
        player.getCombatFollowing?.()
      );
      if (
        state.mode === this.behaviorMode.PVP &&
        !inCombatWithLiveTarget
      ) {
        this.activateModeWithHandler(
          entry,
          this.behaviorMode.FOLLOW_BACK,
          "recruit_resume_follow"
        );
      }
      if (
        state.mode !== this.behaviorMode.FOLLOW_BACK &&
        state.mode !== this.behaviorMode.PVP
      ) {
        this.activateModeWithHandler(
          entry,
          this.behaviorMode.FOLLOW_BACK,
          "recruit_lock"
        );
      }
      return;
    }

    const manualMode = autonomy.manualMode ?? null;
    if (manualMode) {
      const isTransient = this.transientModes.has(state.mode);
      if (isTransient) {
        return;
      }

      if (state.mode !== manualMode) {
        const switched = this.activateModeWithHandler(
          entry,
          manualMode,
          "manual_override_resume"
        );
        if (switched) {
          this.api?.log?.("bot_mode_switch", {
            username: player.getUsername?.(),
            mode: manualMode,
            reason: "manual_override_resume",
            activeForMs: -1,
          });
        } else {
          autonomy.manualMode = null;
          autonomy.modeEndsAt = 0;
          autonomy.nextDecisionAt = 0;
          this.api?.log?.("bot_manual_mode_invalid", {
            username: player.getUsername?.(),
            mode: manualMode,
          });
          return;
        }
      }

      if (autonomy.nextDecisionAt !== Number.MAX_SAFE_INTEGER) {
        autonomy.nextDecisionAt = Number.MAX_SAFE_INTEGER;
      }
      if (autonomy.modeEndsAt !== Number.MAX_SAFE_INTEGER) {
        autonomy.modeEndsAt = Number.MAX_SAFE_INTEGER;
      }
      return;
    }

    if (this.transientModes.has(state.mode)) {
      this.ensureDecisionScheduled(state, nowMs);
      return;
    }

    if (this.isTraversingBarrier(player, state)) {
      return;
    }

    const modeValidationDueAt = Number(autonomy.nextModeValidationAt ?? 0);
    // Mode-state validation can be expensive (hook fan-out per bot), so we
    // rate-limit it instead of running every cycle for every bot.
    if (modeValidationDueAt <= nowMs) {
      autonomy.nextModeValidationAt = nowMs + this.modeValidationIntervalMs;
      if (!this.isModeStateValid(state.mode, entry, nowMs)) {
        const stopParamsSource = this.modeStopParamsByMode[state.mode];
        const stopParams =
          typeof stopParamsSource === "function"
            ? stopParamsSource({ entry, player, state, nowMs })
            : stopParamsSource ?? {};
        if (
          !this.stopModeWithHandler(
            entry,
            state.mode,
            nowMs,
            "mode_state_invalid",
            stopParams
          )
        ) {
          this.startRoamingFallback(entry, nowMs, "mode_state_invalid", sharedCycleState);
        }
        return;
      }
    }

    if (this.tryAdoptCombatAttacker(entry, nowMs)) {
      this.ensureDecisionScheduled(state, nowMs);
      return;
    }

    if (this.isInCombat(player)) {
      this.ensureDecisionScheduled(state, nowMs);
      return;
    }

    if (nowMs < (autonomy.nextDecisionAt ?? 0)) {
      if (!this.isPvpOnlyBot(state) && this.hasNearbyRealPlayerOpportunity(player, state, nowMs)) {
        autonomy.nextDecisionAt = 0;
      } else {
        return;
      }
    }
    if (nowMs < (autonomy.modeEndsAt ?? 0)) {
      return;
    }
    if (this.shouldDelayModeDecisionWhileMoving(player, state)) {
      autonomy.nextDecisionAt = nowMs + MOVING_MODE_DECISION_DELAY_MS;
      return;
    }

    const forcePvpOnly = this.isPvpOnlyBot(state);
    let allowedAutonomousModes = null;
    if (Array.isArray(autonomy.allowedAutonomousModes)) {
      const modeKey = autonomy.allowedAutonomousModes.join("|");
      if (autonomy.allowedAutonomousModesKey !== modeKey) {
        autonomy.allowedAutonomousModesKey = modeKey;
        autonomy.allowedAutonomousModeSet = new Set(
          autonomy.allowedAutonomousModes.filter((mode) => typeof mode === "string")
        );
      }
      allowedAutonomousModes = autonomy.allowedAutonomousModeSet;
    }
    const candidates = [];
    for (const definition of this.autonomousModes) {
      const mode = definition?.mode;
      const weight = Number(definition?.weight ?? 0);
      if (!mode || weight <= 0) {
        continue;
      }
      if (allowedAutonomousModes && !allowedAutonomousModes.has(mode)) {
        continue;
      }
      if (forcePvpOnly && mode !== this.behaviorMode.PVP) {
        continue;
      }
      if (!this.behaviorRequirementsMet(mode, player, state, nowMs)) {
        continue;
      }
      candidates.push(definition);
    }

    if (this.isPvpOnlyBot(state)) {
      const pvpCandidate = candidates.find(
        (definition) => definition?.mode === this.behaviorMode.PVP
      );
      if (
        pvpCandidate &&
        this.startAutonomousMode(entry, pvpCandidate, nowMs, sharedCycleState)
      ) {
        return;
      }
    }

    const selectedMode = this.selectWeightedMode(candidates);
    if (!selectedMode) {
      this.scheduleNextDecision(state, nowMs);
      return;
    }
    if (this.startAutonomousMode(entry, selectedMode, nowMs, sharedCycleState)) {
      return;
    }

    for (const fallbackMode of candidates) {
      if (fallbackMode === selectedMode) {
        continue;
      }
      if (this.startAutonomousMode(entry, fallbackMode, nowMs, sharedCycleState)) {
        return;
      }
    }

    this.startRoamingFallback(entry, nowMs, "auto_switch_fallback", sharedCycleState);
  }

  processEntry(entry, index, now, sharedCycleState = null, options = {}) {
    const entryNow = this.resolveEntryNowMs(entry, now);
    const urgentPhasePrefix = options?.urgentPhasePrefix ?? null;
    const sampleEntry = this.shouldSampleEntry(index);
    const modeProfile =
      sampleEntry && this._profileWindow
        ? this.getModeProfile(this._profileWindow, entry?.state?.mode)
        : null;
    let entryStartNs = 0n;
    if (sampleEntry && this._profileWindow) {
      entryStartNs = process.hrtime.bigint();
    }
    try {
      const state = entry?.state;
      const player = entry?.player;
      if (!player || !state) {
        return;
      }
      if (this.recoverBlockedWildernessBot(entry, entryNow)) {
        return;
      }
      if (this.hasCombatLinks(player)) {
        this.clearDeadCombatLinks(entry);
      }
      if (sampleEntry && this._profileWindow) {
        this._profileWindow.sampledEntries += 1;
        if (modeProfile) {
          modeProfile.sampledEntries += 1;
        }
      }

      const combat = player.getCombat?.();
      const attacker = combat?.getAttacker?.();
      const target = combat?.getTarget?.();
      const hasPendingTraversal =
        state.awaitingDitchTransition != null ||
        state.roaming?.pendingRetry != null;
      const needsNpcAggro =
        !!this.npcAggroPolicyHandler &&
        (attacker?.isNpc?.() === true || target?.isNpc?.() === true);

      let shouldProcessHeavy = true;
      let traversalStartNs = 0n;
      let npcAggroStartNs = 0n;
      if (sampleEntry && this._profileWindow) {
        traversalStartNs = process.hrtime.bigint();
        npcAggroStartNs = process.hrtime.bigint();
      }

      if (!hasPendingTraversal && !needsNpcAggro) {
        let heavyGateStartNs = 0n;
        if (sampleEntry && this._profileWindow) {
          heavyGateStartNs = process.hrtime.bigint();
        }
        shouldProcessHeavy = this.shouldProcessEntryHeavy(entry, entryNow);
        if (sampleEntry && this._profileWindow) {
          this._profileWindow.heavyGateMs += this.elapsedMs(heavyGateStartNs);
        }
        if (!shouldProcessHeavy) {
          return;
        }
      }

      if (hasPendingTraversal && state.awaitingDitchTransition != null) {
        this.traversalService.processTransition(player, state, entryNow);
      }
      if (hasPendingTraversal && state.roaming?.pendingRetry != null) {
        this.traversalService.processPendingRetry(player, state, entryNow);
      }
      if (sampleEntry && this._profileWindow) {
        this._profileWindow.traversalMs += this.elapsedMs(traversalStartNs);
      }

      if (needsNpcAggro) {
        this.npcAggroPolicyHandler.handlePlayerProcess({
          player,
          nowMs: entryNow,
        });
      }
      if (sampleEntry && this._profileWindow) {
        this._profileWindow.npcAggroMs += this.elapsedMs(npcAggroStartNs);
      }

      if (sampleEntry && this._profileWindow) {
        this._profileWindow.heavyEntries += 1;
        if (modeProfile) {
          modeProfile.heavyEntries += 1;
        }
      }
      let autonomyStartNs = 0n;
      if (sampleEntry && this._profileWindow) {
        autonomyStartNs = process.hrtime.bigint();
      }
      if (urgentPhasePrefix) {
        this.ServerPerf.measurePhase(`${urgentPhasePrefix}.autonomy`, () =>
          this.processAutonomousMode(entry, entryNow, sharedCycleState)
        );
      } else {
        this.processAutonomousMode(entry, entryNow, sharedCycleState);
      }
      if (sampleEntry && this._profileWindow) {
        const autonomyMs = this.elapsedMs(autonomyStartNs);
        this._profileWindow.autonomyMs += autonomyMs;
        if (modeProfile) {
          modeProfile.autonomyMs += autonomyMs;
        }
      }
      if (this.shouldSkipIdlePvpControllerTick(entry, entryNow)) {
        return;
      }
      let controllerStartNs = 0n;
      if (sampleEntry && this._profileWindow) {
        controllerStartNs = process.hrtime.bigint();
      }
      const pvpState = state?.pvp ?? null;
      if (urgentPhasePrefix) {
        if (pvpState) {
          pvpState.currentCyclePvpIndex = sharedCycleState?.pvpIndex ?? null;
        }
        try {
          this.ServerPerf.measurePhase(`${urgentPhasePrefix}.controller`, () =>
            entry.controller.tick(entryNow)
          );
        } finally {
          if (pvpState) {
            pvpState.currentCyclePvpIndex = null;
          }
        }
      } else {
        if (pvpState) {
          pvpState.currentCyclePvpIndex = sharedCycleState?.pvpIndex ?? null;
        }
        try {
          entry.controller.tick(entryNow);
        } finally {
          if (pvpState) {
            pvpState.currentCyclePvpIndex = null;
          }
        }
      }
      if (sampleEntry && this._profileWindow) {
        const controllerMs = this.elapsedMs(controllerStartNs);
        this._profileWindow.controllerMs += controllerMs;
        if (modeProfile) {
          modeProfile.controllerMs += controllerMs;
        }
      }
    } catch (err) {
      console.error("[bots] behavior tick failed", err);
    } finally {
      if (sampleEntry && this._profileWindow) {
        const totalEntryMs = this.elapsedMs(entryStartNs);
        this._profileWindow.totalEntryMs += totalEntryMs;
        if (modeProfile) {
          modeProfile.totalEntryMs += totalEntryMs;
        }
      }
    }
  }

  execute() {
    const now = Date.now();
    this._cycleCounter = (this._cycleCounter + 1) & 0x7fffffff;

    const totalEntries = this.entries.length;
    if (totalEntries <= 0) {
      this.flushTaskProfileIfDue(now);
      return;
    }

    const startedAtMs = Date.now();
    const sharedCycleState = this.ServerPerf.measurePhase(
      "task.bot_behavior.build_cycle_state",
      () => this.buildPvpCycleState(now)
    );
    const urgentEntries = new Set();
    this.ServerPerf.measurePhase("task.bot_behavior.urgent_entries", () => {
      for (let index = 0; index < totalEntries; index++) {
        const entry = this.entries[index];
        if (!this.isUrgentEntry(entry, now)) {
          continue;
        }
        urgentEntries.add(entry);
        this.processEntry(entry, index, now, sharedCycleState, {
          urgentPhasePrefix: "task.bot_behavior.urgent",
        });
      }
    });

    const startIndex = this._entryCursor % totalEntries;
    let processedRegularEntries = 0;
    const budgetYielded = this.ServerPerf.measurePhase(
      "task.bot_behavior.regular_entries",
      () => {
        for (let offset = 0; offset < totalEntries; offset++) {
          const index = (startIndex + offset) % totalEntries;
          const entry = this.entries[index];
          if (urgentEntries.has(entry)) {
            continue;
          }
          if (this.shouldYieldForBudget(startedAtMs, processedRegularEntries)) {
            this._entryCursor = index;
            this.logBudgetYield(now, {
              elapsedMs: Date.now() - startedAtMs,
              totalEntries,
              urgentEntries: urgentEntries.size,
              processedRegularEntries,
              nextCursor: this._entryCursor,
              budgetMs: this.executionBudget.maxMs,
            });
            return true;
          }
          processedRegularEntries += 1;
          this.processEntry(entry, index, now, sharedCycleState);
        }
        return false;
      }
    );
    if (budgetYielded === true) {
      this.flushTaskProfileIfDue(now);
      return;
    }

    this._entryCursor = (startIndex + processedRegularEntries) % totalEntries;
    this.flushTaskProfileIfDue(now);
  }
}

module.exports = {
  BotBehaviorTask,
};
