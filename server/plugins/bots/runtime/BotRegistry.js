const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Wilderness } = require("../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const {
  getEnabledWildernessHotspots,
  getWildernessHotspot,
  createHotspotAnchorLocation,
  isOutsideWildernessHotspots,
} = require("../behaviours/pvp/WildernessHotspotRegistry");
const {
  ATTR_BOT_PVP_PROFILE_ID,
} = require("./BotRecruitConstants");
const {
  ATTR_SKIP_PERSISTENCE,
} = require("./BotPersistenceConstants");

const WILDERNESS_SPAWN_TILE_PROBE_LIMIT = 256;
const WILDERNESS_REGION_SIZE = 64;
const WILDERNESS_REGION_DESPAWN_DELAY_MS = 30000;
const BOT_STARTUP_BATCH_SIZE = 24;
const BOT_STARTUP_BATCH_DELAY_MS = 40;

function createBotRegistry(options) {
  const {
    botApi,
    botCount,
    wildernessRoamerBotCount = 0,
    wildernessActiveRegionBotsPerRegion = 0,
    wildernessActiveRegionInset = 0,
    botBaseCooldownMs,
    spawn,
    spawnOffsets,
    behaviorMode,
    createBotPlayer,
    spawnLocationForIndex,
    createInitialState,
    buildHotspotPvpMetadata: buildHotspotPvpMetadataFn,
    buildRoamingPvpMetadata: buildRoamingPvpMetadataFn,
    assignPvpMetadata: assignPvpMetadataFn,
    applyInitialPvpLoadout: applyInitialPvpLoadoutFn,
    applyForcedModeForDiagnosis: applyForcedModeForDiagnosisFn,
    createController,
    ensureBehaviorTaskStarted,
    emitPlayerLogin,
    worldGetPlayerByName,
    formatText,
    resetMovementState,
    clearFollowState,
    randomInRange,
    startupLogger,
    onActiveRegionsUpdated,
    getActiveRegionSnapshot,
    botStatesByName: providedBotStatesByName,
    botmeUsernames: providedBotmeUsernames,
    playerBotUsernames: providedPlayerBotUsernames,
    entries: providedEntries,
    entriesByUsername: providedEntriesByUsername,
  } = options;
  const RegionManager = botApi.getRegionManager();
  const applyForcedModeForDiagnosis =
    typeof applyForcedModeForDiagnosisFn === "function"
      ? applyForcedModeForDiagnosisFn
      : () => {};
  const assignPvpMetadata =
    typeof assignPvpMetadataFn === "function" ? assignPvpMetadataFn : () => {};
  const buildHotspotPvpMetadata =
    typeof buildHotspotPvpMetadataFn === "function"
      ? buildHotspotPvpMetadataFn
      : () => null;
  const buildRoamingPvpMetadata =
    typeof buildRoamingPvpMetadataFn === "function"
      ? buildRoamingPvpMetadataFn
      : () => null;
  const applyInitialPvpLoadout =
    typeof applyInitialPvpLoadoutFn === "function" ? applyInitialPvpLoadoutFn : () => {};

  const botStatesByName = providedBotStatesByName ?? new Map();
  const botmeUsernames = providedBotmeUsernames ?? new Set();
  const playerBotUsernames = providedPlayerBotUsernames ?? new Set();
  const entries = providedEntries ?? [];
  const entriesByUsername = providedEntriesByUsername ?? new Map();
  let spawned = 0;
  let developerBotId = 0;
  let wildernessRoamersAssigned = 0;
  const hotspotSpawnCounts = new Map();
  const wildernessHotspotAssignments = new Map();
  const wildernessRegionalAssignments = new Map();
  const wildernessRegionalDespawnTimers = new Map();
  const wildernessRegionalPendingDespawn = new Set();

  function regionKeyFromParts(z, regionX, regionY) {
    return `${Math.floor(z)}:${Math.floor(regionX)}:${Math.floor(regionY)}`;
  }

  function sortRegions(left, right) {
    return (
      Number(left?.z ?? 0) - Number(right?.z ?? 0) ||
      Number(left?.regionX ?? 0) - Number(right?.regionX ?? 0) ||
      Number(left?.regionY ?? 0) - Number(right?.regionY ?? 0)
    );
  }

  function contractRegionSet(regions, steps) {
    let current = new Map();
    for (const region of regions ?? []) {
      if (!region?.key) {
        continue;
      }
      current.set(region.key, region);
    }

    const safeSteps = Math.max(0, Math.floor(steps));
    for (let step = 0; step < safeSteps; step += 1) {
      if (current.size <= 0) {
        break;
      }
      const next = new Map();
      for (const region of current.values()) {
        const regionX = Number(region?.regionX);
        const regionY = Number(region?.regionY);
        const z = Number(region?.z);
        if (!Number.isInteger(regionX) || !Number.isInteger(regionY) || !Number.isInteger(z)) {
          continue;
        }
        let hasAllNeighbors = true;
        for (let dx = -1; dx <= 1 && hasAllNeighbors; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            const neighborKey = regionKeyFromParts(z, regionX + dx, regionY + dy);
            if (!current.has(neighborKey)) {
              hasAllNeighbors = false;
              break;
            }
          }
        }
        if (hasAllNeighbors) {
          next.set(region.key, region);
        }
      }
      current = next;
    }

    return Array.from(current.values()).sort(sortRegions);
  }

  function resolveRegionalTargetRegions(snapshot) {
    const regions = Array.isArray(snapshot?.regions) ? snapshot.regions : [];
    if (regions.length <= 0) {
      return [];
    }

    const snapshotRadius = Math.max(0, Math.floor(Number(snapshot?.radius ?? 0)));
    const requestedInset = Math.max(0, Math.floor(Number(wildernessActiveRegionInset ?? 0)));
    const effectiveInset = Math.min(snapshotRadius, requestedInset);
    if (effectiveInset <= 0) {
      return regions;
    }

    const contracted = contractRegionSet(regions, effectiveInset);
    // Safety fallback: never collapse to zero target regions from contraction alone.
    return contracted.length > 0 ? contracted : regions;
  }

  function addEntry(username, entry) {
    entry.entryIndex = entries.length;
    entry.entryUsername = username;
    entries.push(entry);
    entriesByUsername.set(username, entry);
  }

  function removeEntryByUsername(username) {
    if (!username) {
      return false;
    }

    const entry = entriesByUsername.get(username);
    if (!entry) {
      return false;
    }
    const index = entry.entryIndex;
    const lastIndex = entries.length - 1;
    const lastEntry = entries[lastIndex];
    entries.pop();

    if (index < lastIndex) {
      entries[index] = lastEntry;
      lastEntry.entryIndex = index;
    }

    entriesByUsername.delete(username);
    return true;
  }

  function hasControllerForUsername(username) {
    return !!username && entriesByUsername.has(username);
  }

  function hasControllerForPlayer(player) {
    const username = player?.getUsername?.();
    return hasControllerForUsername(username);
  }

  function resolveControlledPlayer(usernameInput) {
    if (!usernameInput) {
      return null;
    }

    const candidates = [usernameInput, formatText(usernameInput)];
    for (const candidate of candidates) {
      const direct = worldGetPlayerByName(candidate);
      if (direct?.isRegistered?.() && hasControllerForPlayer(direct)) {
        return direct;
      }
    }

    const targetLower = usernameInput.trim().toLowerCase();
    for (const entry of entries) {
      const entryPlayer = entry?.player;
      const entryUsername = entryPlayer?.getUsername?.();
      if (!entryUsername) {
        continue;
      }
      if (entryUsername.toLowerCase() !== targetLower) {
        continue;
      }
      if (entryPlayer.isRegistered?.()) {
        return entryPlayer;
      }
    }

    return null;
  }

  function setPersistentRespawnResolver(player, resolver) {
    if (!player) {
      return;
    }
    if (typeof resolver === "function") {
      player.__botResolveRespawnLocation = resolver;
    } else {
      delete player.__botResolveRespawnLocation;
    }
  }

  function syncBotProfileAttribute(player, state) {
    const profileId = state?.pvp?.profileId ?? "standard";
    if (!player) {
      return;
    }
    player.setAttribute?.(
      ATTR_BOT_PVP_PROFILE_ID,
      profileId
    );
  }

  function primePvpOnlyStartupState(state, readyAtMs) {
    if (!state) {
      return;
    }
    state.mode = behaviorMode.PVP;
    if (!state.autonomy) {
      state.autonomy = {};
    }
    state.autonomy.allowedAutonomousModes = [behaviorMode.PVP];
    state.autonomy.nextDecisionAt = readyAtMs;
    state.autonomy.nextModeValidationAt = readyAtMs;
    if (!state.pvp) {
      state.pvp = {};
    }
    state.pvp.phase = "seeking";
    state.pvp.nextActionAt = readyAtMs;
  }

  function createRegionBounds(region) {
    if (!region || !Number.isInteger(region.regionX) || !Number.isInteger(region.regionY)) {
      return null;
    }
    const minX = region.regionX * WILDERNESS_REGION_SIZE;
    const minY = region.regionY * WILDERNESS_REGION_SIZE;
    return {
      id: region.key,
      minX,
      maxX: minX + WILDERNESS_REGION_SIZE - 1,
      minY,
      maxY: minY + WILDERNESS_REGION_SIZE - 1,
      z: Math.floor(region.z ?? 0),
    };
  }

  function regionIntersectsWilderness(region) {
    const bounds = createRegionBounds(region);
    if (!bounds) {
      return false;
    }
    return Wilderness.intersectsArea(
      bounds.minX,
      bounds.maxX,
      bounds.minY,
      bounds.maxY,
      bounds.z
    );
  }

  function getRegionKeyForLocation(location) {
    if (!location) {
      return null;
    }
    const x = location.getX?.();
    const y = location.getY?.();
    const z = location.getZ?.();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    return `${Math.floor(z)}:${Math.floor(x) >> 6}:${Math.floor(y) >> 6}`;
  }

  function countLiveHotspotBotsByRegion() {
    const countsByRegion = new Map();
    for (const [username] of wildernessHotspotAssignments.entries()) {
      const entry = entriesByUsername.get(username);
      const player = entry?.player;
      if (!player || !entriesByUsername.has(username)) {
        continue;
      }
      const regionKey = getRegionKeyForLocation(player.getLocation?.());
      if (!regionKey) {
        continue;
      }
      countsByRegion.set(regionKey, (countsByRegion.get(regionKey) ?? 0) + 1);
    }
    return countsByRegion;
  }

  function getLiveRegionalBotRegionKeys() {
    const currentRegionByUsername = new Map();
    for (const [username] of wildernessRegionalAssignments.entries()) {
      const entry = entriesByUsername.get(username);
      const player = entry?.player;
      if (!player || !entriesByUsername.has(username)) {
        continue;
      }
      const regionKey = getRegionKeyForLocation(player.getLocation?.());
      if (!regionKey) {
        continue;
      }
      currentRegionByUsername.set(username, regionKey);
    }
    return currentRegionByUsername;
  }

  function buildRegionalWildernessPlans(snapshot, hotspotCountsByRegion = null) {
    if (
      wildernessRoamerBotCount <= 0 ||
      wildernessActiveRegionBotsPerRegion <= 0 ||
      !Array.isArray(snapshot?.regions) ||
      snapshot.regions.length === 0
    ) {
      return [];
    }

    const targetRegions = resolveRegionalTargetRegions(snapshot);
    const activeRegions = targetRegions
      .filter((region) => regionIntersectsWilderness(region))
      .sort(sortRegions);

    if (activeRegions.length === 0) {
      return [];
    }
    const desiredCountsByRegion = new Map();
    let totalDesired = 0;
    for (const region of activeRegions) {
      const hotspotCount = hotspotCountsByRegion?.get?.(region.key) ?? 0;
      const desiredCount = Math.max(0, wildernessActiveRegionBotsPerRegion - hotspotCount);
      desiredCountsByRegion.set(region.key, desiredCount);
      totalDesired += desiredCount;
    }
    const desiredTotal = Math.min(
      wildernessRoamerBotCount,
      totalDesired
    );
    if (desiredTotal <= 0) {
      return [];
    }

    const plans = [];
    for (const region of activeRegions) {
      if (plans.length >= desiredTotal) {
        break;
      }
      const regionBounds = createRegionBounds(region);
      if (!regionBounds) {
        continue;
      }
      const desiredCount = desiredCountsByRegion.get(region.key) ?? 0;
      for (let slot = 0; slot < desiredCount; slot += 1) {
        if (plans.length >= desiredTotal) {
          break;
        }
        plans.push({
          regionKey: region.key,
          regionBounds,
          hotspotId: null,
        });
      }
    }
    return plans;
  }

  function buildPersistentHotspotPlans() {
    if (wildernessRoamerBotCount <= 0) {
      return [];
    }
    const plans = [];
    const hotspots = getEnabledWildernessHotspots().sort((a, b) => a.id.localeCompare(b.id));
    for (const hotspot of hotspots) {
      const targetCount = Math.max(
        0,
        Math.min(
          Number(hotspot?.targetBots ?? 0),
          Number(hotspot?.maxBots ?? hotspot?.targetBots ?? 0)
        )
      );
      for (let index = 0; index < targetCount; index += 1) {
        if (plans.length >= wildernessRoamerBotCount) {
          return plans;
        }
        plans.push({
          hotspotId: hotspot.id,
          regionBounds: hotspot.area,
        });
      }
    }
    return plans;
  }

  function claimAvailableWildernessUsername() {
    for (let i = 1; i <= wildernessRoamerBotCount; i += 1) {
      const username = `WildyBot${i}`;
      if (wildernessHotspotAssignments.has(username)) {
        continue;
      }
      if (wildernessRegionalAssignments.has(username)) {
        continue;
      }
      if (wildernessRegionalPendingDespawn.has(username)) {
        continue;
      }
      if (entriesByUsername.has(username)) {
        continue;
      }
      return username;
    }
    return null;
  }

  function requestWildernessDespawn(username, assignmentMap) {
    if (!username || wildernessRegionalPendingDespawn.has(username)) {
      return false;
    }
    const entry = entriesByUsername.get(username);
    const player = entry?.player;
    if (!player) {
      assignmentMap?.delete?.(username);
      wildernessRegionalPendingDespawn.delete(username);
      return false;
    }
    wildernessRegionalPendingDespawn.add(username);
    if (player.isPlayerBot?.() === true) {
      player.getForcedLogoutTimer?.().start?.(0);
    }
    player.requestLogout?.();
    return true;
  }

  function requestRegionalWildernessDespawn(username) {
    return requestWildernessDespawn(username, wildernessRegionalAssignments);
  }

  function requestHotspotWildernessDespawn(username) {
    return requestWildernessDespawn(username, wildernessHotspotAssignments);
  }

  function spawnWildernessBot(plan, assignmentMap, assignmentValue) {
    if (!plan) {
      return false;
    }
    const username = plan.username ?? claimAvailableWildernessUsername();
    if (!username) {
      return false;
    }
    const assignedHotspotId = plan.hotspotId ?? null;
    const assignedHotspot = assignedHotspotId ? getWildernessHotspot(assignedHotspotId) : null;
    const assignedBounds = assignedHotspot?.area ?? plan.regionBounds;
    const hotspotSpawnIndex =
      assignedHotspotId != null ? reserveHotspotSpawnIndex(assignedHotspotId) : -1;
    const hotspotSpawn =
      assignedHotspotId != null ? createHotspotSpawn(assignedHotspotId, hotspotSpawnIndex) : null;
    const botSpawn = plan.spawnLocation?.clone() ?? (assignedHotspotId != null
      ? hotspotSpawn
      : createWildernessRoamerSpawn(spawn, assignedBounds, randomInRange(0, 1_000_000_000)));
    if (!botSpawn) {
      return false;
    }

    const bot = createBotPlayer(username, botSpawn, {
      api: botApi,
      loadPersistence: false,
      saveRandomizedAppearance: false,
    });
    if (!bot) {
      return false;
    }
    bot.setPlayerBot?.(true);
    bot.setAttribute?.(ATTR_SKIP_PERSISTENCE, true);
    setPersistentRespawnResolver(bot, () => {
      if (plan.spawnLocation) return botSpawn.clone();
      if (assignedHotspotId != null) {
        const respawnIndex = reserveHotspotSpawnIndex(assignedHotspotId);
        const respawnTile = createHotspotSpawn(assignedHotspotId, respawnIndex);
        return respawnTile ?? botSpawn.clone();
      }
      return (
        createWildernessRoamerSpawn(spawn, assignedBounds, randomInRange(0, 1_000_000)) ??
        botSpawn.clone()
      );
    });

    const nowMs = Date.now();
    const state = createInitialState(
      {
        x: botSpawn.getX(),
        y: botSpawn.getY(),
        z: botSpawn.getZ(),
      },
      behaviorMode
    );
    if (!state.autonomy) {
      state.autonomy = {};
    }
    primePvpOnlyStartupState(state, nowMs);
    if (!state.roaming) {
      state.roaming = {};
    }
    state.roaming.nextWalkAt = nowMs;
    if (assignedBounds) {
      state.roaming.roamBounds = {
        id: assignedHotspotId ?? assignedBounds.id ?? null,
        minX: assignedBounds.minX ?? assignedHotspot?.area?.minX,
        maxX: assignedBounds.maxX ?? assignedHotspot?.area?.maxX,
        minY: assignedBounds.minY ?? assignedHotspot?.area?.minY,
        maxY: assignedBounds.maxY ?? assignedHotspot?.area?.maxY,
        z: assignedBounds.z ?? assignedHotspot?.area?.z ?? botSpawn.getZ(),
      };
    }
    const pvpMetadata =
      assignedHotspotId != null
        ? buildHotspotPvpMetadata({
            hotspotId: assignedHotspotId,
          })
        : buildRoamingPvpMetadata({
            excludeF2p: true,
          });
    assignPvpMetadata(state, {
      metadata: pvpMetadata,
    });
    state.pvp.presetPoolEnabled = true;
    syncBotProfileAttribute(bot, state);
    if (!applyInitialPvpLoadout(bot, state)) state.pvp.loadoutPending = true;
    applyForcedModeForDiagnosis(bot, state);
    bot.setLocation?.(botSpawn.clone());
    bot.setLastKnownRegion?.(botSpawn.clone());
    botStatesByName.set(username, state);
    playerBotUsernames.add(username);
    assignmentMap?.set(username, assignmentValue);

    addEntry(username, {
      player: bot,
      state,
      controller: createController(
        bot,
        botSpawn,
        0
      ),
    });
    emitPlayerLogin({
      player: bot,
      username,
    });
    bot.moveTo?.(botSpawn.clone());
    ensureBehaviorTaskStarted();
    spawned++;
    if (assignmentMap) wildernessRoamersAssigned++;
    return bot;
  }

  function spawnRegionalWildernessBot(plan) {
    return spawnWildernessBot(
      plan,
      wildernessRegionalAssignments,
      {
        regionKey: plan.regionKey,
        hotspotId: plan.hotspotId ?? null,
      }
    );
  }

  function spawnHotspotWildernessBot(plan) {
    return spawnWildernessBot(
      plan,
      wildernessHotspotAssignments,
      {
        hotspotId: plan.hotspotId ?? null,
      }
    );
  }

  function reconcilePersistentHotspotBots() {
    if (wildernessRoamerBotCount <= 0) {
      return;
    }
    const plans = buildPersistentHotspotPlans();
    const desiredCountsByHotspot = new Map();
    for (const plan of plans) {
      desiredCountsByHotspot.set(
        plan.hotspotId,
        (desiredCountsByHotspot.get(plan.hotspotId) ?? 0) + 1
      );
    }

    const currentUsernamesByHotspot = new Map();
    for (const [username, assignment] of wildernessHotspotAssignments.entries()) {
      if (wildernessRegionalPendingDespawn.has(username)) {
        continue;
      }
      if (!entriesByUsername.has(username)) {
        continue;
      }
      const hotspotId = assignment?.hotspotId ?? null;
      if (!hotspotId) {
        continue;
      }
      const bucket = currentUsernamesByHotspot.get(hotspotId) ?? [];
      bucket.push(username);
      currentUsernamesByHotspot.set(hotspotId, bucket);
    }

    for (const [hotspotId, usernames] of currentUsernamesByHotspot.entries()) {
      const desiredCount = desiredCountsByHotspot.get(hotspotId) ?? 0;
      if (usernames.length <= desiredCount) {
        continue;
      }
      const overflow = usernames
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .slice(desiredCount);
      for (const username of overflow) {
        requestHotspotWildernessDespawn(username);
      }
    }

    const filledCountsByHotspot = new Map();
    for (const [hotspotId, usernames] of currentUsernamesByHotspot.entries()) {
      const desiredCount = desiredCountsByHotspot.get(hotspotId) ?? 0;
      filledCountsByHotspot.set(hotspotId, Math.min(usernames.length, desiredCount));
    }

    for (const plan of plans) {
      const hotspotId = plan.hotspotId;
      const filled = filledCountsByHotspot.get(hotspotId) ?? 0;
      const desired = desiredCountsByHotspot.get(hotspotId) ?? 0;
      if (filled >= desired) {
        continue;
      }
      if (!spawnHotspotWildernessBot(plan)) {
        continue;
      }
      filledCountsByHotspot.set(hotspotId, filled + 1);
    }
  }

  function reconcileRegionalWildernessBots(snapshot = null) {
    if (wildernessRoamerBotCount <= 0 || wildernessActiveRegionBotsPerRegion <= 0) {
      return;
    }
    const nextSnapshot =
      snapshot ??
      (typeof getActiveRegionSnapshot === "function"
        ? getActiveRegionSnapshot()
        : null);
    const hotspotCountsByRegion = countLiveHotspotBotsByRegion();
    const plans = buildRegionalWildernessPlans(nextSnapshot, hotspotCountsByRegion);
    const desiredCountsByRegion = new Map();
    for (const plan of plans) {
      desiredCountsByRegion.set(
        plan.regionKey,
        (desiredCountsByRegion.get(plan.regionKey) ?? 0) + 1
      );
    }

    const liveRegionalRegionKeys = getLiveRegionalBotRegionKeys();
    const currentAssignedUsernamesByRegion = new Map();
    for (const [username, assignment] of wildernessRegionalAssignments.entries()) {
      if (!entriesByUsername.has(username)) {
        continue;
      }
      const liveRegionKey = liveRegionalRegionKeys.get(username);
      if (liveRegionKey !== assignment.regionKey) {
        continue;
      }
      const bucket = currentAssignedUsernamesByRegion.get(assignment.regionKey) ?? [];
      bucket.push(username);
      currentAssignedUsernamesByRegion.set(assignment.regionKey, bucket);
    }

    const cancelRegionalDespawnTimer = (username) => {
      const timer = wildernessRegionalDespawnTimers.get(username);
      if (timer) {
        clearTimeout(timer);
        wildernessRegionalDespawnTimers.delete(username);
      }
      wildernessRegionalPendingDespawn.delete(username);
    };

    const scheduleRegionalDespawnTimer = (username) => {
      if (!username || wildernessRegionalDespawnTimers.has(username)) {
        return;
      }
      wildernessRegionalPendingDespawn.add(username);
      const timer = setTimeout(() => {
        wildernessRegionalDespawnTimers.delete(username);
        const assignment = wildernessRegionalAssignments.get(username);
        if (!assignment || !entriesByUsername.has(username)) {
          wildernessRegionalPendingDespawn.delete(username);
          return;
        }
        const liveSnapshot =
          typeof getActiveRegionSnapshot === "function"
            ? getActiveRegionSnapshot()
            : null;
        const livePlans = buildRegionalWildernessPlans(liveSnapshot);
        const desiredCountsByRegion = new Map();
        for (const plan of livePlans) {
          desiredCountsByRegion.set(
            plan.regionKey,
            (desiredCountsByRegion.get(plan.regionKey) ?? 0) + 1
          );
        }
        const desiredCount = desiredCountsByRegion.get(assignment.regionKey) ?? 0;
        const aliveInRegion = [];
        for (const [otherUsername, otherAssignment] of wildernessRegionalAssignments.entries()) {
          if (otherAssignment?.regionKey !== assignment.regionKey) {
            continue;
          }
          if (!entriesByUsername.has(otherUsername)) {
            continue;
          }
          const otherLiveRegionKey = getRegionKeyForLocation(
            entriesByUsername.get(otherUsername)?.player?.getLocation?.()
          );
          if (otherLiveRegionKey !== assignment.regionKey) {
            continue;
          }
          aliveInRegion.push(otherUsername);
        }
        aliveInRegion.sort((a, b) => a.localeCompare(b));
        const keep = new Set(aliveInRegion.slice(0, desiredCount));
        if (keep.has(username)) {
          wildernessRegionalPendingDespawn.delete(username);
          return;
        }
        wildernessRegionalPendingDespawn.delete(username);
        requestRegionalWildernessDespawn(username);
      }, WILDERNESS_REGION_DESPAWN_DELAY_MS);
      wildernessRegionalDespawnTimers.set(username, timer);
    };

    for (const [regionKey, usernames] of currentAssignedUsernamesByRegion.entries()) {
      const desiredCount = desiredCountsByRegion.get(regionKey) ?? 0;
      const sortedUsernames = usernames.slice().sort((a, b) => a.localeCompare(b));
      const keep = new Set(sortedUsernames.slice(0, desiredCount));
      for (const username of sortedUsernames) {
        if (keep.has(username)) {
          cancelRegionalDespawnTimer(username);
          continue;
        }
        scheduleRegionalDespawnTimer(username);
      }
    }

    const presentRegionalCountsByRegion = new Map();
    for (const regionKey of liveRegionalRegionKeys.values()) {
      presentRegionalCountsByRegion.set(
        regionKey,
        (presentRegionalCountsByRegion.get(regionKey) ?? 0) + 1
      );
    }

    const filledCountsByRegion = new Map();
    for (const [regionKey, presentCount] of presentRegionalCountsByRegion.entries()) {
      const desiredCount = desiredCountsByRegion.get(regionKey) ?? 0;
      filledCountsByRegion.set(regionKey, Math.min(presentCount, desiredCount));
    }

    const liveHotspotCount = Array.from(countLiveHotspotBotsByRegion().values()).reduce(
      (sum, count) => sum + count,
      0
    );
    const liveRegionalCount = liveRegionalRegionKeys.size;
    const desiredRegionalTotal = Array.from(desiredCountsByRegion.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    const currentSatisfiedRegionalTotal = Array.from(filledCountsByRegion.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    const regionalShortfall = Math.max(0, desiredRegionalTotal - currentSatisfiedRegionalTotal);
    const freeRegionalSlots = Math.max(
      0,
      wildernessRoamerBotCount - liveHotspotCount - liveRegionalCount
    );
    let immediateSlotsNeeded = Math.max(0, regionalShortfall - freeRegionalSlots);
    if (immediateSlotsNeeded > 0) {
      const immediateCandidates = [];
      for (const [regionKey, usernames] of currentAssignedUsernamesByRegion.entries()) {
        const desiredCount = desiredCountsByRegion.get(regionKey) ?? 0;
        const sortedUsernames = usernames.slice().sort((a, b) => a.localeCompare(b));
        const overflow = sortedUsernames.slice(desiredCount);
        for (const username of overflow) {
          immediateCandidates.push(username);
        }
      }
      for (const username of immediateCandidates) {
        if (immediateSlotsNeeded <= 0) {
          break;
        }
        cancelRegionalDespawnTimer(username);
        if (requestRegionalWildernessDespawn(username)) {
          immediateSlotsNeeded -= 1;
        }
      }
    }

    for (const plan of plans) {
      const filled = filledCountsByRegion.get(plan.regionKey) ?? 0;
      const desired = desiredCountsByRegion.get(plan.regionKey) ?? 0;
      if (filled >= desired) {
        continue;
      }
      if (!spawnRegionalWildernessBot(plan)) {
        continue;
      }
      filledCountsByRegion.set(plan.regionKey, filled + 1);
    }
  }

  function spawnConfiguredBots() {
    const spawnStartedAt = Date.now();
    const pendingSpawns = [];

    for (let i = 1; i <= botCount; i++) {
      const username = `PlayerBot${i}`;
      const pvpMetadata = buildRoamingPvpMetadata({
        excludeF2p: true,
      });
      const botSpawn = spawnLocationForIndex(spawn, spawnOffsets, i - 1);
      pendingSpawns.push(() => {
        const bot = createBotPlayer(username, botSpawn, { api: botApi });
        if (!bot) {
          return;
        }
        bot.setPlayerBot?.(true);
        bot.setAttribute?.(ATTR_SKIP_PERSISTENCE, false);
        setPersistentRespawnResolver(bot, null);

        const state = createInitialState(
          {
            x: botSpawn.getX(),
            y: botSpawn.getY(),
            z: botSpawn.getZ(),
          },
          behaviorMode
        );
        if (state?.autonomy) {
          state.autonomy.nextDecisionAt = spawnStartedAt;
          state.autonomy.nextModeValidationAt = spawnStartedAt;
        }
        if (state?.roaming) {
          state.roaming.nextWalkAt = spawnStartedAt;
        }
        assignPvpMetadata(state, { metadata: pvpMetadata });
        syncBotProfileAttribute(bot, state);
        applyForcedModeForDiagnosis(bot, state);
        botStatesByName.set(username, state);
        playerBotUsernames.add(username);

        addEntry(username, {
          player: bot,
          state,
          controller: createController(
            bot,
            botSpawn,
            0
          ),
        });
        emitPlayerLogin({
          player: bot,
          username,
        });
        spawned++;
      });
    }

    let spawnCursor = 0;
    const flushSpawnBatch = () => {
      const end = Math.min(
        spawnCursor + BOT_STARTUP_BATCH_SIZE,
        pendingSpawns.length
      );
      while (spawnCursor < end) {
        pendingSpawns[spawnCursor++]?.();
      }
      ensureBehaviorTaskStarted();
      if (spawnCursor < pendingSpawns.length) {
        setTimeout(flushSpawnBatch, BOT_STARTUP_BATCH_DELAY_MS);
        return;
      }
      const spawnSummary = {
        spawned,
        configured: botCount,
        wildernessRegionalPool: wildernessRoamerBotCount,
        wildernessRoamersAssigned,
      };
      botApi.log("spawn_complete", spawnSummary);
      if (typeof startupLogger === "function") {
        startupLogger(spawnSummary);
      }
      reconcilePersistentHotspotBots();
      reconcileRegionalWildernessBots();
    };

    flushSpawnBatch();
  }

  function scheduleInitialSpawn() {
    // Defer spawn until all plugins (including persistence provider) have registered.
    if (typeof onActiveRegionsUpdated === "function") {
      onActiveRegionsUpdated((snapshot) => {
        reconcileRegionalWildernessBots(snapshot);
      });
    }
    setTimeout(() => spawnConfiguredBots(), 0);
  }

  function createWildernessRoamerSpawn(baseSpawn, bounds, index) {
    if (!baseSpawn || !bounds) {
      return null;
    }
    const minX = Math.floor(bounds.minX);
    const maxX = Math.floor(bounds.maxX);
    const minY = Math.floor(bounds.minY);
    const maxY = Math.floor(bounds.maxY);
    const z = Math.floor(bounds.z ?? 0);
    if (maxX < minX || maxY < minY) {
      return null;
    }
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const totalTiles = width * height;
    if (totalTiles <= 0) {
      return null;
    }
    const seedBase =
      Math.imul(index + 1, 1103515245) ^
      Math.imul((bounds.id?.length ?? 7) + 37, 12345) ^
      Math.imul(minX + maxY + z, 2654435761);
    const startIndex = Math.abs(seedBase) % totalTiles;
    const rawStep = Math.abs(Math.imul(seedBase ^ 0x9e3779b9, 48271)) % totalTiles;
    const step = rawStep === 0 ? 1 : rawStep;
    const attempts = Math.min(totalTiles, WILDERNESS_SPAWN_TILE_PROBE_LIMIT);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const tileIndex = (startIndex + attempt * step) % totalTiles;
      const offsetX = tileIndex % width;
      const offsetY = Math.floor(tileIndex / width);
      const candidate = new Location(minX + offsetX, minY + offsetY, z);
      if (Wilderness.isInLocation(candidate) && isOutsideWildernessHotspots(candidate) && !RegionManager.blocked(candidate, null)) {
        return candidate;
      }
    }
    return null;
  }

  function reserveHotspotSpawnIndex(hotspotId) {
    const nextIndex = hotspotSpawnCounts.get(hotspotId) ?? 0;
    hotspotSpawnCounts.set(hotspotId, nextIndex + 1);
    return nextIndex;
  }

  function createHotspotSpawn(hotspotId, index) {
    const hotspot = getWildernessHotspot(hotspotId);
    const anchor = createHotspotAnchorLocation(hotspot);
    if (!anchor) {
      return null;
    }
    const area = hotspot?.area;
    if (!area) {
      return anchor;
    }
    const minX = Math.floor(area.minX);
    const maxX = Math.floor(area.maxX);
    const minY = Math.floor(area.minY);
    const maxY = Math.floor(area.maxY);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (width <= 0 || height <= 0) {
      return RegionManager.blocked(anchor, null) ? null : anchor;
    }
    const totalTiles = width * height;
    if (totalTiles <= 0) {
      return RegionManager.blocked(anchor, null) ? null : anchor;
    }
    const seedBase =
      Math.imul(index + 1, 1103515245) ^
      Math.imul(hotspotId.length + 17, 12345) ^
      Math.imul(minX + maxY + (anchor.getZ?.() ?? 0), 2654435761);
    const startIndex = Math.abs(seedBase) % totalTiles;
    const rawStep = Math.abs(Math.imul(seedBase ^ 0x9e3779b9, 48271)) % totalTiles;
    const step = rawStep === 0 ? 1 : rawStep;
    const z = Math.floor(area.z ?? anchor.getZ?.() ?? 0);
    const attempts = Math.min(totalTiles, WILDERNESS_SPAWN_TILE_PROBE_LIMIT);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const tileIndex = (startIndex + attempt * step) % totalTiles;
      const offsetX = tileIndex % width;
      const offsetY = Math.floor(tileIndex / width);
      const candidate = new Location(minX + offsetX, minY + offsetY, z);
      if (
        Wilderness.isInLocation(candidate) &&
        !RegionManager.blocked(candidate, null)
      ) {
        return candidate;
      }
    }
    if (Wilderness.isInLocation(anchor) && !RegionManager.blocked(anchor, null)) {
      return anchor.clone().setZ(z);
    }
    return null;
  }

  function enableControllerForPlayer(player) {
    if (!player || !player.isRegistered()) {
      return { ok: false, reason: "not_registered" };
    }

    const username = player.getUsername();
    if (!username) {
      return { ok: false, reason: "missing_username" };
    }
    if (hasControllerForUsername(username)) {
      return { ok: false, reason: "already_enabled" };
    }

    const location = player.getLocation();
    const state = createInitialState(
      {
        x: location.getX(),
        y: location.getY(),
        z: location.getZ(),
      },
      behaviorMode
    );
    assignPvpMetadata(state, {
    });
    syncBotProfileAttribute(player, state);
    applyForcedModeForDiagnosis(player, state);
    botStatesByName.set(username, state);
    botmeUsernames.add(username);
    player.setPlayerBot?.(true);
    addEntry(username, {
      player,
      state,
      controller: createController(player, location, 0),
    });
    resetMovementState(player);
    ensureBehaviorTaskStarted();
    return { ok: true };
  }

  function disableControllerForPlayer(player) {
    if (!player) {
      return false;
    }
    player.setPlayerBot?.(false);
    const username = player.getUsername();
    const state = username ? botStatesByName.get(username) : null;
    clearFollowState(player, state);
    if (username) {
      botStatesByName.delete(username);
      botmeUsernames.delete(username);
    }
    resetMovementState(player);
    return removeEntryByUsername(username);
  }

  function handleDisconnect(player, usernameInput) {
    const username = usernameInput ?? player?.getUsername?.();
    const removed = removeEntryByUsername(username);
    botStatesByName.delete(username);
    botmeUsernames.delete(username);
    playerBotUsernames.delete(username);
    wildernessHotspotAssignments.delete(username);
    wildernessRegionalAssignments.delete(username);
    const regionalDespawnTimer = wildernessRegionalDespawnTimers.get(username);
    if (regionalDespawnTimer) {
      clearTimeout(regionalDespawnTimer);
      wildernessRegionalDespawnTimers.delete(username);
    }
    wildernessRegionalPendingDespawn.delete(username);
    reconcilePersistentHotspotBots();
    reconcileRegionalWildernessBots();
    return removed;
  }

  return {
    botStatesByName,
    botmeUsernames,
    playerBotUsernames,
    entries,
    entriesByUsername,
    getSpawnedCount: () => spawned,
    hasControllerForUsername,
    hasControllerForPlayer,
    resolveControlledPlayer,
    spawnConfiguredBots,
    spawnPvpBot(location) {
      let username;
      do { username = `DevBot${++developerBotId}`; }
      while (entriesByUsername.has(username) || worldGetPlayerByName(username));
      return spawnWildernessBot({ username, spawnLocation: location });
    },
    scheduleInitialSpawn,
    enableControllerForPlayer,
    disableControllerForPlayer,
    handleDisconnect,
  };
}

module.exports = {
  createBotRegistry,
};
