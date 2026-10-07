const { GameConstants } = require("../../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../../src/main/typescript/elvarg/util/Misc");
const { createTraversalAssist } = require("../lib/TraversalAssist");
const { randomInRange, peekMovementRequest } = require("../behaviours/navigation/BotNavigation");
const {
  createSpawnOffsets,
  spawnLocationForIndex,
} = require("../behaviours/spawn/BotSpawnLayout");
const { createBotPlayer } = require("../behaviours/spawn/BotPlayerFactory");
const {
  clearFollowState,
  createInitialState,
  resetMovementState,
} = require("../behaviours/state/PlayerBotState");
const { BotBehaviorTask } = require("../behaviours/task/BotBehaviorTask");
const { AvengeOpponentPolicy } = require("../behaviours/policies/AvengeOpponentPolicy");
const { PvpJumpOnKillPolicy } = require("../behaviours/policies/PvpJumpOnKillPolicy");
const { createBotRegistry } = require("./BotRegistry");
const { createBotTickMetrics } = require("./BotTickMetrics");
const { createBotActivityRegistry } = require("../brain/BotActivityRegistry");
const { PvpController } = require("../brain/pvp/PvpController");
const { configureBrainActivities, startActivity } = require("../brain/BrainActivities");
const { registerBrainProgressEvents } = require("../brain/BotBrainEvents");
const { listCatalogObjectIds } = require("../brain/BotObjectCatalog");
const { BANK_BOOTH_IDS } = require("../lib/BankBooths");
const Woodcutting = require("../../skills/Woodcutting.plugin");
const Mining = require("../../skills/Mining.plugin");
const Firemaking = require("../../skills/Firemaking.plugin");
const Smithing = require("../../skills/Smithing.plugin");
const { BotStatusReporter } = require("./BotStatusReporter");
const { FlashHintArrowTask } = require("./FlashHintArrowTask");
const { listPvpProfiles } = require("../behaviours/pvp/PvpProfileRegistry");
const { listPvpLoadouts } = require("../behaviours/pvp/PvpLoadoutRegistry");
const {
  listWildernessHotspots,
} = require("../behaviours/pvp/WildernessHotspotRegistry");
const { assignPvpMetadata } = require("../behaviours/pvp/PvpAssignment");
const {
  buildHotspotPvpMetadata,
  buildRoamingPvpMetadata,
} = require("../behaviours/pvp/PvpAssignment");
const {
  applyGeneratedPvpLoadout,
} = require("../behaviours/policies/PvpLoadoutPolicy");

function bootPlayerBotsRuntime(options = {}) {
  const api = options.api;
  const botApi = options.botApi ?? api;
  const TaskManager = botApi.getTaskManager();
  const World = botApi.getWorld();
  const config = options.config ?? {};
  const tickMetrics = createBotTickMetrics(config.tickMetrics ?? {});
  const behaviorMode = config.behaviorMode;
  const recentBotLogsByUsername = options.recentBotLogsByUsername ?? new Map();
  const runtimeEventLoggingEnabled = config.logging?.runtimeEventLoggingEnabled === true;
  const statusRecentLogLines = Number.isFinite(config.status?.recentLogLines)
    ? Math.max(1, Math.floor(config.status.recentLogLines))
    : 8;

  const spawn = GameConstants.DEFAULT_LOCATION.clone();
  const botStatesByName = new Map();
  const botmeUsernames = new Set();
  const playerBotUsernames = new Set();
  const entries = [];
  const entriesByUsername = new Map();
  const traversalAssist = createTraversalAssist(botApi, {
    objectIds: [config.wildernessDitchObjectId],
    cachePath: config.objectIndexCachePath,
  });

  const brainWorld = {
    objectSearch: traversalAssist,
    regionManager: botApi.getRegionManager(),
    areaManager: botApi.getAreaManager(),
    getPlayerByName: (name) => World.getPlayerByName(name),
    ditch: {
      objectId: config.wildernessDitchObjectId,
      attemptCooldownMs: config.ditchAttemptCooldownMs,
      postCrossDelayMs: config.ditchPostCrossRetryDelayMs,
      roamMaxDistanceY: config.roamingDitchCrossMaxDistanceY,
    },
    emitObjectInteraction: (event) => botApi.emitObjectInteraction(event),
    isBusy: (player) =>
      Woodcutting.isWoodcuttingActive?.(player) === true ||
      Mining.isMiningActive?.(player) === true ||
      Firemaking.isFiremakingActive?.(player) === true ||
      Smithing.isSmeltingActive?.(player) === true,
    log: (message, extra) => botApi.log(message, extra),
  };

  // One pvp engine for the brain activities and reactive overlays.
  const pvpController = new PvpController(botStatesByName, botApi, {
    behaviorMode,
    ...(config.eatOptions ?? {}),
  });
  pvpController.setEntrySource(() => entries);
  brainWorld.pvpController = pvpController;
  brainWorld.supportTick = ({ player, state, nowMs }) =>
    pvpController.tickSupport({ player, state, nowMs });
  // Every bot runs on the brain, so a broken bot-activities.json must fail boot
  // loudly rather than leave the whole population standing still.
  const brainRegistry = createBotActivityRegistry({ api: botApi, world: brainWorld });

  traversalAssist.trackObjectIds([
    config.wildernessDitchObjectId,
    ...listCatalogObjectIds(),
    ...BANK_BOOTH_IDS,
  ]);
  // A valid dump loads here, before regions load; a missing/stale one is scanned and
  // rewritten once core startup has initialized regions.
  traversalAssist.initializePersistentIndex();
  traversalAssist.schedulePersistentIndexInitialization(0);

  const pvpJumpOnKillPolicy = new PvpJumpOnKillPolicy({
    botStatesByName,
    api: botApi,
    behaviorMode,
    config: config.pvp ?? {},
  });
  const avengeOpponentPolicy = new AvengeOpponentPolicy({
    botStatesByName,
    api: botApi,
    behaviorMode,
    config: config.pvp ?? {},
  });

  const spawnOffsets = createSpawnOffsets(
    config.botCount,
    config.botSpawnRadius,
    config.botSpawnMinDistance,
    config.botSpawnMaxAttempts
  );

  let runtime = null;
  let behaviorTaskStarted = false;

  const ensureBehaviorTaskStarted = () => {
    if (behaviorTaskStarted || !runtime || runtime.entries.length === 0) {
      return;
    }
    TaskManager.submit(
      new BotBehaviorTask(runtime.entries, config.botDecisionTicks, {
        api: botApi,
        behaviorMode,
        idleEntryStride: config.idleEntryStride,
        timingDesyncMs: config.timingDesyncMs,
        lodConfig: config.lodConfig,
        taskProfiler: config.taskProfiler,
        tickMetrics,
        executionBudget: config.executionBudget,
      })
    );
    behaviorTaskStarted = true;
  };

  runtime = createBotRegistry({
    botApi,
    botCount: config.botCount,
    wildernessRoamerBotCount: config.wildernessRoamerBotCount,
    wildernessActiveRegionBotsPerRegion: config.wildernessActiveRegionBotsPerRegion,
    wildernessActiveRegionInset: config.wildernessActiveRegionInset,
    botBaseCooldownMs: config.botBaseCooldownMs,
    spawn,
    spawnOffsets,
    behaviorMode,
    createBotPlayer,
    spawnLocationForIndex,
    createInitialState,
    buildHotspotPvpMetadata: (meta) =>
      buildHotspotPvpMetadata({
        ...meta,
        config,
      }),
    buildRoamingPvpMetadata: (meta) =>
      buildRoamingPvpMetadata({
        ...meta,
        config,
      }),
    assignPvpMetadata: (state, meta) =>
      assignPvpMetadata(state, {
        ...meta,
        config,
      }),
    applyInitialPvpLoadout: (player, state) =>
      applyGeneratedPvpLoadout(player, state, {
        api: botApi,
      }),
    ensureBehaviorTaskStarted,
    // ::botme drives a real player through the roam brain.
    attachAssistantBrain: ({ player, state }) =>
      startActivity(player, "roam", { home: state?.home ?? null }),
    attachWildernessBrain: ({ bot, state }) => {
      const attached = startActivity(bot, "pvp", { home: state?.home ?? null });
      if (attached) {
        botApi.log("bot_wilderness_brain_attached", {
          username: bot.getUsername?.(),
          hotspotId: state?.pvp?.hotspotId ?? null,
        });
      }
      return attached;
    },
    emitPlayerLogin: (event) => botApi.emitPlayerLogin(event),
    worldGetPlayerByName: (name) => World.getPlayerByName(name),
    formatText: (value) => Misc.formatText(value),
    resetMovementState,
    clearFollowState,
    randomInRange,
    startupLogger: (summary) => {
      api?.log?.("bot_startup_spawned", summary);
    },
    onActiveRegionsUpdated: (handler) => api?.onActiveRegionsUpdated?.(handler),
    getActiveRegionSnapshot: () => api?.getActiveRegionSnapshot?.(),
    botStatesByName,
    botmeUsernames,
    playerBotUsernames,
    entries,
    entriesByUsername,
  });

  registerBrainProgressEvents({ api, runtime });
  configureBrainActivities({
    runtime,
    registry: brainRegistry,
    world: brainWorld,
    resetMovementState,
  });

  const botStatusReporter = new BotStatusReporter({
    api: botApi,
    botStatesByName,
    recentBotLogsByUsername,
    runtimeEventLoggingEnabled,
    recentLogLines: statusRecentLogLines,
    diagnoseLogPath: config.status?.diagnoseLogPath,
    peekMovementRequest,
  });

  runtime.scheduleInitialSpawn();

  return {
    runtime,
    avengeOpponentPolicy,
    pvpJumpOnKillPolicy,
    botStatusReporter,
    tickMetrics,
    brainRegistry,
    brainWorld,
    flashHintArrowTaskFactory: (player, target) =>
      new FlashHintArrowTask(player, target),
    pvpCatalogs: {
      profiles: listPvpProfiles(),
      loadouts: listPvpLoadouts(),
      hotspots: listWildernessHotspots(),
    },
  };
}

module.exports = {
  bootPlayerBotsRuntime,
};
