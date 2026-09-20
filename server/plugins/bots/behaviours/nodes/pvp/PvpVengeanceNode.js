"use strict";

const { EffectSpells } = require("../../../../../src/main/typescript/elvarg/game/content/combat/magic/EffectSpells");
const { MagicSpellbook } = require("../../../../../src/main/typescript/elvarg/game/model/MagicSpellbook");

const PROFILE_VENGEANCE_USE_CHANCE = Object.freeze({
  novice: 0.34,
  standard: 0.56,
  veteran: 0.78,
  elite: 0.92,
});

function randomInRange(min, max) {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  return lower + Math.floor(Math.random() * (upper - lower + 1));
}

function isEngagedWithTarget(player, target) {
  if (!player || !target) {
    return false;
  }
  const playerCombat = player.getCombat?.();
  const targetCombat = target.getCombat?.();
  return !!(
    playerCombat?.getTarget?.() === target ||
    playerCombat?.getAttacker?.() === target ||
    player.getCombatFollowing?.() === target ||
    player.getFollowing?.() === target ||
    targetCombat?.getTarget?.() === player ||
    targetCombat?.getAttacker?.() === player ||
    target.getCombatFollowing?.() === player
  );
}

function resolvePrecastDistance(profile) {
  const chaseDistance = Number(profile?.chaseDistanceTiles ?? 8);
  if (!Number.isFinite(chaseDistance)) {
    return 7;
  }
  return Math.max(6, Math.min(10, Math.floor(chaseDistance)));
}

class PvpVengeanceNode {
  constructor(options = {}) {
    this.setPhase = options.setPhase;
    this.scheduleCombatAction = options.scheduleCombatAction;
    this.getProfile = options.getProfile;
    this.pvpPhase = options.pvpPhase;
  }

  tick(context) {
    const { player, state, nowMs, target } = context ?? {};
    const pvp = state?.pvp;
    if (!player || !state || !pvp || !target) {
      return { handled: false, status: "failure" };
    }
    if (typeof pvp.loadoutId === "string" && pvp.loadoutId.startsWith("f2p_")) {
      return { handled: false, status: "running" };
    }
    if (player.getSpellbook?.() !== MagicSpellbook.LUNAR) {
      return { handled: false, status: "running" };
    }
    if (nowMs < Number(pvp.nextVengeanceAttemptAt ?? 0)) {
      return { handled: false, status: "running" };
    }
    if (
      target.isRegistered?.() !== true ||
      (target.getHitpoints?.() ?? 0) <= 0 ||
      (player.getHitpoints?.() ?? 0) <= 0
    ) {
      return { handled: false, status: "running" };
    }
    if (player.hasVengeanceReturn?.() === true) {
      pvp.nextVengeanceAttemptAt = nowMs + randomInRange(1200, 2200);
      return { handled: false, status: "running" };
    }
    if (player.getVengeanceTimer?.().finished?.() !== true) {
      pvp.nextVengeanceAttemptAt = nowMs + randomInRange(900, 1800);
      return { handled: false, status: "running" };
    }

    const profile = this.getProfile?.(state) ?? null;
    const useChance =
      PROFILE_VENGEANCE_USE_CHANCE[profile?.id ?? ""] ??
      PROFILE_VENGEANCE_USE_CHANCE.standard;
    if (Math.random() > useChance) {
      pvp.nextVengeanceAttemptAt = nowMs + randomInRange(1200, 2600);
      return { handled: false, status: "running" };
    }

    const distance = player.getLocation?.().getDistance?.(target.getLocation?.()) ?? 99;
    const engaged = isEngagedWithTarget(player, target);
    if (!engaged && distance > resolvePrecastDistance(profile)) {
      pvp.nextVengeanceAttemptAt = nowMs + randomInRange(1000, 1900);
      return { handled: false, status: "running" };
    }

    const spellId = EffectSpells.VENGEANCE?.spellId?.();
    if (!Number.isInteger(spellId)) {
      pvp.nextVengeanceAttemptAt = nowMs + randomInRange(1800, 3200);
      return { handled: false, status: "running" };
    }

    EffectSpells.handleSpell(player, spellId);
    if (player.hasVengeanceReturn?.() === true) {
      pvp.lastVengeanceAt = nowMs;
      pvp.nextVengeanceAttemptAt = nowMs + randomInRange(1800, 3200);
      this.setPhase?.(state, this.pvpPhase?.COMBAT ?? "combat");
      return { handled: true, status: "running" };
    }

    pvp.nextVengeanceAttemptAt = nowMs + randomInRange(1600, 3200);
    return { handled: false, status: "running" };
  }
}

module.exports = {
  PvpVengeanceNode,
};
