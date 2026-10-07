"use strict";

const { attachBrain } = require("./attachBrain");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
  ATTR_RECRUIT_RETURN_AFTER_DEATH_AT,
  ATTR_RECRUIT_OWNER_MISSING_SINCE,
} = require("../runtime/BotRecruitConstants");

/**
 * Runtime hand-offs into the brain (roam, recruit, reactive pvp, bank flee).
 * Configured once at boot.
 */
let service = null;

function configureBrainActivities(options = {}) {
  service = {
    runtime: options.runtime ?? null,
    registry: options.registry ?? null,
    world: options.world ?? null,
    resetMovementState: options.resetMovementState ?? null,
  };
}

/**
 * Starts activity `activityId` on a bot. With `stack`, an existing brain keeps
 * its activity and resumes it when this one ends; otherwise the brain is
 * replaced.
 */
function startActivity(player, activityId, options = {}) {
  const username = player?.getUsername?.();
  const entry = username ? service?.runtime?.entriesByUsername?.get?.(username) : null;
  const activity = service?.registry?.byId?.get(activityId) ?? null;
  if (!entry || !activity) {
    return false;
  }
  const nowMs = options.nowMs ?? Date.now();
  if (options.stack === true && entry.brain) {
    if (!entry.brain.isRunningActivity(activityId)) {
      entry.brain.pushActivity(activity, nowMs);
    }
    return true;
  }
  return attachBrain({
    runtime: service.runtime,
    registry: service.registry,
    world: service.world,
    bot: player,
    activity,
    home: options.home ?? null,
    resetMovementState: service.resetMovementState,
    nowMs,
  });
}

function startBrainRoam(player, state, nowMs = Date.now(), home = null) {
  return startActivity(player, "roam", {
    nowMs,
    home: home ?? state?.home ?? player?.getLocation?.(),
  });
}

/** Bank flee after a real-player attack; the parent activity resumes after. */
function startBankTrip(player, state, nowMs = Date.now()) {
  return startActivity(player, "bank_trip", { stack: true, nowMs, home: state?.home });
}

/** Fights the seeded state.pvp target, then hands back to the parent activity. */
function startReactivePvp(player, state, nowMs = Date.now()) {
  if (state?.pvp) {
    state.pvp.phase = "combat";
    state.pvp.nextActionAt = nowMs;
  }
  return startActivity(player, "pvp_engage", { stack: true, nowMs, home: state?.home });
}

/** Recruit hand-off: the bot follows its owner through follow_owner. */
function startRecruit(player, state, owner, nowMs = Date.now()) {
  if (!player || !state || !owner) {
    return false;
  }
  const ownerUsername = owner.getUsername?.() ?? null;
  const entry = service?.runtime?.entriesByUsername?.get?.(player.getUsername?.());
  if (!entry || !service.registry?.byId?.get("follow_owner")) {
    return false;
  }
  const alreadyFollowing =
    entry.brain?.isRunningActivity("follow_owner") &&
    player.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME) === ownerUsername;
  player.setAttribute?.(ATTR_RECRUIT_OWNER_USERNAME, ownerUsername);
  player.setAttribute?.(ATTR_RECRUIT_RETURN_AFTER_DEATH_AT, null);
  player.setAttribute?.(ATTR_RECRUIT_OWNER_MISSING_SINCE, null);
  if (alreadyFollowing) {
    return true;
  }
  return startActivity(player, "follow_owner", {
    nowMs,
    home: state.home ?? player.getLocation?.(),
  });
}

module.exports = {
  configureBrainActivities,
  startActivity,
  startBrainRoam,
  startBankTrip,
  startReactivePvp,
  startRecruit,
};
