const { Flag } = require("../../../../src/main/typescript/elvarg/game/model/Flag");
const { Animation } = require("../../../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../../../src/main/typescript/elvarg/game/model/Graphic");
const { Location } = require("../../../../src/main/typescript/elvarg/game/model/Location");
const { clearMovementRequest } = require("../navigation/BotNavigation");

const HOME_TELEPORT_START_ANIMATION = new Animation(714);
const HOME_TELEPORT_END_ANIMATION = new Animation(715);
const HOME_TELEPORT_START_GRAPHIC = new Graphic(308, 50);
let BANK_RUN_SEQUENCE = 0;
const DEFAULT_TRANSITION_PROFILE = Object.freeze({ resetTraversal: true });
const MODE_TRANSITION_PROFILE_OVERRIDES = Object.freeze({
  ROAMING: Object.freeze({ resetTraversal: false }),
});
const RESUMABLE_MODE_KEYS = Object.freeze([
  "ROAMING",
  "WOODCUTTING",
  "MINING",
  "SMELTING",
  "FIREMAKING",
  "PVP",
]);

function createRoamingBehaviorState() {
  return {
    target: null,
    nextWalkAt: 0,
    pendingRetry: null,
    endpointPauseUntil: 0,
  };
}

function clearRoamingBehaviorState(state) {
  if (!state?.roaming) {
    return;
  }
  state.roaming.target = null;
  state.roaming.nextWalkAt = 0;
  state.roaming.pendingRetry = null;
  state.roaming.endpointPauseUntil = 0;
}

function createWoodcuttingBehaviorState() {
  return {
    target: null,
    nextActionAt: 0,
    nextSearchAt: 0,
    nextDebugChatAt: 0,
    searchTarget: null,
  };
}

function createMiningBehaviorState() {
  return {
    target: null,
    nextActionAt: 0,
    nextSearchAt: 0,
    nextDebugChatAt: 0,
    searchTarget: null,
  };
}

function createFiremakingBehaviorState() {
  return {
    phase: "burning",
    nextActionAt: 0,
    bankTarget: null,
    lightTile: null,
    travelTarget: null,
  };
}

function createSmeltingBehaviorState() {
  return {
    phase: "withdraw",
    nextActionAt: 0,
    recipeBarId: null,
    bankTarget: null,
    furnaceTarget: null,
    travelTarget: null,
  };
}

function createBankRunBehaviorState() {
  return {
    id: null,
    phase: "idle",
    nextActionAt: 0,
    bankTarget: null,
    travelTarget: null,
    returnMode: null,
    returnTo: null,
    resumeWoodcuttingTarget: null,
    resumeMiningTarget: null,
    startedAt: 0,
    phaseStartedAt: 0,
    lastPhaseLogged: null,
    phaseTimeoutCount: 0,
    lastHeartbeatAt: 0,
    lastStuckWarningAt: 0,
    suppressAutoRetaliate: false,
    previousAutoRetaliate: null,
  };
}

function createPvpBehaviorState() {
  return {
    phase: "idle",
    targetUsername: null,
    targetPlayer: null,
    endsAt: 0,
    nextActionAt: 0,
    profileId: "standard",
    loadoutId: "edge_main_melee",
    generatedArchetypeId: null,
    generatedPrimaryWeaponId: null,
    generatedPrimaryAmmoId: null,
    generatedSpecWeaponId: null,
    generatedSpecAmmoId: null,
    hotspotId: null,
    engagementStyle: "roaming",
    preferredCombatStyle: "melee",
    nextTargetReviewAt: 0,
    nextPrayerReviewAt: 0,
    nextSpecReviewAt: 0,
    nextFreezeReviewAt: 0,
    retreat: null,
    lastFreezeAt: 0,
    lastTeleblockAt: 0,
    lastDamageTakenAt: 0,
    lastDamageDealtAt: 0,
    lastFoodAt: 0,
    f2pFoodPending: false,
    f2pFoodPendingHp: null,
    retreatFoodCharges: null,
    lastBrewAt: 0,
    lastComboEatAt: 0,
    lastVengeanceAt: 0,
    startCombatPotionsReady: false,
    startCombatPotionNames: [],
    lastSpecAt: 0,
    specSwitchbackAt: 0,
    lastOneTickAt: 0,
    lastPressureScriptAt: 0,
    lastStyleSwitchAt: 0,
    pressureAttackReviewed: false,
    lastCombatStep: null,
    movementReview: null,
    backstep: null,
    nextBackstepCycle: 0,
    escapeThreshold: 0.24,
    riskTolerance: 0.3,
    confidenceTier: 2,
    currentTargetScore: 0,
    targetLockUntil: 0,
    pjTargetUsername: null,
    pjExpiresAt: 0,
    pjVictimUsername: null,
    pjVictimExpiresAt: 0,
    replenishAfterKillPending: false,
    replenishPrayerId: null,
    replenishPrayerUntil: 0,
    appliedBoostProfileId: null,
    cachedEatAtHpRatioProfileId: null,
    cachedEatAtHpRatio: null,
    runtimeCombatSnapshot: null,
    cachedProtectionPrayerId: null,
    cachedOffensivePrayerId: null,
    cachedPrayerTargetCombatType: null,
    cachedPrayerPlayerCombatType: null,
    cachedPrayerTargetUsername: null,
    cachedActualPrayerTargetCombatType: null,
    cachedActualPrayerTargetWeaponId: null,
    cachedActualPrayerTargetWeaponInterface: null,
    cachedActualPrayerTargetCastSpellId: null,
    cachedActualPrayerTargetAutocastSpellId: null,
    cachedActualPrayerTargetSpecialActive: null,
    observedPrayerTargetCombatType: null,
    pendingPrayerTargetCombatType: null,
    pendingPrayerTargetCombatTypeAt: 0,
    currentCyclePvpIndex: null,
    nextOneTickCheckAt: 0,
    nextSwitchbackCheckAt: 0,
    nextPressureCheckAt: 0,
    nextVengeanceAttemptAt: 0,
  };
}

function clearPvpBehaviorState(state) {
  if (!state?.pvp) {
    return;
  }
  state.pvp.phase = "idle";
  state.pvp.targetUsername = null;
  state.pvp.targetPlayer = null;
  state.pvp.endsAt = 0;
  state.pvp.nextActionAt = 0;
  state.pvp.generatedArchetypeId = null;
  state.pvp.generatedPrimaryWeaponId = null;
  state.pvp.generatedPrimaryAmmoId = null;
  state.pvp.generatedSpecWeaponId = null;
  state.pvp.generatedSpecAmmoId = null;
  state.pvp.nextTargetReviewAt = 0;
  state.pvp.nextPrayerReviewAt = 0;
  state.pvp.nextSpecReviewAt = 0;
  state.pvp.nextFreezeReviewAt = 0;
  state.pvp.retreat = null;
  state.pvp.lastFreezeAt = 0;
  state.pvp.lastTeleblockAt = 0;
  state.pvp.lastDamageTakenAt = 0;
  state.pvp.lastDamageDealtAt = 0;
  state.pvp.lastFoodAt = 0;
  state.pvp.f2pFoodPending = false;
  state.pvp.f2pFoodPendingHp = null;
  state.pvp.retreatFoodCharges = null;
  state.pvp.lastBrewAt = 0;
  state.pvp.lastComboEatAt = 0;
  state.pvp.lastVengeanceAt = 0;
  state.pvp.startCombatPotionsReady = false;
  state.pvp.startCombatPotionNames = [];
  state.pvp.lastSpecAt = 0;
  state.pvp.specSwitchbackAt = 0;
  state.pvp.lastOneTickAt = 0;
  state.pvp.lastPressureScriptAt = 0;
  state.pvp.lastStyleSwitchAt = 0;
  state.pvp.pressureAttackReviewed = false;
  state.pvp.lastCombatStep = null;
  state.pvp.movementReview = null;
  state.pvp.backstep = null;
  state.pvp.nextBackstepCycle = 0;
  state.pvp.currentTargetScore = 0;
  state.pvp.targetLockUntil = 0;
  state.pvp.pjTargetUsername = null;
  state.pvp.pjExpiresAt = 0;
  state.pvp.pjVictimUsername = null;
  state.pvp.pjVictimExpiresAt = 0;
  state.pvp.replenishAfterKillPending = false;
  state.pvp.replenishPrayerId = null;
  state.pvp.replenishPrayerUntil = 0;
  state.pvp.appliedBoostProfileId = null;
  state.pvp.cachedEatAtHpRatioProfileId = null;
  state.pvp.cachedEatAtHpRatio = null;
  state.pvp.runtimeCombatSnapshot = null;
  state.pvp.cachedProtectionPrayerId = null;
  state.pvp.cachedOffensivePrayerId = null;
  state.pvp.cachedPrayerTargetCombatType = null;
  state.pvp.cachedPrayerPlayerCombatType = null;
  state.pvp.cachedPrayerTargetUsername = null;
  state.pvp.cachedActualPrayerTargetCombatType = null;
  state.pvp.cachedActualPrayerTargetWeaponId = null;
  state.pvp.cachedActualPrayerTargetWeaponInterface = null;
  state.pvp.cachedActualPrayerTargetCastSpellId = null;
  state.pvp.cachedActualPrayerTargetAutocastSpellId = null;
  state.pvp.cachedActualPrayerTargetSpecialActive = null;
  state.pvp.observedPrayerTargetCombatType = null;
  state.pvp.pendingPrayerTargetCombatType = null;
  state.pvp.pendingPrayerTargetCombatTypeAt = 0;
  state.pvp.currentCyclePvpIndex = null;
  state.pvp.nextOneTickCheckAt = 0;
  state.pvp.nextSwitchbackCheckAt = 0;
  state.pvp.nextPressureCheckAt = 0;
  state.pvp.nextVengeanceAttemptAt = 0;
}

function createAutonomyState() {
  return {
    nextDecisionAt: 0,
    modeEndsAt: 0,
    pvpCooldownUntil: 0,
    allowedAutonomousModes: null,
    manualMode: null,
  };
}

function clearWoodcuttingBehaviorState(state) {
  if (!state?.woodcutting) {
    return;
  }
  state.woodcutting.target = null;
  state.woodcutting.nextActionAt = 0;
  state.woodcutting.nextSearchAt = 0;
  state.woodcutting.nextDebugChatAt = 0;
  state.woodcutting.searchTarget = null;
}

function clearMiningBehaviorState(state) {
  if (!state?.mining) {
    return;
  }
  state.mining.target = null;
  state.mining.nextActionAt = 0;
  state.mining.nextSearchAt = 0;
  state.mining.nextDebugChatAt = 0;
  state.mining.searchTarget = null;
}

function clearFiremakingBehaviorState(state) {
  if (!state?.firemaking) {
    return;
  }
  state.firemaking.phase = "burning";
  state.firemaking.nextActionAt = 0;
  state.firemaking.bankTarget = null;
  state.firemaking.lightTile = null;
  state.firemaking.travelTarget = null;
}

function clearSmeltingBehaviorState(state) {
  if (!state?.smelting) {
    return;
  }
  state.smelting.phase = "withdraw";
  state.smelting.nextActionAt = 0;
  state.smelting.recipeBarId = null;
  state.smelting.bankTarget = null;
  state.smelting.furnaceTarget = null;
  state.smelting.travelTarget = null;
}

function clearBankRunBehaviorState(state) {
  if (!state?.bankRun) {
    return;
  }
  state.bankRun.phase = "idle";
  state.bankRun.id = null;
  state.bankRun.nextActionAt = 0;
  state.bankRun.bankTarget = null;
  state.bankRun.travelTarget = null;
  state.bankRun.returnMode = null;
  state.bankRun.returnTo = null;
  state.bankRun.resumeWoodcuttingTarget = null;
  state.bankRun.resumeMiningTarget = null;
  state.bankRun.startedAt = 0;
  state.bankRun.phaseStartedAt = 0;
  state.bankRun.lastPhaseLogged = null;
  state.bankRun.phaseTimeoutCount = 0;
  state.bankRun.lastHeartbeatAt = 0;
  state.bankRun.lastStuckWarningAt = 0;
  state.bankRun.suppressAutoRetaliate = false;
  state.bankRun.previousAutoRetaliate = null;
}

let TaskManager = null;

/** Called once from PlayerBots.plugin.js's register(api), before any bot behavior runs. */
function initPlayerBotStateCoreAccess(api) {
  TaskManager = api.getTaskManager();
}

function resetMovementState(player) {
  if (!player) {
    return;
  }
  clearMovementRequest(player);
  // Avoid canceling player-keyed tasks while a force movement is active
  // (e.g. wilderness ditch), otherwise the movement task can be interrupted.
  if (player.getForceMovement?.() == null) {
    try {
      TaskManager.cancelTasks(player);
    } catch (_) {
      // Ignore task cancellation issues in plugin flow.
    }
  }
  player.getMovementQueue().walkToReset();
  player.getMovementQueue().reset();
}

function clearFollowState(player, state) {
  if (player) {
    player.setFollowing(null);
    player.setMobileInteraction(null);
    player.setPositionToFace(null);
  }
  if (!state) {
    return;
  }
  state.followTargetUsername = null;
  state.followUntilMs = 0;
  state.nextFollowRepathAt = 0;
}

function clearAllBehaviorStates(state) {
  if (!state) {
    return;
  }
  clearRoamingBehaviorState(state);
  clearWoodcuttingBehaviorState(state);
  clearMiningBehaviorState(state);
  clearFiremakingBehaviorState(state);
  clearSmeltingBehaviorState(state);
  clearBankRunBehaviorState(state);
  clearPvpBehaviorState(state);
}

function restoreSuppressedAutoRetaliate(player, state, nextMode) {
  if (player && state?.pvp?.retreat) {
    player.setAutoRetaliate(state.pvp.retreat.autoRetaliate);
    state.pvp.retreat = null;
  }

  if (
    !player ||
    !state ||
    state.bankRun?.suppressAutoRetaliate !== true ||
    state.mode === nextMode
  ) {
    return;
  }
  const previousAutoRetaliate = state.bankRun.previousAutoRetaliate;
  player.setAutoRetaliate(
    typeof previousAutoRetaliate === "boolean" ? previousAutoRetaliate : true
  );
  state.bankRun.suppressAutoRetaliate = false;
  state.bankRun.previousAutoRetaliate = null;
}

function clearCombatState(player) {
  if (!player) {
    return;
  }
  player.getCombat?.()?.reset?.();
  player.setCombatFollowing?.(null);
}

function listAllowedAutonomousModes(state) {
  const modes = state?.autonomy?.allowedAutonomousModes;
  if (!Array.isArray(modes)) {
    return null;
  }
  return modes.filter((mode) => typeof mode === "string" && mode.length > 0);
}

function allowsAutonomousMode(state, mode) {
  if (typeof mode !== "string" || mode.length === 0) {
    return false;
  }
  const allowedModes = listAllowedAutonomousModes(state);
  if (!allowedModes) {
    return true;
  }
  return allowedModes.includes(mode);
}

function isPvpOnlyBotState(state) {
  if (state?.pvp == null) {
    return false;
  }
  const allowedModes = listAllowedAutonomousModes(state);
  return Array.isArray(allowedModes) && allowedModes.length === 1 && allowedModes[0] === "pvp";
}

function applyModeTransitionSideEffects(player, state, mode, options = {}) {
  restoreSuppressedAutoRetaliate(player, state, mode);
  if (options.resetMovement !== false) {
    resetMovementState(player);
  } else {
    clearMovementRequest(player);
  }
  if (options.resetCombat !== false) {
    clearCombatState(player);
  }
  if (options.clearFollow !== false) {
    clearFollowState(player, state);
  }
}

function applyModeTransition(player, state, mode, options = {}) {
  if (!state) {
    return;
  }
  applyModeTransitionSideEffects(player, state, mode, options);
  const resetTraversal = options.resetTraversal === true;
  state.mode = mode;
  clearAllBehaviorStates(state);
  if (resetTraversal) {
    state.awaitingDitchTransition = null;
  }
}

function resolveBehaviorModeValue(behaviorMode, modeKey) {
  if (!behaviorMode || typeof modeKey !== "string" || modeKey.length === 0) {
    return null;
  }
  const mode = behaviorMode[modeKey];
  return typeof mode === "string" && mode.length > 0 ? mode : null;
}

function isPlayerInCombat(player) {
  if (!player) {
    return false;
  }
  const hitpoints = player.getHitpoints?.();
  if (Number.isFinite(hitpoints) && hitpoints <= 0) {
    return false;
  }
  if (player.isDyingReturn?.() === true) {
    return false;
  }
  const combat = player.getCombat?.();
  return !!(
    combat?.getTarget?.() ||
    combat?.getAttacker?.() ||
    player.getCombatFollowing?.()
  );
}

function transitionToMode(player, state, behaviorMode, modeKey, overrideOptions = null) {
  if (!state) {
    return false;
  }
  const mode = resolveBehaviorModeValue(behaviorMode, modeKey);
  if (!mode) {
    return false;
  }
  const profile =
    overrideOptions ??
    MODE_TRANSITION_PROFILE_OVERRIDES[modeKey] ??
    DEFAULT_TRANSITION_PROFILE;
  if (
    state.mode !== mode &&
    profile?.allowInCombatTransition !== true &&
    isPlayerInCombat(player)
  ) {
    return false;
  }
  applyModeTransition(player, state, mode, profile);
  return true;
}

function setModeRoaming(player, state, behaviorMode) {
  transitionToMode(player, state, behaviorMode, "ROAMING");
}

function setModeReturnHome(player, state, behaviorMode) {
  transitionToMode(player, state, behaviorMode, "RETURN_HOME");
}

function setModeFollowBack(
  player,
  state,
  followTarget,
  nowMs,
  followBackDurationMs,
  behaviorMode,
  options = {}
) {
  if (!player || !state || !followTarget) {
    return false;
  }
  const followTargetUsername = followTarget.getUsername?.();
  if (!followTargetUsername) {
    return false;
  }

  if (
    !transitionToMode(player, state, behaviorMode, "FOLLOW_BACK", {
      allowInCombatTransition: options.allowInCombatTransition === true,
    })
  ) {
    return false;
  }
  state.followTargetUsername = followTargetUsername;
  state.followUntilMs = nowMs + followBackDurationMs;
  state.nextFollowRepathAt = 0;
  clearMovementRequest(player);
  player.getMovementQueue?.()?.reset?.();
  clearRoamingBehaviorState(state);
  if (player.getRunEnergy?.() > 0) {
    player.setRunning?.(true);
    player.getPacketSender?.()?.sendRunStatus?.();
  }
  player.setFollowing(followTarget);
  player.setMobileInteraction(followTarget);
  player.setPositionToFace(followTarget.getLocation());
  return true;
}

function setModeWoodcutting(player, state, behaviorMode) {
  transitionToMode(player, state, behaviorMode, "WOODCUTTING");
}

function setModeMining(player, state, behaviorMode) {
  transitionToMode(player, state, behaviorMode, "MINING");
}

function setModeFiremaking(player, state, behaviorMode) {
  transitionToMode(player, state, behaviorMode, "FIREMAKING");
}

function setModeSmelting(player, state, behaviorMode) {
  transitionToMode(player, state, behaviorMode, "SMELTING");
}

function isResumableMode(mode, behaviorMode) {
  if (!behaviorMode) {
    return false;
  }
  return RESUMABLE_MODE_KEYS.some(
    (modeKey) => resolveBehaviorModeValue(behaviorMode, modeKey) === mode
  );
}

function resolveBankRunResumeMode(state, behaviorMode) {
  if (!behaviorMode) {
    return null;
  }
  if (isResumableMode(state?.mode, behaviorMode)) {
    return state.mode;
  }
  const manualMode = state?.autonomy?.manualMode;
  if (isResumableMode(manualMode, behaviorMode)) {
    return manualMode;
  }
  return behaviorMode.ROAMING;
}

function setModeBankRun(player, state, behaviorMode, options = {}) {
  if (!state) {
    return false;
  }
  const loc = player?.getLocation?.();
  const fallbackReturn = loc
    ? { x: loc.getX(), y: loc.getY(), z: loc.getZ() }
    : null;
  const returnMode =
    options.returnMode ?? resolveBankRunResumeMode(state, behaviorMode);
  const returnTo = options.returnTo ?? fallbackReturn;
  const resumeWoodcuttingTarget = options.resumeWoodcuttingTarget
    ? {
        objectId: options.resumeWoodcuttingTarget.objectId,
        x: options.resumeWoodcuttingTarget.x,
        y: options.resumeWoodcuttingTarget.y,
        z: options.resumeWoodcuttingTarget.z,
      }
    : null;
  const resumeMiningTarget = options.resumeMiningTarget
    ? {
        objectId: options.resumeMiningTarget.objectId,
        x: options.resumeMiningTarget.x,
        y: options.resumeMiningTarget.y,
        z: options.resumeMiningTarget.z,
      }
    : null;

  if (!transitionToMode(player, state, behaviorMode, "BANK_RUN")) {
    return false;
  }
  if (!state.bankRun) {
    state.bankRun = createBankRunBehaviorState();
  }
  const nowMs = Date.now();
  BANK_RUN_SEQUENCE += 1;
  state.bankRun.id = BANK_RUN_SEQUENCE;
  state.bankRun.phase = "to_bank";
  state.bankRun.nextActionAt = 0;
  state.bankRun.bankTarget = null;
  state.bankRun.travelTarget = null;
  state.bankRun.returnMode = returnMode;
  state.bankRun.returnTo = returnTo
    ? { x: returnTo.x, y: returnTo.y, z: returnTo.z }
    : null;
  state.bankRun.resumeWoodcuttingTarget = resumeWoodcuttingTarget;
  state.bankRun.resumeMiningTarget = resumeMiningTarget;
  state.bankRun.startedAt = nowMs;
  state.bankRun.phaseStartedAt = nowMs;
  state.bankRun.lastPhaseLogged = null;
  state.bankRun.phaseTimeoutCount = 0;
  state.bankRun.lastHeartbeatAt = 0;
  state.bankRun.lastStuckWarningAt = 0;
  state.bankRun.suppressAutoRetaliate = options.suppressAutoRetaliate === true;
  state.bankRun.previousAutoRetaliate = null;
  if (
    state.bankRun.suppressAutoRetaliate &&
    player &&
    typeof player.autoRetaliateReturn === "function" &&
    typeof player.setAutoRetaliate === "function"
  ) {
    state.bankRun.previousAutoRetaliate = player.autoRetaliateReturn();
    player.setAutoRetaliate(false);
  }
  return true;
}

function setModePvp(
  player,
  state,
  targetPlayer,
  nowMs,
  durationMs,
  behaviorMode,
  options = {}
) {
  if (!player || !state || !targetPlayer || durationMs <= 0) {
    return false;
  }
  const targetUsername = targetPlayer.getUsername?.();
  if (!targetUsername) {
    return false;
  }

  if (
    !transitionToMode(player, state, behaviorMode, "PVP", {
      allowInCombatTransition: options.allowInCombatTransition === true,
    })
  ) {
    return false;
  }
  if (!state.pvp) {
    state.pvp = createPvpBehaviorState();
  }

  state.pvp.phase = "seeking";
  state.pvp.targetUsername = targetUsername;
  state.pvp.targetPlayer = targetPlayer;
  state.pvp.startCombatPotionsReady = false;
  state.pvp.startCombatPotionNames = [];
  state.pvp.retreatFoodCharges = null;
  state.pvp.endsAt = nowMs + durationMs;
  state.pvp.nextActionAt = nowMs;
  if (player.getRunEnergy?.() > 0) {
    player.setRunning?.(true);
    player.getPacketSender?.()?.sendRunStatus?.();
  }
  return true;
}

function setModeSparring(
  player,
  state,
  targetPlayer,
  nowMs,
  durationMs,
  behaviorMode
) {
  return setModePvp(player, state, targetPlayer, nowMs, durationMs, behaviorMode);
}

function isInsideHomeArea(player, state, botHomeRadius) {
  if (!player || !state?.home) {
    return false;
  }
  const current = player.getLocation();
  const homeX = state.home.x;
  const homeY = state.home.y;
  const homeZ = state.home.z ?? current.getZ();
  if (current.getZ() !== homeZ) {
    return false;
  }
  const dx = current.getX() - homeX;
  const dy = current.getY() - homeY;
  return dx * dx + dy * dy <= botHomeRadius * botHomeRadius;
}

function teleportHome(player, state) {
  if (!player || !state?.home) {
    return false;
  }
  if (isTeleblocked(player)) {
    return false;
  }
  const home = new Location(state.home.x, state.home.y, state.home.z ?? 0);
  player.performAnimation(HOME_TELEPORT_START_ANIMATION);
  player.performGraphic(HOME_TELEPORT_START_GRAPHIC);
  player.moveTo(home);
  player.performAnimation(HOME_TELEPORT_END_ANIMATION);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  return true;
}

function isTeleblocked(player) {
  return player?.getCombat?.()?.getTeleblockTimer?.()?.finished?.() === false;
}

function computeEatThreshold(maxHp, eatAtHpRatio, isF2p) {
  return isF2p
    ? Math.min(24, Math.max(1, maxHp - 1))
    : Math.max(1, Math.ceil(maxHp * eatAtHpRatio));
}

function createInitialState(home, behaviorMode) {
  return {
    mode: behaviorMode.ROAMING,
    home,
    // Keep roaming internals in a dedicated child state; this prevents future
    // behavior modes (minigames, skilling, PvP) from coupling to roam fields.
    roaming: createRoamingBehaviorState(),
    woodcutting: createWoodcuttingBehaviorState(),
    mining: createMiningBehaviorState(),
    firemaking: createFiremakingBehaviorState(),
    smelting: createSmeltingBehaviorState(),
    bankRun: createBankRunBehaviorState(),
    pvp: createPvpBehaviorState(),
    autonomy: createAutonomyState(),
    followTargetUsername: null,
    followUntilMs: 0,
    nextFollowRepathAt: 0,
    deathResetApplied: false,
    awaitingDitchTransition: null,
    nextDitchAttemptAt: 0,
  };
}

function markResumeSoon(state, nowMs = Date.now(), blockedRetargetMinDelayMs = 0) {
  if (!state) {
    return;
  }
  if (!state.roaming) {
    state.roaming = createRoamingBehaviorState();
  }
  state.roaming.nextWalkAt = nowMs + blockedRetargetMinDelayMs;
}

module.exports = {
  initPlayerBotStateCoreAccess,
  allowsAutonomousMode,
  clearFollowState,
  createInitialState,
  isPvpOnlyBotState,
  isInsideHomeArea,
  listAllowedAutonomousModes,
  markResumeSoon,
  resolveBankRunResumeMode,
  resetMovementState,
  setModeFollowBack,
  setModePvp,
  setModeSparring,
  setModeReturnHome,
  setModeRoaming,
  setModeBankRun,
  setModeWoodcutting,
  setModeMining,
  setModeSmelting,
  setModeFiremaking,
  teleportHome,
  isTeleblocked,
  computeEatThreshold,
};
