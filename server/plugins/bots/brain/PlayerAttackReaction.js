"use strict";

const { isPvpOnlyBotState } = require("../behaviours/state/PlayerBotState");
const { startBankTrip, startReactivePvp } = require("./BrainActivities");

const PERSISTENT_PVP_REACTION_DURATION_MS = 30000;
const FIGHT_REACTION_DURATION_MS = 30000;

function clampChance(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

/**
 * Fight back without skulling: a real player is only attacked after they
 * attacked us or already dealt damage; another bot can be hit immediately.
 */
function retaliateAgainstAttacker(bot, attacker, attackerIsPlayerBot, forceImmediate = false) {
  if (!bot || !attacker) {
    return;
  }
  const combat = bot.getCombat?.();
  if (!combat || bot.getHitpoints?.() <= 0 || attacker.getHitpoints?.() <= 0) {
    return;
  }
  if (combat.getTarget?.() === attacker) {
    return;
  }
  if (attackerIsPlayerBot || forceImmediate) {
    bot.getMovementQueue?.().reset?.();
    combat.attack(attacker);
    return;
  }
  const alreadyUnderAttackByPlayer = combat.getAttacker?.() === attacker;
  const alreadyHasDamageFromPlayer = combat.damageMapContains?.(attacker) === true;
  if (alreadyUnderAttackByPlayer || alreadyHasDamageFromPlayer) {
    bot.getMovementQueue?.().reset?.();
    combat.attack(attacker);
  }
}

function seedTarget(state, attacker, nowMs, durationMs) {
  if (!state?.pvp) {
    return;
  }
  state.pvp.targetUsername = attacker.getUsername?.() ?? null;
  state.pvp.targetPlayer = attacker;
  state.pvp.endsAt = Math.max(Number(state.pvp.endsAt ?? 0), nowMs + durationMs);
  state.pvp.nextActionAt = nowMs;
}

/**
 * Brain reaction to a player attacking one of our bots: pvp bots and recruits
 * fight through the nested pvp_engage overlay; other bots flee to a bank with
 * the bank_trip overlay or fight back, then resume whatever they were doing.
 */
function handlePlayerAttackReaction({
  bot,
  state,
  attacker,
  attackerIsPlayerBot,
  nowMs = Date.now(),
  playerAttackFleeChance,
  api,
}) {
  if (!bot || !state || !attacker) {
    return false;
  }
  if (state.pvp?.retreat) {
    return true;
  }

  if (isPvpOnlyBotState(state)) {
    seedTarget(state, attacker, nowMs, PERSISTENT_PVP_REACTION_DURATION_MS);
    startReactivePvp(bot, state, nowMs);
    retaliateAgainstAttacker(bot, attacker, attackerIsPlayerBot, true);
    api?.log?.("persistent_pvp_reaction", {
      bot: bot.getUsername?.() ?? null,
      attacker: attacker.getUsername?.() ?? null,
      attackerIsPlayerBot: attackerIsPlayerBot === true,
    });
    return true;
  }

  const fleeChance = clampChance(playerAttackFleeChance, 0.5);
  if (
    !attackerIsPlayerBot &&
    Math.random() < fleeChance &&
    startBankTrip(bot, state, nowMs)
  ) {
    api?.log?.("bot_run_away_started_by_attack", {
      bot: bot.getUsername?.() ?? null,
      attacker: attacker.getUsername?.() ?? null,
    });
    return true;
  }

  seedTarget(state, attacker, nowMs, FIGHT_REACTION_DURATION_MS);
  startReactivePvp(bot, state, nowMs);
  retaliateAgainstAttacker(bot, attacker, attackerIsPlayerBot);
  api?.log?.("attack_reaction_fight", {
    bot: bot.getUsername?.() ?? null,
    attacker: attacker.getUsername?.() ?? null,
    attackerIsPlayerBot: attackerIsPlayerBot === true,
  });
  return true;
}

module.exports = {
  handlePlayerAttackReaction,
};
