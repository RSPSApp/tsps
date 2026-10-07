const { clearMovementRequest } = require("../navigation/BotNavigation");

const DEFAULT_TRANSITION_PROFILE = Object.freeze({ resetTraversal: true });
const MODE_TRANSITION_PROFILE_OVERRIDES = Object.freeze({
  ROAMING: Object.freeze({ resetTraversal: false }),
});
function createRoamingBehaviorState() {
  return {
    target: null,
    nextWalkAt: 0,
    endpointPauseUntil: 0,
  };
}

function clearRoamingBehaviorState(state) {
  if (!state?.roaming) {
    return;
  }
  state.roaming.target = null;
  state.roaming.nextWalkAt = 0;
  state.roaming.endpointPauseUntil = 0;
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
  clearPvpBehaviorState(state);
}

function restoreSuppressedAutoRetaliate(player, state, nextMode) {
  if (player && state?.pvp?.retreat) {
    player.setAutoRetaliate(state.pvp.retreat.autoRetaliate);
    state.pvp.retreat = null;
  }

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
  state.pvp.endsAt = nowMs + durationMs;
  state.pvp.nextActionAt = nowMs;
  if (player.getRunEnergy?.() > 0) {
    player.setRunning?.(true);
    player.getPacketSender?.()?.sendRunStatus?.();
  }
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

module.exports = {
  initPlayerBotStateCoreAccess,
  clearFollowState,
  createInitialState,
  isPvpOnlyBotState,
  resetMovementState,
  setModePvp,
  setModeRoaming,
  isTeleblocked,
  computeEatThreshold,
};
