"use strict";

const { GameConstants } = require("../../../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../../../src/main/typescript/elvarg/util/Misc");
const {
  FriendsChatManager,
  CLAN_CHAT_ATTRIBUTE,
} = require("../../../interface/FriendsChatManager");
const {
  resolveAlternativeLoadoutId,
} = require("../../behaviours/pvp/PvpAssignment");
const {
  applyGeneratedPvpLoadout,
} = require("../../behaviours/policies/PvpLoadoutPolicy");
const { startBrainRoam, startReactivePvp } = require("../BrainActivities");
const { playerState } = require("../ActionState");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
  ATTR_RECRUIT_RETURN_AFTER_DEATH_AT,
  ATTR_RECRUIT_OWNER_MISSING_SINCE,
} = require("../../runtime/BotRecruitConstants");

const OWNER_MISSING_TIMEOUT_MS = 60000;
const ASSIST_DURATION_MS = 30000;
const CLAN_GRACE_MS = 10000;

function resolveAssistTarget(world, bot, owner) {
  if (!world.areaManager?.inMulti?.(owner) || !world.areaManager?.inMulti?.(bot)) {
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
    return candidate.isRegistered?.() === true &&
      (candidate.getHitpoints?.() ?? 0) > 0 &&
      (candidate.getPrivateArea?.() ?? null) === (bot.getPrivateArea?.() ?? null)
      ? candidate
      : null;
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

function teleportNear(world, bot, follower) {
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
    if (world.regionManager?.blocked?.(tile, follower.getPrivateArea?.())) {
      continue;
    }
    tiles.push(tile);
  }
  const destination =
    tiles.length > 0 ? tiles[Misc.getRandom(tiles.length - 1)] : followerLoc;
  bot.moveTo?.(destination);
}

/**
 * Brain follow_owner: keeps a recruited bot following its owner, snaps to the
 * owner after teleports, re-gears after death and hands player-assist fights to
 * the nested pvp_engage overlay. Ends (success) when the owner is gone or the
 * clan membership is lost; the ephemeral brain then hands the bot back.
 */
function createFollowOwnerAction(spec, world) {
  const stateFor = (player) =>
    playerState(action, player, () => ({ ownerMissingSince: 0, startedAt: Date.now() }));

  function clearAssistCombatState(player, ownerUsername) {
    const combat = player.getCombat?.();
    const target = combat?.getTarget?.();
    const attacker = combat?.getAttacker?.();
    if (
      target?.getUsername?.() === ownerUsername ||
      attacker?.getUsername?.() === ownerUsername
    ) {
      return;
    }
    combat?.reset?.();
    combat?.setUnderAttack?.(null);
    player.setCombatFollowing?.(null);
  }

  function releaseRecruit(player, state, nowMs) {
    player.setAttribute?.(ATTR_RECRUIT_OWNER_USERNAME, null);
    player.setAttribute?.(ATTR_RECRUIT_OWNER_MISSING_SINCE, null);
    player.setFollowing?.(null);
    player.setMobileInteraction?.(null);
    player.setPositionToFace?.(null);
    player.setCombatFollowing?.(null);
    player.getMovementQueue?.().reset?.();
    player.getCombat?.().reset?.();
    player.getCombat?.().setUnderAttack?.(null);
    if (state?.pvp) {
      state.pvp.targetUsername = null;
      state.pvp.targetPlayer = null;
      state.pvp.phase = "idle";
      state.pvp.endsAt = 0;
    }
    startBrainRoam(player, state, nowMs, state?.home ?? null);
  }

  const action = {
    id: "followOwner",
    update(ctx) {
      const { player, state, nowMs } = ctx;
      if (!player || !state) {
        return "failed";
      }
      const bot = stateFor(player);
      const ownerUsername = player.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME);
      if (!ownerUsername) {
        return "success";
      }
      const owner = world.getPlayerByName?.(ownerUsername) ?? null;
      if (!owner || owner.isRegistered?.() !== true || (owner.getHitpoints?.() ?? 0) <= 0) {
        if (bot.ownerMissingSince === 0) {
          bot.ownerMissingSince = nowMs;
          player.setAttribute?.(ATTR_RECRUIT_OWNER_MISSING_SINCE, nowMs);
        }
        player.setFollowing?.(null);
        player.setMobileInteraction?.(null);
        player.setPositionToFace?.(null);
        player.getMovementQueue?.().reset?.();
        if (nowMs - bot.ownerMissingSince >= OWNER_MISSING_TIMEOUT_MS) {
          releaseRecruit(player, state, nowMs);
          return "success";
        }
        return "running";
      }
      if (bot.ownerMissingSince !== 0) {
        bot.ownerMissingSince = 0;
        player.setAttribute?.(ATTR_RECRUIT_OWNER_MISSING_SINCE, null);
      }

      // Clan membership is enforced once the FC join had time to land.
      const ownerClan = FriendsChatManager.getOwnedChannel(owner);
      const botClan = player.getAttribute?.(CLAN_CHAT_ATTRIBUTE);
      if (ownerClan && botClan && botClan !== ownerClan) {
        releaseRecruit(player, state, nowMs);
        return "success";
      }
      if (!ownerClan && nowMs - bot.startedAt > CLAN_GRACE_MS) {
        releaseRecruit(player, state, nowMs);
        return "success";
      }

      const returnAt = Number(
        player.getAttribute?.(ATTR_RECRUIT_RETURN_AFTER_DEATH_AT) ?? 0
      );
      if (returnAt > 0) {
        if (nowMs < returnAt) {
          clearAssistCombatState(player, ownerUsername);
          player.setFollowing?.(null);
          player.setMobileInteraction?.(null);
          player.setPositionToFace?.(null);
          player.getMovementQueue?.().reset?.();
          return "running";
        }
        player.setAttribute?.(ATTR_RECRUIT_RETURN_AFTER_DEATH_AT, null);
        if (state.pvp) {
          state.pvp.loadoutId = resolveAlternativeLoadoutId(
            {},
            state.pvp.hotspotId ?? null,
            state.pvp.loadoutId ?? null
          );
          applyGeneratedPvpLoadout(player, state);
        }
        clearAssistCombatState(player, ownerUsername);
      }

      if (player.getPrivateArea?.() !== owner.getPrivateArea?.()) {
        player.setArea?.(owner.getArea?.() ?? null);
      }
      teleportNear(world, player, owner);

      const assistTarget = resolveAssistTarget(world, player, owner);
      if (assistTarget) {
        teleportNear(world, player, assistTarget);
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
        if (state.pvp) {
          state.pvp.targetUsername = assistTarget.getUsername?.() ?? null;
          state.pvp.targetPlayer = assistTarget;
          state.pvp.endsAt = Math.max(
            Number(state.pvp.endsAt ?? 0),
            nowMs + ASSIST_DURATION_MS
          );
          state.pvp.nextActionAt = nowMs;
        }
        startReactivePvp(player, state, nowMs);
        return "running";
      }

      clearAssistCombatState(player, ownerUsername);
      player.setFollowing?.(owner);
      player.setMobileInteraction?.(owner);
      player.setPositionToFace?.(owner.getLocation?.());
      return "running";
    },
  };
  return action;
}

module.exports = {
  createFollowOwnerAction,
};
