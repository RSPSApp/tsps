"use strict";

const { GameConstants } = require("../../../../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../../../../src/main/typescript/elvarg/util/Misc");
const {
  FriendsChatManager,
  CLAN_CHAT_ATTRIBUTE,
} = require("../../../../interface/FriendsChatManager");
const { resolveAlternativeLoadoutId } = require("../../pvp/PvpAssignment");
const { applyGeneratedPvpLoadout } = require("../../policies/PvpLoadoutPolicy");
const {
  setModeFollowBack,
  setModePvp,
} = require("../../state/PlayerBotState");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
  ATTR_RECRUIT_RETURN_AFTER_DEATH_AT,
  ATTR_RECRUIT_OWNER_MISSING_SINCE,
} = require("../../../runtime/BotRecruitConstants");

const FOLLOW_REFRESH_MS = 30000;
const PVP_DURATION_MS = 30000;
const OWNER_MISSING_TIMEOUT_MS = 60000;

class ClanRecruitActionNode {
  constructor(botStatesByName, api, options) {
    this.botStatesByName = botStatesByName;
    this.api = api;
    this.World = api.getWorld();
    this.AreaManager = api.getAreaManager();
    this.RegionManager = api.getRegionManager();
    this.behaviorMode = options.behaviorMode;
  }

  tick(context) {
    const { player, state, nowMs } = context ?? {};
    if (!player || !state) {
      return "failure";
    }

    const ownerUsername = player.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME);
    if (!ownerUsername) {
      return "failure";
    }

    const owner = this.World.getPlayerByName(ownerUsername);
    if (!owner || owner.isRegistered?.() !== true) {
      const missingSince =
        Number(player.getAttribute?.(ATTR_RECRUIT_OWNER_MISSING_SINCE) ?? 0) || nowMs;
      player.setAttribute?.(ATTR_RECRUIT_OWNER_MISSING_SINCE, missingSince);
      if (nowMs - missingSince >= OWNER_MISSING_TIMEOUT_MS) {
        this.clearRecruitState(player, state);
        return "failure";
      }
      player.setFollowing?.(null);
      player.setMobileInteraction?.(null);
      player.setPositionToFace?.(null);
      return "running";
    }
    player.setAttribute?.(ATTR_RECRUIT_OWNER_MISSING_SINCE, null);
    if (!this.isActiveRecruit(owner, player)) {
      this.clearRecruitState(player, state);
      return "failure";
    }

    if (this.handleRespawnCooldown(player, state, owner, nowMs)) {
      return "running";
    }

    if (this.shouldSnapToOwner(player, owner)) {
      this.clearAssistCombatState(player, state, ownerUsername);
      this.resumeFollowOwner(player, state, owner, ownerUsername, nowMs);
      return "failure";
    }

    const assistTarget = this.resolveAssistTarget(player, owner);
    if (assistTarget) {
      this.teleportNearFollowerIfNeeded(player, assistTarget);
      player.setFollowing?.(assistTarget);
      player.setMobileInteraction?.(assistTarget);
      player.setPositionToFace?.(assistTarget.getLocation?.());
      if (assistTarget.isNpc?.() === true) {
        if (player.getCombat?.().getTarget?.() !== assistTarget) {
          player.getMovementQueue?.().reset?.();
          player.getCombat?.().attack?.(assistTarget);
        }
        return "running";
      }
      if (
        state.mode !== this.behaviorMode.PVP ||
        state?.pvp?.targetUsername !== assistTarget.getUsername?.()
      ) {
        setModePvp(
          player,
          state,
          assistTarget,
          nowMs,
          PVP_DURATION_MS,
          this.behaviorMode,
          { allowInCombatTransition: true }
        );
      }
      return "failure";
    }

    this.clearAssistCombatState(player, state, ownerUsername);
    this.resumeFollowOwner(player, state, owner, ownerUsername, nowMs);
    return "failure";
  }

  resumeFollowOwner(bot, state, owner, ownerUsername, nowMs) {
    if (bot.getPrivateArea?.() !== owner.getPrivateArea?.()) {
      bot.setArea?.(owner.getArea?.() ?? null);
    }
    this.teleportNearFollowerIfNeeded(bot, owner);
    bot.setFollowing?.(owner);
    bot.setMobileInteraction?.(owner);
    bot.setPositionToFace?.(owner.getLocation?.());
    if (
      state.mode !== this.behaviorMode.FOLLOW_BACK ||
      state.followTargetUsername !== ownerUsername ||
      nowMs >= Number(state.followUntilMs ?? 0) - 2000
    ) {
      setModeFollowBack(
        bot,
        state,
        owner,
        nowMs,
        FOLLOW_REFRESH_MS,
        this.behaviorMode,
        { allowInCombatTransition: true }
      );
    }
  }

  handleRespawnCooldown(bot, state, owner, nowMs) {
    const returnAt = Number(
      bot.getAttribute?.(ATTR_RECRUIT_RETURN_AFTER_DEATH_AT) ?? 0
    );
    if (!Number.isFinite(returnAt) || returnAt <= 0) {
      return false;
    }
    if (nowMs < returnAt) {
      this.clearAssistCombatState(bot, state, owner.getUsername?.());
      bot.setFollowing?.(null);
      bot.setMobileInteraction?.(null);
      bot.setPositionToFace?.(null);
      bot.getMovementQueue?.().reset?.();
      return true;
    }

    bot.setAttribute?.(ATTR_RECRUIT_RETURN_AFTER_DEATH_AT, null);
    if (state?.pvp) {
      state.pvp.loadoutId = resolveAlternativeLoadoutId(
        {},
        state.pvp.hotspotId ?? null,
        state.pvp.loadoutId ?? null
      );
      applyGeneratedPvpLoadout(bot, state);
    }
    this.clearAssistCombatState(bot, state, owner.getUsername?.());
    this.resumeFollowOwner(
      bot,
      state,
      owner,
      owner.getUsername?.(),
      nowMs
    );
    return true;
  }

  clearRecruitState(bot, state) {
    bot.setAttribute?.(ATTR_RECRUIT_OWNER_USERNAME, null);
    bot.setAttribute?.(ATTR_RECRUIT_OWNER_MISSING_SINCE, null);
    if (state?.autonomy?.manualMode === this.behaviorMode.FOLLOW_BACK) {
      state.autonomy.manualMode = null;
      state.autonomy.modeEndsAt = 0;
      state.autonomy.nextDecisionAt = 0;
    }
  }

  clearAssistCombatState(bot, state, ownerUsername) {
    const combat = bot.getCombat?.();
    const target = combat?.getTarget?.();
    const attacker = combat?.getAttacker?.();
    const followTargetUsername = state?.followTargetUsername;
    const ownerIsCombatTarget =
      target?.getUsername?.() === ownerUsername ||
      attacker?.getUsername?.() === ownerUsername ||
      followTargetUsername === ownerUsername;
    if (ownerIsCombatTarget) {
      return;
    }
    combat?.reset?.();
    combat?.setUnderAttack?.(null);
    bot.setCombatFollowing?.(null);
  }

  isActiveRecruit(owner, bot) {
    if (!owner || owner.isPlayerBot?.() === true || owner.isRegistered?.() !== true) {
      return false;
    }
    if ((bot.getHitpoints?.() ?? 0) <= 0) {
      return false;
    }
    const ownerClan = FriendsChatManager.getOwnedChannel(owner);
    return ownerClan != null && bot.getAttribute?.(CLAN_CHAT_ATTRIBUTE) === ownerClan;
  }

  shouldSnapToOwner(bot, owner) {
    const botLoc = bot.getLocation?.();
    const ownerLoc = owner.getLocation?.();
    if (!botLoc || !ownerLoc) {
      return false;
    }
    if (owner.isTeleportingReturn?.() === true) {
      return true;
    }
    return (
      ownerLoc.isWithinDistance?.(
        botLoc,
        GameConstants.PET_FOLLOW_AUTO_TELEPORT_DISTANCE
      ) !== true
    );
  }

  resolveAssistTarget(bot, owner) {
    if (!this.AreaManager.inMulti(owner) || !this.AreaManager.inMulti(bot)) {
      return null;
    }

    const candidate =
      owner.getCombat?.().getTarget?.() ??
      owner.getCombat?.().getAttacker?.() ??
      owner.getCombatFollowing?.() ??
      owner.getInteractingEntity?.() ??
      null;
    if (!candidate || candidate === bot || candidate === owner) {
      return null;
    }
    if (candidate.isNpc?.() === true) {
      return candidate.isRegistered?.() === true && (candidate.getHitpoints?.() ?? 0) > 0
        && (candidate.getPrivateArea?.() ?? null) === (bot.getPrivateArea?.() ?? null) ? candidate : null;
    }
    if (candidate.isPlayer?.() !== true) {
      return null;
    }
    if (candidate.isRegistered?.() !== true || (candidate.getHitpoints?.() ?? 0) <= 0) {
      return null;
    }
    if (candidate.getPrivateArea?.() !== bot.getPrivateArea?.()) {
      return null;
    }
    const ownerClan = owner.getAttribute?.(CLAN_CHAT_ATTRIBUTE);
    if (ownerClan != null && candidate.getAttribute?.(CLAN_CHAT_ATTRIBUTE) === ownerClan) {
      return null;
    }
    return candidate;
  }

  teleportNearFollowerIfNeeded(bot, follower) {
    const botLoc = bot.getLocation?.();
    const followerLoc = follower.getLocation?.();
    if (!botLoc || !followerLoc) {
      return;
    }
    if (
      follower.isTeleportingReturn?.() !== true &&
      followerLoc.isWithinDistance?.(
        botLoc,
        GameConstants.PET_FOLLOW_AUTO_TELEPORT_DISTANCE
      ) === true
    ) {
      return;
    }

    const tiles = [];
    for (const tile of follower.outterTiles?.() ?? []) {
      if (this.RegionManager.blocked?.(tile, follower.getPrivateArea?.())) {
        continue;
      }
      tiles.push(tile);
    }
    const destination =
      tiles.length > 0
        ? tiles[Misc.getRandom(tiles.length - 1)]
        : followerLoc;
    bot.moveTo?.(destination);
  }
}

module.exports = {
  ClanRecruitActionNode,
};
