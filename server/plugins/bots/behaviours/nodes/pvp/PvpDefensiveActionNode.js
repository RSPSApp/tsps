"use strict";

const { Location } = require("../../../../../src/main/typescript/elvarg/game/model/Location");
const { hasGlobalWorldTag } = require("../../../../../src/main/typescript/elvarg/game/definition/WorldDefinition");
const { TeleportHandler } = require("../../../../../src/main/typescript/elvarg/game/model/teleportation/TeleportHandler");
const { TeleportType } = require("../../../../../src/main/typescript/elvarg/game/model/teleportation/TeleportType");
const { TimerKey } = require("../../../../../src/main/typescript/elvarg/util/timers/TimerKey");
const { Wilderness } = require("../../../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { CanAttackResponse } = require("../../../../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { queueRouteAndFlagAppearance, clearMovementRequest, peekMovementRequest, randomInRange } = require("../../navigation/BotNavigation");
const { applyGeneratedPvpLoadout } = require("../../policies/PvpLoadoutPolicy");
const { getEnabledWildernessHotspots, createHotspotAnchorLocation } = require("../../pvp/WildernessHotspotRegistry");

const RETREAT_STEP_TILES = 12;
const RETREAT_FOOD_CHARGES_MIN = 1;
const RETREAT_FOOD_CHARGES_MAX = 4;
const RETREAT_TELEPORT_LEVEL = 20;

class PvpDefensiveActionNode {
  constructor(options = {}) {
    this.setPhase = options.setPhase;
    this.stopPvp = options.stopPvp;
    this.api = options.api;
    this.getProfile = options.getProfile;
    this.pvpPhase = options.pvpPhase;
  }

  tick(context) {
    const { player, state, nowMs, target } = context ?? {};
    const pvp = state?.pvp;
    if (!player || !state || !pvp) {
      return { handled: true, status: "failure" };
    }

    const currentHp = Number(player.getHitpoints?.() ?? 0);
    if (currentHp <= 0 || player.isDyingReturn()) {
      return { handled: true, status: "failure" };
    }
    const foodCharges = state.virtualFoodChargesRemaining ?? this.getProfile(state).foodCharges;
    if (!Number.isInteger(pvp.retreatFoodCharges)) {
      pvp.retreatFoodCharges = randomInRange(RETREAT_FOOD_CHARGES_MIN, RETREAT_FOOD_CHARGES_MAX);
    }
    if (!pvp.retreat && foodCharges <= pvp.retreatFoodCharges) {
      pvp.retreat = { autoRetaliate: player.autoRetaliateReturn(), teleportStarted: false };
      player.setAutoRetaliate(false);
      clearMovementRequest(player);
      player.getMovementQueue().reset();
    }

    if (pvp.retreat) {
      return this.retreat(player, state, nowMs, target);
    }

    if (player.getForceMovement?.() != null) {
      this.setPhase?.(state, this.pvpPhase?.COMBAT ?? "combat");
      return { handled: true, status: "running" };
    }

    return { handled: false, status: "running" };
  }

  retreat(player, state, nowMs, target) {
    const pvp = state.pvp;
    const retreat = pvp.retreat;
    const running = { handled: true, status: "running" };
    this.setPhase(state, "retreating");
    if (player.isTeleportingReturn() || player.getForceMovement() != null) return running;

    const combat = player.getCombat();
    player.setCombatFollowing(null);
    player.setFollowing(null);
    const home = new Location(state.home.x, state.home.y, state.home.z ?? 0);
    const atHome = player.getLocation().equals(home);
    const arrived = retreat.destination && player.getLocation().equals(retreat.destination);
    if (retreat.teleportStarted) {
      // Discard combat links from the old location only after arriving.
      if (arrived) combat.setUnderAttack(null);
      retreat.teleportStarted = false;
    }
    if ((atHome || arrived) && !combat.getAttacker()) {
      // Walking home while teleblocked must finish the same recovery as teleporting.
      if (combat.getTarget()) combat.reset();
      clearMovementRequest(player);
      if (!applyGeneratedPvpLoadout(player, state, { api: this.api })) return running;
      state.virtualFoodChargesRemaining = null;
      player.setAutoRetaliate(retreat.autoRetaliate);
      pvp.retreat = null;
      this.stopPvp(player, state, nowMs, "retreated");
      return { handled: true, status: "success" };
    }

    const location = player.getLocation();
    const level = !hasGlobalWorldTag("pvp") && Wilderness.isIn(player)
      ? Wilderness.levelAt(location.getX(), location.getY()) : 0;
    const teleblocked = !combat.getTeleblockTimer().finished();
    if (level < RETREAT_TELEPORT_LEVEL && !teleblocked) {
      if (!retreat.destination) {
        const hotspots = getEnabledWildernessHotspots().filter((hotspot) =>
          location.getDistance(createHotspotAnchorLocation(hotspot)) > RETREAT_STEP_TILES
        );
        retreat.destination = createHotspotAnchorLocation(hotspots[Math.floor(Math.random() * hotspots.length)]) ?? home;
      }
      if (TeleportHandler.checkReqs(player, retreat.destination, RETREAT_TELEPORT_LEVEL)) {
        if (combat.getTarget()) combat.reset();
        clearMovementRequest(player);
        TeleportHandler.teleport(player, retreat.destination, TeleportType.NORMAL, false);
        retreat.teleportStarted = true;
        return running;
      }
    }

    if (player.getTimers().has(TimerKey.FREEZE) ||
        player.getMovementQueue().isMovementBlocked()) {
      clearMovementRequest(player);
      player.getMovementQueue().reset();
      return this.fightWhileTrapped(player, state, nowMs, target);
    }
    const pending = peekMovementRequest(player);
    if (pending?.noPathAttempts > 0 && pending.nextDispatchAtMs > nowMs &&
        player.getMovementQueue().size() === 0) {
      this.fightWhileTrapped(player, state, nowMs, target);
      return running;
    }
    if (combat.getTarget()) combat.reset();
    player.setRunning(player.getRunEnergy() > 0);
    if (level < RETREAT_TELEPORT_LEVEL && !combat.getAttacker()) {
      queueRouteAndFlagAppearance(player, home.getX(), home.getY(), {
        state, reason: "pvp_retreat_return",
      });
      return running;
    }
    // Run below the teleport limit; while blocked at lower levels, flee the pursuer.
    const attackerLocation = (combat.getAttacker() ?? target)?.getLocation();
    const dx = attackerLocation ? Math.sign(location.getX() - attackerLocation.getX()) : 1;
    const dy = attackerLocation ? Math.sign(location.getY() - attackerLocation.getY()) : 0;
    const deep = level >= RETREAT_TELEPORT_LEVEL;
    const targetX = location.getX() + (deep ? 0 : (dx || (dy ? 0 : 1)) * RETREAT_STEP_TILES);
    const targetY = location.getY() + (deep ? -RETREAT_STEP_TILES : dy * RETREAT_STEP_TILES);
    queueRouteAndFlagAppearance(player, targetX, targetY, { state, reason: "pvp_retreat" });
    return running;
  }

  fightWhileTrapped(player, state, nowMs, target) {
    const combat = player.getCombat();
    const attacker = combat.getAttacker() ?? target;
    const factory = this.api.getCombatFactory();
    if (!attacker || factory.canAttackPermission(player, attacker, false,
        factory.getMethod(player)) !== CanAttackResponse.CAN_ATTACK) {
      return { handled: true, status: "running" };
    }
    state.pvp.targetPlayer = attacker;
    state.pvp.targetUsername = attacker.getUsername();
    state.pvp.endsAt = Math.max(state.pvp.endsAt ?? 0, nowMs + 30000);
    if (combat.getTarget() !== attacker) combat.attack(attacker);
    return { handled: false, status: "running" };
  }
}

module.exports = {
  PvpDefensiveActionNode,
};
