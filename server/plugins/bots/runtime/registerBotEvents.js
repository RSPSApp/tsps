const {
  FriendsChatManager,
  CLAN_CHAT_ATTRIBUTE,
} = require("../../interface/FriendsChatManager");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
  ATTR_RECRUIT_RETURN_AFTER_DEATH_AT,
  ATTR_BOT_PVP_PROFILE_ID,
  getRecruitReturnDelayMs,
} = require("./BotRecruitConstants");
const {
  ATTR_SKIP_PERSISTENCE,
} = require("./BotPersistenceConstants");
const {
  isPvpOnlyBotState,
} = require("../behaviours/state/PlayerBotState");
const { startReactivePvp } = require("../brain/BrainActivities");
const {
  handlePlayerAttackReaction,
} = require("../brain/PlayerAttackReaction");
const {
  randomInRange,
} = require("../behaviours/navigation/BotNavigation");
const {
  initBotDeathLootCoreAccess,
  clearBotDeathLootPlan,
  handleBotDeathItemDrop,
} = require("./BotDeathLoot");

const CLAN_ASSIST_DURATION_MS = 30000;
const BOT_RESPAWN_REACQUIRE_DELAY_MIN_MS = 3500;
const BOT_RESPAWN_REACQUIRE_DELAY_MAX_MS = 7000;
const ATTR_RECRUIT_SINGLEWAY_WARN_UNTIL = "bot-recruit-singleway-warn-until";
const RECRUIT_SINGLEWAY_WARN_COOLDOWN_MS = 5000;

function isActiveClanRecruit(owner, bot) {
  if (!owner || !bot || owner.isPlayerBot?.() === true || bot.isPlayerBot?.() !== true) {
    return false;
  }
  if (owner.isRegistered?.() !== true || bot.isRegistered?.() !== true) {
    return false;
  }
  if ((owner.getHitpoints?.() ?? 0) <= 0 || (bot.getHitpoints?.() ?? 0) <= 0) {
    return false;
  }
  if (owner.getPrivateArea?.() !== bot.getPrivateArea?.()) {
    return false;
  }
  const ownerClan = FriendsChatManager.getOwnedChannel(owner);
  return ownerClan != null && bot.getAttribute?.(CLAN_CHAT_ATTRIBUTE) === ownerClan;
}

function clearPersistentPvpRespawnAggro(victim, runtime, nowMs) {
  if (!victim || victim.isPlayerBot?.() !== true) {
    return;
  }

  const username = victim.getUsername?.();
  if (!username) {
    return;
  }

  const entry = runtime?.entriesByUsername?.get?.(username);
  const state = entry?.state ?? runtime?.botStatesByName?.get?.(username);
  if (!isPvpOnlyBotState(state)) {
    return;
  }

  victim.getCombat?.().reset?.();
  victim.getCombat?.().setUnderAttack?.(null);
  victim.setFollowing?.(null);
  victim.setCombatFollowing?.(null);
  victim.setMobileInteraction?.(null);
  victim.setPositionToFace?.(null);
  victim.getMovementQueue?.().reset?.();

  state.pvp.phase = "seeking";
  state.pvp.targetUsername = null;
  state.pvp.targetPlayer = null;
  state.pvp.currentTargetScore = 0;
  state.pvp.targetLockUntil = 0;
  state.pvp.endsAt = 0;
  state.pvp.pjTargetUsername = null;
  state.pvp.pjExpiresAt = 0;
  state.pvp.pjVictimUsername = null;
  state.pvp.pjVictimExpiresAt = 0;
  state.pvp.nextActionAt =
    nowMs + randomInRange(BOT_RESPAWN_REACQUIRE_DELAY_MIN_MS, BOT_RESPAWN_REACQUIRE_DELAY_MAX_MS);

  if (state.autonomy) {
    state.autonomy.modeEndsAt = 0;
    state.autonomy.nextDecisionAt = Math.max(
      Number(state.autonomy.nextDecisionAt ?? 0),
      state.pvp.nextActionAt
    );
  }
}

function sharesClanChat(left, right) {
  if (!left || !right || left === right) {
    return false;
  }
  const leftClan = left.getAttribute?.(CLAN_CHAT_ATTRIBUTE);
  const rightClan = right.getAttribute?.(CLAN_CHAT_ATTRIBUTE);
  return leftClan != null && leftClan === rightClan;
}

function resolveClanRecruitCombatTarget(owner) {
  if (!owner || owner.isPlayerBot?.() === true) {
    return null;
  }
  const candidate =
    owner.getCombat?.().getTarget?.() ??
    owner.getCombat?.().getAttacker?.() ??
    owner.getCombatFollowing?.() ??
    owner.getInteractingEntity?.() ??
    null;
  if (!candidate || candidate === owner) {
    return null;
  }
  if (
    (candidate.isPlayer?.() !== true && candidate.isNpc?.() !== true) ||
    candidate.isRegistered?.() !== true
  ) {
    return null;
  }
  if ((candidate.getHitpoints?.() ?? 0) <= 0) {
    return null;
  }
  return candidate;
}

function maybeWarnRecruitSingleway(bot, owner, nowMs) {
  if (!bot || !owner) {
    return;
  }
  const warnUntil = Number(owner.getAttribute?.(ATTR_RECRUIT_SINGLEWAY_WARN_UNTIL) ?? 0);
  if (Number.isFinite(warnUntil) && nowMs < warnUntil) {
    return;
  }
  owner.setAttribute?.(
    ATTR_RECRUIT_SINGLEWAY_WARN_UNTIL,
    nowMs + RECRUIT_SINGLEWAY_WARN_COOLDOWN_MS
  );
  bot.forceChat?.("Sorry, not in multi- cant help");
}

function handleClanRecruitAssist({ runtime, behaviorMode, player, target, nowMs, api }) {
  if (!runtime || !behaviorMode || !player || player.isPlayerBot?.() === true || !target) {
    return;
  }
  if (target === player || target.isRegistered?.() !== true) {
    return;
  }
  if (sharesClanChat(player, target)) {
    return;
  }

  const ownerClan = FriendsChatManager.getOwnedChannel(player);
  if (!ownerClan) {
    return;
  }

  const AreaManager = api.getAreaManager();
  for (const [botUsername, entry] of runtime.entriesByUsername ?? []) {
    const bot = entry?.player;
    const state = entry?.state;
    if (!bot || !state) {
      continue;
    }
    if (bot.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME) !== player.getUsername?.()) {
      continue;
    }
    if (!isActiveClanRecruit(player, bot)) {
      continue;
    }

    if (!AreaManager.inMulti(player) || !AreaManager.inMulti(bot) || !AreaManager.inMulti(target)) {
      maybeWarnRecruitSingleway(bot, player, nowMs);
      continue;
    }

    const targetUsername = target.getUsername?.();
    const combat = bot.getCombat?.();
    const alreadyHelping =
      combat?.getTarget?.() === target ||
      bot.getCombatFollowing?.() === target ||
      state?.pvp?.targetPlayer === target ||
      (targetUsername && state?.pvp?.targetUsername === targetUsername);

    if (!alreadyHelping) {
      if (target.isPlayer?.() === true) {
        if (state.pvp) {
          state.pvp.targetUsername = target.getUsername?.() ?? null;
          state.pvp.targetPlayer = target;
          state.pvp.endsAt = nowMs + CLAN_ASSIST_DURATION_MS;
          state.pvp.nextActionAt = nowMs;
        }
        startReactivePvp(bot, state, nowMs);
      }
      bot.getMovementQueue?.().reset?.();
    } else if (target.isPlayer?.() === true && state?.pvp) {
      state.pvp.endsAt = Math.max(
        Number(state.pvp.endsAt ?? 0),
        nowMs + CLAN_ASSIST_DURATION_MS
      );
    }

    if (combat?.getTarget?.() !== target) {
      bot.getCombat?.().attack?.(target);
    }
  }
}

function recallClanRecruitsOnOwnerDefeat({ runtime, behaviorMode, owner, nowMs }) {
  if (!runtime || !behaviorMode || !owner || owner.isPlayerBot?.() === true) {
    return;
  }
  for (const [, entry] of runtime.entriesByUsername ?? []) {
    const bot = entry?.player;
    const state = entry?.state;
    if (!bot || !state) {
      continue;
    }
    if (bot.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME) !== owner.getUsername?.()) {
      continue;
    }

    bot.getCombat?.().reset?.();
    bot.getCombat?.().setUnderAttack?.(null);
    bot.setCombatFollowing?.(null);
    bot.getMovementQueue?.().reset?.();
    // The follow_owner brain keeps ticking; it re-snaps once the owner returns.
  }
}

function registerBotEvents(options) {
  const {
    api,
    botApi,
    runtime,
    behaviorMode,
    playerPersistence,
    npcAggroBlockedModes,
    avengeOpponentPolicy,
    pvpJumpOnKillPolicy,
    playerAttackFleeChance,
  } = options;

  initBotDeathLootCoreAccess(api);

  const handleRuntimeRemoval = ({ player, username, source }) => {
    if (
      player &&
      player.isPlayerBot?.() &&
      player.getAttribute?.(ATTR_SKIP_PERSISTENCE) !== true
    ) {
      try {
        playerPersistence.save(player);
      } catch (err) {
        botApi.log("bot_persistence_save_failed_disconnect", {
          username,
          error: String(err?.message ?? err),
        });
      }
    }
    const removed = runtime.handleDisconnect(player, username);
    if (removed) {
      botApi.log("botme_auto_disabled_disconnect", { username, source });
    }
  };

  api.onPlayerDisconnect(({ player, username }) => {
    handleRuntimeRemoval({
      player,
      username,
      source: "disconnect",
    });
  });

  api.onPlayerLogout(({ player, username }) => {
    handleRuntimeRemoval({
      player,
      username,
      source: "logout",
    });
  });

  api.onPlayerDeathItemDrop((event) => {
    handleBotDeathItemDrop(event, runtime);
  });

  api.onPlayerAttack(({ player, target }) => {
    const followed = target;
    const followedUsername = followed?.getUsername?.();
    if (
      !followed ||
      followed === player ||
      !followedUsername ||
      !runtime.playerBotUsernames.has(followedUsername) ||
      !followed.isRegistered?.()
    ) {
      return;
    }
    const state = runtime.botStatesByName.get(followedUsername);
    if (!state) {
      return;
    }
    handlePlayerAttackReaction({
      bot: followed,
      state,
      attacker: player,
      attackerIsPlayerBot: player.isPlayerBot?.() === true,
      nowMs: Date.now(),
      playerAttackFleeChance,
      api,
    });
  });

  // Manual object interactions (doors, levers, etc.) are the live equivalent
  // of the old MANUAL_CONTROL_PACKET_OPCODES set (which was exclusively the 5
  // object-click opcodes) - still the strongest "this player is at the
  // keyboard" signal available.
  api.onObjectInteraction((event) => {
    const { player, objectId } = event;
    const username = player?.getUsername?.();
    if (!username || !runtime.botmeUsernames.has(username)) {
      return;
    }

    const disabled = runtime.disableControllerForPlayer(player);
    if (!disabled) {
      return;
    }
    player.sendMessage("botme auto-disabled due to manual input.");
    botApi.log("botme_auto_disabled_manual_input", { username, objectId });
  });

  api.onPlayerProcess(({ player }) => {
    if (!player || player.isPlayerBot?.() === true) {
      return;
    }
    const target = resolveClanRecruitCombatTarget(player);
    if (!target) {
      return;
    }
    handleClanRecruitAssist({
      runtime,
      behaviorMode,
      player,
      target,
      api,
      nowMs: Date.now(),
    });
  });

  const blockedAggroModes = new Set(npcAggroBlockedModes ?? []);
  if (blockedAggroModes.size > 0) {
    api.onCanAttack((event) => {
      if (!event || event.allow !== null) {
        return;
      }
      const attacker = event.attacker;
      const target = event.target;
      if (attacker?.isNpc?.() !== true || target?.isPlayer?.() !== true) {
        return;
      }
      const player = target.getAsPlayer?.() ?? target;
      if (player?.isPlayerBot?.() !== true) {
        return;
      }
      const username = player.getUsername?.();
      const state = username ? runtime.botStatesByName.get(username) : null;
      if (state && blockedAggroModes.has(state.mode)) {
        event.allow = false;
      }
    });
  }

  if (avengeOpponentPolicy) {
    api.onPlayerDefeated((event) => {
      const victim = event?.victim;
      clearPersistentPvpRespawnAggro(victim, runtime, Date.now());
      if (victim?.isPlayerBot?.() === true) {
        const recruitOwnerUsername = victim.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME);
        if (recruitOwnerUsername) {
          const profileId =
            victim.getAttribute?.(ATTR_BOT_PVP_PROFILE_ID) ??
            runtime?.entriesByUsername?.get?.(victim.getUsername?.())?.state?.pvp?.profileId ??
            "standard";
          victim.setAttribute?.(
            ATTR_RECRUIT_RETURN_AFTER_DEATH_AT,
            Date.now() + getRecruitReturnDelayMs(profileId)
          );
        }
      }
      avengeOpponentPolicy.handle({
        killer: event?.killer,
        victim: event?.victim,
        nowMs: Date.now(),
      });
    });
  }

  api.onPlayerDefeated((event) => {
    clearBotDeathLootPlan(event?.victim);
    recallClanRecruitsOnOwnerDefeat({
      runtime,
      behaviorMode,
      owner: event?.victim,
      nowMs: Date.now(),
    });
  });

  api.onPlayerDefeated((event) => {
    const killer = event?.killer;
    const victim = event?.victim;
    if (killer?.isPlayerBot?.() !== true || victim?.isPlayerBot?.() !== true) {
      return;
    }
    const killerUsername = killer.getUsername?.();
    const killerEntry = killerUsername ? runtime?.entriesByUsername?.get?.(killerUsername) : null;
    const killerState = killerEntry?.state ?? runtime?.botStatesByName?.get?.(killerUsername);
    if (!killerState?.pvp) {
      return;
    }
    killerState.pvp.replenishAfterKillPending = true;
  });

  if (pvpJumpOnKillPolicy) {
    api.onPlayerDefeated((event) => {
      pvpJumpOnKillPolicy.handle({
        killer: event?.killer,
        victim: event?.victim,
        nowMs: Date.now(),
      });
    });
  }
}

module.exports = {
  registerBotEvents,
};
