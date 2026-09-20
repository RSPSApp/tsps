"use strict";

const { CombatSpells } = require("../../../../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");
const { MagicSpellbook } = require("../../../../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { CombatType } = require("../../../../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { Location } = require("../../../../../src/main/typescript/elvarg/game/model/Location");
const { TimerKey } = require("../../../../../src/main/typescript/elvarg/util/timers/TimerKey");
const { WeaponInterfaces } = require("../../../../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaces");
const { requestMovement, peekMovementRequest, dispatchMovementRequest, clearMovementRequest } = require("../../navigation/BotNavigation");

const RANGED_WEAPON_INTERFACES = new Set([
  WeaponInterfaces.SHORTBOW,
  WeaponInterfaces.LONGBOW,
  WeaponInterfaces.DARK_BOW,
  WeaponInterfaces.CROSSBOW,
  WeaponInterfaces.KARILS_CROSSBOW,
  WeaponInterfaces.KNIFE,
  WeaponInterfaces.OBBY_RINGS,
  WeaponInterfaces.THROWNAXE,
  WeaponInterfaces.DART,
  WeaponInterfaces.JAVELIN,
]);

const PROFILE_FREEZE_SPELLS = Object.freeze({
  standard: CombatSpells.BIND,
  veteran: CombatSpells.SNARE,
  elite: CombatSpells.ENTANGLE,
});

class PvpFreezeAndKiteNode {
  constructor(options = {}) {
    this.setPhase = options.setPhase;
    this.getProfile = options.getProfile;
    this.scheduleCombatAction = options.scheduleCombatAction;
    this.scheduleFreezeReview = options.scheduleFreezeReview;
    this.regionManager = options.regionManager;
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

    const profile = this.getProfile?.(state) ?? null;
    const openerFreeze = this.shouldOpenWithFreeze(player, state, target, profile);

    if (!openerFreeze && nowMs < Number(pvp.nextFreezeReviewAt ?? 0)) {
      return { handled: false, status: "running" };
    }

    const finish = (handled = false, status = "running") => {
      this.scheduleFreezeReview?.(state, nowMs);
      return { handled, status };
    };

    if (!openerFreeze && nowMs < Number(pvp.nextActionAt ?? 0)) {
      return finish(false, "running");
    }

    if (!this.isMeleeOpponent(target)) {
      return finish(false, "running");
    }
    if (!this.hasBindableMagic(player)) {
      return finish(false, "running");
    }
    if (target.getTimers?.().has?.(TimerKey.FREEZE) || target.getTimers?.().has?.(TimerKey.FREEZE_IMMUNITY)) {
      return finish(false, "running");
    }

    const freezeSpell = PROFILE_FREEZE_SPELLS[profile?.id ?? ""] ?? null;
    if (!freezeSpell) {
      return finish(false, "running");
    }

    const freezeUseChance = Number(profile?.freezeUseChance ?? 0);
    if (!openerFreeze && (freezeUseChance <= 0 || Math.random() > freezeUseChance)) {
      return finish(false, "running");
    }

    const combat = player.getCombat?.();
    if (!combat) {
      return finish(false, "failure");
    }

    const currentTarget = combat.getTarget?.();
    if (currentTarget && currentTarget !== target) {
      combat.reset?.();
    }

    combat.castSpellOn?.(target, freezeSpell);
    pvp.lastFreezeAt = nowMs;
    this.scheduleCombatAction?.(state, nowMs);
    this.setPhase?.(state, this.pvpPhase?.COMBAT ?? "combat");
    return finish(true, "running");
  }

  maybeMoveBetweenHits(player, state, target, profile, nowMs) {
    const combat = player?.getCombat?.();
    const playerLoc = player?.getLocation?.();
    const targetLoc = target?.getLocation?.();
    if (!combat || !playerLoc || !targetLoc || playerLoc.getZ() !== targetLoc.getZ()) return false;
    if (player.getTimers?.().has?.(TimerKey.FREEZE)) return false;
    if (combat.getTarget?.() !== target && combat.getAttacker?.() !== target) return false;

    const delay = combat.getAttackDelay();
    const distance = Math.max(Math.abs(playerLoc.getX() - targetLoc.getX()),
      Math.abs(playerLoc.getY() - targetLoc.getY()));
    const method = combat.resolveMethodForCurrentCycle();
    const melee = method.type() === CombatType.MELEE;
    const targetMelee = target.getCombat().resolveMethodForCurrentCycle().type() === CombatType.MELEE;
    const canDeathDot = Number(profile?.confidenceTier ?? 0) >= 3 &&
      state?.pvp?.preferredCombatStyle === "hybrid" && distance <= 1 &&
      target.getTimers().has(TimerKey.FREEZE);
    let desiredDistance;
    let reason;
    if (canDeathDot) {
      desiredDistance = delay > 1 ? 0 : 1;
      reason = delay > 1 ? "pvp_death_dot" : "pvp_death_dot_step_out";
    } else if (delay > 1 && targetMelee) {
      // One tile out of melee reach; ranged styles keep a modest firing distance.
      desiredDistance = melee ? 2 : Math.min(3, method.attackDistance(player));
      reason = melee ? "pvp_step_back" : "pvp_kite";
      if (distance > desiredDistance) return false;
    } else {
      // Let ordinary combat following close the gap for the next hit.
      return false;
    }
    if (distance === desiredDistance) {
      if (delay > 1) {
        player.getMovementQueue().reset();
        combat.preserveMovementThisCycle();
      }
      return false;
    }
    // Returning from underneath is mandatory; initiating a tactic depends on skill.
    if (distance !== 0 && Math.random() > Number(profile?.combatMoveChance ?? 0)) return false;
    const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    const candidates = offsets.map(([dx, dy]) => {
      const tile = new Location(playerLoc.getX() + dx, playerLoc.getY() + dy, playerLoc.getZ());
      const tx = Math.abs(tile.getX() - targetLoc.getX());
      const ty = Math.abs(tile.getY() - targetLoc.getY());
      return { tile, distance: Math.max(tx, ty), diagonal: tx > 0 && ty > 0 };
    }).filter((candidate) =>
      Math.abs(candidate.distance - desiredDistance) < Math.abs(distance - desiredDistance) &&
      !(desiredDistance === 1 && candidate.diagonal) &&
      !this.regionManager.blocked(candidate.tile, player.getPrivateArea()) &&
      !this.regionManager.isWater(candidate.tile)
    ).sort((a, b) => Math.abs(a.distance - desiredDistance) - Math.abs(b.distance - desiredDistance));
    for (const { tile } of candidates) {
      if (this.moveCombatStep(player, tile.getX(), tile.getY(), {
        state, nowMs, basicPather: false, maxRouteSegmentTiles: 1, reason,
      })) return true;
    }
    return false;
  }

  moveCombatStep(player, x, y, options) {
    if (!requestMovement(player, x, y, options)) return false;
    const request = peekMovementRequest(player);
    const result = dispatchMovementRequest(player, request, options.state);
    if (peekMovementRequest(player) === request) clearMovementRequest(player);
    if (!result?.hasRoute) return false;
    // A blocked adjacent tile must not turn a combat step into a long detour.
    let previous = player.getLocation();
    let steps = 0;
    for (const point of player.getMovementQueue().pointsReturn()) {
      steps += Math.max(Math.abs(point.position.getX() - previous.getX()),
        Math.abs(point.position.getY() - previous.getY()));
      previous = point.position;
    }
    if (steps > 1) {
      player.getMovementQueue().reset();
      return false;
    }
    player.getCombat().preserveMovementThisCycle();
    return true;
  }

  shouldOpenWithFreeze(player, state, target, profile) {
    const profileId = profile?.id ?? "";
    if (profileId !== "veteran" && profileId !== "elite") {
      return false;
    }
    if (state?.pvp?.preferredCombatStyle === "melee") {
      return false;
    }
    const combat = player?.getCombat?.();
    const currentTarget = combat?.getTarget?.() ?? null;
    const attacker = combat?.getAttacker?.() ?? null;
    const alreadyEngaged =
      currentTarget === target ||
      attacker === target ||
      player?.getFollowing?.() === target ||
      player?.getCombatFollowing?.() === target;
    if (alreadyEngaged) {
      return false;
    }
    if (target?.getTimers?.().has?.(TimerKey.FREEZE) || target?.getTimers?.().has?.(TimerKey.FREEZE_IMMUNITY)) {
      return false;
    }
    return true;
  }

  hasBindableMagic(player) {
    if (!player) {
      return false;
    }
    if (player.getSpellbook?.() !== MagicSpellbook.NORMAL) {
      return false;
    }

    const autocastSpell = player.getCombat?.().getAutocastSpell?.() ?? null;
    if (autocastSpell?.spellId?.() === CombatSpells.ICE_BARRAGE.spellId()) {
      return false;
    }
    if (autocastSpell) {
      return true;
    }
    if (player.getEquipment?.().hasStaffEquipped?.()) {
      return true;
    }

    const inventoryItems = player.getInventory?.().getItems?.() ?? [];
    for (const item of inventoryItems) {
      const itemId = item?.getId?.() ?? -1;
      if (itemId <= 0) {
        continue;
      }
      const weaponInterface = item.getDefinition?.()?.getWeaponInterface?.();
      if (weaponInterface === WeaponInterfaces.STAFF || weaponInterface === WeaponInterfaces.ANCIENT_STAFF) {
        return true;
      }
    }
    return false;
  }

  isMeleeOpponent(target) {
    if (!target?.isPlayer?.()) {
      return false;
    }
    if (target.getEquipment?.().hasStaffEquipped?.()) {
      return false;
    }
    const weaponInterface = target.getWeapon?.();
    return !RANGED_WEAPON_INTERFACES.has(weaponInterface);
  }
}

module.exports = {
  PvpFreezeAndKiteNode,
};
