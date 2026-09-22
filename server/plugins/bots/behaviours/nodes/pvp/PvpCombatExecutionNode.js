"use strict";

const { PrayerHandler } = require("../../../../../src/main/typescript/elvarg/game/content/PrayerHandler");
const {
  CombatType,
} = require("../../../../../src/main/typescript/elvarg/game/content/combat/CombatType");
const {
  CanAttackResponse,
} = require("../../../../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { GameConstants } = require("../../../../../src/main/typescript/elvarg/game/GameConstants");
const { Inventory } = require("../../../../../src/main/typescript/elvarg/game/model/container/impl/Inventory");
const { ItemActionPacketListener } = require("../../../../../src/main/typescript/elvarg/net/packet/impl/ItemActionPacketListener");
const { TimerKey } = require("../../../../../src/main/typescript/elvarg/util/timers/TimerKey");
const { getPotionName } = require("../../../../items/Potions.plugin");
const { randomInRange } = require("../../navigation/BotNavigation");
const {
  getPvpCombatSnapshot,
  getWeaponId,
  resolveCurrentCombatType,
  START_COMBAT_POTION_NAMES,
} = require("../../policies/PvpCombatRuntimeCache");

const MELEE_OFFENSIVE_PRAYERS = Object.freeze([
  PrayerHandler.PIETY,
  PrayerHandler.CHIVALRY,
  PrayerHandler.ULTIMATE_STRENGTH,
]);
const RANGED_OFFENSIVE_PRAYERS = Object.freeze([
  PrayerHandler.RIGOUR,
  PrayerHandler.EAGLE_EYE,
  PrayerHandler.HAWK_EYE,
  PrayerHandler.SHARP_EYE,
]);
const MAGIC_OFFENSIVE_PRAYERS = Object.freeze([
  PrayerHandler.AUGURY,
  PrayerHandler.MYSTIC_MIGHT,
  PrayerHandler.MYSTIC_LORE,
  PrayerHandler.MYSTIC_WILL,
]);
const HYBRID_OFFENSIVE_PRAYERS = Object.freeze([
  ...MAGIC_OFFENSIVE_PRAYERS,
  ...RANGED_OFFENSIVE_PRAYERS,
]);
const MANAGED_OFFENSIVE_PRAYERS = Object.freeze([
  ...MELEE_OFFENSIVE_PRAYERS,
  ...RANGED_OFFENSIVE_PRAYERS,
  ...MAGIC_OFFENSIVE_PRAYERS,
]);
const GAME_TICK_MS = Number(GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE ?? 600);

function deactivatePrayerSet(prayerHandler, player, prayerIds, exceptPrayerId = null) {
  if (!player || !Array.isArray(prayerIds)) {
    return;
  }
  for (const prayerId of prayerIds) {
    if (prayerId === exceptPrayerId) {
      continue;
    }
    if (prayerHandler.isActivated(player, prayerId)) {
      prayerHandler.deactivatePrayer(player, prayerId);
    }
  }
}

function activateFirstAvailablePrayer(prayerHandler, player, prayerIds) {
  if (!player || !Array.isArray(prayerIds)) {
    return null;
  }
  for (const prayerId of prayerIds) {
    if (prayerHandler.isActivated(player, prayerId)) {
      return prayerId;
    }
    prayerHandler.activatePrayerPrayerId(player, prayerId);
    if (prayerHandler.isActivated(player, prayerId)) {
      return prayerId;
    }
  }
  return null;
}

function isPrayerActive(player, prayerId) {
  return player?.getPrayerActive?.()?.[prayerId] === true;
}

function hasOtherActivePrayer(player, prayerIds, exceptPrayerId = null) {
  if (!player || !Array.isArray(prayerIds)) {
    return false;
  }
  const activePrayers = player.getPrayerActive?.() ?? [];
  for (const prayerId of prayerIds) {
    if (prayerId === exceptPrayerId) {
      continue;
    }
    if (activePrayers[prayerId] === true) {
      return true;
    }
  }
  return false;
}

function normalizeCombatType(combatType) {
  return Number.isInteger(combatType) ? combatType : null;
}

function readTargetCombatSignature(target) {
  const combat = target?.getCombat?.();
  return {
    weaponId: getWeaponId(target),
    weaponInterface: target?.getWeapon?.() ?? null,
    castSpellId: combat?.getCastSpell?.()?.spellId ?? null,
    autocastSpellId: combat?.getAutocastSpell?.()?.spellId ?? null,
    specialActive: target?.isSpecialActivated?.() === true,
  };
}

function clearApproachForTarget(player, target) {
  if (!player || !target) {
    return;
  }
  if (player.getFollowing?.() === target) {
    player.setFollowing?.(null);
  }
  if (player.getInteractingMobile?.() === target) {
    player.setMobileInteraction?.(null);
  }
  player.setPositionToFace?.(null);
}

class PvpCombatExecutionNode {
  constructor(options = {}) {
    this.CombatFactory = options.api.getCombatFactory();
    this.PrayerHandler = options.api.getPrayerHandler();
    this.ServerPerf = options.api.getServerPerf();
    this.setPhase = options.setPhase;
    this.maybeSwitchBackToPrimaryWeapon = options.maybeSwitchBackToPrimaryWeapon;
    this.maybeUseSpecialAttack = options.maybeUseSpecialAttack;
    this.maybeRunPressureCombatScript = options.maybeRunPressureCombatScript;
    this.scheduleCombatAction = options.scheduleCombatAction;
    this.scheduleFreezeReview = options.scheduleFreezeReview;
    this.scheduleSpecReview = options.scheduleSpecReview;
    this.scheduleReviewTimers = options.scheduleReviewTimers;
    this.getProfile = options.getProfile;
    this.pvpPhase = options.pvpPhase;
  }

  resolveObservedTargetCombatType(state, target, nowMs, profile = null) {
    const pvp = state?.pvp;
    const targetUsername = target?.getUsername?.() ?? null;
    if (!pvp || !target || !targetUsername) {
      return null;
    }

    const targetSignature = readTargetCombatSignature(target);
    let actualTargetCombatType = null;
    if (
      pvp.cachedPrayerTargetUsername === targetUsername &&
      pvp.cachedActualPrayerTargetWeaponId === targetSignature.weaponId &&
      pvp.cachedActualPrayerTargetWeaponInterface === targetSignature.weaponInterface &&
      pvp.cachedActualPrayerTargetCastSpellId === targetSignature.castSpellId &&
      pvp.cachedActualPrayerTargetAutocastSpellId === targetSignature.autocastSpellId &&
      pvp.cachedActualPrayerTargetSpecialActive === targetSignature.specialActive
    ) {
      actualTargetCombatType = normalizeCombatType(
        pvp.cachedActualPrayerTargetCombatType
      );
    } else {
      actualTargetCombatType = normalizeCombatType(
        resolveCurrentCombatType(
          target,
          targetSignature.weaponInterface,
          targetSignature.weaponId
        )
      );
      pvp.cachedActualPrayerTargetCombatType = actualTargetCombatType;
      pvp.cachedActualPrayerTargetWeaponId = targetSignature.weaponId;
      pvp.cachedActualPrayerTargetWeaponInterface = targetSignature.weaponInterface;
      pvp.cachedActualPrayerTargetCastSpellId = targetSignature.castSpellId;
      pvp.cachedActualPrayerTargetAutocastSpellId = targetSignature.autocastSpellId;
      pvp.cachedActualPrayerTargetSpecialActive = targetSignature.specialActive;
    }
    const reactionTicks = profile?.targetStyleReactionTicks ?? null;
    const reactionMinMs = Math.max(
      0,
      Number(reactionTicks?.min ?? 0) * GAME_TICK_MS
    );
    const reactionMaxMs = Math.max(
      reactionMinMs,
      Number(reactionTicks?.max ?? 0) * GAME_TICK_MS
    );

    if (pvp.cachedPrayerTargetUsername !== targetUsername) {
      pvp.cachedActualPrayerTargetCombatType = actualTargetCombatType;
      pvp.cachedActualPrayerTargetWeaponId = targetSignature.weaponId;
      pvp.cachedActualPrayerTargetWeaponInterface = targetSignature.weaponInterface;
      pvp.cachedActualPrayerTargetCastSpellId = targetSignature.castSpellId;
      pvp.cachedActualPrayerTargetAutocastSpellId = targetSignature.autocastSpellId;
      pvp.cachedActualPrayerTargetSpecialActive = targetSignature.specialActive;
      pvp.observedPrayerTargetCombatType = actualTargetCombatType;
      pvp.pendingPrayerTargetCombatType = null;
      pvp.pendingPrayerTargetCombatTypeAt = 0;
      return actualTargetCombatType;
    }

    const observedCombatType = normalizeCombatType(pvp.observedPrayerTargetCombatType);
    if (actualTargetCombatType == null) {
      pvp.pendingPrayerTargetCombatType = null;
      pvp.pendingPrayerTargetCombatTypeAt = 0;
      return observedCombatType;
    }
    if (observedCombatType == null) {
      pvp.observedPrayerTargetCombatType = actualTargetCombatType;
      pvp.pendingPrayerTargetCombatType = null;
      pvp.pendingPrayerTargetCombatTypeAt = 0;
      return actualTargetCombatType;
    }
    if (reactionMaxMs <= 0) {
      pvp.observedPrayerTargetCombatType = actualTargetCombatType;
      pvp.pendingPrayerTargetCombatType = null;
      pvp.pendingPrayerTargetCombatTypeAt = 0;
      return actualTargetCombatType;
    }

    if (actualTargetCombatType === observedCombatType) {
      pvp.pendingPrayerTargetCombatType = null;
      pvp.pendingPrayerTargetCombatTypeAt = 0;
      return observedCombatType;
    }

    const pendingCombatType = normalizeCombatType(pvp.pendingPrayerTargetCombatType);
    if (
      pendingCombatType !== actualTargetCombatType ||
      Number(pvp.pendingPrayerTargetCombatTypeAt ?? 0) <= 0
    ) {
      pvp.pendingPrayerTargetCombatType = actualTargetCombatType;
      pvp.pendingPrayerTargetCombatTypeAt =
        nowMs + randomInRange(reactionMinMs, reactionMaxMs);
      return observedCombatType;
    }

    if (nowMs >= Number(pvp.pendingPrayerTargetCombatTypeAt ?? 0)) {
      pvp.observedPrayerTargetCombatType = pendingCombatType;
      pvp.pendingPrayerTargetCombatType = null;
      pvp.pendingPrayerTargetCombatTypeAt = 0;
      return pendingCombatType;
    }

    return observedCombatType;
  }

  resolveNextPrayerReviewAt(nowMs, baseMinMs, baseMaxMs, isStable, pendingTargetCombatTypeAt = 0) {
    const nextReviewAt =
      nowMs +
      randomInRange(
        isStable ? Math.max(baseMinMs + 200, Math.floor(baseMinMs * 2)) : baseMinMs,
        isStable ? Math.max(baseMaxMs + 400, Math.floor(baseMaxMs * 2)) : baseMaxMs
      );
    const pendingReviewAt = Number(pendingTargetCombatTypeAt ?? 0);
    if (pendingReviewAt > nowMs) {
      return Math.min(nextReviewAt, pendingReviewAt);
    }
    return nextReviewAt;
  }

  reviewPrayers(player, state, target, nowMs, profile = null) {
    const pvp = state?.pvp;
    const resolvedProfile = profile ?? this.getProfile?.(state) ?? null;
    if (!player || !pvp || !target || !resolvedProfile) {
      return false;
    }

    const basePrayerReviewMinMs = Number(resolvedProfile?.prayerReviewMs?.min ?? 1200);
    const basePrayerReviewMaxMs = Number(resolvedProfile?.prayerReviewMs?.max ?? 2400);

    const confidenceTier = Number(resolvedProfile?.confidenceTier ?? 0);
    // Novice bots fight prayerless; standard and above manage protection and
    // offensive prayers. Tiers below veteran lean on targetStyleReactionTicks
    // so they switch late rather than reading the style instantly.
    if (confidenceTier < 2) {
      pvp.nextPrayerReviewAt =
        nowMs + randomInRange(basePrayerReviewMinMs, basePrayerReviewMaxMs);
      return false;
    }

    const combatSnapshot = getPvpCombatSnapshot(player, state, nowMs);
    const playerCombatType =
      combatSnapshot?.currentCombatType ??
      resolveCurrentCombatType(player, player?.getWeapon?.(), getWeaponId(player));
    const targetUsername = target.getUsername?.() ?? null;
    const targetCombatType = this.resolveObservedTargetCombatType(
      state,
      target,
      nowMs,
      resolvedProfile
    );
    const desiredProtectionPrayer = this.resolveProtectionPrayer(
      player,
      target,
      confidenceTier,
      targetCombatType
    );
    const flickPrayers = confidenceTier >= 3;
    const protectionStable =
      desiredProtectionPrayer != null
        ? pvp.cachedProtectionPrayerId === desiredProtectionPrayer &&
          pvp.cachedPrayerTargetCombatType === targetCombatType &&
          pvp.cachedPrayerTargetUsername === targetUsername &&
          isPrayerActive(player, desiredProtectionPrayer) &&
          !hasOtherActivePrayer(player, PrayerHandler.PROTECTION_PRAYERS, desiredProtectionPrayer)
        : !hasOtherActivePrayer(player, PrayerHandler.PROTECTION_PRAYERS);
    const shouldRefreshProtectionPrayers = !protectionStable;
    if (desiredProtectionPrayer != null) {
      if (shouldRefreshProtectionPrayers) {
        activateFirstAvailablePrayer(this.PrayerHandler, player, [desiredProtectionPrayer]);
        deactivatePrayerSet(this.PrayerHandler, player, PrayerHandler.PROTECTION_PRAYERS, desiredProtectionPrayer);
      }
    } else {
      if (shouldRefreshProtectionPrayers) {
        deactivatePrayerSet(this.PrayerHandler, player, PrayerHandler.PROTECTION_PRAYERS);
      }
    }

    const offensivePrayerIds =
      flickPrayers && player.getCombat?.()?.willAttackBeReadyIn?.(1) !== true
        ? []
        : this.resolveOffensivePrayerPriority(state, playerCombatType);
    const preferredOffensivePrayer = offensivePrayerIds[0] ?? null;
    const offensiveStable =
      preferredOffensivePrayer == null
        ? !hasOtherActivePrayer(player, MANAGED_OFFENSIVE_PRAYERS)
        : pvp.cachedOffensivePrayerId === preferredOffensivePrayer &&
          pvp.cachedPrayerPlayerCombatType === playerCombatType &&
          isPrayerActive(player, preferredOffensivePrayer) &&
          !hasOtherActivePrayer(player, MANAGED_OFFENSIVE_PRAYERS, preferredOffensivePrayer);
    const shouldRefreshOffensivePrayers = !offensiveStable;
    let activatedOffensivePrayer = pvp.cachedOffensivePrayerId ?? null;
    if (shouldRefreshOffensivePrayers) {
      activatedOffensivePrayer = activateFirstAvailablePrayer(this.PrayerHandler, player, offensivePrayerIds);
      if (activatedOffensivePrayer != null) {
        deactivatePrayerSet(this.PrayerHandler, player, MANAGED_OFFENSIVE_PRAYERS, activatedOffensivePrayer);
      } else {
        deactivatePrayerSet(this.PrayerHandler, player, MANAGED_OFFENSIVE_PRAYERS);
      }
    }
    pvp.cachedProtectionPrayerId = desiredProtectionPrayer;
    pvp.cachedOffensivePrayerId = activatedOffensivePrayer ?? null;
    pvp.cachedPrayerTargetCombatType = targetCombatType;
    pvp.cachedPrayerPlayerCombatType = playerCombatType;
    pvp.cachedPrayerTargetUsername = targetUsername;
    pvp.nextPrayerReviewAt = this.resolveNextPrayerReviewAt(
      nowMs,
      basePrayerReviewMinMs,
      basePrayerReviewMaxMs,
      protectionStable && offensiveStable,
      pvp.pendingPrayerTargetCombatTypeAt
    );
    return true;
  }

  resolveProtectionPrayer(player, target, confidenceTier, targetMethodType = null) {
    if (!Number.isInteger(targetMethodType)) {
      return null;
    }

    const targetCombat = target.getCombat?.();
    const playerCombat = player.getCombat?.();
    const targetIsThreatening =
      targetCombat?.getTarget?.() === player ||
      targetCombat?.getAttacker?.() === player ||
      playerCombat?.getTarget?.() === target ||
      playerCombat?.getAttacker?.() === target;
    if (!targetIsThreatening && confidenceTier < 4) {
      return null;
    }

    try {
      return this.PrayerHandler.getProtectingPrayer(targetMethodType);
    } catch (_error) {
      return null;
    }
  }

  resolveOffensivePrayerPriority(state, combatType) {
    if (combatType === CombatType.RANGED) {
      return RANGED_OFFENSIVE_PRAYERS;
    }
    if (combatType === CombatType.MAGIC) {
      return MAGIC_OFFENSIVE_PRAYERS;
    }
    if (combatType === CombatType.MELEE) {
      return MELEE_OFFENSIVE_PRAYERS;
    }

    const preferredStyle = state?.pvp?.preferredCombatStyle;
    if (preferredStyle === "range") {
      return RANGED_OFFENSIVE_PRAYERS;
    }
    if (preferredStyle === "hybrid") {
      return HYBRID_OFFENSIVE_PRAYERS;
    }
    return MELEE_OFFENSIVE_PRAYERS;
  }

  shouldForcePrayerSync(player, state, target, nowMs, forcedCombatType = null) {
    const pvp = state?.pvp;
    if (!player || !pvp || !target) {
      return false;
    }
    if (nowMs >= Number(pvp.nextPrayerReviewAt ?? 0)) {
      return true;
    }
    if (
      Number.isInteger(forcedCombatType) &&
      pvp.cachedPrayerPlayerCombatType !== forcedCombatType
    ) {
      return true;
    }
    const targetCombatType = this.resolveObservedTargetCombatType(
      state,
      target,
      nowMs,
      this.getProfile?.(state) ?? null
    );
    return pvp.cachedPrayerTargetCombatType !== targetCombatType;
  }

  forcePrayerSync(player, state, target, nowMs, profile = null) {
    if (!player || !state || !target) {
      return false;
    }
    return this.reviewPrayers(player, state, target, nowMs, profile);
  }

  drinkStartCombatPotion(player, state) {
    const pvp = state?.pvp;
    if (!player || !pvp || pvp.startCombatPotionsReady === true) {
      return false;
    }

    const usedPotionNames = pvp.startCombatPotionNames ?? [];
    const inventory = player.getInventory?.();
    const potion = (inventory?.getItems?.() ?? [])
      .map((item, slot) => ({ item, slot, name: getPotionName(item?.getId?.()) }))
      .find(({ name }) => START_COMBAT_POTION_NAMES.has(name) && !usedPotionNames.includes(name));

    if (!potion) {
      pvp.startCombatPotionsReady = true;
      return false;
    }
    if (player.getTimers?.().has?.(TimerKey.POTION)) {
      return true;
    }

    const itemId = potion.item.getId?.();
    const handled = ItemActionPacketListener.handleAction(
      player,
      Inventory.INTERFACE_ID,
      itemId,
      potion.slot,
      1
    );
    const replaced = inventory.getItems?.()[potion.slot]?.getId?.() !== itemId;
    if (handled && replaced) {
      pvp.startCombatPotionNames = [...usedPotionNames, potion.name];
      return true;
    }
    return false;
  }

  tick(context) {
    const { player, state, nowMs, target } = context ?? {};
    const pvp = state?.pvp;
    if (!player || !state || !pvp || !target) {
      return "failure";
    }
    const combat = player.getCombat?.();
    if (!combat) {
      return "failure";
    }

    const committedToTarget =
      combat.getTarget?.() === target ||
      combat.getAttacker?.() === target ||
      player.getCombatFollowing?.() === target;
    const method = this.CombatFactory.getMethod(player);
    const shouldApproachTarget = committedToTarget ||
      this.CombatFactory.canAttackPermission(player, target, false, method) ===
        CanAttackResponse.CAN_ATTACK;
    if (!shouldApproachTarget) {
      clearApproachForTarget(player, target);
      pvp.nextActionAt = Math.max(Number(pvp.nextActionAt ?? 0), nowMs + 600);
      this.setPhase?.(state, this.pvpPhase?.SEEKING ?? "seeking");
      return "running";
    }

    const profile = this.getProfile?.(state) ?? null;
    if (this.drinkStartCombatPotion(player, state)) {
      this.setPhase?.(state, this.pvpPhase?.COMBAT ?? "combat");
      this.scheduleCombatAction?.(state, nowMs);
      return "running";
    }
    if (Number(profile?.confidenceTier ?? 0) >= 3) {
      this.ServerPerf.measurePhase("bot.pvp.combat_execution.prayer_flick", () =>
        this.reviewPrayers(player, state, target, nowMs, profile)
      );
    }
    this.ServerPerf.measurePhase("bot.pvp.combat_execution.spec", () =>
      this.maybeUseSpecialAttack?.({
        player,
        state,
        nowMs,
        target,
        profile,
        scheduleSpecReview: this.scheduleSpecReview,
      })
    );
    const pressureResult = this.ServerPerf.measurePhase(
      "bot.pvp.combat_execution.pressure_script",
      () =>
        this.maybeRunPressureCombatScript?.({
          player,
          state,
          nowMs,
          target,
          profile,
          scheduleCombatAction: this.scheduleCombatAction,
          scheduleFreezeReview: this.scheduleFreezeReview,
        })
    );
    if (pressureResult?.handled === true) {
      if (
        this.shouldForcePrayerSync(
          player,
          state,
          target,
          nowMs,
          pressureResult?.forcedCombatType ?? null
        )
      ) {
        this.ServerPerf.measurePhase("bot.pvp.combat_execution.prayer_review", () =>
          this.forcePrayerSync(player, state, target, nowMs, profile)
        );
      }
      this.setPhase?.(state, this.pvpPhase?.COMBAT ?? "combat");
      if (nowMs >= (pvp.nextTargetReviewAt ?? 0)) {
        this.scheduleReviewTimers?.(state, nowMs);
      }
      return "running";
    }
    this.ServerPerf.measurePhase("bot.pvp.combat_execution.combat_sync_or_reissue", () =>
      this.ServerPerf.measurePhase("bot.pvp.combat_sync.switchback", () =>
        this.maybeSwitchBackToPrimaryWeapon?.({
          player,
          state,
          nowMs,
        })
      )
    );
    if (nowMs >= Number(pvp.nextPrayerReviewAt ?? 0)) {
      this.ServerPerf.measurePhase("bot.pvp.combat_execution.prayer_review", () =>
        this.reviewPrayers(player, state, target, nowMs, profile)
      );
    }

    if (nowMs < (pvp.nextActionAt ?? 0)) {
      this.setPhase?.(state, this.pvpPhase?.COMBAT ?? "combat");
      return "running";
    }

    this.ServerPerf.measurePhase("bot.pvp.combat_execution.combat_sync_or_reissue", () =>
      this.ServerPerf.measurePhase("bot.pvp.combat_sync.attack_reissue", () => {
        const currentTarget = combat.getTarget?.();
        if (currentTarget && currentTarget !== target) {
          combat.reset?.();
        }

        if (
          this.CombatFactory.canAttackPermission(
            player,
            target,
            false,
            this.CombatFactory.getMethod(player)
          ) !==
          CanAttackResponse.CAN_ATTACK
        ) {
          clearApproachForTarget(player, target);
          return;
        }

        if (combat.getTarget?.() !== target) {
          player.getMovementQueue?.().reset?.();
          player.setFollowing?.(target);
          player.setMobileInteraction?.(target);
          combat.attack(target);
        }
      })
    );

    this.setPhase?.(state, this.pvpPhase?.COMBAT ?? "combat");
    this.scheduleCombatAction?.(state, nowMs);
    if (nowMs >= (pvp.nextTargetReviewAt ?? 0)) {
      this.scheduleReviewTimers?.(state, nowMs);
    }
    return "running";
  }
}

module.exports = {
  PvpCombatExecutionNode,
};
