const { PlayerRights } = require("../../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const { FriendsChatManager } = require("../../interface/FriendsChatManager");
const { isPvpOnlyBotState } = require("../behaviours/state/PlayerBotState");
const { ATTR_RECRUIT_OWNER_USERNAME } = require("./BotRecruitConstants");
const {
  startActivity,
  startBrainRoam,
  startRecruit,
} = require("../brain/BrainActivities");

function registerBotCommands(options) {
  const {
    api,
    botApi,
    runtime,
    behaviorMode,
    resetMovementState,
    taskManager,
    flashHintArrowTaskFactory,
    brainRegistry,
  } = options;

  const brainModes = [
    ...new Set(
      brainRegistry.activities
        .map((activity) => activity.mode)
        .filter(Boolean)
    ),
  ];
  const supportedBehaviorList = [
    ...new Set(brainModes),
    "recruit",
    "auto",
  ].sort((a, b) => a.localeCompare(b)).join("|");

  /** Brain activity for a requested behavior name, or null when unknown. */
  const findBrainActivity = (requested) => {
    if (requested === "pvp" || requested === "sparring") {
      return brainRegistry.byId?.get("pvp") ?? null;
    }
    if (
      requested === "recruit" ||
      requested === "follow" ||
      requested === "follow_owner"
    ) {
      return brainRegistry.byId?.get("follow_owner") ?? null;
    }
    const mode = requested;
    return (
      brainRegistry.activities?.find((activity) => activity.mode === mode) ?? null
    );
  };

  /** Swaps a controlled bot onto a brain activity, replacing its current one. */
  const assignBrainActivity = (target, state, activity) => {
    if (state.autonomy) {
      state.autonomy.manualMode = activity.mode;
      state.autonomy.modeEndsAt = Number.MAX_SAFE_INTEGER;
      state.autonomy.nextDecisionAt = Number.MAX_SAFE_INTEGER;
    }
    return startActivity(target, activity.id, {
      home: state.home ?? target.getLocation?.(),
    });
  };

  /** Hands a bot back to autonomous behavior: the brain roam activity. */
  const assignAutoBehavior = (target, state) => {
    if (!state.autonomy) {
      state.autonomy = {};
    }
    state.autonomy.manualMode = null;
    state.autonomy.modeEndsAt = 0;
    state.autonomy.nextDecisionAt = 0;
    if (!startBrainRoam(target, state)) {
      return false;
    }
    resetMovementState(target);
    return true;
  };

  const pendingRecruits = new Map();
  api.registerCommand("bot", ({ player, parts }) => {
    const requested = (parts[1] ?? "recruit").toLowerCase();
    const wantsAuto = requested === "auto";
    const isRecruitRequest =
      requested === "recruit" ||
      requested === "follow" ||
      requested === "follow_owner";
    const activity = findBrainActivity(requested);
    const normalizedBehavior = activity?.mode ?? (wantsAuto ? "auto" : null);
    if (!activity && !wantsAuto) {
      player.sendMessage(`Usage: ::bot [${supportedBehaviorList}] (default pvp)`);
      return true;
    }
    // Recruits spawn geared (pvp priming applies the generated loadout) and
    // follow the owner through the follow_owner brain; the clan-chat join waits
    // for the bot session in the drain below.
    if (isRecruitRequest) {
      const recruitActivity = findBrainActivity("recruit");
      if (!recruitActivity) {
        player.sendMessage("Recruit activity is unavailable.");
        return true;
      }
      const recruit = runtime.spawnPvpBot(player.getLocation(), {
        mode: behaviorMode.PVP,
      });
      if (!recruit) {
        player.sendMessage("Unable to spawn a bot right now.");
        return true;
      }
      const recruitUsername = recruit.getUsername?.();
      const recruitState = recruitUsername
        ? runtime.botStatesByName.get(recruitUsername)
        : null;
      const started =
        recruitState && startRecruit(recruit, recruitState, player);
      player.sendMessage(
        started
          ? `${recruitUsername} is geared and following you.`
          : `Unable to start following for ${recruitUsername}.`
      );
      if (started) {
        pendingRecruits.set(recruit, { owner: player, behavior: "recruit" });
      }
      return true;
    }
    const bot = runtime.spawnPvpBot(player.getLocation(), {
      mode: activity?.mode ?? normalizedBehavior,
    });
    if (!bot) {
      player.sendMessage("Unable to spawn a bot right now.");
      return true;
    }
    if (activity) {
      const attached = startActivity(bot, activity.id, { home: player.getLocation() });
      player.sendMessage(
        attached
          ? `${bot.getUsername()} spawned as ${activity.mode} (brain).`
          : `Unable to attach the brain to ${bot.getUsername()}.`
      );
      return true;
    }
    // The factory queues a world login. Clan membership and mode activation need the bot registered.
    pendingRecruits.set(bot, { owner: player, behavior: normalizedBehavior });
    return true;
  }, PlayerRights.DEVELOPER, "Manage player bots");
  api.onPlayerProcess(({ player: owner }) => {
    if (owner.isPlayerBot?.()) return;
    for (const [bot, pending] of pendingRecruits) {
      if (pending.owner !== owner || !bot.isRegistered()) continue;
      pendingRecruits.delete(bot);
      if (!owner.isRegistered()) continue;
      const username = bot.getUsername?.();
      const state = username ? runtime.botStatesByName.get(username) : null;
      if (pending.behavior === "recruit") {
        if (!owner.getRelations().getFriendsChatChannelName()) {
          FriendsChatManager.setOwnChannelName(owner, owner.getUsername());
        }
        const recruited = FriendsChatManager.recruitBot(owner, bot);
        bot.setArea(owner.getArea());
        bot.moveTo(owner.getLocation().clone());
        owner.sendMessage(
          recruited
            ? `${username} is geared, in your clan chat, and following you.`
            : `${username} is geared and following you, but could not join your clan chat.`
        );
        continue;
      }
      if (pending.behavior === "auto") {
        if (!state) {
          owner.sendMessage(`Unable to start auto for ${username}: missing bot state.`);
          continue;
        }
        if (state.autonomy) state.autonomy.allowedAutonomousModes = null;
        const assigned = assignAutoBehavior(bot, state);
        owner.sendMessage(assigned
          ? `${username} spawned as auto.`
          : `Unable to start auto for ${username}.`);
        botApi.log("bot_spawn_behavior_assigned", {
          assignedBy: owner.getUsername(),
          target: username,
          behavior: "auto",
          assigned,
        });
      }
    }
  });

  api.registerCommand("botme", ({ player, parts }) => {
    const mode = (parts[1] ?? "toggle").toLowerCase();
    if (mode === "status") {
      const enabled = runtime.hasControllerForPlayer(player);
      player.sendMessage(`botme: ${enabled ? "enabled" : "disabled"}`);
      return true;
    }

    const shouldEnable =
      mode === "on" ||
      mode === "start" ||
      (mode === "toggle" && !runtime.hasControllerForPlayer(player));

    if (shouldEnable) {
      const enabled = runtime.enableControllerForPlayer(player);
      if (!enabled.ok) {
        const reason =
          enabled.reason === "already_enabled"
            ? "already enabled"
            : enabled.reason === "not_registered"
            ? "player is not active"
            : "unable to enable";
        player.sendMessage(`botme: ${reason}.`);
        return true;
      }
      player.sendMessage(
        "botme enabled: your character is running PlayerBots behavior."
      );
      botApi.log("botme_enabled", { username: player.getUsername() });
      return true;
    }

    if (mode === "off" || mode === "stop" || mode === "toggle") {
      const disabled = runtime.disableControllerForPlayer(player);
      if (!disabled) {
        player.sendMessage("botme: already disabled.");
        return true;
      }
      player.sendMessage("botme disabled: your character is no longer bot-driven.");
      botApi.log("botme_disabled", { username: player.getUsername() });
      return true;
    }

    player.sendMessage("Usage: ::botme [on|off|toggle|status]");
    return true;
  }, PlayerRights.ADMINISTRATOR, "Control yourself as a bot");

  api.registerCommand("bh", ({ player, parts }) => {
    const usernameArg = parts[1];
    const behaviorArg = parts[2]?.toLowerCase();
    if (!usernameArg || !behaviorArg) {
      player.sendMessage(`Usage: ::bh <username> <${supportedBehaviorList}>`);
      return true;
    }

    const wantsAuto = behaviorArg === "auto";
    const activity = findBrainActivity(behaviorArg);
    if (!activity && !wantsAuto) {
      player.sendMessage(`Unknown behaviour. Supported: ${supportedBehaviorList}`);
      return true;
    }

    const target = runtime.resolveControlledPlayer(usernameArg);
    if (!target || !target.isRegistered()) {
      player.sendMessage(`bh: player not found: ${usernameArg}`);
      return true;
    }

    const targetUsername = target.getUsername?.();
    if (!targetUsername || !runtime.hasControllerForUsername(targetUsername)) {
      player.sendMessage(`bh: target is not bot-controlled: ${usernameArg}`);
      return true;
    }

    const state = runtime.botStatesByName.get(targetUsername);
    if (!state) {
      player.sendMessage(`bh: missing state for: ${targetUsername}`);
      return true;
    }

    if (wantsAuto) {
      if (!assignAutoBehavior(target, state)) {
        player.sendMessage(`bh: failed to switch ${targetUsername} to auto`);
        return true;
      }
      taskManager.submit(flashHintArrowTaskFactory(player, target));

      player.sendMessage(`bh: ${targetUsername} -> auto`);
      botApi.log("bot_behavior_assigned", {
        assignedBy: player.getUsername(),
        target: targetUsername,
        behavior: "auto",
      });
      return true;
    }

    if (activity) {
      if (activity.id === "follow_owner") {
        target.setAttribute?.(
          ATTR_RECRUIT_OWNER_USERNAME,
          player.getUsername?.() ?? null
        );
      }
      if (!assignBrainActivity(target, state, activity)) {
        player.sendMessage(`bh: failed to attach ${activity.id} to ${targetUsername}`);
        return true;
      }
    } else {
      if (!assignAutoBehavior(target, state)) {
        player.sendMessage(`bh: failed to switch ${targetUsername} to auto`);
        return true;
      }
    }
    taskManager.submit(flashHintArrowTaskFactory(player, target));

    const assigned = activity ? activity.mode : "auto";
    player.sendMessage(`bh: ${targetUsername} -> ${assigned}`);
    botApi.log("bot_behavior_assigned", {
      assignedBy: player.getUsername(),
      target: targetUsername,
      behavior: assigned,
    });
    return true;
  }, PlayerRights.ADMINISTRATOR, "Set bot behaviour");

  api.registerCommand("bothotspots", ({ player }) => {
    const countsByHotspot = new Map();
    const countsByLoadout = new Map();
    const countsByProfile = new Map();

    for (const entry of runtime.entries ?? []) {
      const state = entry?.state;
      if (!isPvpOnlyBotState(state)) {
        continue;
      }
      const hotspotId = state?.pvp?.hotspotId ?? "none";
      const loadoutId = state?.pvp?.loadoutId ?? "unknown";
      const profileId = state?.pvp?.profileId ?? "unknown";
      countsByHotspot.set(hotspotId, (countsByHotspot.get(hotspotId) ?? 0) + 1);
      countsByLoadout.set(loadoutId, (countsByLoadout.get(loadoutId) ?? 0) + 1);
      countsByProfile.set(profileId, (countsByProfile.get(profileId) ?? 0) + 1);
    }

    const formatCounts = (map) =>
      [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, count]) => `${key}:${count}`)
        .join(", ");

    player.sendMessage(
      `hotspots ${formatCounts(countsByHotspot) || "none"}`
    );
    player.sendMessage(
      `loadouts ${formatCounts(countsByLoadout) || "none"}`
    );
    player.sendMessage(
      `profiles ${formatCounts(countsByProfile) || "none"}`
    );
    return true;
  }, PlayerRights.ADMINISTRATOR, "Show bot hotspot counts");
}

module.exports = {
  registerBotCommands,
};
