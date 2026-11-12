const { GameConstants } = require("../../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../../src/main/typescript/elvarg/util/Misc");
const { createTraversalAssist } = require("../lib/TraversalAssist.PlayerBots");
const { randomInRange, peekMovementRequest } = require("../behaviours/navigation/Navigation.PlayerBots");
const {
  createSpawnOffsets,
  spawnLocationForIndex,
} = require("../behaviours/spawn/SpawnLayout.PlayerBots");
const { createBotPlayer } = require("../behaviours/spawn/PlayerFactory.PlayerBots");
const {
  clearFollowState,
  createInitialState,
  resetMovementState,
} = require("../behaviours/state/State.PlayerBots");
const { BotBehaviorTask } = require("../behaviours/task/BehaviorTask.PlayerBots");
const { AvengeOpponentPolicy } = require("../behaviours/policies/AvengeOpponentPolicy.PlayerBots");
const { PvpJumpOnKillPolicy } = require("../behaviours/policies/PvpJumpOnKillPolicy.PlayerBots");
const { createBotRegistry } = require("./Registry.PlayerBots");
const { createBotTickMetrics } = require("./TickMetrics.PlayerBots");
const { createBotActivityRegistry } = require("../brain/ActivityRegistry.PlayerBots");
const { PvpController } = require("../brain/pvp/PvpController.PlayerBots");
const { configureBrainActivities, startActivity } = require("../brain/BrainActivities.PlayerBots");
const { registerBrainProgressEvents } = require("../brain/BrainEvents.PlayerBots");
const { listCatalogObjectIds } = require("../brain/ObjectCatalog.PlayerBots");
const { BANK_BOOTH_IDS } = require("../lib/BankBooths.PlayerBots");
const Woodcutting = require("../../skills/Woodcutting.plugin");
const Mining = require("../../skills/Mining.plugin");
const Fishing = require("../../skills/Fishing.plugin");
const Cooking = require("../../skills/Cooking.plugin");
const Firemaking = require("../../skills/Firemaking.plugin");
const Smithing = require("../../skills/Smithing.plugin");
const { BotStatusReporter } = require("./StatusReporter.PlayerBots");
const { FlashHintArrowTask } = require("./FlashHintArrowTask.PlayerBots");
const { listPvpProfiles } = require("../behaviours/pvp/PvpProfileRegistry.PlayerBots");
const { listPvpLoadouts } = require("../behaviours/pvp/PvpLoadoutRegistry.PlayerBots");
const {
  listWildernessHotspots,
} = require("../behaviours/pvp/WildernessHotspotRegistry.PlayerBots");
const { assignPvpMetadata } = require("../behaviours/pvp/PvpAssignment.PlayerBots");
const {
  buildHotspotPvpMetadata,
  buildRoamingPvpMetadata,
} = require("../behaviours/pvp/PvpAssignment.PlayerBots");
const {
  applyGeneratedPvpLoadout,
} = require("../behaviours/policies/PvpLoadoutPolicy.PlayerBots");

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

  const faceTarget = (event) => {
    const target = event?.object?.getLocation?.() ?? event?.npc?.getLocation?.();
    if (!target) {
      return;
    }
    const player = event.player;
    // forcePositionToFace: after a walk the field can already hold the target while
    // the client shows the walk direction, and setPositionToFace short-circuits on
    // the same coordinates - which left bots chopping without facing their tree.
    if (typeof player?.forcePositionToFace === "function") {
      player.forcePositionToFace(target);
    } else {
      player?.setPositionToFace?.(target);
    }
  };
  const brainWorld = {
    core: botApi.core,
    refreshEquipment: (player) => botApi.getBonusManager().update(player),
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
    // Face what is used, as the click handlers do for players (ObjectActionPacketListener,
    // NPCOptionPacketListener): bots skip those packets, so trees and rocks went unfaced.
    emitObjectInteraction: (event) => {
      faceTarget(event);
      return botApi.emitObjectInteraction(event);
    },
    emitNpcInteraction: (event) => {
      faceTarget(event);
      return botApi.emitNpcInteraction(event);
    },
    emitItemOnObject: (event) => {
      faceTarget(event);
      return botApi.emitItemOnObject(event);
    },
    isBusy: (player) =>
      Fishing.isFishingActive?.(player) === true ||
      Cooking.isCookingActive?.(player) === true ||
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
    wildernessActiveRegionBotsByRegion: config.wildernessActiveRegionBotsByRegion,
    wildernessActiveRegionInset: config.wildernessActiveRegionInset,
    // Asked as PvP bots come and go, once every plugin has registered: a world that has no place
    // for them (a Hardcore World) answers `bots:pvp-allowed` { allowed: false }.
    pvpAllowed: () => {
      const query = { allowed: true };
      api.emitCustomEvent("bots:pvp-allowed", query);
      return query.allowed !== false;
    },
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
    onPlayerMapSquareChange: (handler) => api?.onPlayerMapSquareChange?.(handler),
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
