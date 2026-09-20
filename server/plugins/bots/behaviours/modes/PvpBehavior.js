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
} = require("../navigation/BotNavigation");
const { PvpCombatExecutionNode } = require("../nodes/pvp/PvpCombatExecutionNode");
const { PvpDefensiveActionNode } = require("../nodes/pvp/PvpDefensiveActionNode");
const { PvpFreezeAndKiteNode } = require("../nodes/pvp/PvpFreezeAndKiteNode");
const { PvpJumpKilledTargetNode } = require("../nodes/pvp/PvpJumpKilledTargetNode");
const { PvpVengeanceNode } = require("../nodes/pvp/PvpVengeanceNode");
const { ReplenishAfterKillNode } = require("../nodes/pvp/ReplenishAfterKillNode");
const { PvpValidateEngagementNode } = require("../nodes/pvp/PvpValidateEngagementNode");
const {
  handlePlayerAttackReaction,
} = require("../policies/PlayerAttackReactionPolicy");
const { applyGeneratedPvpLoadout } = require("../policies/PvpLoadoutPolicy");
const { pickPvpOpponent } = require("../policies/PvpTargetSelectionPolicy");
const {
  scheduleCombatAction,
  scheduleFreezeReview,
  scheduleSpecReview,
  scheduleReviewTimers,
} = require("../policies/PvpTimingPolicy");
const {
  maybeSwitchBackToPrimaryWeapon,
  maybeUseSpecialAttack,
} = require("../policies/PvpSpecialAttackPolicy");
const {
  initPvpPressureCombatPolicyCoreAccess,
  maybeRunPressureCombatScript,
} = require("../policies/PvpPressureCombatPolicy");
const {
  clearFollowState,
  isPvpOnlyBotState,
  resetMovementState,
  setModePvp,
  setModeRoaming,
} = require("../state/PlayerBotState");
const { resolveBotNodeContext } = require("../nodes/context/BotNodeContext");
const {
  getPvpProfile,
  getWildernessHotspot,
} = require("../pvp/PvpAssignment");

const PVP_DURATION_DEFAULT_MIN_MS = 18000;
const PVP_DURATION_DEFAULT_MAX_MS = 50000;
const POST_PVP_DECISION_MIN_MS = 3500;
const POST_PVP_DECISION_MAX_MS = 9000;
const POST_PVP_COOLDOWN_MIN_MS = 35000;
const POST_PVP_COOLDOWN_MAX_MS = 110000;
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

function getSpatialBucketKey(x, y, z, chunkSize) {
  return `${z}:${Math.floor(x / chunkSize)}:${Math.floor(y / chunkSize)}`;
}

function getTileOccupancyKey(location) {
  return `${location.getZ?.()}:${location.getX?.()}:${location.getY?.()}`;
}

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

class PvpBehavior {
  constructor(botStatesByName, api, options) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.World = api.getWorld();
    this.CombatFactory = api.getCombatFactory();
    this.AreaManager = api.getAreaManager();
    this.ServerPerf = api.getServerPerf();
    initPvpPressureCombatPolicyCoreAccess(api);
    this.behaviorMode = options.behaviorMode;
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

  handleBlocked() {
    // PvP movement/combat loop handles its own recovery.
    return true;
  }

  onPlayerAttackReaction(payload) {
    return handlePlayerAttackReaction({
      ...payload,
      behaviorMode: this.behaviorMode,
      api: this.api,
    });
  }

  setPhase(state, phase) {
    if (!state?.pvp) {
      return;
    }
    state.pvp.phase = phase;
  }

  appendStatusLines({ lines, state, nowMs, helpers = {} }) {
    if (!Array.isArray(lines) || !state?.pvp) {
      return;
    }
    const msRemainingLabel = helpers?.msRemainingLabel ?? (() => "n/a");
    lines.push(
      `pvp phase=${state.pvp.phase ?? PVP_PHASE.IDLE} target=${
        state.pvp.targetUsername ?? "n/a"
      } ends=${msRemainingLabel(state.pvp.endsAt, nowMs)} profile=${
        state.pvp.profileId ?? "standard"
      } loadout=${state.pvp.loadoutId ?? "edge_main_melee"} hotspot=${
        state.pvp.hotspotId ?? "none"
      }`
    );
  }

  getModeLogContext(state) {
    return {
      phase: state?.pvp?.phase ?? PVP_PHASE.IDLE,
      targetUsername: state?.pvp?.targetUsername ?? null,
      profileId: state?.pvp?.profileId ?? "standard",
      loadoutId: state?.pvp?.loadoutId ?? "edge_main_melee",
      hotspotId: state?.pvp?.hotspotId ?? null,
    };
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

  behaviorRequirementsMet({ player, state, nowMs }) {
    if (!player || !state) {
      return false;
    }
    const pvpOnly = this.isPvpOnly(state);
    if (
      state.mode !== this.behaviorMode.ROAMING &&
      !(pvpOnly && state.mode === this.behaviorMode.PVP)
    ) {
      return false;
    }
    if (this.queueReturnToWildernessIfNeeded(player, state)) {
      return false;
    }
    if (!Wilderness.isIn(player)) {
      this.setPhase(state, PVP_PHASE.IDLE);
      return false;
    }

    this.setPhase(state, PVP_PHASE.SEEKING);
    const pvpCooldownUntil = Number(state?.autonomy?.pvpCooldownUntil ?? 0);
    if (!pvpOnly && Number.isInteger(nowMs) && nowMs < pvpCooldownUntil) {
      return false;
    }
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

  countActiveHotspotFights(entries, hotspotId, pvpIndex = null) {
    if (pvpIndex?.activeHotspotCombatCounts instanceof Map) {
      return Math.floor((pvpIndex.activeHotspotCombatCounts.get(hotspotId) ?? 0) / 2);
    }
    if (!Array.isArray(entries) || !hotspotId) {
      return 0;
    }
    let engagedBots = 0;
    for (const candidate of entries) {
      const candidateState = candidate?.state;
      const candidatePlayer = candidate?.player;
      if (!candidateState || !candidatePlayer) {
        continue;
      }
      if ((candidateState?.pvp?.hotspotId ?? null) !== hotspotId) {
        continue;
      }
      if (candidateState.mode !== this.behaviorMode.PVP) {
        continue;
      }
      if (candidateState?.pvp?.phase !== PVP_PHASE.COMBAT) {
        continue;
      }
      if (!this.isInCombat(candidatePlayer)) {
        continue;
      }
      engagedBots += 1;
    }
    return Math.floor(engagedBots / 2);
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

  trackActivePvpTarget(pvpIndex, player, targetUsername) {
    if (
      !(pvpIndex?.activePvpTargetCounts instanceof Map) ||
      !(pvpIndex?.activePvpTargetByUsername instanceof Map) ||
      !targetUsername
    ) {
      return;
    }
    const username = player?.getUsername?.() ?? null;
    if (!username) {
      return;
    }
    const previousTargetUsername = pvpIndex.activePvpTargetByUsername.get(username) ?? null;
    if (previousTargetUsername === targetUsername) {
      return;
    }
    if (previousTargetUsername) {
      const previousCount = Number(
        pvpIndex.activePvpTargetCounts.get(previousTargetUsername) ?? 0
      );
      if (previousCount <= 1) {
        pvpIndex.activePvpTargetCounts.delete(previousTargetUsername);
      } else {
        pvpIndex.activePvpTargetCounts.set(previousTargetUsername, previousCount - 1);
      }
    }
    pvpIndex.activePvpTargetByUsername.set(username, targetUsername);
    pvpIndex.activePvpTargetCounts.set(
      targetUsername,
      Number(pvpIndex.activePvpTargetCounts.get(targetUsername) ?? 0) + 1
    );
  }

  trackHotspotCombatEntry(pvpIndex, hotspotId) {
    if (!(pvpIndex?.activeHotspotCombatCounts instanceof Map) || !hotspotId) {
      return;
    }
    pvpIndex.activeHotspotCombatCounts.set(
      hotspotId,
      Number(pvpIndex.activeHotspotCombatCounts.get(hotspotId) ?? 0) + 1
    );
  }

  trackPvpIndexEngagement(pvpIndex, player, state, targetUsername) {
    if (!pvpIndex || !player || !state || !targetUsername) {
      return;
    }
    this.trackActivePvpTarget(pvpIndex, player, targetUsername);
    this.trackHotspotCombatEntry(pvpIndex, state?.pvp?.hotspotId ?? null);
  }

  tryStartRealPlayerEngagement({
    sourcePlayer,
    sourceState,
    sourceAutonomy,
    targetPlayer,
    pvpIndex,
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
    this.trackPvpIndexEngagement(
      pvpIndex,
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
    entries,
    sharedCycleState,
    nowMs,
    pvpMinMs = PVP_DURATION_DEFAULT_MIN_MS,
    pvpMaxMs = PVP_DURATION_DEFAULT_MAX_MS,
    pvpMaxDistanceTiles = 16,
    postPvpCooldownMinMs = POST_PVP_COOLDOWN_MIN_MS,
    postPvpCooldownMaxMs = POST_PVP_COOLDOWN_MAX_MS,
    scheduleNextDecision,
    startRoaming,
    isInCombat,
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

    const isInCombatCheck =
      typeof isInCombat === "function"
        ? isInCombat
        : (candidate) => this.isInCombat(candidate);

    const realPlayerOpponent = this.ServerPerf.measurePhase(
      "bot.pvp.try_start.real_player_scan",
      () =>
        this.resolvePreferredRealPlayerOpponent({
          sourceEntry: entry,
          pvpMaxDistanceTiles,
          isInCombat: isInCombatCheck,
          pvpIndex: sharedCycleState?.pvpIndex ?? null,
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
        pvpIndex: sharedCycleState?.pvpIndex ?? null,
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
      const activeFights = this.countActiveHotspotFights(
        entries,
        sourceHotspotId,
        sharedCycleState?.pvpIndex ?? null
      );
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
          entries,
          candidateEntries: this.getNearbyIndexedBotEntries(
            sharedCycleState?.pvpIndex ?? null,
            sourcePlayer,
            pvpMaxDistanceTiles
          ),
          pvpIndex: sharedCycleState?.pvpIndex ?? null,
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
          pvpIndex: sharedCycleState?.pvpIndex ?? null,
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
      } else if (typeof startRoaming === "function") {
        startRoaming(entry, nowMs, "pvp_pair_failed");
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
    this.trackPvpIndexEngagement(
      sharedCycleState?.pvpIndex ?? null,
      sourcePlayer,
      sourceState,
      opponentPlayer.getUsername?.() ?? null
    );
    this.trackPvpIndexEngagement(
      sharedCycleState?.pvpIndex ?? null,
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

    if (typeof scheduleNextDecision === "function") {
      scheduleNextDecision(sourceState, nowMs + durationMs);
      scheduleNextDecision(opponentState, nowMs + durationMs);
    } else {
      if (sourceAutonomy) {
        sourceAutonomy.nextDecisionAt = nowMs + durationMs;
      }
      if (opponentAutonomy) {
        opponentAutonomy.nextDecisionAt = nowMs + durationMs;
      }
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

  stopMode({
    entry,
    nowMs,
    reason,
    postPvpCooldownMinMs = POST_PVP_COOLDOWN_MIN_MS,
    postPvpCooldownMaxMs = POST_PVP_COOLDOWN_MAX_MS,
    startRoaming,
  }) {
    const player = entry?.player;
    const state = entry?.state;
    if (!player || !state) {
      return false;
    }

    if (this.isPvpOnly(state)) {
      const reset = this.resetSeekingState(player, state, nowMs, reason);
      this.queueReturnToWildernessIfNeeded(player, state);
      return reset;
    }

    this.setPhase(state, PVP_PHASE.IDLE);
    if (!state.autonomy) {
      state.autonomy = {
        nextDecisionAt: 0,
        modeEndsAt: 0,
        pvpCooldownUntil: 0,
        manualMode: null,
      };
    }
    state.autonomy.pvpCooldownUntil = Math.max(
      state.autonomy.pvpCooldownUntil ?? 0,
      nowMs + randomInRange(postPvpCooldownMinMs, postPvpCooldownMaxMs)
    );

    if (typeof startRoaming === "function") {
      startRoaming(entry, nowMs, reason);
    } else {
      setModeRoaming(player, state, this.behaviorMode);
    }
    return true;
  }

  getNearbyIndexedValues(bucketMap, sourcePlayer, maxDistanceTiles, chunkSizeTiles) {
    if (
      !(bucketMap instanceof Map) ||
      !sourcePlayer ||
      !Number.isFinite(maxDistanceTiles) ||
      maxDistanceTiles < 0 ||
      !Number.isFinite(chunkSizeTiles) ||
      chunkSizeTiles <= 0
    ) {
      return null;
    }
    const location = sourcePlayer.getLocation?.();
    const x = location?.getX?.();
    const y = location?.getY?.();
    const z = location?.getZ?.();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    const radius = Math.max(1, Math.ceil(maxDistanceTiles / chunkSizeTiles));
    const originChunkX = Math.floor(x / chunkSizeTiles);
    const originChunkY = Math.floor(y / chunkSizeTiles);
    const values = [];
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const key = getSpatialBucketKey(
          (originChunkX + dx) * chunkSizeTiles,
          (originChunkY + dy) * chunkSizeTiles,
          z,
          chunkSizeTiles
        );
        const bucket = bucketMap.get(key);
        if (!bucket?.length) {
          continue;
        }
        values.push(...bucket);
      }
    }
    return values;
  }

  getNearbyIndexedBotEntries(pvpIndex, sourcePlayer, maxDistanceTiles) {
    return this.getNearbyIndexedValues(
      pvpIndex?.botBuckets ?? null,
      sourcePlayer,
      maxDistanceTiles,
      Number(pvpIndex?.chunkSizeTiles ?? 0)
    );
  }

  getNearbyIndexedRealPlayers(pvpIndex, sourcePlayer, maxDistanceTiles) {
    return this.getNearbyIndexedValues(
      pvpIndex?.realPlayerBuckets ?? null,
      sourcePlayer,
      maxDistanceTiles,
      Number(pvpIndex?.chunkSizeTiles ?? 0)
    );
  }

  getIndexedPlayerTileOccupancyCount(pvpIndex, privateArea, location) {
    if (!(pvpIndex?.playerTileOccupancyByArea instanceof Map) || !location) {
      return null;
    }
    const areaMap = pvpIndex.playerTileOccupancyByArea.get(privateArea ?? null);
    if (!(areaMap instanceof Map)) {
      return 0;
    }
    return Number(areaMap.get(getTileOccupancyKey(location)) ?? 0);
  }

  isTargetedByActivePvp(targetUsername, entries, ignoreUsername = null, pvpIndex = null) {
    if (targetUsername && pvpIndex?.activePvpTargetCounts instanceof Map) {
      const activeCount = Number(pvpIndex.activePvpTargetCounts.get(targetUsername) ?? 0);
      const ignoredTargetUsername = ignoreUsername
        ? pvpIndex?.activePvpTargetByUsername?.get(ignoreUsername) ?? null
        : null;
      return activeCount - (ignoredTargetUsername === targetUsername ? 1 : 0) > 0;
    }
    if (!targetUsername || !Array.isArray(entries)) {
      return false;
    }
    for (const entry of entries) {
      const username = entry?.player?.getUsername?.();
      if (!username || (ignoreUsername && username === ignoreUsername)) {
        continue;
      }
      const state = entry?.state;
      if (state?.mode !== this.behaviorMode.PVP) {
        continue;
      }
      if (state?.pvp?.targetUsername === targetUsername) {
        return true;
      }
    }
    return false;
  }

  getActivePvpTargetCount(targetUsername, ignoreUsername = null, pvpIndex = null) {
    if (!targetUsername || !(pvpIndex?.activePvpTargetCounts instanceof Map)) {
      return 0;
    }
    const activeCount = Number(pvpIndex.activePvpTargetCounts.get(targetUsername) ?? 0);
    const ignoredTargetUsername = ignoreUsername
      ? pvpIndex?.activePvpTargetByUsername?.get(ignoreUsername) ?? null
      : null;
    return Math.max(0, activeCount - (ignoredTargetUsername === targetUsername ? 1 : 0));
  }

  isPvpCandidate({ sourceEntry, candidateEntry, entries, pvpIndex, nowMs, isInCombat }) {
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
      candidateState.mode === this.behaviorMode.FOLLOW_BACK ||
      candidateState.mode === this.behaviorMode.RETURN_HOME ||
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
      this.isTargetedByActivePvp(candidateUsername, entries, sourceUsername, pvpIndex)
    ) {
      return false;
    }
    return true;
  }

  resolvePreferredRealPlayerOpponent({
    sourceEntry,
    pvpMaxDistanceTiles,
    isInCombat,
    pvpIndex = null,
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
    const indexedCandidates = this.getNearbyIndexedRealPlayers(
      pvpIndex,
      sourcePlayer,
      pvpMaxDistanceTiles
    );
    const realPlayerCandidates = Array.isArray(indexedCandidates)
      ? indexedCandidates
      : this.World.getPlayers();

    realPlayerCandidates.forEach((candidatePlayer) => {
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
      const activeTargeters = this.getActivePvpTargetCount(
        candidateUsername,
        sourceUsername,
        pvpIndex
      );
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

  isModeStateValid({ player, state, nowMs }) {
    const pvp = state?.pvp;
    if (!player || !state || !pvp) {
      return false;
    }
    if (pvp.retreat && player.getHitpoints() > 0) return true;
    if (this.isPvpOnly(state) && !pvp.targetUsername) {
      this.setPhase(state, PVP_PHASE.SEEKING);
      return Wilderness.isIn(player);
    }
    if (!pvp.targetUsername) {
      return false;
    }

    const opponent = this.resolveTargetPlayer(state);
    if (!opponent || !opponent.isRegistered?.()) {
      return false;
    }
    if (Number.isInteger(nowMs) && nowMs >= (pvp.endsAt ?? 0)) {
      if (!this.isActivelyEngagedWithTarget(player, opponent)) {
        return false;
      }
    }
    if ((player.getHitpoints?.() ?? 0) <= 0 || (opponent.getHitpoints?.() ?? 0) <= 0) {
      return false;
    }
    if (!Wilderness.isIn(player) || !Wilderness.isIn(opponent)) {
      return false;
    }
    if (player.getPrivateArea?.() !== opponent.getPrivateArea?.()) {
      return false;
    }
    const profile = this.getProfile(state);
    if (
      !this.isActivelyEngagedWithTarget(player, opponent) &&
      player.getLocation().getDistance(opponent.getLocation()) >
        Math.max(6, profile.chaseDistanceTiles + 2)
    ) {
      return false;
    }
    return true;
  }

  tickDefensive(context) {
    const resolved = resolveBotNodeContext(context, this.botStatesByName, {
      requiredMode: this.behaviorMode.PVP,
      requireNotInCombat: false,
      requireNotBusy: false,
    });
    if (!resolved) return { handled: false };
    return this.defensiveActionNode.tick({
      ...resolved, target: this.resolveTargetPlayer(resolved.state),
    });
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

    const vengeance = this.ServerPerf.measurePhase("bot.pvp.tick.vengeance", () =>
      this.vengeanceNode.tick({
        player,
        state,
        nowMs,
        target,
      })
    );
    if (vengeance?.handled) {
      return vengeance.status ?? "failure";
    }

    return this.ServerPerf.measurePhase("bot.pvp.tick.combat_execution", () =>
      this.combatExecutionNode.tick({
        player,
        state,
        nowMs,
        target,
      })
    );
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
}

const PVP_MODE_DESCRIPTOR = Object.freeze({
  key: "pvp",
  modeProperty: "PVP",
  assignable: true,
  autonomous: Object.freeze({
    strategy: "try_start",
    weight: 0.05,
    params: Object.freeze({
      pvpMinMs: PVP_DURATION_DEFAULT_MIN_MS,
      pvpMaxMs: PVP_DURATION_DEFAULT_MAX_MS,
      pvpMaxDistanceTiles: 16,
      postPvpCooldownMinMs: POST_PVP_COOLDOWN_MIN_MS,
      postPvpCooldownMaxMs: POST_PVP_COOLDOWN_MAX_MS,
    }),
    priority: 10,
  }),
  modeStopParams: Object.freeze({
    postPvpCooldownMinMs: POST_PVP_COOLDOWN_MIN_MS,
    postPvpCooldownMaxMs: POST_PVP_COOLDOWN_MAX_MS,
  }),
  requiredHooks: [
    "behaviorRequirementsMet",
    "tryStartMode",
    "stopMode",
    "isModeStateValid",
    "handleBlocked",
  ],
  create({ botStatesByName, api, behaviorMode }) {
    return new PvpBehavior(botStatesByName, api, {
      behaviorMode,
    });
  },
});

module.exports = {
  PvpBehavior,
  PVP_MODE_DESCRIPTOR,
};
