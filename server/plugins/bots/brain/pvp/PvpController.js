const { Wilderness } = require("../../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const {
  canAttackByWildernessLevel,
} = require("../../../areas/Wilderness.plugin");
const { PrayerHandler } = require("../../../../src/main/typescript/elvarg/game/content/PrayerHandler");
const {
  CanAttackResponse,
} = require("../../../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { Location } = require("../../../../src/main/typescript/elvarg/game/model/Location");
const { Skill } = require("../../../../src/main/typescript/elvarg/game/model/Skill");
const {
  queueRouteAndFlagAppearance,
  randomInRange,
  peekMovementRequest,
} = require("../../behaviours/navigation/BotNavigation");
const { PvpCombatExecutionNode } = require("../../behaviours/nodes/pvp/PvpCombatExecutionNode");
const { PvpDefensiveActionNode } = require("../../behaviours/nodes/pvp/PvpDefensiveActionNode");
const { PvpFreezeAndKiteNode } = require("../../behaviours/nodes/pvp/PvpFreezeAndKiteNode");
const { PvpJumpKilledTargetNode } = require("../../behaviours/nodes/pvp/PvpJumpKilledTargetNode");
const { PvpVengeanceNode } = require("../../behaviours/nodes/pvp/PvpVengeanceNode");
const { ReplenishAfterKillNode } = require("../../behaviours/nodes/pvp/ReplenishAfterKillNode");
const { PvpValidateEngagementNode } = require("../../behaviours/nodes/pvp/PvpValidateEngagementNode");
const { applyGeneratedPvpLoadout } = require("../../behaviours/policies/PvpLoadoutPolicy");
const { pickPvpOpponent } = require("../../behaviours/policies/PvpTargetSelectionPolicy");
const {
  scheduleCombatAction,
  scheduleFreezeReview,
  scheduleSpecReview,
  scheduleReviewTimers,
} = require("../../behaviours/policies/PvpTimingPolicy");
const {
  maybeSwitchBackToPrimaryWeapon,
  maybeUseSpecialAttack,
} = require("../../behaviours/policies/PvpSpecialAttackPolicy");
const {
  initPvpPressureCombatPolicyCoreAccess,
  maybeRunPressureCombatScript,
} = require("../../behaviours/policies/PvpPressureCombatPolicy");
const {
  clearFollowState,
  isPvpOnlyBotState,
  resetMovementState,
  setModePvp,
  setModeRoaming,
} = require("../../behaviours/state/PlayerBotState");
const { resolveBotNodeContext } = require("../../behaviours/nodes/context/BotNodeContext");
const { EatFoodActionNode } = require("../../behaviours/nodes/actions/EatFoodActionNode");
const {
  MaintainCombatBoostsActionNode,
} = require("../../behaviours/nodes/actions/MaintainCombatBoostsActionNode");
const {
  getPvpProfile,
  getWildernessHotspot,
} = require("../../behaviours/pvp/PvpAssignment");
const {
  INDEX_TTL_MS,
  buildPvpSeekIndex,
  nearby,
  activeTargetCount,
  hotspotFightCount,
  trackEngagement,
} = require("./PvpSeekIndex");

const PVP_DURATION_DEFAULT_MIN_MS = 18000;
const PVP_DURATION_DEFAULT_MAX_MS = 50000;
const POST_PVP_DECISION_MIN_MS = 3500;
const POST_PVP_DECISION_MAX_MS = 9000;
const POST_PVP_COOLDOWN_MIN_MS = 35000;
const POST_PVP_COOLDOWN_MAX_MS = 110000;
const SEEK_RETRY_MIN_MS = 1200;
const SEEK_RETRY_MAX_MS = 3500;
const HOTSPOT_DECISION_JITTER_MS = 2600;
const HOTSPOT_DYNAMIC_DECISION_JITTER_MS = 4200;
const SEEKING_RESET_STAGGER_MIN_MS = 250;
const SEEKING_RESET_STAGGER_MAX_MS = 1800;
const HIGH_WILDNESS_AGGRESSION_LEVEL = 48;
const DEEP_WILD_FENCE_Y = 3904;
const DITCH_NON_WILD_STRIP_MIN_X = 2940;
const DITCH_NON_WILD_STRIP_MAX_X = 3392;
const DITCH_NON_WILD_STRIP_MIN_Y = 3523;
const DITCH_NON_WILD_STRIP_MAX_Y = 3524;
const DITCH_WILDERNESS_RETURN_Y = 3525;
const REAL_PLAYER_OPPONENT_VALIDATION_POOL_SIZE = 4;
const MULTI_REAL_PLAYER_ATTACKER_CAP = 2;

const PVP_PHASE = Object.freeze({
  IDLE: "idle",
  SEEKING: "seeking",
  COMBAT: "combat",
  DEAD: "dead",
});
const MANAGED_PVP_PRAYERS = Object.freeze([
  PrayerHandler.PROTECT_FROM_MAGIC,
  PrayerHandler.PROTECT_FROM_MISSILES,
  PrayerHandler.PROTECT_FROM_MELEE,
  PrayerHandler.PIETY,
  PrayerHandler.CHIVALRY,
  PrayerHandler.ULTIMATE_STRENGTH,
  PrayerHandler.RIGOUR,
  PrayerHandler.EAGLE_EYE,
  PrayerHandler.HAWK_EYE,
  PrayerHandler.SHARP_EYE,
  PrayerHandler.AUGURY,
  PrayerHandler.MYSTIC_MIGHT,
  PrayerHandler.MYSTIC_LORE,
  PrayerHandler.MYSTIC_WILL,
]);

function hashUsername(value) {
  const text = typeof value === "string" ? value : "";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function resolveHotspotCycleJitterMs(username, nowMs, spreadMs) {
  const safeSpreadMs = Math.max(1, Math.floor(spreadMs));
  const cycleSeed = Math.floor(Math.max(0, Number(nowMs) || 0) / 7000);
  return hashUsername(`${username}:${cycleSeed}`) % safeSpreadMs;
}

function isInDitchNonWildStrip(player) {
  const location = player?.getLocation?.();
  const x = location?.getX?.();
  const y = location?.getY?.();
  const z = location?.getZ?.();
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    z === 0 &&
    x >= DITCH_NON_WILD_STRIP_MIN_X &&
    x <= DITCH_NON_WILD_STRIP_MAX_X &&
    y >= DITCH_NON_WILD_STRIP_MIN_Y &&
    y <= DITCH_NON_WILD_STRIP_MAX_Y
  );
}

function chooseWalkableWildernessReturnTile(regionManager, player, state) {
  const location = player?.getLocation?.();
  if (!location) {
    return null;
  }
  const z = location.getZ?.();
  if (z !== 0) {
    return null;
  }
  const privateArea = player.getPrivateArea?.() ?? null;
  const roamBounds = state?.roaming?.roamBounds ?? null;
  if (
    roamBounds &&
    Number.isFinite(roamBounds.minX) &&
    Number.isFinite(roamBounds.maxX) &&
    Number.isFinite(roamBounds.minY) &&
    Number.isFinite(roamBounds.maxY)
  ) {
    const minX = Math.floor(roamBounds.minX);
    const maxX = Math.floor(roamBounds.maxX);
    const minY = Math.max(DITCH_WILDERNESS_RETURN_Y, Math.floor(roamBounds.minY));
    const maxY = Math.floor(roamBounds.maxY);
    if (maxX >= minX && maxY >= minY) {
      for (let attempt = 0; attempt < 64; attempt += 1) {
        const tile = new Location(
          randomInRange(minX, maxX),
          randomInRange(minY, maxY),
          z
        );
        if (!Wilderness.isInLocation(tile)) {
          continue;
        }
        if (regionManager.blocked(tile, privateArea)) {
          continue;
        }
        return { x: tile.getX(), y: tile.getY() };
      }
    }
  }

  const baseX = location.getX?.();
  if (!Number.isFinite(baseX)) {
    return null;
  }
  for (let dy = 0; dy <= 2; dy += 1) {
    const y = DITCH_WILDERNESS_RETURN_Y + dy;
    for (let dx = 0; dx <= 4; dx += 1) {
      const candidates = dx === 0 ? [baseX] : [baseX - dx, baseX + dx];
      for (const x of candidates) {
        const tile = new Location(x, y, z);
        if (!Wilderness.isInLocation(tile)) {
          continue;
        }
        if (regionManager.blocked(tile, privateArea)) {
          continue;
        }
        return { x, y };
      }
    }
  }
  return null;
}

class PvpController {
  constructor(botStatesByName, api, options) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.World = api.getWorld();
    this.CombatFactory = api.getCombatFactory();
    this.AreaManager = api.getAreaManager();
    this.ServerPerf = api.getServerPerf();
    initPvpPressureCombatPolicyCoreAccess(api);
    this.behaviorMode = options.behaviorMode;
    this.entrySource = null;
    this.seekIndex = null;
    this.seekIndexBuiltAt = 0;
    // Support nodes run before every brain action through tickSupport.
    this.eatFoodActionNode = new EatFoodActionNode(botStatesByName, api, {
      lowHpRatio: options.botEatLowHpRatio,
      minHeal: options.botEatHealMin,
      maxHeal: options.botEatHealMax,
      maxCharges: options.botEatMaxCharges,
    });
    this.maintainCombatBoostsActionNode = new MaintainCombatBoostsActionNode(
      botStatesByName
    );
    this.validateEngagementNode = new PvpValidateEngagementNode({
      api,
      behaviorMode: this.behaviorMode,
      setPhase: (state, phase) => this.setPhase(state, phase),
      stopPvp: (player, state, nowMs, reason) =>
        this.stopPvp(player, state, nowMs, reason),
      isPvpOnly: (state) => this.isPvpOnly(state),
      resetSeekingState: (player, state, nowMs, reason) =>
        this.resetSeekingState(player, state, nowMs, reason),
      resolveTargetPlayer: (state) => this.resolveTargetPlayer(state),
      isValidTarget: (player, target) => this.isValidTarget(player, target),
      isActivelyEngagedWithTarget: (player, target) =>
        this.isActivelyEngagedWithTarget(player, target),
      randomInRange,
      pvpPhase: PVP_PHASE,
    });
    this.defensiveActionNode = new PvpDefensiveActionNode({
      api,
      setPhase: (state, phase) => this.setPhase(state, phase),
      stopPvp: (player, state, nowMs, reason) =>
        this.stopPvp(player, state, nowMs, reason),
      getProfile: (state) => this.getProfile(state),
      pvpPhase: PVP_PHASE,
    });
    this.freezeAndKiteNode = new PvpFreezeAndKiteNode({
      setPhase: (state, phase) => this.setPhase(state, phase),
      getProfile: (state) => this.getProfile(state),
      scheduleCombatAction,
      scheduleFreezeReview,
      regionManager: this.api.getRegionManager(),
      pvpPhase: PVP_PHASE,
    });
    this.vengeanceNode = new PvpVengeanceNode({
      setPhase: (state, phase) => this.setPhase(state, phase),
      scheduleCombatAction,
      getProfile: (state) => this.getProfile(state),
      pvpPhase: PVP_PHASE,
    });
    this.jumpKilledTargetNode = new PvpJumpKilledTargetNode({
      setPhase: (state, phase) => this.setPhase(state, phase),
      resolveTargetPlayer: (state) => this.resolveTargetPlayer(state),
      isValidTarget: (player, target) => this.isValidTarget(player, target),
      setModePvp,
      scheduleCombatAction,
      scheduleReviewTimers,
      applyGeneratedPvpLoadout: (player, state) =>
        applyGeneratedPvpLoadout(player, state, { api: this.api }),
      randomInRange,
      pvpPhase: PVP_PHASE,
      behaviorMode: this.behaviorMode,
    });
    this.replenishAfterKillNode = new ReplenishAfterKillNode(botStatesByName, api);
    this.combatExecutionNode = new PvpCombatExecutionNode({
      api,
      setPhase: (state, phase) => this.setPhase(state, phase),
      maybeSwitchBackToPrimaryWeapon,
      maybeUseSpecialAttack,
      maybeRunPressureCombatScript,
      scheduleCombatAction,
      scheduleFreezeReview,
      scheduleSpecReview,
      scheduleReviewTimers,
      getProfile: (state) => this.getProfile(state),
      pvpPhase: PVP_PHASE,
    });
  }

  setPhase(state, phase) {
    if (!state?.pvp) {
      return;
    }
    state.pvp.phase = phase;
  }

  getProfile(state) {
    return getPvpProfile(state?.pvp?.profileId);
  }

  isPvpOnly(state) {
    return isPvpOnlyBotState(state);
  }

  getHotspotDecisionJitterMs(player) {
    const username = player?.getUsername?.() ?? "";
    return hashUsername(username) % HOTSPOT_DECISION_JITTER_MS;
  }

  getDynamicHotspotDecisionJitterMs(player, nowMs) {
    const username = player?.getUsername?.() ?? "";
    return (
      this.getHotspotDecisionJitterMs(player) +
      resolveHotspotCycleJitterMs(username, nowMs, HOTSPOT_DYNAMIC_DECISION_JITTER_MS)
    );
  }

  clearManagedPvpPrayers(player) {
    if (!player) {
      return;
    }
    const prayerHandler = this.api.getPrayerHandler();
    for (const prayerId of MANAGED_PVP_PRAYERS) {
      if (prayerHandler.isActivated(player, prayerId)) {
        prayerHandler.deactivatePrayer(player, prayerId);
      }
    }
  }

  isAcrossDeepWildFence(sourcePlayer, targetPlayer) {
    if (
      sourcePlayer?.isPlayerBot?.() !== true ||
      targetPlayer?.isPlayerBot?.() !== true
    ) {
      return false;
    }
    const sourceLoc = sourcePlayer.getLocation?.();
    const targetLoc = targetPlayer.getLocation?.();
    if (!sourceLoc || !targetLoc) {
      return false;
    }
    if (sourceLoc.getZ?.() !== targetLoc.getZ?.()) {
      return false;
    }
    const sourceY = sourceLoc.getY?.();
    const targetY = targetLoc.getY?.();
    if (!Number.isFinite(sourceY) || !Number.isFinite(targetY)) {
      return false;
    }
    const sourceNorth = sourceY >= DEEP_WILD_FENCE_Y;
    const targetNorth = targetY >= DEEP_WILD_FENCE_Y;
    return sourceNorth !== targetNorth;
  }

  resetSeekingState(player, state, nowMs, reason) {
    if (!player || !state) {
      return false;
    }
    if (!state.pvp) {
      return false;
    }
    this.setPhase(state, PVP_PHASE.SEEKING);
    state.pvp.targetUsername = null;
    state.pvp.targetPlayer = null;
    state.pvp.currentTargetScore = 0;
    state.pvp.targetLockUntil = 0;
    state.pvp.endsAt = 0;
    this.clearManagedPvpPrayers(player);
    player.getCombat?.()?.reset?.();
    player.setCombatFollowing?.(null);
    clearFollowState(player, state);
    player.setPositionToFace?.(null);
    state.pvp.nextActionAt =
      nowMs +
      randomInRange(SEEKING_RESET_STAGGER_MIN_MS, SEEKING_RESET_STAGGER_MAX_MS) +
      this.getDynamicHotspotDecisionJitterMs(player, nowMs);
    resetMovementState(player);
    if (state.autonomy) {
      state.autonomy.modeEndsAt = 0;
      state.autonomy.nextDecisionAt = Math.max(
        state.autonomy.nextDecisionAt ?? 0,
        state.pvp.nextActionAt
      );
    }
    this.api?.log?.("pvp_seeking_reset", {
      username: player.getUsername?.(),
      reason,
      profileId: state?.pvp?.profileId ?? "standard",
      hotspotId: state?.pvp?.hotspotId ?? null,
    });
    return true;
  }

  queueReturnToWildernessIfNeeded(player, state) {
    if (!this.isPvpOnly(state) || !isInDitchNonWildStrip(player)) {
      return false;
    }
    const returnTile = chooseWalkableWildernessReturnTile(
      this.api.getRegionManager(),
      player,
      state
    );
    if (!returnTile) {
      return false;
    }
    queueRouteAndFlagAppearance(player, returnTile.x, returnTile.y, {
      state,
      reason: "pvp_non_wild_strip_return",
    });
    this.setPhase(state, PVP_PHASE.SEEKING);
    return true;
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

  isAliveCombatEntity(entity) {
    return !!(
      entity &&
      entity.isRegistered?.() === true &&
      (entity.getHitpoints?.() ?? 0) > 0
    );
  }

  isSingleWayEngagement(player, target) {
    return !(
      this.AreaManager.inMulti(player) &&
      this.AreaManager.inMulti(target)
    );
  }

  isTargetOccupiedByOtherInSingleWay(player, target) {
    if (!player || !target) {
      return false;
    }
    if (!this.isSingleWayEngagement(player, target)) {
      return false;
    }
    const targetCombat = target.getCombat?.();
    const occupants = [
      targetCombat?.getTarget?.(),
      targetCombat?.getAttacker?.(),
      target.getCombatFollowing?.(),
    ];
    for (const occupant of occupants) {
      if (occupant === player) {
        continue;
      }
      if (this.isAliveCombatEntity(occupant)) {
        return true;
      }
    }
    return false;
  }

  isActivelyEngagedWithTarget(player, target) {
    if (!player || !target) {
      return false;
    }
    const playerCombat = player.getCombat?.();
    const targetCombat = target.getCombat?.();
    return !!(
      playerCombat?.getTarget?.() === target ||
      playerCombat?.getAttacker?.() === target ||
      player.getCombatFollowing?.() === target ||
      targetCombat?.getTarget?.() === player ||
      targetCombat?.getAttacker?.() === player ||
      target.getCombatFollowing?.() === player
    );
  }

  resolveHotspotEngagementDecision(player, state, nowMs) {
    if (this.isHighWildernessAggressionActive(player)) {
      return true;
    }
    if (!this.isPvpOnly(state)) {
      return true;
    }
    const hotspotId = state?.pvp?.hotspotId ?? null;
    const hotspot = hotspotId ? getWildernessHotspot(hotspotId) : null;
    const weights = hotspot?.activityWeights ?? null;
    if (!weights) {
      return true;
    }

    const seek = Math.max(0, Number(weights.seek ?? 0));
    const bait = Math.max(0, Number(weights.bait ?? 0));
    const fight = Math.max(0, Number(weights.fight ?? 0));
    const escape = Math.max(0, Number(weights.escape ?? 0));
    const total = seek + bait + fight + escape;
    if (total <= 0) {
      return true;
    }

    let roll = Math.random() * total;
    const pick = (label, weight) => {
      if (weight <= 0) {
        return false;
      }
      roll -= weight;
      return roll <= 0 ? label : false;
    };

    const activity =
      pick("seek", seek) ||
      pick("bait", bait) ||
      pick("fight", fight) ||
      "escape";
    if (activity === "fight" || activity === "seek") {
      return true;
    }

    const lingerBase = Math.max(4000, Number(hotspot?.lingerMs ?? 9000));
    const idleDelayByActivity = {
      seek: randomInRange(Math.floor(lingerBase * 0.8), Math.floor(lingerBase * 1.5)),
      bait: randomInRange(Math.floor(lingerBase * 1.0), Math.floor(lingerBase * 1.9)),
      escape: randomInRange(Math.floor(lingerBase * 1.1), Math.floor(lingerBase * 2.1)),
    };
    const nextDecisionAt =
      nowMs +
      (idleDelayByActivity[activity] ?? lingerBase) +
      this.getDynamicHotspotDecisionJitterMs(player, nowMs);
    if (!state.autonomy) {
      state.autonomy = {
        nextDecisionAt,
        modeEndsAt: 0,
        pvpCooldownUntil: 0,
        manualMode: null,
      };
    } else {
      state.autonomy.nextDecisionAt = Math.max(state.autonomy.nextDecisionAt ?? 0, nextDecisionAt);
    }
    this.setPhase(state, PVP_PHASE.SEEKING);
    return false;
  }

  getWildernessLevel(player) {
    if (!player) {
      return 0;
    }
    const resolved = Number(player.getWildernessLevel?.() ?? 0);
    if (Number.isFinite(resolved) && resolved > 0) {
      return Math.floor(resolved);
    }
    const location = player.getLocation?.();
    const x = Number(location?.getX?.() ?? Number.NaN);
    const y = Number(location?.getY?.() ?? Number.NaN);
    return Number.isFinite(x) && Number.isFinite(y) ? Wilderness.levelAt(x, y) : 0;
  }

  isHighWildernessAggressionActive(player) {
    return this.getWildernessLevel(player) >= HIGH_WILDNESS_AGGRESSION_LEVEL;
  }

  shouldPrioritizeRealPlayerAggro(sourcePlayer, targetPlayer) {
    return (
      this.isHighWildernessAggressionActive(sourcePlayer) ||
      this.isHighWildernessAggressionActive(targetPlayer)
    );
  }

  compareScoredCandidates(a, b) {
    if ((a?.score ?? Number.NEGATIVE_INFINITY) !== (b?.score ?? Number.NEGATIVE_INFINITY)) {
      return (b?.score ?? Number.NEGATIVE_INFINITY) - (a?.score ?? Number.NEGATIVE_INFINITY);
    }
    return (a?.distance ?? Number.POSITIVE_INFINITY) - (b?.distance ?? Number.POSITIVE_INFINITY);
  }

  insertTopScoredCandidate(pool, candidate, maxSize) {
    if (!candidate || !Array.isArray(pool) || maxSize <= 0) {
      return;
    }
    let insertAt = pool.length;
    while (insertAt > 0 && this.compareScoredCandidates(candidate, pool[insertAt - 1]) < 0) {
      insertAt -= 1;
    }
    pool.splice(insertAt, 0, candidate);
    if (pool.length > maxSize) {
      pool.length = maxSize;
    }
  }

  tryStartRealPlayerEngagement({
    sourcePlayer,
    sourceState,
    sourceAutonomy,
    targetPlayer,
    index,
    nowMs,
    durationMs,
    postPvpCooldownMinMs,
    postPvpCooldownMaxMs,
  }) {
    if (
      !sourcePlayer ||
      !sourceState ||
      !targetPlayer ||
      !setModePvp(
        sourcePlayer,
        sourceState,
        targetPlayer,
        nowMs,
        durationMs,
        this.behaviorMode
      )
    ) {
      return false;
    }

    if (sourceState?.pvp) {
      sourceState.pvp.phase = PVP_PHASE.COMBAT;
      scheduleCombatAction(sourceState, nowMs);
      scheduleReviewTimers(sourceState, nowMs);
    }

    applyGeneratedPvpLoadout(sourcePlayer, sourceState, {
      api: this.api,
    });

    if (sourceAutonomy) {
      sourceAutonomy.modeEndsAt = nowMs + durationMs;
      sourceAutonomy.pvpCooldownUntil =
        nowMs + durationMs + randomInRange(postPvpCooldownMinMs, postPvpCooldownMaxMs);
      sourceAutonomy.nextDecisionAt = nowMs + durationMs;
    }

    sourcePlayer.getMovementQueue?.().reset?.();
    sourcePlayer.getCombat?.()?.attack?.(targetPlayer);
    trackEngagement(
      index,
      sourcePlayer,
      sourceState,
      targetPlayer.getUsername?.() ?? null
    );
    this.api?.log?.("bot_pvp_started_real_player", {
      bot: sourcePlayer.getUsername?.(),
      target: targetPlayer.getUsername?.(),
      profileId: sourceState?.pvp?.profileId ?? "standard",
      hotspotId: sourceState?.pvp?.hotspotId ?? null,
      highWildAggro: this.shouldPrioritizeRealPlayerAggro(sourcePlayer, targetPlayer),
    });
    return true;
  }

  tryStartMode({
    entry,
    index,
    nowMs,
    pvpMinMs = PVP_DURATION_DEFAULT_MIN_MS,
    pvpMaxMs = PVP_DURATION_DEFAULT_MAX_MS,
    pvpMaxDistanceTiles = 16,
    postPvpCooldownMinMs = POST_PVP_COOLDOWN_MIN_MS,
    postPvpCooldownMaxMs = POST_PVP_COOLDOWN_MAX_MS,
  }) {
    const sourcePlayer = entry?.player;
    const sourceState = entry?.state;
    if (!sourcePlayer || !sourceState) {
      return false;
    }
    const pvpOnly = this.isPvpOnly(sourceState);
    if (
      sourceState.mode !== this.behaviorMode.ROAMING &&
      !(pvpOnly && sourceState.mode === this.behaviorMode.PVP)
    ) {
      return false;
    }
    if (!Wilderness.isIn(sourcePlayer)) {
      this.setPhase(sourceState, PVP_PHASE.IDLE);
      return false;
    }

    const sourceAutonomy = sourceState?.autonomy ?? null;
    if (!pvpOnly && nowMs < (sourceAutonomy?.pvpCooldownUntil ?? 0)) {
      return false;
    }
    this.setPhase(sourceState, PVP_PHASE.SEEKING);

    const isInCombatCheck = (candidate) => this.isInCombat(candidate);

    const realPlayerOpponent = this.ServerPerf.measurePhase(
      "bot.pvp.try_start.real_player_scan",
      () =>
        this.resolvePreferredRealPlayerOpponent({
          sourceEntry: entry,
          pvpMaxDistanceTiles,
          isInCombat: isInCombatCheck,
          index,
        })
    );
    if (
      realPlayerOpponent &&
      this.shouldPrioritizeRealPlayerAggro(sourcePlayer, realPlayerOpponent)
    ) {
      const durationMs = randomInRange(pvpMinMs, pvpMaxMs);
      if (this.tryStartRealPlayerEngagement({
        sourcePlayer,
        sourceState,
        sourceAutonomy,
        targetPlayer: realPlayerOpponent,
        index,
        nowMs,
        durationMs,
        postPvpCooldownMinMs,
        postPvpCooldownMaxMs,
      })) {
        return true;
      }
    }

    if (
      !this.ServerPerf.measurePhase("bot.pvp.try_start.hotspot_decision", () =>
        this.resolveHotspotEngagementDecision(sourcePlayer, sourceState, nowMs)
      )
    ) {
      return false;
    }

    const sourceHotspotId = sourceState?.pvp?.hotspotId ?? null;
    const sourceHotspot = sourceHotspotId ? getWildernessHotspot(sourceHotspotId) : null;
    const maxSimultaneousFights = Number(sourceHotspot?.maxSimultaneousFights ?? 0);
    if (maxSimultaneousFights > 0) {
      const activeFights = hotspotFightCount(index, sourceHotspotId);
      if (activeFights >= maxSimultaneousFights) {
        const lingerBase = Math.max(5000, Number(sourceHotspot?.lingerMs ?? 9000));
        const nextDecisionAt =
          nowMs +
          randomInRange(lingerBase, Math.floor(lingerBase * 2)) +
          this.getDynamicHotspotDecisionJitterMs(sourcePlayer, nowMs);
        if (!sourceState.autonomy) {
          sourceState.autonomy = {
            nextDecisionAt,
            modeEndsAt: 0,
            pvpCooldownUntil: 0,
            manualMode: null,
          };
        } else {
          sourceState.autonomy.nextDecisionAt = Math.max(
            sourceState.autonomy.nextDecisionAt ?? 0,
            nextDecisionAt
          );
        }
        return false;
      }
    }
    const opponentEntry = this.ServerPerf.measurePhase(
      "bot.pvp.try_start.bot_opponent_selection",
      () =>
        pickPvpOpponent({
          sourceEntry: entry,
          candidateEntries: nearby(index.botBuckets, sourcePlayer, pvpMaxDistanceTiles),
          index,
          nowMs,
          pvpMaxDistanceTiles,
          isInCombat: isInCombatCheck,
          isPvpCandidate: (options) => this.isPvpCandidate(options),
        })
    );
    if (!opponentEntry) {
      if (realPlayerOpponent) {
        const durationMs = randomInRange(pvpMinMs, pvpMaxMs);
        if (this.tryStartRealPlayerEngagement({
          sourcePlayer,
          sourceState,
          sourceAutonomy,
          targetPlayer: realPlayerOpponent,
          index,
          nowMs,
          durationMs,
          postPvpCooldownMinMs,
          postPvpCooldownMaxMs,
        })) {
          return true;
        }
      }
      return false;
    }

    const opponentPlayer = opponentEntry.player;
    const opponentState = opponentEntry.state;
    const opponentAutonomy = opponentState?.autonomy ?? null;
    const durationMs = randomInRange(pvpMinMs, pvpMaxMs);

    if (
      !setModePvp(
        sourcePlayer,
        sourceState,
        opponentPlayer,
        nowMs,
        durationMs,
        this.behaviorMode
      )
    ) {
      return false;
    }
    if (
      !setModePvp(
        opponentPlayer,
        opponentState,
        sourcePlayer,
        nowMs,
        durationMs,
        this.behaviorMode
      )
    ) {
      if (pvpOnly) {
        this.resetSeekingState(sourcePlayer, sourceState, nowMs, "pvp_pair_failed");
      } else {
        setModeRoaming(sourcePlayer, sourceState, this.behaviorMode);
      }
      return false;
    }

    if (sourceState?.pvp) {
      sourceState.pvp.phase = PVP_PHASE.COMBAT;
      scheduleCombatAction(sourceState, nowMs);
      scheduleReviewTimers(sourceState, nowMs);
    }
    if (opponentState?.pvp) {
      opponentState.pvp.phase = PVP_PHASE.COMBAT;
      scheduleCombatAction(opponentState, nowMs);
      scheduleReviewTimers(opponentState, nowMs);
    }
    trackEngagement(
      index,
      sourcePlayer,
      sourceState,
      opponentPlayer.getUsername?.() ?? null
    );
    trackEngagement(
      index,
      opponentPlayer,
      opponentState,
      sourcePlayer.getUsername?.() ?? null
    );

    applyGeneratedPvpLoadout(sourcePlayer, sourceState, {
      api: this.api,
    });
    applyGeneratedPvpLoadout(opponentPlayer, opponentState, {
      api: this.api,
    });

    // Mirror real-player engagements: immediately lock combat targets so bots
    // enter combat-follow instead of spending the initial action-delay window
    // in mutual generic-follow orbiting.
    sourcePlayer.getMovementQueue?.().reset?.();
    opponentPlayer.getMovementQueue?.().reset?.();
    sourcePlayer.getCombat?.()?.attack?.(opponentPlayer);
    opponentPlayer.getCombat?.()?.attack?.(sourcePlayer);

    if (sourceAutonomy) {
      sourceAutonomy.modeEndsAt = nowMs + durationMs;
    }
    if (opponentAutonomy) {
      opponentAutonomy.modeEndsAt = nowMs + durationMs;
    }

    const pvpCooldownUntil =
      nowMs + durationMs + randomInRange(postPvpCooldownMinMs, postPvpCooldownMaxMs);
    if (sourceAutonomy) {
      sourceAutonomy.pvpCooldownUntil = pvpCooldownUntil;
    }
    if (opponentAutonomy) {
      opponentAutonomy.pvpCooldownUntil = pvpCooldownUntil;
    }

    if (sourceAutonomy) {
      sourceAutonomy.nextDecisionAt = nowMs + durationMs;
    }
    if (opponentAutonomy) {
      opponentAutonomy.nextDecisionAt = nowMs + durationMs;
    }

    this.api?.log?.("bot_pvp_started", {
      a: sourcePlayer.getUsername?.(),
      b: opponentPlayer.getUsername?.(),
      durationMs,
      aProfileId: sourceState?.pvp?.profileId ?? "standard",
      aHotspotId: sourceState?.pvp?.hotspotId ?? null,
      bProfileId: opponentState?.pvp?.profileId ?? "standard",
      bHotspotId: opponentState?.pvp?.hotspotId ?? null,
    });
    return true;
  }

  isPvpCandidate({ sourceEntry, candidateEntry, index, nowMs, isInCombat }) {
    if (!sourceEntry || !candidateEntry || sourceEntry === candidateEntry) {
      return false;
    }
    const sourcePlayer = sourceEntry.player;
    const sourceState = sourceEntry.state;
    const candidatePlayer = candidateEntry.player;
    const candidateState = candidateEntry.state;
    if (!sourcePlayer || !sourceState || !candidatePlayer || !candidateState) {
      return false;
    }
    if (this.isAcrossDeepWildFence(sourcePlayer, candidatePlayer)) {
      return false;
    }
    if (!candidatePlayer.isRegistered?.()) {
      return false;
    }
    if ((candidatePlayer.getHitpoints?.() ?? 0) <= 0) {
      return false;
    }
    if (!Wilderness.isIn(candidatePlayer)) {
      return false;
    }
    // Out of combat level range for this depth of Wilderness: the attack would be refused,
    // so drop the candidate here rather than pathing to it for a tick and finding out.
    if (!canAttackByWildernessLevel(sourcePlayer, candidatePlayer)) {
      return false;
    }
    if (sourcePlayer.getPrivateArea?.() !== candidatePlayer.getPrivateArea?.()) {
      return false;
    }
    if (
      sourcePlayer.getLocation?.().getZ?.() !== candidatePlayer.getLocation?.().getZ?.()
    ) {
      return false;
    }
    if (
      !(
        candidateState.mode === this.behaviorMode.ROAMING ||
        (this.isPvpOnly(candidateState) &&
          candidateState.mode === this.behaviorMode.PVP &&
          !candidateState?.pvp?.targetUsername)
      ) ||
      (candidateState.mode === this.behaviorMode.PVP && !this.isPvpOnly(candidateState))
    ) {
      return false;
    }
    const isMultiEngagement = !this.isSingleWayEngagement(sourcePlayer, candidatePlayer);
    if (this.isTargetOccupiedByOtherInSingleWay(sourcePlayer, candidatePlayer)) {
      return false;
    }
    if (!isMultiEngagement && typeof isInCombat === "function" && isInCombat(candidatePlayer)) {
      return false;
    }
    if (nowMs < (candidateState?.autonomy?.pvpCooldownUntil ?? 0)) {
      return false;
    }

    const sourceUsername = sourcePlayer.getUsername?.();
    const candidateUsername = candidatePlayer.getUsername?.();
    if (
      !isMultiEngagement &&
      activeTargetCount(index, candidateUsername, sourceUsername) > 0
    ) {
      return false;
    }
    return true;
  }

  resolvePreferredRealPlayerOpponent({
    sourceEntry,
    pvpMaxDistanceTiles,
    isInCombat,
    index,
  }) {
    const sourcePlayer = sourceEntry?.player;
    const sourceState = sourceEntry?.state;
    if (!sourcePlayer || !sourceState) {
      return null;
    }

    const sourceProfile = this.getProfile(sourceState);
    const sourceMethod = this.CombatFactory.getMethod(sourcePlayer);
    const sourceUsername = sourcePlayer.getUsername?.() ?? null;
    const topCandidates = [];
    nearby(index.realPlayerBuckets, sourcePlayer, pvpMaxDistanceTiles).forEach((candidatePlayer) => {
      if (!candidatePlayer || candidatePlayer === sourcePlayer) {
        return;
      }
      if (candidatePlayer.isPlayerBot?.() === true) {
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
      if (!Wilderness.isIn(candidatePlayer)) {
        return;
      }
      if (!canAttackByWildernessLevel(sourcePlayer, candidatePlayer)) {
        return;
      }
      if (sourcePlayer.getPrivateArea?.() !== candidatePlayer.getPrivateArea?.()) {
        return;
      }
      if (
        sourcePlayer.getLocation?.().getZ?.() !== candidatePlayer.getLocation?.().getZ?.()
      ) {
        return;
      }

      const distance = sourcePlayer.getLocation().getDistance(candidatePlayer.getLocation());
      if (distance > pvpMaxDistanceTiles) {
        return;
      }
      const isMultiEngagement =
        !this.isSingleWayEngagement(sourcePlayer, candidatePlayer);
      const candidateUsername = candidatePlayer.getUsername?.() ?? null;
      const activeTargeters = activeTargetCount(index, candidateUsername, sourceUsername);
      if (!isMultiEngagement && activeTargeters > 0) {
        return;
      }
      if (this.isTargetOccupiedByOtherInSingleWay(sourcePlayer, candidatePlayer)) {
        return;
      }
      if (!isMultiEngagement && typeof isInCombat === "function" && isInCombat(candidatePlayer)) {
        return;
      }
      if (isMultiEngagement && activeTargeters >= MULTI_REAL_PLAYER_ATTACKER_CAP) {
        return;
      }

      let score = 220 - distance * 5;
      if (this.shouldPrioritizeRealPlayerAggro(sourcePlayer, candidatePlayer)) {
        score += 1000;
      }
      if (distance <= sourceProfile.chaseDistanceTiles) {
        score += 18;
      }
      if (candidatePlayer.getCombat?.().getTarget?.() === sourcePlayer) {
        score += 40;
      }
      if (isMultiEngagement) {
        score += Math.max(0, 20 - activeTargeters * 12);
      }

      this.insertTopScoredCandidate(
        topCandidates,
        {
          player: candidatePlayer,
          score,
          distance,
        },
        REAL_PLAYER_OPPONENT_VALIDATION_POOL_SIZE
      );
    });

    for (const candidate of topCandidates) {
      if (
        this.CombatFactory.canAttackPermission(sourcePlayer, candidate.player, false, sourceMethod) ===
        CanAttackResponse.CAN_ATTACK
      ) {
        return candidate.player;
      }
    }

    return null;
  }

  resolveTargetPlayer(state) {
    const pvp = state?.pvp;
    if (!pvp?.targetUsername) {
      return null;
    }

    const cachedTarget = pvp.targetPlayer;
    if (
      cachedTarget &&
      cachedTarget.isRegistered?.() === true &&
      cachedTarget.getUsername?.() === pvp.targetUsername
    ) {
      return cachedTarget;
    }

    const resolved = this.World.getPlayerByName(pvp.targetUsername);
    pvp.targetPlayer = resolved ?? null;
    return resolved ?? null;
  }

  /**
   * Boosts, retreat/defensive and food, run before every brain action. Returns
   * { skip: true } when one of them took the turn, so the action waits.
   */
  tickSupport({ player, state, nowMs }) {
    const base = { player, state, nowMs };
    // Boosts and defensive only apply to pvp-mode bots (their own contracts
    // gate that); eating applies to every brain activity.
    if (this.maintainCombatBoostsActionNode.tick({ ...base }) !== "failure") {
      return { skip: true };
    }
    const resolved = resolveBotNodeContext(base, this.botStatesByName, {
      requireNotInCombat: false,
      requireNotBusy: false,
    });
    if (resolved && resolved.state?.mode === this.behaviorMode.PVP) {
      const defensive = this.defensiveActionNode.tick({
        ...resolved,
        target: this.resolveTargetPlayer(resolved.state),
      });
      if (defensive.handled) {
        if (resolved.state?.pvp?.retreat && !resolved.player.isTeleportingReturn?.()) {
          this.eatFoodActionNode.tick({ ...base });
        }
        return { skip: true };
      }
    }
    if (this.eatFoodActionNode.tick({ ...base }) !== "failure") {
      return { skip: true };
    }
    return { skip: false };
  }

  tick(context) {
    const resolved = this.ServerPerf.measurePhase("bot.pvp.tick.resolve_context", () =>
      resolveBotNodeContext(context, this.botStatesByName, {
        requiredMode: this.behaviorMode.PVP,
        requireNotInCombat: false,
        requireNotBusy: false,
      })
    );
    if (!resolved) {
      return "failure";
    }

    const { player, state, nowMs } = resolved;

    const replenish = this.ServerPerf.measurePhase("bot.pvp.tick.replenish", () =>
      this.replenishAfterKillNode.tick({
        player,
        state,
        nowMs,
      })
    );
    if (replenish?.handled) {
      return replenish.status ?? "failure";
    }

    const jump = this.ServerPerf.measurePhase("bot.pvp.tick.jump", () =>
      this.jumpKilledTargetNode.tick({
        player,
        state,
        nowMs,
        pvpMinMs: PVP_DURATION_DEFAULT_MIN_MS,
        pvpMaxMs: PVP_DURATION_DEFAULT_MAX_MS,
      })
    );
    if (jump?.handled) {
      return jump.status ?? "failure";
    }

    const validation = this.ServerPerf.measurePhase("bot.pvp.tick.validate", () =>
      this.validateEngagementNode.tick({
        player,
        state,
        nowMs,
      })
    );
    if (validation?.handled) {
      return validation.status ?? "failure";
    }

    const target = validation?.target ?? null;
    // Establish combat before support actions can consume this decision.
    if (target && player.getCombat().getTarget() !== target &&
        this.CombatFactory.canAttackPermission(player, target, false,
          this.CombatFactory.getMethod(player)) === CanAttackResponse.CAN_ATTACK) {
      player.getCombat().attack(target);
    }
    const freeze = this.ServerPerf.measurePhase("bot.pvp.tick.freeze", () =>
      this.freezeAndKiteNode.tick({
        player,
        state,
        nowMs,
        target,
      })
    );
    if (freeze?.handled) {
      return freeze.status ?? "failure";
    }

    this.ServerPerf.measurePhase("bot.pvp.tick.vengeance", () =>
      this.vengeanceNode.tick({
        player,
        state,
        nowMs,
        target,
      })
    );
    const combatStatus = this.ServerPerf.measurePhase("bot.pvp.tick.combat_execution", () =>
      this.combatExecutionNode.tick({
        player,
        state,
        nowMs,
        target,
      })
    );
    this.freezeAndKiteNode.maybeMoveBetweenHits(player, state, target, this.getProfile(state), nowMs);
    return combatStatus;
  }

  isValidTarget(player, target) {
    if (!player || !target || target === player) {
      return false;
    }
    if (this.isAcrossDeepWildFence(player, target)) {
      return false;
    }
    if (!target.isRegistered?.()) {
      return false;
    }
    if ((player.getHitpoints?.() ?? 0) <= 0 || (target.getHitpoints?.() ?? 0) <= 0) {
      return false;
    }
    if (player.getPrivateArea?.() !== target.getPrivateArea?.()) {
      return false;
    }
    return true;
  }

  stopPvp(player, state, nowMs, reason) {
    if (this.isPvpOnly(state)) {
      return this.resetSeekingState(player, state, nowMs, reason);
    }
    this.setPhase(state, reason === "dead" ? PVP_PHASE.DEAD : PVP_PHASE.IDLE);
    resetMovementState(player);
    this.clearManagedPvpPrayers(player);
    setModeRoaming(player, state, this.behaviorMode);

    if (state?.autonomy) {
      state.autonomy.modeEndsAt = 0;
      state.autonomy.pvpCooldownUntil = Math.max(
        state.autonomy.pvpCooldownUntil ?? 0,
        nowMs + randomInRange(POST_PVP_COOLDOWN_MIN_MS, POST_PVP_COOLDOWN_MAX_MS)
      );
      state.autonomy.nextDecisionAt =
        nowMs + randomInRange(POST_PVP_DECISION_MIN_MS, POST_PVP_DECISION_MAX_MS);
    }

    this.api?.log?.("pvp_stopped", {
      username: player.getUsername?.(),
      reason,
      profileId: state?.pvp?.profileId ?? "standard",
      hotspotId: state?.pvp?.hotspotId ?? null,
    });
  }

  setEntrySource(source) {
    this.entrySource = typeof source === "function" ? source : null;
  }

  getEntries() {
    return this.entrySource?.() ?? [];
  }

  /** One shared index per game tick instead of a world scan per seeking bot. */
  getSeekIndex() {
    const now = Date.now();
    if (!this.seekIndex || now - this.seekIndexBuiltAt >= INDEX_TTL_MS) {
      this.seekIndex = buildPvpSeekIndex({
        entries: this.getEntries(),
        world: this.World,
        pvpMode: this.behaviorMode.PVP,
        isInCombat: (player) => this.isInCombat(player),
      });
      this.seekIndexBuiltAt = now;
    }
    return this.seekIndex;
  }

  /**
   * Target selection. Throttled through state.pvp.nextActionAt so a bot with no
   * candidate does not rescan every tick.
   */
  seek({ player, state, nowMs }) {
    // Pvp-only bots stranded on the non-wild ditch strip walk back in first.
    if (this.queueReturnToWildernessIfNeeded(player, state)) {
      return false;
    }
    const index = this.getSeekIndex();
    // Candidates are compared by entry identity, so the source must be the
    // canonical runtime entry or the bot can pick itself.
    const entry = index.entryByPlayer.get(player) ?? { player, state };
    const started = this.tryStartMode({ entry, index, nowMs });
    if (!started && state?.pvp) {
      if (process.env.BOT_BRAIN_DEBUG === "1") {
        this.logSeekMiss({ entry, index, nowMs });
      }
      state.pvp.nextActionAt = nowMs + randomInRange(SEEK_RETRY_MIN_MS, SEEK_RETRY_MAX_MS);
    }
    return started;
  }

  wanderWhileSeeking({ player, state, nowMs }) {
    if (!this.isPvpOnly(state) || this.isInCombat(player) || state?.pvp?.retreat ||
        player.isTeleportingReturn?.() || player.busy?.() || player.getForceMovement?.() ||
        player.getMovementQueue?.()?.size?.() > 0 || peekMovementRequest(player)) {
      return false;
    }
    const roaming = state.roaming;
    const bounds = roaming?.roamBounds;
    if (!bounds || nowMs < Number(roaming.nextWalkAt ?? 0)) return false;
    roaming.nextWalkAt = nowMs + randomInRange(3500, 9000);
    const location = player.getLocation();
    const hotspot = getWildernessHotspot(state.pvp.hotspotId);
    const radius = hotspot?.roamRadius ?? 6;
    const centerX = Math.max(bounds.minX, Math.min(bounds.maxX, location.getX()));
    const centerY = Math.max(bounds.minY, Math.min(bounds.maxY, location.getY()));
    const regionManager = this.api.getRegionManager();
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const x = randomInRange(Math.max(bounds.minX, centerX - radius),
        Math.min(bounds.maxX, centerX + radius));
      const y = randomInRange(Math.max(bounds.minY, centerY - radius),
        Math.min(bounds.maxY, centerY + radius));
      const tile = new Location(x, y, bounds.z ?? location.getZ());
      if (x === location.getX() && y === location.getY()) continue;
      if (!Wilderness.isInLocation(tile) || regionManager.blocked(tile, player.getPrivateArea?.() ?? null) ||
          regionManager.isWater(tile)) continue;
      const occupied = this.getEntries().some((entry) => {
        const other = entry.player?.getLocation?.();
        return other?.getX() === x && other?.getY() === y && other?.getZ() === tile.getZ();
      });
      if (occupied) continue;
      return queueRouteAndFlagAppearance(player, x, y, {
        state, nowMs, reason: "pvp_idle_wander",
      });
    }
    return false;
  }

  /** PvP-only bots respawn through the registry resolver; re-gear them once healthy. */
  ensureLoadout(player, state) {
    if (!state?.pvp) {
      return false;
    }
    if ((player.getHitpoints?.() ?? 0) <= 0 || player.isDyingReturn?.() === true) {
      return false;
    }
    const hasInventory = player
      .getInventory?.()
      .getItems?.()
      .some((item) => item?.getId?.() > 0);
    const hasEquipment = player
      .getEquipment?.()
      .getItems?.()
      .some((item) => item?.getId?.() > 0);
    if (hasInventory || hasEquipment) {
      return false;
    }
    const applied = applyGeneratedPvpLoadout(player, state, { api: this.api });
    if (applied) {
      state.pvp.loadoutPending = false;
    }
    return applied;
  }

  /** BOT_BRAIN_DEBUG=1: why a seek found no fight, without guessing from logs. */
  logSeekMiss({ entry, index, nowMs }) {
    const player = entry.player;
    const location = player.getLocation?.();
    const nearbyEntries = nearby(index.botBuckets, player, 16).filter(
      (candidate) =>
        candidate !== entry &&
        candidate?.player?.getLocation &&
        location &&
        location.getDistance(candidate.player.getLocation()) <= 16
    );
    const passing = nearbyEntries.filter(
      (candidate) =>
        this.isPvpCandidate?.({
          sourceEntry: entry,
          candidateEntry: candidate,
          index,
          nowMs,
          isInCombat: null,
        }) === true
    ).length;
    this.api?.log?.("bot_brain_pvp_seek_miss", {
      username: player.getUsername?.(),
      mode: entry.state?.mode ?? null,
      phase: entry.state?.pvp?.phase ?? null,
      pvpOnly: isPvpOnlyBotState(entry.state),
      wild: Wilderness.isIn(player),
      nearby: nearbyEntries.length,
      passing,
      nextInMs: Math.max(0, Math.floor(Number(entry.state?.pvp?.nextActionAt ?? 0) - nowMs)),
    });
  }
}

module.exports = {
  PvpController,
  PVP_DURATION_DEFAULT_MIN_MS,
  PVP_DURATION_DEFAULT_MAX_MS,
  POST_PVP_COOLDOWN_MIN_MS,
  POST_PVP_COOLDOWN_MAX_MS,
};
