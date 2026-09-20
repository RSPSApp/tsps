const { GameConstants } = require("../../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../../src/main/typescript/elvarg/util/Misc");
const { BotController } = require("../../../src/main/typescript/elvarg/game/bot/BehaviorTree");
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
  isPvpOnlyBotState,
  resetMovementState,
} = require("../behaviours/state/PlayerBotState");
const {
  PlayerBotBehaviorTreeFactory,
} = require("../behaviours/branches/PlayerBotBehaviorTreeFactory");
const { BotBehaviorTask } = require("../behaviours/task/BotBehaviorTask");
const { DitchTraversalService } = require("../behaviours/traversal/DitchTraversalService");
const { PathBlockedHandler } = require("../behaviours/traversal/PathBlockedHandler");
const { FollowBackTrigger } = require("../behaviours/handlers/FollowBackTrigger");
const { CombatReactionTrigger } = require("../behaviours/handlers/CombatReactionTrigger");
const { NpcAggroPolicyHandler } = require("../behaviours/handlers/NpcAggroPolicyHandler");
const { AvengeOpponentPolicy } = require("../behaviours/policies/AvengeOpponentPolicy");
const { PvpJumpOnKillPolicy } = require("../behaviours/policies/PvpJumpOnKillPolicy");
const {
  validateModeHandlerContracts,
  callModeHook,
} = require("../behaviours/hooks/ModeHookContract");
const {
  createModeHandlers,
  buildModeRegistries,
} = require("../behaviours/factory/BotModeFactory");
const { FollowBackModeHandler } = require("../behaviours/modes/FollowBackModeHandler");
const { ReturnHomeModeHandler } = require("../behaviours/modes/ReturnHomeModeHandler");
const { createBotRegistry } = require("./BotRegistry");
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

function collectTrackedObjectIdsFromModes({ modeHandlers, api }) {
  const objectIds = new Set();
  for (const mode of Object.keys(modeHandlers ?? {})) {
    const ids = callModeHook({
      modeHandlers,
      mode,
      hookName: "collectTrackedObjectIds",
      payload: {},
      fallback: [],
      api,
      errorEvent: "bot_mode_collect_tracked_object_ids_error",
    });
    if (!Array.isArray(ids)) {
      continue;
    }
    for (const objectId of ids) {
      if (Number.isFinite(objectId)) {
        objectIds.add(objectId);
      }
    }
  }
  return objectIds;
}

function bootPlayerBotsRuntime(options = {}) {
  const api = options.api;
  const botApi = options.botApi ?? api;
  const TaskManager = botApi.getTaskManager();
  const World = botApi.getWorld();
  const config = options.config ?? {};
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
  const modeHandlers = {};
  const traversalAssist = createTraversalAssist(botApi, {
    objectIds: [config.wildernessDitchObjectId],
    cachePath: config.objectIndexCachePath,
  });

  const { requiredHooksByMode } = createModeHandlers({
    botStatesByName,
    api: botApi,
    behaviorMode,
    modeHandlers,
    objectSearch: traversalAssist,
    options: config.modeBehaviorOptions ?? {},
  });
  modeHandlers[behaviorMode.FOLLOW_BACK] = new FollowBackModeHandler({
    api: botApi,
    behaviorMode,
    followBlockedRetryMs: config.followBlockedRetryMs,
  });
  modeHandlers[behaviorMode.RETURN_HOME] = new ReturnHomeModeHandler();

  const modeRegistries = buildModeRegistries(behaviorMode);
  validateModeHandlerContracts(
    modeHandlers,
    requiredHooksByMode,
    botApi,
    "player_bots_mode_handlers"
  );

  const trackedTraversalObjectIds = new Set([config.wildernessDitchObjectId]);
  for (const objectId of collectTrackedObjectIdsFromModes({
    modeHandlers,
    api: botApi,
  })) {
    trackedTraversalObjectIds.add(objectId);
  }
  traversalAssist.trackObjectIds([...trackedTraversalObjectIds]);
  // Defer index initialization until after core startup has initialized regions.
  traversalAssist.schedulePersistentIndexInitialization(0);

  const traversalService = new DitchTraversalService({
    api: botApi,
    traversalAssist,
    objectId: config.wildernessDitchObjectId,
    emitObjectInteraction: (interaction) =>
      botApi.emitObjectInteraction(interaction),
    options: {
      behaviorMode,
      modeHandlers,
      roamingDitchCrossMaxDistanceY: config.roamingDitchCrossMaxDistanceY,
      ditchAttemptCooldownMs: config.ditchAttemptCooldownMs,
      ditchPostCrossRetryDelayMs: config.ditchPostCrossRetryDelayMs,
      ditchTransitionTimeoutMs: config.ditchTransitionTimeoutMs,
    },
  });

  const treeFactory = new PlayerBotBehaviorTreeFactory(botStatesByName, botApi, {
    behaviorMode,
    ...(config.treeOptions ?? {}),
    modeHandlers,
    traversalService,
  });

  const pathBlockedHandler = new PathBlockedHandler({
    botStatesByName,
    traversalService,
    api: botApi,
    modeHandlers,
    options: {
      blockedRetargetMinDelayMs: config.blockedRetargetMinDelayMs,
      blockedRetargetMaxDelayMs: config.blockedRetargetMaxDelayMs,
      duplicateEventWindowMs: config.pathBlockedDuplicateEventWindowMs,
      minHandleIntervalMs: config.pathBlockedHandleMinIntervalMs,
      meaningfulRecheckMs: config.pathBlockedMeaningfulRecheckMs,
      maxRepeatBeforeBackoff: config.pathBlockedMaxRepeatBeforeBackoff,
      backoffBaseMs: config.pathBlockedBackoffBaseMs,
      backoffMaxMs: config.pathBlockedBackoffMaxMs,
      ignoredModes: config.pathBlockedIgnoredModes,
    },
  });
  const npcAggroPolicyHandler = new NpcAggroPolicyHandler({
    botStatesByName,
    modeHandlers,
    api: botApi,
    options: {
      npcAggroBlockedModes: config.npcAggroBlockedModes,
    },
  });
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
  const randomizedCooldownMs = () =>
    config.botBaseCooldownMs + randomInRange(-config.botJitterMs, config.botJitterMs);
  const createController = (player, location, initialDelayMs) =>
    new BotController(
      player,
      location.getX(),
      location.getY(),
      location.getZ(),
      treeFactory.create(randomizedCooldownMs(), initialDelayMs)
    );

  const ensureBehaviorTaskStarted = () => {
    if (behaviorTaskStarted || !runtime || runtime.entries.length === 0) {
      return;
    }
    TaskManager.submit(
      new BotBehaviorTask(runtime.entries, traversalService, config.botDecisionTicks, {
        api: botApi,
        behaviorMode,
        modeHandlers,
        decisionDelayMinMs: config.autoModeDecisionMinMs,
        decisionDelayMaxMs: config.autoModeDecisionMaxMs,
        autonomousModes: modeRegistries.autonomousModes,
        transientModes: [
          behaviorMode.FOLLOW_BACK,
          behaviorMode.RETURN_HOME,
          behaviorMode.BANK_RUN,
        ],
        modeStopParamsByMode: modeRegistries.modeStopParamsByMode,
        npcAggroPolicyHandler,
        modeValidationIntervalMs: config.modeValidationIntervalMs,
        idleEntryStride: config.idleEntryStride,
        timingDesyncMs: config.timingDesyncMs,
        lodConfig: config.lodConfig,
        taskProfiler: config.taskProfiler,
        executionBudget: config.executionBudget,
        handlePersistentPvpRespawn: (entry, nowMs) => {
          const player = entry?.player;
          const state = entry?.state;
          if (!player || !state?.pvp) {
            return false;
          }
          if (isPvpOnlyBotState(state)) {
            // PlayerDeath already uses the registry's assigned respawn resolver.
            const hotspotId = state.pvp.hotspotId;
            const nextMetadata = hotspotId
              ? buildHotspotPvpMetadata({ config, hotspotId })
              : buildRoamingPvpMetadata({ config, excludeF2p: true });
            assignPvpMetadata(state, {
              config,
              metadata: nextMetadata,
            });
          }
          state.pvp.targetUsername = null;
          state.pvp.targetPlayer = null;
          state.pvp.currentTargetScore = 0;
          state.pvp.targetLockUntil = 0;
          state.pvp.endsAt = 0;
          player.getCombat?.().reset?.();
          player.getCombat?.().setUnderAttack?.(null);
          player.setFollowing?.(null);
          player.setCombatFollowing?.(null);
          player.setMobileInteraction?.(null);
          player.setPositionToFace?.(null);
          player.getMovementQueue?.().reset?.();
          state.pvp.nextActionAt = nowMs + randomInRange(3500, 7000);
          state.pvp.phase = "seeking";

          const loadoutApplied = applyGeneratedPvpLoadout(player, state, {
            api: botApi,
          });

          botApi.log("persistent_pvp_respawn_reset", {
            username: player.getUsername?.(),
            hotspotId: state.pvp.hotspotId ?? null,
            loadoutId: state.pvp.loadoutId ?? null,
          });
          return loadoutApplied;
        },
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
    createController,
    ensureBehaviorTaskStarted,
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

  const botStatusReporter = new BotStatusReporter({
    api: botApi,
    botStatesByName,
    recentBotLogsByUsername,
    runtimeEventLoggingEnabled,
    recentLogLines: statusRecentLogLines,
    diagnoseLogPath: config.status?.diagnoseLogPath,
    peekMovementRequest,
  });

  const followBackTrigger = new FollowBackTrigger({
    botStatesByName: runtime.botStatesByName,
    playerBotUsernames: runtime.playerBotUsernames,
    modeHandlers,
    api: botApi,
    options: {
      behaviorMode,
      botStatusReporter,
    },
  });
  const combatReactionTrigger = new CombatReactionTrigger({
    botStatesByName: runtime.botStatesByName,
    playerBotUsernames: runtime.playerBotUsernames,
    modeHandlers,
    api: botApi,
    options: {
      behaviorMode,
      followBackDurationMs: config.followBackDurationMs,
      playerRunAwayChance: config.playerAttackFleeChance,
    },
  });

  for (const [mode, handler] of Object.entries(modeHandlers)) {
    if (typeof handler?.registerEvents !== "function") {
      continue;
    }
    try {
      handler.registerEvents({
        api,
        botApi,
        runtime,
        behaviorMode,
      });
    } catch (err) {
      botApi.log("bot_mode_register_events_error", {
        mode,
        error: String(err?.message ?? err),
      });
    }
  }

  runtime.scheduleInitialSpawn();

  return {
    runtime,
    modeHandlers,
    modeRegistries,
    pathBlockedHandler,
    npcAggroPolicyHandler,
    avengeOpponentPolicy,
    pvpJumpOnKillPolicy,
    followBackTrigger,
    combatReactionTrigger,
    botStatusReporter,
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
