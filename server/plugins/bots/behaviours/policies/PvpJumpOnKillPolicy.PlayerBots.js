"use strict";

const { Wilderness } = require("../../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const {
  canAttackByWildernessLevel,
} = require("../../../areas/Wilderness.plugin");
const { isPvpOnlyBotState } = require("../state/State.PlayerBots");

const IMMEDIATE_PJ_DURATION_MS = 30000;
const DEFAULT_PJ_USE_CHANCE_BY_PROFILE = Object.freeze({
  novice: 0.42,
  standard: 0.66,
  veteran: 0.88,
  elite: 1,
});
const DEFAULT_PJ_MAX_RESPONDERS = 3;

class PvpJumpOnKillPolicy {
  constructor(options = {}) {
    this.botStatesByName = options.botStatesByName ?? new Map();
    this.World = options.api.getWorld();
    this.behaviorMode = options.behaviorMode ?? {};
    this.config = options.config ?? {};
  }

  isPersistentPvpState(state) {
    return isPvpOnlyBotState(state);
  }

  resolvePrimaryRealPlayerDamager(victim, killer) {
    if (
      killer &&
      killer.isPlayerBot?.() !== true &&
      killer.isRegistered?.() &&
      (killer.getHitpoints?.() ?? 0) > 0
    ) {
      return killer;
    }

    const damageEntries = [
      ...((victim?.__recentDeathDamagerEntries ?? victim?.getCombat?.().getRecentDamagerEntries?.()) ??
        []),
    ];
    let bestTarget = null;
    let bestDamage = -1;

    for (const entry of damageEntries) {
      const target = entry?.player;
      if (!target || target.isPlayerBot?.() === true) {
        continue;
      }
      if (!target.isRegistered?.() || (target.getHitpoints?.() ?? 0) <= 0) {
        continue;
      }

      const damage = Number(entry?.damage ?? 0);
      if (damage > bestDamage) {
        bestTarget = target;
        bestDamage = damage;
      }
    }

    return bestTarget;
  }

  getPjUseChance(state) {
    const profileId = state?.pvp?.profileId ?? "standard";
    const configuredChance =
      this.config?.pjUseChanceByProfile?.[profileId] ??
      DEFAULT_PJ_USE_CHANCE_BY_PROFILE[profileId] ??
      DEFAULT_PJ_USE_CHANCE_BY_PROFILE.standard;
    if (!Number.isFinite(configuredChance)) {
      return DEFAULT_PJ_USE_CHANCE_BY_PROFILE.standard;
    }
    return Math.max(0, Math.min(1, configuredChance));
  }

  shouldUsePj(state) {
    return Math.random() <= this.getPjUseChance(state);
  }

  resolveNearbyJumpBots(victim, target, distanceTiles, maxResponders) {
    if (!victim || !target) {
      return [];
    }

    const nearbyPlayers = this.World.getNearbyPlayersForUpdate?.(victim) ?? [];
    const victimLoc = victim.getLocation?.();
    const victimPrivateArea = victim.getPrivateArea?.();
    const candidates = [];

    for (const candidate of nearbyPlayers) {
      if (!candidate || candidate === victim || candidate === target) {
        continue;
      }
      if (candidate.isPlayerBot?.() !== true || !candidate.isRegistered?.()) {
        continue;
      }
      if ((candidate.getHitpoints?.() ?? 0) <= 0) {
        continue;
      }
      if (candidate.getPrivateArea?.() !== victimPrivateArea) {
        continue;
      }
      // A jump-on-kill response is still a Wilderness attack: only bots that may actually
      // attack the real player at this depth join in. Otherwise a low-level bystander turns
      // at a player it can never hit, and core refuses it a tick later (#5329).
      if (!canAttackByWildernessLevel(candidate, target)) {
        continue;
      }

      const state = this.botStatesByName.get(candidate.getUsername?.());
      if (!this.isPersistentPvpState(state)) {
        continue;
      }
      if (!this.shouldUsePj(state)) {
        continue;
      }

      const candidateLoc = candidate.getLocation?.();
      if (
        !victimLoc ||
        !candidateLoc ||
        victimLoc.getZ?.() !== candidateLoc.getZ?.()
      ) {
        continue;
      }
      const distance = victimLoc.getDistance(candidateLoc);
      if (distance > distanceTiles) {
        continue;
      }
      candidates.push({ bot: candidate, state, distance });
    }

    candidates.sort((left, right) => left.distance - right.distance);
    return candidates.slice(0, Math.max(1, maxResponders));
  }

  signalJump(bot, state, target, nowMs) {
    if (!bot || !state?.pvp || !target) {
      return false;
    }
    if (state.mode !== this.behaviorMode.PVP) {
      return false;
    }

    const durationMs = Math.max(
      1000,
      Number(this.config.immediatePjDurationMs ?? IMMEDIATE_PJ_DURATION_MS)
    );
    const targetUsername = target.getUsername?.();
    if (!targetUsername) {
      return false;
    }
    if (!canAttackByWildernessLevel(bot, target)) {
      return false;
    }

    state.pvp.pjTargetUsername = targetUsername;
    state.pvp.pjExpiresAt = nowMs + durationMs;
    state.pvp.pjVictimUsername = null;
    state.pvp.pjVictimExpiresAt = 0;
    state.pvp.nextActionAt = nowMs;
    return true;
  }

  handle({ killer, victim, nowMs = Date.now() }) {
    if (!victim || victim.isPlayerBot?.() !== true || !Wilderness.isIn(victim)) {
      return;
    }

    const target = this.resolvePrimaryRealPlayerDamager(victim, killer);
    if (!target || !Wilderness.isIn(target)) {
      return;
    }

    const jumpCandidates = this.resolveNearbyJumpBots(
      victim,
      target,
      Number(this.config.pjObserveDistanceTiles ?? 12),
      Number(this.config.pjMaxResponders ?? DEFAULT_PJ_MAX_RESPONDERS)
    );
    if (jumpCandidates.length === 0) {
      return;
    }

    for (const candidate of jumpCandidates) {
      this.signalJump(candidate.bot, candidate.state, target, nowMs);
    }
  }
}

module.exports = {
  PvpJumpOnKillPolicy,
};
