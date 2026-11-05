const { Task } = require("../../../../src/main/typescript/elvarg/game/task/Task");
const { Location } = require("../../../../src/main/typescript/elvarg/game/model/Location");
const { Wilderness } = require("../../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const {
  CanAttackResponse,
} = require("../../../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const {
  chooseNextTarget,
  peekMovementRequest,
  randomInRange,
} = require("../navigation/Navigation.PlayerBots");
const {
  isPvpOnlyBotState,
  isTeleblocked,
  resetMovementState,
} = require("../state/State.PlayerBots");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
} = require("../../runtime/RecruitConstants.PlayerBots");
const { createBotTickMetrics } = require("../../runtime/TickMetrics.PlayerBots");
const { Equipment } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const {
  getWildernessHotspot,
  hotspotContainsLocation,
  isOutsideWildernessHotspots,
} = require("../pvp/WildernessHotspotRegistry.PlayerBots");
const {
  applyGeneratedPvpLoadout,
  needsLoadoutRestore,
} = require("../policies/PvpLoadoutPolicy.PlayerBots");
const { startActivity } = require("../../brain/BrainActivities.PlayerBots");

const NS_PER_MS = 1_000_000n;
const MOVING_MODE_DECISION_DELAY_MS = 1500;
const BLOCKED_TILE_CHECK_INTERVAL_MS = 5000;
// A bot that has not left one 8x8 map square for this long, out of combat, is pacing a
// loop (an unreachable roam target, a doorway it keeps missing), not playing.
const STUCK_AREA_SIZE = 8;
const STUCK_AREA_MS = 5 * 60 * 1000;
const STUCK_RECOVERY_COOLDOWN_MS = 2 * 60 * 1000;
const MISSING_BRAIN_GRACE_MS = 15000;
const LOADOUT_CHECK_INTERVAL_MS = 30000;

/** Per-entry bookkeeping for the stuck/loadout watchdogs. */
function createStuckWatch(nowMs) {
  return {
    areaKey: null,
    sinceMs: nowMs,
    lastRecoveryAtMs: 0,
    recoveries: 0,
    noBrainSinceMs: 0,
    nextLoadoutCheckAtMs: 0,
  };
}

function areaKeyFor(location) {
  if (!location) {
    return null;
  }
  const x = Number(location.getX?.());
  const y = Number(location.getY?.());
  const z = Number(location.getZ?.() ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return `${Math.floor(z)}:${Math.floor(x / STUCK_AREA_SIZE)}:${Math.floor(y / STUCK_AREA_SIZE)}`;
}

/**
 * Re-applies the generated loadout when a PvP bot has nothing on or lost its weapon.
 * A partial kit (armour but no weapon) is invisible to the PvP action's "wearing
 * nothing" check, so without this it would stick forever.
 */
function restorePvpBot(player, state, api) {
  if (!state?.pvp || !needsLoadoutRestore(player)) {
    return false;
  }
  state.pvp.loadoutPending = true;
  applyGeneratedPvpLoadout(player, state, { api });
  return !needsLoadoutRestore(player);
}

/**
 * Managed Wilderness population bots are spawned with assigned roam bounds. Minigame
 * bots (LMS waiting area, Bounty Hunter crater) use the same PvP runtime but set no
 * bounds, so the Wilderness watchdogs must leave them to their own controllers.
 */
function isManagedWildernessBot(state) {
  if (!isPvpOnlyBotState(state)) {
    return false;
  }
  const bounds = state?.roaming?.roamBounds ?? null;
  return !!bounds &&
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxY);
}

/**
 * Per-entry same-area watchdog. Returns the stuck reason, or null. A legitimate fight
 * resets the clock, and a hotspot bot lingering inside its own hotspot is doing its job.
 */
function trackStuckArea(entry, nowMs) {
  const player = entry?.player;
  const state = entry?.state;
  if (!player || !state || !isManagedWildernessBot(state)) {
    return null;
  }
  const location = player.getLocation?.();
  const key = areaKeyFor(location);
  if (!key) {
    return null;
  }
  const watch = entry.stuckWatch ?? (entry.stuckWatch = createStuckWatch(nowMs));
  const hotspot = state.pvp?.hotspotId ? getWildernessHotspot(state.pvp.hotspotId) : null;
  const inCombat = !!(
    player.getCombat?.()?.getTarget?.() ||
    player.getCombat?.()?.getAttacker?.() ||
    player.getCombatFollowing?.()
  );
  if (watch.areaKey !== key || inCombat || (hotspot && hotspotContainsLocation(hotspot, location))) {
    watch.areaKey = key;
    watch.sinceMs = nowMs;
    return null;
  }
  if (nowMs - watch.sinceMs < STUCK_AREA_MS) {
    return null;
  }
  if (nowMs - Number(watch.lastRecoveryAtMs ?? 0) < STUCK_RECOVERY_COOLDOWN_MS) {
    return null;
  }
  return {
    key,
    elapsedMs: nowMs - watch.sinceMs,
  };
}

/**
 * Re-flags an idle bot's facing. A face update that lands on the same tick as the
 * bot's last walk step is ignored by the client (it keeps the walk direction), and
 * the flag is one-shot - so a bot that arrives and clicks a tree would stay facing
 * its walk direction. Re-sending while standing keeps it facing what it uses, the
 * way a real client does on its own.
 */
function refreshIdleFace(player) {
  if (typeof player?.forcePositionToFace !== "function") {
    return false;
  }
  const face = player.getPositionToFace?.();
  if (!face || player.getForceMovement?.() != null) {
    return false;
  }
  if ((player.getMovementQueue?.()?.size?.() ?? 0) > 0) {
    return false;
  }
  player.forcePositionToFace(face);
  return true;
}

class BotBehaviorTask extends Task {
  constructor(entries, decisionTicks, options = {}) {
    super(decisionTicks);
    this.entries = entries;
    this.api = options.api ?? null;
    this.World = this.api?.getWorld();
    this.RegionManager = this.api?.getRegionManager();
    this.CombatFactory = this.api?.getCombatFactory();
    this.AreaManager = this.api?.getAreaManager();
    this.ServerPerf = this.api?.getServerPerf();
    this.behaviorMode = options.behaviorMode ?? null;
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
    this.tickMetrics =
      options.tickMetrics && typeof options.tickMetrics.beginCycle === "function"
        ? options.tickMetrics
        : createBotTickMetrics(options.tickMetrics ?? {});
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
      heavyGateMs: 0,
      brainMs: 0,
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
        brainMs: 0,
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
    const avg = (total, count) => (count > 0 ? Number((total / count).toFixed(4)) : 0);
    const topModes = Object.entries(window.modeSamples)
      .map(([mode, stats]) => ({
        mode,
        sampledEntries: stats.sampledEntries,
        avgEntryMs: avg(stats.totalEntryMs, stats.sampledEntries),
        avgBrainMs: avg(stats.brainMs, stats.sampledEntries),
      }))
      .sort((a, b) => b.avgEntryMs - a.avgEntryMs)
      .slice(0, 6);
    this.api?.log?.("bot_task_profile_snapshot", {
      windowMs: nowMs - window.startedAt,
      sampledEntries,
      sampleStride: this.taskProfiler.sampleStride,
      avgEntryMs: avg(window.totalEntryMs, sampledEntries),
      avgHeavyGateMs: avg(window.heavyGateMs, sampledEntries),
      avgBrainMs: avg(window.brainMs, sampledEntries),
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
    if (state.awaitingDitchTransition != null) {
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

  shouldProcessEntryHeavy(entry, nowMs) {
    // Temporal sharding for performance: calm/idle bots skip brain ticks on
    // some cycles. Urgent bots (combat, traversal, transient, pvp) are
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
      return this.isDue(state, offscreenPvpCombatStride, shard);
    }
    if (state.awaitingDitchTransition != null) {
      return true;
    }
    if (player.getForceMovement?.() != null) {
      return true;
    }
    const queueSize = Number(player.getMovementQueue?.()?.size?.() ?? 0);
    if (queueSize > 0 && state.mode !== this.behaviorMode?.PVP) {
      const movingStride = Math.max(2, stride);
      return this.isDue(state, movingStride, shard);
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
      return this.isDue(state, pvpStride, shard);
    }
    return this.isDue(state, stride, shard);
  }

  /**
   * LOD gate: true once `stride` cycles have passed since this entry last ran
   * (first run offset by its shard, to spread the load). A `(cycle + shard) %
   * stride === 0` gate aliased with the budget's round-robin: an entry visited
   * only every few cycles could keep missing its slot and starve for minutes.
   */
  isDue(state, stride, shard) {
    if (!Number.isFinite(state.nextHeavyCycle)) {
      state.nextHeavyCycle = this._cycleCounter + shard;
    }
    if (this._cycleCounter < state.nextHeavyCycle) {
      return false;
    }
    state.nextHeavyCycle = this._cycleCounter + stride;
    return true;
  }

  isPvpOnlyBot(state) {
    return isPvpOnlyBotState(state);
  }

  chooseWildernessRecoveryLocation(player, state) {
    if (!player || !state) {
      return null;
    }
    const roamBounds = state?.roaming?.roamBounds ?? null;
    const hotspotId = state?.pvp?.hotspotId ?? null;
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
          !this.RegionManager.blocked(location, privateArea) &&
          !this.RegionManager.isWater(location) &&
          (hotspotId != null || isOutsideWildernessHotspots(candidate))
        );
      },
    });
    if (!target) {
      return null;
    }
    return new Location(target.x, target.y, target.z);
  }

  /**
   * A PvP bot that has not left its 8x8 square for minutes, or one that lost its brain,
   * is not fighting and not travelling: reset it onto a walkable Wilderness tile and
   * start its PvP frame again. The stall watchdog in the brain cannot see either case -
   * it only fails a frame when nothing moves, and a bot without a brain never ticks.
   */
  recoverStuckBot(entry, nowMs) {
    const player = entry?.player;
    const state = entry?.state;
    if (!player || !state || !isManagedWildernessBot(state)) {
      return false;
    }
    if ((player.getHitpoints?.() ?? 0) <= 0 || player.isDyingReturn?.() === true) {
      return false;
    }
    // Instances, teleports and live fights belong to their own controllers (LMS, BH).
    if (player.getPrivateArea?.() != null || isTeleblocked(player) || this.hasCombatLinks(player) || player.getCombat?.()?.getHitQueue?.()?.hasPendingWork?.()) {
      return false;
    }
    const watch = entry.stuckWatch ?? (entry.stuckWatch = createStuckWatch(nowMs));
    let reason = null;
    watch.stuckElapsedMs = null;
    if (!entry.brain) {
      if (!watch.noBrainSinceMs) {
        watch.noBrainSinceMs = nowMs;
      }
      if (nowMs - watch.noBrainSinceMs >= MISSING_BRAIN_GRACE_MS) {
        reason = "missing_brain";
      }
    } else {
      watch.noBrainSinceMs = 0;
      const stuckArea = trackStuckArea(entry, nowMs);
      if (stuckArea) {
        reason = "same_area";
        watch.stuckElapsedMs = stuckArea.elapsedMs;
      }
    }
    if (!reason) {
      return false;
    }

    const from = player.getLocation?.();
    const destination = this.chooseWildernessRecoveryLocation(player, state);
    resetMovementState(player);
    player.getCombat?.().reset?.();
    player.getCombat?.().setUnderAttack?.(null);
    player.setFollowing?.(null);
    player.setCombatFollowing?.(null);
    player.setMobileInteraction?.(null);
    player.setPositionToFace?.(null);
    player.getMovementQueue?.().reset?.();
    if (state.pvp) {
      state.pvp.phase = "seeking";
      state.pvp.targetUsername = null;
      state.pvp.targetPlayer = null;
      state.pvp.currentTargetScore = 0;
      state.pvp.targetLockUntil = 0;
      state.pvp.endsAt = 0;
      state.pvp.nextActionAt = nowMs + randomInRange(600, 1500);
    }
    if (state.roaming) {
      state.roaming.target = null;
      state.roaming.targetPickedAt = 0;
      state.roaming.nextWalkAt = nowMs + randomInRange(600, 1500);
    }
    if (destination) {
      if (state.home) {
        state.home.x = destination.getX();
        state.home.y = destination.getY();
        state.home.z = destination.getZ();
      }
      player.moveTo?.(destination);
    }
    const loadoutRestored = restorePvpBot(player, state, this.api);
    const attached = startActivity(player, "pvp", { home: state.home ?? null });

    watch.lastRecoveryAtMs = nowMs;
    watch.recoveries = Number(watch.recoveries ?? 0) + 1;
    watch.areaKey = areaKeyFor(destination ?? player.getLocation?.());
    watch.sinceMs = nowMs;
    watch.noBrainSinceMs = 0;
    this.api?.log?.("bot_stuck_recovered", {
      username: player.getUsername?.() ?? null,
      reason,
      elapsedMs: watch.stuckElapsedMs ?? null,
      recoveries: watch.recoveries,
      loadoutRestored,
      brainAttached: attached,
      fromX: from?.getX?.() ?? null,
      fromY: from?.getY?.() ?? null,
      fromZ: from?.getZ?.() ?? null,
      toX: destination?.getX?.() ?? null,
      toY: destination?.getY?.() ?? null,
      toZ: destination?.getZ?.() ?? null,
      hotspotId: state.pvp?.hotspotId ?? null,
    });
    return true;
  }

  /** Periodic safety net for a PvP bot that is wearing a partial kit (armour, no weapon). */
  maybeRestoreMissingLoadout(entry, nowMs) {
    const player = entry?.player;
    const state = entry?.state;
    if (!player || !state || !isManagedWildernessBot(state) || !state.pvp) {
      return false;
    }
    if ((player.getHitpoints?.() ?? 0) <= 0 || player.isDyingReturn?.() === true) {
      return false;
    }
    if (player.getPrivateArea?.() != null || isTeleblocked(player) || this.hasCombatLinks(player) || player.getCombat?.()?.getHitQueue?.()?.hasPendingWork?.()) {
      return false;
    }
    const watch = entry.stuckWatch ?? (entry.stuckWatch = createStuckWatch(nowMs));
    if (nowMs < Number(watch.nextLoadoutCheckAtMs ?? 0)) {
      return false;
    }
    watch.nextLoadoutCheckAtMs = nowMs + LOADOUT_CHECK_INTERVAL_MS;
    if (!needsLoadoutRestore(player)) {
      return false;
    }
    const worn = (player.getEquipment?.()?.getItems?.() ?? []).slice();
    restorePvpBot(player, state, this.api);
    if (needsLoadoutRestore(player)) {
      return false; // still mid-fight: the PvP action retries once it is out
    }
    this.api?.log?.("bot_pvp_loadout_restored", {
      username: player.getUsername?.() ?? null,
      loadoutId: state.pvp.loadoutId ?? null,
      pending: state.pvp.loadoutPending === true,
      wornBefore: worn.filter((item) => (item?.getId?.() ?? 0) > 0).length,
      weaponBefore: worn[Equipment.WEAPON_SLOT]?.getId?.() ?? -1,
    });
    return true;
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

    const recoveryLocation = this.chooseWildernessRecoveryLocation(player, state);
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

  processEntry(entry, index, now, options = {}) {
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
    const metricsStartNs = this.tickMetrics.enabled
      ? process.hrtime.bigint()
      : 0n;
    try {
      const state = entry?.state;
      const player = entry?.player;
      if (!player || !state) {
        return;
      }
      if (this.recoverBlockedWildernessBot(entry, entryNow)) {
        return;
      }
      if (this.recoverStuckBot(entry, entryNow)) {
        return;
      }
      if (this.hasCombatLinks(player)) {
        this.clearDeadCombatLinks(entry);
      }
      this.maybeRestoreMissingLoadout(entry, entryNow);
      if (sampleEntry && this._profileWindow) {
        this._profileWindow.sampledEntries += 1;
        if (modeProfile) {
          modeProfile.sampledEntries += 1;
        }
      }
      if (!entry.brain) {
        return;
      }
      let heavyGateStartNs = 0n;
      if (sampleEntry && this._profileWindow) {
        heavyGateStartNs = process.hrtime.bigint();
      }
      const shouldProcessHeavy = this.shouldProcessEntryHeavy(entry, entryNow);
      if (sampleEntry && this._profileWindow) {
        this._profileWindow.heavyGateMs += this.elapsedMs(heavyGateStartNs);
      }
      if (!shouldProcessHeavy) {
        return;
      }
      const brainStartNs = sampleEntry && this._profileWindow ? process.hrtime.bigint() : 0n;
      if (urgentPhasePrefix) {
        this.ServerPerf.measurePhase(`${urgentPhasePrefix}.brain`, () =>
          entry.brain.tick(entryNow)
        );
      } else {
        entry.brain.tick(entryNow);
      }
      if (sampleEntry && this._profileWindow) {
        const brainMs = this.elapsedMs(brainStartNs);
        this._profileWindow.brainMs += brainMs;
        if (modeProfile) {
          modeProfile.brainMs += brainMs;
        }
      }
    } catch (err) {
      console.error("[bots] brain tick failed", err);
    } finally {
      if (sampleEntry && this._profileWindow) {
        const totalEntryMs = this.elapsedMs(entryStartNs);
        this._profileWindow.totalEntryMs += totalEntryMs;
        if (modeProfile) {
          modeProfile.totalEntryMs += totalEntryMs;
        }
      }
      if (metricsStartNs !== 0n) {
        this.tickMetrics.recordEntry(
          Number(process.hrtime.bigint() - metricsStartNs)
        );
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
    this.tickMetrics.beginCycle(now);
    // Every entry each tick, not just the brain's strided turns: the face flag is
    // one-shot, and a bot's click-face on its walk-ending tick is dropped by the
    // client (it keeps the walk direction) - an idle bot must re-send it promptly.
    for (let index = 0; index < totalEntries; index++) {
      refreshIdleFace(this.entries[index]?.player);
    }
    const urgentEntries = new Set();
    this.ServerPerf.measurePhase("task.bot_behavior.urgent_entries", () => {
      for (let index = 0; index < totalEntries; index++) {
        const entry = this.entries[index];
        if (!this.isUrgentEntry(entry, now)) {
          continue;
        }
        urgentEntries.add(entry);
        this.processEntry(entry, index, now, {
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
          this.processEntry(entry, index, now);
        }
        return false;
      }
    );
    if (budgetYielded === true) {
      this.flushTaskProfileIfDue(now);
      this.tickMetrics.endCycle(
        Date.now(),
        urgentEntries.size + processedRegularEntries
      );
      return;
    }

    this._entryCursor = (startIndex + processedRegularEntries) % totalEntries;
    this.flushTaskProfileIfDue(now);
    this.tickMetrics.endCycle(
      Date.now(),
      urgentEntries.size + processedRegularEntries
    );
  }
}

module.exports = {
  BotBehaviorTask,
  refreshIdleFace,
  __testing: {
    STUCK_AREA_MS,
    isManagedWildernessBot,
    trackStuckArea,
  },
};
