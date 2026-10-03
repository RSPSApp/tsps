"use strict";

const { Wilderness } = require("../../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const {
  CanAttackResponse,
} = require("../../../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { applyGeneratedPvpLoadout } = require("./PvpLoadoutPolicy");
const { scheduleCombatAction, scheduleReviewTimers } = require("./PvpTimingPolicy");
const { isPvpOnlyBotState } = require("../state/PlayerBotState");
const { setModePvp } = require("../state/PlayerBotState");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
} = require("../../runtime/BotRecruitConstants");

const CLAN_CHAT_ATTRIBUTE = "clan-chat:channel";

const IMMEDIATE_PJ_DURATION_MS = 30000;

class AvengeOpponentPolicy {
  constructor(options = {}) {
    this.botStatesByName = options.botStatesByName ?? new Map();
    this.AreaManager = options.api.getAreaManager();
    this.CombatFactory = options.api.getCombatFactory();
    this.behaviorMode = options.behaviorMode ?? {};
    this.config = options.config ?? {};
  }

  isPersistentPvpState(state) {
    return isPvpOnlyBotState(state);
  }

  clearDeadVictimCombatState(bot, state, victim) {
    if (!bot || !state || !victim) {
      return;
    }
    const combat = bot.getCombat?.();
    const currentTarget = combat?.getTarget?.();
    const currentAttacker = combat?.getAttacker?.();
    const following = bot.getCombatFollowing?.();
    const pvpTargetUsername = state?.pvp?.targetUsername;
    const victimUsername = victim.getUsername?.();
    const targetingVictim =
      currentTarget === victim ||
      currentAttacker === victim ||
      following === victim ||
      state?.pvp?.targetPlayer === victim ||
      (victimUsername && pvpTargetUsername === victimUsername);
    if (!targetingVictim) {
      return;
    }
    combat?.reset?.();
    combat?.setUnderAttack?.(null);
    bot.setFollowing?.(null);
    bot.setCombatFollowing?.(null);
    bot.setMobileInteraction?.(null);
    bot.setPositionToFace?.(null);
    bot.getMovementQueue?.().reset?.();
    if (state?.pvp) {
      state.pvp.targetPlayer = null;
      state.pvp.targetUsername = null;
      state.pvp.currentTargetScore = 0;
      state.pvp.targetLockUntil = 0;
    }
  }

  isFriendlyTarget(bot, candidate) {
    if (!bot || !candidate) {
      return false;
    }
    if (bot.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME) === candidate.getUsername?.()) {
      return true;
    }
    const botClan = bot.getAttribute?.(CLAN_CHAT_ATTRIBUTE);
    return botClan != null && candidate.getAttribute?.(CLAN_CHAT_ATTRIBUTE) === botClan;
  }

  resolveRealPlayerTarget(bot, realDamagerEntries, distanceTiles) {
    if (!bot || !Array.isArray(realDamagerEntries) || realDamagerEntries.length === 0) {
      return null;
    }
    const botLoc = bot.getLocation?.();
    const botPrivateArea = bot.getPrivateArea?.();
    let bestTarget = null;
    let bestDamage = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const entry of realDamagerEntries) {
      const candidate = entry?.player;
      if (!candidate || candidate === bot || candidate.isPlayerBot?.() === true) {
        continue;
      }
      if (this.isFriendlyTarget(bot, candidate)) {
        continue;
      }
      if (!candidate.isRegistered?.() || (candidate.getHitpoints?.() ?? 0) <= 0) {
        continue;
      }
      if (candidate.getPrivateArea?.() !== botPrivateArea) {
        continue;
      }
      const candidateLoc = candidate.getLocation?.();
      if (
        !botLoc ||
        !candidateLoc ||
        botLoc.getZ?.() !== candidateLoc.getZ?.() ||
        botLoc.getDistance?.(candidateLoc) > distanceTiles
      ) {
        continue;
      }
      const distance = botLoc.getDistance(candidate.getLocation?.());
      const damage = Number(entry?.damage ?? 0);
      if (damage > bestDamage || (damage === bestDamage && distance < bestDistance)) {
        bestTarget = candidate;
        bestDamage = damage;
        bestDistance = distance;
      }
    }
    return bestTarget;
  }

  engageImmediately(bot, state, target, nowMs) {
    if (!bot || !state || !state.pvp || !target) {
      return false;
    }
    const isMultiEngagement = this.AreaManager.inMulti(bot) && this.AreaManager.inMulti(target);
    if (!isMultiEngagement) {
      const targetCombat = target.getCombat?.();
      const targetTarget = targetCombat?.getTarget?.();
      const targetAttacker = targetCombat?.getAttacker?.();
      const targetFollowing = target.getCombatFollowing?.();
      const occupiedByOther =
        (targetTarget &&
          targetTarget !== bot &&
          targetTarget.isRegistered?.() === true &&
          (targetTarget.getHitpoints?.() ?? 0) > 0) ||
        (targetAttacker &&
          targetAttacker !== bot &&
          targetAttacker.isRegistered?.() === true &&
          (targetAttacker.getHitpoints?.() ?? 0) > 0) ||
        (targetFollowing &&
          targetFollowing !== bot &&
          targetFollowing.isRegistered?.() === true &&
          (targetFollowing.getHitpoints?.() ?? 0) > 0);
      if (occupiedByOther) {
        return false;
      }
    }
    const method = this.CombatFactory.getMethod(bot);
    if (this.CombatFactory.canAttackPermission(bot, target, false, method) !== CanAttackResponse.CAN_ATTACK) {
      return false;
    }
    const durationMs = Math.max(
      1000,
      Number(this.config.immediatePjDurationMs ?? IMMEDIATE_PJ_DURATION_MS)
    );
    if (
      !setModePvp(
        bot,
        state,
        target,
        nowMs,
        durationMs,
        this.behaviorMode,
        { allowInCombatTransition: true }
      )
    ) {
      return false;
    }

    state.pvp.phase = "combat";
    state.pvp.pjTargetUsername = null;
    state.pvp.pjExpiresAt = 0;
    state.pvp.pjVictimUsername = null;
    state.pvp.pjVictimExpiresAt = 0;
    scheduleCombatAction(state, nowMs);
    scheduleReviewTimers(state, nowMs);
    applyGeneratedPvpLoadout(bot, state);
    bot.getMovementQueue?.().reset?.();
    bot.getCombat?.()?.attack?.(target);
    return true;
  }

  handle({ killer, victim, nowMs = Date.now() }) {
    if (!victim) {
      return;
    }
    if (!Wilderness.isIn(victim) || (killer && !Wilderness.isIn(killer))) {
      return;
    }

    const damageEntries = [
      ...((victim?.__recentDeathDamagerEntries ?? victim.getCombat?.().getRecentDamagerEntries?.()) ?? []),
    ];
    if (damageEntries.length === 0) {
      return;
    }

    const realDamagerEntries = damageEntries.filter(
      (entry) => entry?.player?.isPlayerBot?.() !== true
    );
    const botDamagerEntries = damageEntries.filter(
      (entry) =>
        entry?.player &&
        entry.player !== victim &&
        entry.player.isPlayerBot?.() === true
    );
    if (realDamagerEntries.length === 0 || botDamagerEntries.length === 0) {
      return;
    }

    for (const entry of botDamagerEntries) {
      const bot = entry?.player;
      if (!bot || !bot.isRegistered?.() || (bot.getHitpoints?.() ?? 0) <= 0) {
        continue;
      }
      const state = this.botStatesByName.get(bot.getUsername?.());
      if (!this.isPersistentPvpState(state)) {
        continue;
      }
      this.clearDeadVictimCombatState(bot, state, victim);
      const target = this.resolveRealPlayerTarget(
        bot,
        realDamagerEntries,
        Number(this.config.pjObserveDistanceTiles ?? 12)
      );
      if (target) {
        if (this.engageImmediately(bot, state, target, nowMs)) {
          bot.forceChat?.("You stole my kill!");
        }
      }
    }
  }
}

module.exports = {
  AvengeOpponentPolicy,
};
