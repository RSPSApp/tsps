"use strict";

const { CombatType } = require("../../../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { CombatSpells } = require("../../../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");
const { MagicSpellbook } = require("../../../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { Skill } = require("../../../../src/main/typescript/elvarg/game/model/Skill");
const { EquipPacketListener } = require("../../../../src/main/typescript/elvarg/net/packet/impl/EquipPacketListener");
const { TimerKey } = require("../../../../src/main/typescript/elvarg/util/timers/TimerKey");
const { Inventory } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Inventory");
const {
  equipStyleGear,
  resolveOffensiveSpell,
  BOW_INTERFACES,
  CROSSBOW_INTERFACES,
  getAmmoId,
  getPvpCombatSnapshot,
  getWeaponId,
  invalidatePvpCombatSnapshot,
  isRangedInterface,
  resolveInventorySlotByItemId,
  isStaffInterface,
  resolveCurrentCombatType,
} = require("./PvpCombatRuntimeCache");

const PRESSURE_WINDOW_TICKS = 1;
const MELEE_DISTANCE_TILES = 1;
const PRESSURE_RETRY_COOLDOWN_MS = 450;
const PRESSURE_FAILURE_COOLDOWN_MS = 300;
const FREEZE_SPELLS = Object.freeze({
  veteran: CombatSpells.SNARE,
  elite: CombatSpells.ENTANGLE,
});

let PrayerHandler = null;
let ServerPerf = null;

/** Called once from PvpBehavior.js's constructor, before any tick() runs. */
function initPvpPressureCombatPolicyCoreAccess(api) {
  PrayerHandler = api.getPrayerHandler();
  ServerPerf = api.getServerPerf();
}

function isVeteranOrEliteProfile(profile) {
  return profile?.id === "veteran" || profile?.id === "elite";
}

function getDistance(player, target) {
  const playerLoc = player?.getLocation?.();
  const targetLoc = target?.getLocation?.();
  if (!playerLoc || !targetLoc || playerLoc.getZ?.() !== targetLoc.getZ?.()) {
    return 99;
  }
  return Number(playerLoc.getDistance?.(targetLoc) ?? 99);
}

function getTargetHpRatio(target) {
  const current = Math.max(
    0,
    Number(target?.getHitpointsAfterPendingDamage?.() ?? target?.getHitpoints?.() ?? 0)
  );
  let max = current;
  if (target?.isPlayer?.() === true) {
    max = Number(target?.getSkillManager?.()?.getMaxLevel?.(Skill.HITPOINTS) ?? current ?? 1);
  }
  return current / Math.max(1, max);
}

function isAttackWindowOpen(player) {
  return player?.getCombat?.()?.willAttackBeReadyIn?.(PRESSURE_WINDOW_TICKS) === true;
}

function equipInventoryItem(player, slot, itemId) {
  if (!player || slot < 0 || itemId <= 0) {
    return false;
  }
  EquipPacketListener.equip(player, itemId, slot, Inventory.INTERFACE_ID);
  return true;
}

function isLikelyMeleeThreat(target) {
  const targetWeapon = target?.getWeapon?.();
  if (!targetWeapon) {
    return false;
  }
  if (isStaffInterface(targetWeapon) || isRangedInterface(targetWeapon)) {
    return false;
  }
  return true;
}

function canUseMagicPressure(player) {
  return resolveOffensiveSpell(player) != null;
}

function shouldUseFreeze(player, profile, magicCandidate, pressureContext) {
  if (!magicCandidate || !isVeteranOrEliteProfile(profile)) {
    return false;
  }
  if (player?.getSpellbook?.() !== MagicSpellbook.NORMAL) {
    return false;
  }
  if (!pressureContext?.targetLikelyMeleeThreat) {
    return false;
  }
  if (pressureContext?.targetFrozen || pressureContext?.targetFreezeImmune) {
    return false;
  }
  return Math.random() <= Number(profile?.nextHitFreezeChance ?? profile?.freezeUseChance ?? 0);
}

function buildPressureContext(player, target, state) {
  const targetPrayers = target?.getPrayerActive?.() ?? [];
  let currentCombatType = null;
  const runtimeSnapshot = state?.pvp?.runtimeCombatSnapshot?.snapshot ?? null;
  if (runtimeSnapshot?.currentCombatType != null) {
    currentCombatType = runtimeSnapshot.currentCombatType;
  } else {
    currentCombatType = resolveCurrentCombatType(
      player,
      player?.getWeapon?.(),
      getWeaponId(player)
    );
  }
  return {
    targetPrayers,
    targetHpRatio: getTargetHpRatio(target),
    distance: getDistance(player, target),
    preferredStyle: state?.pvp?.preferredCombatStyle,
    targetFrozen: target?.getTimers?.().has?.(TimerKey.FREEZE) === true,
    targetFreezeImmune: target?.getTimers?.().has?.(TimerKey.FREEZE_IMMUNITY) === true,
    targetLikelyMeleeThreat: isLikelyMeleeThreat(target),
    magicPressureAvailable: canUseMagicPressure(player),
    currentCombatType,
  };
}

function isCurrentStyleAlreadyGoodEnough(pressureContext) {
  if (!pressureContext) {
    return false;
  }
  const currentCombatType = pressureContext.currentCombatType;
  if (!Number.isInteger(currentCombatType)) {
    return false;
  }
  const targetPrayers = pressureContext.targetPrayers ?? [];
  try {
    const protectingPrayer = PrayerHandler.getProtectingPrayer(currentCombatType);
    if (targetPrayers[protectingPrayer] === true) {
      return false;
    }
  } catch (_error) {
    // No direct protection prayer mapping; fall through to positional checks.
  }

  const distance = Number(pressureContext.distance ?? 99);
  if (currentCombatType === CombatType.MELEE) {
    return distance <= MELEE_DISTANCE_TILES;
  }
  if (currentCombatType === CombatType.RANGED) {
    return distance > MELEE_DISTANCE_TILES;
  }
  if (currentCombatType === CombatType.MAGIC) {
    if (
      pressureContext.targetLikelyMeleeThreat &&
      !pressureContext.targetFrozen &&
      !pressureContext.targetFreezeImmune
    ) {
      return false;
    }
    return true;
  }
  return false;
}

function scoreCandidate(candidate, state, profile, pressureContext) {
  if (!candidate) {
    return Number.NEGATIVE_INFINITY;
  }
  const targetPrayers = pressureContext?.targetPrayers ?? [];
  const targetHpRatio = Number(pressureContext?.targetHpRatio ?? 1);
  const distance = Number(pressureContext?.distance ?? 99);
  const preferredStyle = pressureContext?.preferredStyle ?? state?.pvp?.preferredCombatStyle;
  let score = candidate.current ? 0.45 : 0.2;

  if (candidate.combatType === CombatType.MAGIC && pressureContext?.magicPressureAvailable !== true) {
    return Number.NEGATIVE_INFINITY;
  }

  try {
    const protectingPrayer = PrayerHandler.getProtectingPrayer(candidate.combatType);
    if (targetPrayers[protectingPrayer] === true) {
      score -= 1.4;
    } else {
      score += 0.7;
    }
  } catch (_error) {
    score += 0.2;
  }

  if (
    (candidate.combatType === CombatType.MAGIC && preferredStyle === "hybrid") ||
    (candidate.combatType === CombatType.RANGED && preferredStyle === "range") ||
    (candidate.combatType === CombatType.MELEE && preferredStyle === "melee")
  ) {
    score += 0.12;
  }

  if (candidate.combatType === CombatType.MELEE) {
    if (distance <= MELEE_DISTANCE_TILES) {
      score += 0.95;
    } else {
      score -= 1.1;
    }
    if (targetHpRatio <= Number(profile?.nextHitMeleeFinisherHpRatio ?? 0.45)) {
      score += 0.95;
    }
    if (pressureContext?.targetFrozen) {
      score += 0.2;
    }
  } else if (candidate.combatType === CombatType.RANGED) {
    if (distance > MELEE_DISTANCE_TILES) {
      score += 0.65;
    }
    if (pressureContext?.targetFrozen) {
      score += 0.55;
    }
    if (!candidate.ammo && (BOW_INTERFACES.has(candidate.weaponInterface) || CROSSBOW_INTERFACES.has(candidate.weaponInterface))) {
      score -= 2;
    }
  } else if (candidate.combatType === CombatType.MAGIC) {
    if (pressureContext?.targetLikelyMeleeThreat) {
      score += 0.45;
    }
    if (!pressureContext?.targetFrozen && !pressureContext?.targetFreezeImmune) {
      score += 0.25;
    }
  }

  return score;
}

function chooseBestCandidate(candidates, state, profile, pressureContext) {
  let bestCandidate = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates.values()) {
    const score = scoreCandidate(candidate, state, profile, pressureContext);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }
  return bestCandidate;
}

function maybeEquipCandidate(player, candidate, state) {
  if (!candidate) {
    return false;
  }
  const weaponSlot = resolveInventorySlotByItemId(
    player,
    candidate.weaponId,
    state?.pvp?.runtimeCombatSnapshot?.snapshot ?? null,
    candidate.slot
  );
  if (weaponSlot >= 0 && getWeaponId(player) !== candidate.weaponId) {
    equipInventoryItem(player, weaponSlot, candidate.weaponId);
    invalidatePvpCombatSnapshot(state);
  }
  const ammoId = candidate.ammo?.ammoId ?? candidate.ammo?.itemId ?? -1;
  const ammoSlot = resolveInventorySlotByItemId(
    player,
    ammoId,
    state?.pvp?.runtimeCombatSnapshot?.snapshot ?? null,
    candidate.ammo?.slot ?? -1
  );
  if (
    candidate.ammo &&
    ammoSlot >= 0 &&
    getAmmoId(player) !== (candidate.ammo.ammoId ?? candidate.ammo.itemId)
  ) {
    equipInventoryItem(player, ammoSlot, candidate.ammo.ammoId ?? candidate.ammo.itemId);
    invalidatePvpCombatSnapshot(state);
  }
  if (getWeaponId(player) !== candidate.weaponId) return false;
  if (equipStyleGear(player, candidate.combatType)) invalidatePvpCombatSnapshot(state);
  return true;
}

function tryQueuedSpecialAttack(player, target) {
  const combat = player?.getCombat?.();
  if (!combat || !target) {
    return false;
  }
  const graniteQueued = combat.isGraniteMaulSpecialQueued?.() === true;
  if (player?.isSpecialActivated?.() !== true && !graniteQueued) {
    return false;
  }
  combat.attack(target);
  return true;
}

function executePressureStyle(player, target, candidate, state) {
  const combat = player?.getCombat?.();
  if (!combat || !candidate) {
    return false;
  }
  if (!maybeEquipCandidate(player, candidate, state)) {
    return false;
  }
  if (candidate.combatType === CombatType.MAGIC) {
    const spell = resolveOffensiveSpell(player);
    if (!spell) return false;
    if (isStaffInterface(player.getWeapon())) {
      const { Autocasting } = require("../../../../src/main/typescript/elvarg/game/content/combat/magic/Autocasting");
      Autocasting.setAutocast(player, spell);
    }
    combat.castSpellOn(target, spell);
  } else {
    combat.setCastSpell(null);
    combat.setAutocastSpell(null);
    combat.attack(target);
  }
  return true;
}

function schedulePressureCheck(state, nowMs, delayMs) {
  if (!state?.pvp) {
    return false;
  }
  state.pvp.nextPressureCheckAt = nowMs + Math.max(100, Math.floor(delayMs));
  return true;
}

function maybeRunPressureCombatScript(context) {
  const {
    player,
    state,
    target,
    nowMs,
    profile,
    scheduleCombatAction,
    scheduleFreezeReview,
  } = context ?? {};
  const pvp = state?.pvp;
  if (!player || !target || !pvp || !profile) {
    return { handled: false, forcedCombatType: null };
  }
  if (!isAttackWindowOpen(player)) {
    pvp.pressureAttackReviewed = false;
    return { handled: false, forcedCombatType: null };
  }
  // Hold the selected setup until this attack opportunity has passed. This also
  // prevents repeated rolls while chasing or waiting for a clear attack tile.
  if (pvp.pressureAttackReviewed || pvp.lastSpecAt === nowMs) {
    return { handled: true, forcedCombatType: null };
  }
  if (nowMs < Number(pvp.nextPressureCheckAt ?? 0)) {
    return { handled: false, forcedCombatType: null };
  }

  const queuedSpecialHandled = ServerPerf.measurePhase(
    "bot.pvp.pressure_script.queued_special",
    () => tryQueuedSpecialAttack(player, target)
  );
  if (queuedSpecialHandled) {
    pvp.lastPressureScriptAt = nowMs;
    schedulePressureCheck(state, nowMs, PRESSURE_RETRY_COOLDOWN_MS);
    scheduleCombatAction?.(state, nowMs);
    const combatSnapshot = getPvpCombatSnapshot(player, state, nowMs);
    return {
      handled: true,
      forcedCombatType:
        combatSnapshot?.currentCombatType ??
        resolveCurrentCombatType(player, player?.getWeapon?.(), getWeaponId(player)),
    };
  }

  const cooldownMs = Math.max(200, Number(profile?.nextHitScriptCooldownMs ?? 450));
  if (nowMs < Number(pvp.lastPressureScriptAt ?? 0) + cooldownMs) {
    return { handled: false, forcedCombatType: null };
  }
  pvp.pressureAttackReviewed = true;
  if (Math.random() > Number(profile?.nextHitScriptChance ?? 1)) {
    schedulePressureCheck(state, nowMs, PRESSURE_FAILURE_COOLDOWN_MS);
    return { handled: false, forcedCombatType: null };
  }

  const combatSnapshot = ServerPerf.measurePhase("bot.pvp.pressure_script.snapshot", () =>
    getPvpCombatSnapshot(player, state, nowMs)
  );
  const candidates = new Map(combatSnapshot?.styleCandidatesByType);
  const pressureContext = ServerPerf.measurePhase("bot.pvp.pressure_script.context", () =>
    buildPressureContext(player, target, state)
  );
  if (!pressureContext.magicPressureAvailable) candidates.delete(CombatType.MAGIC);
  if (candidates.size > 1) pressureContext.preferredStyle = "hybrid";
  const meleeFinisher =
    pressureContext.targetHpRatio <= Number(profile.nextHitMeleeFinisherHpRatio ?? 0.45) &&
    (pressureContext.distance <= MELEE_DISTANCE_TILES || !player.getTimers().has(TimerKey.FREEZE)) &&
    pressureContext.targetPrayers[PrayerHandler.getProtectingPrayer(CombatType.MELEE)] !== true
      ? candidates.get(CombatType.MELEE)
      : null;
  if (
    !meleeFinisher &&
    candidates.size < 2 &&
    pressureContext.currentCombatType !== CombatType.MAGIC &&
    pressureContext.preferredStyle !== "hybrid" &&
    ServerPerf.measurePhase("bot.pvp.pressure_script.fast_keep_style", () =>
      isCurrentStyleAlreadyGoodEnough(pressureContext)
    )
  ) {
    schedulePressureCheck(state, nowMs, PRESSURE_RETRY_COOLDOWN_MS);
    return {
      handled: false,
      forcedCombatType: pressureContext?.currentCombatType ?? null,
    };
  }
  const magicCandidate = candidates.get(CombatType.MAGIC) ?? null;
  const switchIntervalMs = ({ novice: 7200, standard: 4800, veteran: 3600, elite: 2400 })[profile.id] ?? 4800;
  const canSwitchStyle = nowMs >= Number(pvp.lastStyleSwitchAt ?? 0) + switchIntervalMs;
  const shouldFreeze = canSwitchStyle && ServerPerf.measurePhase("bot.pvp.pressure_script.freeze_check", () =>
    shouldUseFreeze(player, profile, magicCandidate, pressureContext)
  );
  if (shouldFreeze) {
    if (
      ServerPerf.measurePhase("bot.pvp.pressure_script.freeze_cast", () =>
        maybeEquipCandidate(player, magicCandidate, state)
      )
    ) {
      player.getCombat?.().castSpellOn?.(target, FREEZE_SPELLS[profile.id]);
      pvp.lastStyleSwitchAt = nowMs;
      pvp.lastFreezeAt = nowMs;
      pvp.lastPressureScriptAt = nowMs;
      schedulePressureCheck(state, nowMs, PRESSURE_RETRY_COOLDOWN_MS);
      scheduleCombatAction?.(state, nowMs);
      scheduleFreezeReview?.(state, nowMs);
      return { handled: true, forcedCombatType: CombatType.MAGIC };
    }
  }

  let bestCandidate = ServerPerf.measurePhase("bot.pvp.pressure_script.choose_candidate", () =>
    meleeFinisher ?? chooseBestCandidate(candidates, state, profile, pressureContext)
  );
  const currentCandidate = [...candidates.values()].find((candidate) => candidate.current);
  if (currentCandidate && bestCandidate && bestCandidate !== currentCandidate &&
      (!canSwitchStyle || (!meleeFinisher &&
        scoreCandidate(bestCandidate, state, profile, pressureContext) <
        scoreCandidate(currentCandidate, state, profile, pressureContext) + 0.6))) {
    bestCandidate = currentCandidate;
  }
  if (!bestCandidate) {
    schedulePressureCheck(state, nowMs, PRESSURE_FAILURE_COOLDOWN_MS);
    return { handled: false, forcedCombatType: null };
  }
  if (bestCandidate.combatType !== pressureContext.currentCombatType && !meleeFinisher) {
    const currentProtected = pressureContext.targetPrayers[
      PrayerHandler.getProtectingPrayer(pressureContext.currentCombatType)
    ] === true;
    const candidateProtected = pressureContext.targetPrayers[
      PrayerHandler.getProtectingPrayer(bestCandidate.combatType)
    ] === true;
    const switchChance = Math.min(0.995,
      Number(profile?.nextHitStyleSwitchChance ?? profile?.switchChance ?? 0.5) +
      (currentProtected && !candidateProtected ? 0.1 : 0));
    if (Math.random() > switchChance) {
      schedulePressureCheck(state, nowMs, PRESSURE_FAILURE_COOLDOWN_MS);
      return { handled: false, forcedCombatType: null };
    }
  }
  if (
    !ServerPerf.measurePhase("bot.pvp.pressure_script.execute_style", () =>
      executePressureStyle(player, target, bestCandidate, state)
    )
  ) {
    schedulePressureCheck(state, nowMs, PRESSURE_FAILURE_COOLDOWN_MS);
    return { handled: false, forcedCombatType: null };
  }

  if (bestCandidate.combatType !== pressureContext.currentCombatType) pvp.lastStyleSwitchAt = nowMs;
  pvp.lastPressureScriptAt = nowMs;
  schedulePressureCheck(state, nowMs, PRESSURE_RETRY_COOLDOWN_MS);
  scheduleCombatAction?.(state, nowMs);
  return { handled: true, forcedCombatType: bestCandidate.combatType };
}

module.exports = {
  initPvpPressureCombatPolicyCoreAccess,
  maybeRunPressureCombatScript,
};
