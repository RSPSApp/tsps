"use strict";

const { PvpProfileId } = require("../../pvp/PvpProfileRegistry.PlayerBots");
const { isVisibleRealPlayer } = require("../../pvp/PvpTargetFilters.PlayerBots");
const { EatFoodActionNode } = require("../actions/EatFoodActionNode.PlayerBots");
const { usesSmiteOnlyPrayers } = require("../../pvp/WildernessHotspotRegistry.PlayerBots");

const PROTECTION_DURATION_MS = 10_000;
const RUNNING = Object.freeze({ handled: false, status: "running" });

class ReplenishAfterKillNode {
  constructor(botStatesByName, api) {
    this.api = api;
    this.PrayerHandler = api.getPrayerHandler();
    this.CombatFactory = api.getCombatFactory();
    this.eatFoodActionNode = new EatFoodActionNode(botStatesByName, api);
  }

  tick(context) {
    const { player, state } = context ?? {};
    const pvp = state?.pvp;
    if (!player || !state || !pvp) {
      return RUNNING;
    }
    const smiteOnly = usesSmiteOnlyPrayers(player, state);
    if (smiteOnly) {
      for (const prayerId of this.PrayerHandler.PROTECTION_PRAYERS) {
        if (this.PrayerHandler.isActivated(player, prayerId)) {
          this.PrayerHandler.deactivatePrayer(player, prayerId);
          pvp.nextPrayerReviewAt = 0;
        }
      }
      pvp.replenishPrayerId = null;
      pvp.replenishPrayerUntil = 0;
    }
    this.clearExpiredPrayerProtection(player, pvp);
    if (pvp.replenishAfterKillPending !== true) {
      return RUNNING;
    }

    pvp.replenishAfterKillPending = false;
    this.eatFoodActionNode.tick(context);
    if (smiteOnly) {
      return RUNNING;
    }

    const profileId = pvp.profileId;
    if (profileId !== PvpProfileId.VETERAN && profileId !== PvpProfileId.ELITE) {
      return RUNNING;
    }

    const closestRealPlayer = this.findClosestRealLocalPlayer(player);
    if (!closestRealPlayer) {
      return RUNNING;
    }

    const prayerId =
      profileId === PvpProfileId.ELITE
        ? this.resolveProtectPrayerForTarget(closestRealPlayer)
        : this.PrayerHandler.PROTECT_FROM_MELEE;

    this.PrayerHandler.activatePrayerPrayerId(player, prayerId);
    pvp.replenishPrayerId = prayerId;
    pvp.replenishPrayerUntil = Date.now() + PROTECTION_DURATION_MS;
    return RUNNING;
  }

  clearExpiredPrayerProtection(player, pvp) {
    const expiresAt = Number(pvp?.replenishPrayerUntil ?? 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0 || Date.now() < expiresAt) {
      return;
    }
    const prayerId = Number(pvp?.replenishPrayerId);
    if (Number.isInteger(prayerId) && this.PrayerHandler.isActivated(player, prayerId)) {
      this.PrayerHandler.deactivatePrayer(player, prayerId);
    }
    pvp.replenishPrayerId = null;
    pvp.replenishPrayerUntil = 0;
  }

  findClosestRealLocalPlayer(player) {
    const localPlayers = player.getLocalPlayers?.() ?? [];
    const playerLoc = player.getLocation?.();
    let bestTarget = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of localPlayers) {
      if (!isVisibleRealPlayer(player, candidate)) {
        continue;
      }
      const candidateLoc = candidate.getLocation?.();
      const distance = playerLoc && candidateLoc ? playerLoc.getDistance(candidateLoc) : 9999;
      if (distance < bestDistance) {
        bestTarget = candidate;
        bestDistance = distance;
      }
    }

    return bestTarget;
  }

  resolveProtectPrayerForTarget(target) {
    const combatType = this.CombatFactory.getMethod(target)?.type?.();
    return Number.isInteger(combatType)
      ? this.PrayerHandler.getProtectingPrayer(combatType)
      : this.PrayerHandler.PROTECT_FROM_MELEE;
  }
}

module.exports = {
  ReplenishAfterKillNode,
};
