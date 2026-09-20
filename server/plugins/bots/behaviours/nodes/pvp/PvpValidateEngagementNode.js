"use strict";

const { CanAttackResponse } = require("../../../../../src/main/typescript/elvarg/game/content/combat/CombatFactory");

class PvpValidateEngagementNode {
  constructor(options = {}) {
    this.AreaManager = options.api.getAreaManager();
    this.CombatFactory = options.api.getCombatFactory();
    this.behaviorMode = options.behaviorMode;
    this.setPhase = options.setPhase;
    this.stopPvp = options.stopPvp;
    this.resolveTargetPlayer = options.resolveTargetPlayer;
    this.isValidTarget = options.isValidTarget;
    this.isActivelyEngagedWithTarget = options.isActivelyEngagedWithTarget;
    this.randomInRange = options.randomInRange;
    this.pvpPhase = options.pvpPhase;
    this.isPvpOnly = options.isPvpOnly;
    this.resetSeekingState = options.resetSeekingState;
  }

  tick(context) {
    const { player, state, nowMs } = context ?? {};
    const pvp = state?.pvp;
    const pvpOnly = this.isPvpOnly?.(state) === true;
    if (!player || !state || !pvp) {
      return { handled: true, status: "failure", target: null };
    }
    if (!pvp.targetUsername) {
      this.setPhase?.(state, this.pvpPhase?.SEEKING ?? "seeking");
      if (pvpOnly) {
        this.resetSeekingState?.(player, state, nowMs, "missing_target");
      } else {
        this.stopPvp?.(player, state, nowMs, "missing_target");
      }
      return { handled: true, status: "success", target: null };
    }

    if ((player.getHitpoints?.() ?? 0) <= 0) {
      this.setPhase?.(state, this.pvpPhase?.DEAD ?? "dead");
      this.stopPvp?.(player, state, nowMs, "dead");
      return { handled: true, status: "success", target: null };
    }

    const target = this.resolveTargetPlayer?.(state) ?? null;
    if (!this.isValidTarget?.(player, target)) {
      this.setPhase?.(state, this.pvpPhase?.SEEKING ?? "seeking");
      if (pvpOnly) {
        this.resetSeekingState?.(player, state, nowMs, "invalid_target");
      } else {
        this.stopPvp?.(player, state, nowMs, "invalid_target");
      }
      return { handled: true, status: "success", target: null };
    }

    if (nowMs >= (pvp.endsAt ?? 0)) {
      if (this.isActivelyEngagedWithTarget?.(player, target)) {
        pvp.endsAt = nowMs + this.randomInRange?.(8000, 15000);
      } else {
        this.setPhase?.(state, this.pvpPhase?.IDLE ?? "idle");
        if (pvpOnly) {
          this.resetSeekingState?.(player, state, nowMs, "expired");
        } else {
          this.stopPvp?.(player, state, nowMs, "expired");
        }
        return { handled: true, status: "success", target: null };
      }
    }

    const targetCombat = target.getCombat?.();
    const targetTarget = targetCombat?.getTarget?.();
    const targetAttacker = targetCombat?.getAttacker?.();
    const targetFollowing = target.getCombatFollowing?.();
    const isMultiEngagement = this.AreaManager.inMulti(player) && this.AreaManager.inMulti(target);
    const hasOtherOccupant =
      (!targetTarget || targetTarget === player
        ? false
        : targetTarget.isRegistered?.() === true &&
          (targetTarget.getHitpoints?.() ?? 0) > 0) ||
      (!targetAttacker || targetAttacker === player
        ? false
        : targetAttacker.isRegistered?.() === true &&
          (targetAttacker.getHitpoints?.() ?? 0) > 0) ||
      (!targetFollowing || targetFollowing === player
        ? false
        : targetFollowing.isRegistered?.() === true &&
          (targetFollowing.getHitpoints?.() ?? 0) > 0);
    if (!isMultiEngagement && hasOtherOccupant &&
        this.CombatFactory.canAttackPermission(player, target, false,
          this.CombatFactory.getMethod(player)) !== CanAttackResponse.CAN_ATTACK) {
      this.setPhase?.(state, this.pvpPhase?.SEEKING ?? "seeking");
      if (pvpOnly) {
        this.resetSeekingState?.(player, state, nowMs, "target_in_other_combat");
      } else {
        this.stopPvp?.(player, state, nowMs, "target_in_other_combat");
      }
      return { handled: true, status: "success", target: null };
    }

    return { handled: false, status: "running", target };
  }
}

module.exports = {
  PvpValidateEngagementNode,
};
